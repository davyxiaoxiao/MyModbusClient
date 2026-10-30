import { useCallback, useEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api } from "./api";
import {
  buildBackup,
  exportFileName,
  fileNameOf,
  parseBackup,
  type ParsedBackup,
} from "./backup";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { VariableDialog } from "./components/VariableDialog";
import { Icon } from "./components/Icon";
import { ConfirmDialog, Toasts } from "./components/Overlays";
import { RequestLog } from "./components/RequestLog";
import { ValueGrid } from "./components/ValueGrid";
import { formatDuration } from "./format";
import {
  defaultVariableRange,
  isMergedVariable,
  newVariableId,
  validateVariable,
  type VariableDraft,
} from "./variables";
import {
  loadConfig,
  loadTableView,
  loadValues,
  loadVariables,
  saveConfig,
  saveTableView,
  saveValues,
  saveVariables,
} from "./storage";
import {
  AREAS,
  areaMeta,
  createEmptyValues,
  type AppConfig,
  type Area,
  type BitArea,
  type RegisterArea,
  type RegisterVariable,
  type SerialPortInfo,
  type Snapshot,
  type StartConfig,
  type TableView,
  type ToastMessage,
  type Transport,
  type Values,
  type VariablesByArea,
} from "./types";

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "操作失败，请重试";
}

function buildStartConfig(config: AppConfig): StartConfig | string {
  const unitId = Number(config.unitId);
  if (!Number.isInteger(unitId) || unitId < 1 || unitId > 255) {
    return "从站地址需在 1-255 之间";
  }

  if (config.transport === "rtu" && !config.serialPort) {
    return "请先选择串口设备";
  }

  const port = Number(config.port);
  if (
    config.transport === "tcp" &&
    (!Number.isInteger(port) || port < 1 || port > 65535)
  ) {
    return "TCP 端口需在 1-65535 之间";
  }

  return {
    transport: config.transport,
    host: config.host,
    port: config.transport === "tcp" ? port : 0,
    unitId,
    serialPort: config.serialPort,
    baudRate: config.baudRate,
    dataBits: 8,
    parity: config.parity,
    stopBits: config.stopBits,
  };
}

interface VariableEditorState {
  area: RegisterArea;
  variableId: string | null;
  start: number;
  count: number;
}

interface VariableDeleteState {
  area: RegisterArea;
  variable: RegisterVariable;
}

function isRegisterArea(area: Area): area is RegisterArea {
  return area === "holding" || area === "input";
}

function valuesEqual(left: Values, right: Values): boolean {
  return (
    left.holding.every((value, index) => value === right.holding[index]) &&
    left.input.every((value, index) => value === right.input[index]) &&
    left.coils.every((value, index) => value === right.coils[index]) &&
    left.discrete.every((value, index) => value === right.discrete[index])
  );
}

function fallbackCopy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

export default function App() {
  const [config, setConfig] = useState<AppConfig>(loadConfig);
  const [values, setValues] = useState<Values>(
    () => loadValues() ?? createEmptyValues()
  );
  const [activeArea, setActiveArea] = useState<Area>("holding");
  const [tableView, setTableView] = useState<TableView>(loadTableView);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [serialPorts, setSerialPorts] = useState<SerialPortInfo[]>([]);
  const [serialError, setSerialError] = useState<string | null>(null);
  const [localIps, setLocalIps] = useState<string[]>(["127.0.0.1"]);
  const [logsCollapsed, setLogsCollapsed] = useState(false);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const [variables, setVariables] = useState<VariablesByArea>(loadVariables);
  const [variableEditor, setVariableEditor] =
    useState<VariableEditorState | null>(null);
  const [variableToDelete, setVariableToDelete] =
    useState<VariableDeleteState | null>(null);
  const [pendingImport, setPendingImport] = useState<ParsedBackup | null>(
    null
  );

  const lastLocalEdit = useRef(0);
  const toastSequence = useRef(0);
  const seenError = useRef<string | null>(null);
  const reportedBridgeError = useRef(false);

  const toast = useCallback(
    (message: string, tone: ToastMessage["tone"] = "info") => {
      const id = ++toastSequence.current;
      setToasts((current) => [
        ...current.slice(-2),
        { id, message, tone },
      ]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== id));
      }, 4200);
    },
    []
  );

  const refresh = useCallback(
    async (forceValues = false): Promise<Snapshot | null> => {
      try {
        const next = await api.snapshot();
        setSnapshot(next);
        if (
          forceValues ||
          Date.now() - lastLocalEdit.current > 900
        ) {
          setValues((current) =>
            valuesEqual(current, next.values) ? current : next.values
          );
        }
        return next;
      } catch (error) {
        if (!reportedBridgeError.current) {
          reportedBridgeError.current = true;
          console.warn("无法读取后端状态", error);
        }
        return null;
      }
    },
    []
  );

  // Load saved values into the backend, then begin polling.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const initialize = async () => {
      const saved = loadValues();
      if (saved) {
        try {
          await api.restoreValues(saved);
          if (!cancelled) setValues(saved);
        } catch (error) {
          console.warn("恢复寄存器数据失败", error);
        }
      }
      if (cancelled) return;
      await refresh(true);
      if (cancelled) return;
      timer = window.setInterval(() => {
        void refresh();
      }, 700);
    };

    void initialize();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [refresh]);

  useEffect(() => {
    const timer = window.setTimeout(() => saveValues(values), 400);
    return () => window.clearTimeout(timer);
  }, [values]);

  useEffect(() => saveConfig(config), [config]);
  useEffect(() => saveVariables(variables), [variables]);
  useEffect(() => saveTableView(tableView), [tableView]);

  useEffect(() => {
    let active = true;
    api
      .localIps()
      .then((ips) => {
        if (active && ips.length > 0) setLocalIps(ips);
      })
      .catch(() => {
        // Keep localhost as a sensible fallback.
      });
    return () => {
      active = false;
    };
  }, []);

  const refreshSerialPorts = useCallback(async () => {
    try {
      const ports = await api.serialPorts();
      setSerialPorts(ports);
      setSerialError(null);
    } catch (error) {
      setSerialPorts([]);
      setSerialError(errorText(error));
    }
  }, []);

  useEffect(() => {
    if (config.transport !== "rtu") return;
    void refreshSerialPorts();
  }, [config.transport, refreshSerialPorts]);

  const running = snapshot?.running ?? false;
  const transport: Transport =
    running && snapshot?.transport ? snapshot.transport : config.transport;

  // Pick the first available serial port when the previous choice vanished.
  useEffect(() => {
    if (config.transport !== "rtu" || running) return;
    if (serialPorts.length === 0) return;
    if (!serialPorts.some((port) => port.portName === config.serialPort)) {
      setConfig((current) => ({
        ...current,
        serialPort: serialPorts[0].portName,
      }));
    }
  }, [config.transport, config.serialPort, running, serialPorts]);

  useEffect(() => {
    const error = snapshot?.lastError ?? null;
    if (!error) {
      seenError.current = null;
      return;
    }
    if (seenError.current !== error) {
      seenError.current = error;
      toast(error, "error");
    }
  }, [snapshot?.lastError, toast]);

  const updateConfig = useCallback((patch: Partial<AppConfig>) => {
    setConfig((current) => ({ ...current, ...patch }));
  }, []);

  const handleStart = useCallback(async () => {
    const startConfig = buildStartConfig(config);
    if (typeof startConfig === "string") {
      toast(startConfig, "error");
      return;
    }

    setBusy(true);
    try {
      await api.start(startConfig);
      lastLocalEdit.current = 0;
      await refresh(true);
      toast(
        startConfig.transport === "tcp"
          ? `TCP 从站已启动 · 端口 ${startConfig.port}`
          : `RTU 从站已启动 · ${startConfig.serialPort}`,
        "success"
      );
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(false);
    }
  }, [config, refresh, toast]);

  const handleStop = useCallback(async () => {
    setBusy(true);
    try {
      await api.stop();
      lastLocalEdit.current = 0;
      await refresh(true);
      toast("服务已停止", "info");
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(false);
    }
  }, [refresh, toast]);

  const handleToggle = useCallback(() => {
    if (busy) return;
    if (running) {
      void handleStop();
    } else {
      void handleStart();
    }
  }, [busy, handleStart, handleStop, running]);

  const handleCommitRegister = useCallback(
    async (area: RegisterArea, address: number, value: number) => {
      lastLocalEdit.current = Date.now();
      setValues((current) => {
        const list =
          area === "holding" ? current.holding : current.input;
        const next = list.slice();
        next[address] = value;
        return area === "holding"
          ? { ...current, holding: next }
          : { ...current, input: next };
      });

      try {
        await api.writeRegister(area, address, value);
      } catch (error) {
        lastLocalEdit.current = 0;
        toast(errorText(error), "error");
        void refresh(true);
      }
    },
    [refresh, toast]
  );

  const handleToggleBit = useCallback(
    async (area: BitArea, address: number, value: boolean) => {
      lastLocalEdit.current = Date.now();
      setValues((current) => {
        const list = area === "coil" ? current.coils : current.discrete;
        const next = list.slice();
        next[address] = value;
        return area === "coil"
          ? { ...current, coils: next }
          : { ...current, discrete: next };
      });

      try {
        await api.writeCoil(area, address, value);
      } catch (error) {
        lastLocalEdit.current = 0;
        toast(errorText(error), "error");
        void refresh(true);
      }
    },
    [refresh, toast]
  );

  const handleAddVariable = useCallback(() => {
    if (!isRegisterArea(activeArea)) return;
    const range = defaultVariableRange(variables[activeArea]);
    setVariableEditor({
      area: activeArea,
      variableId: null,
      start: range.start,
      count: range.count,
    });
  }, [activeArea, variables]);

  const handleEditVariable = useCallback(
    (variable: RegisterVariable) => {
      if (!isRegisterArea(activeArea)) return;
      setVariableEditor({
        area: activeArea,
        variableId: variable.id,
        start: variable.start,
        count: variable.end - variable.start + 1,
      });
    },
    [activeArea]
  );

  const handleToggleVariable = useCallback(
    (variable: RegisterVariable) => {
      if (!isRegisterArea(activeArea)) return;
      const area = activeArea;
      setVariables((current) => ({
        ...current,
        [area]: current[area].map((item) =>
          item.id === variable.id
            ? { ...item, collapsed: !item.collapsed }
            : item
        ),
      }));
    },
    [activeArea]
  );

  const handleSaveVariable = useCallback(
    (draft: VariableDraft) => {
      if (!variableEditor) return;
      const { area, variableId } = variableEditor;
      const message = validateVariable(
        draft,
        variables[area],
        variableId ?? undefined
      );
      if (message) {
        toast(message, "error");
        return;
      }
      const end = draft.start + draft.count - 1;

      setVariables((current) => {
        const areaVariables = current[area];
        const next = variableId
          ? areaVariables.map((variable) =>
              variable.id === variableId
                ? {
                    ...variable,
                    name: draft.name,
                    start: draft.start,
                    end,
                    merged: draft.merged,
                    type: draft.type,
                    order: draft.order,
                  }
                : variable
            )
          : [
              ...areaVariables,
              {
                id: newVariableId(),
                name: draft.name,
                start: draft.start,
                end,
                collapsed: false,
                merged: draft.merged,
                type: draft.type,
                order: draft.order,
              },
            ];
        next.sort((left, right) => left.start - right.start);
        return { ...current, [area]: next };
      });

      setVariableEditor(null);
      const kind = draft.merged ? "变量" : "分组";
      toast(
        variableId
          ? `${kind}已更新`
          : `已创建${kind}「${draft.name}」`,
        "success"
      );
    },
    [variableEditor, variables, toast]
  );

  const handleCommitVariable = useCallback(
    async (
      area: RegisterArea,
      variable: RegisterVariable,
      registers: number[]
    ) => {
      lastLocalEdit.current = Date.now();
      setValues((current) => {
        const list =
          area === "holding" ? current.holding : current.input;
        const next = list.slice();
        registers.forEach((value, offset) => {
          next[variable.start + offset] = value;
        });
        return area === "holding"
          ? { ...current, holding: next }
          : { ...current, input: next };
      });

      try {
        await api.writeRegisters(area, variable.start, registers);
      } catch (error) {
        lastLocalEdit.current = 0;
        toast(errorText(error), "error");
        void refresh(true);
      }
    },
    [refresh, toast]
  );

  const handleDeleteVariable = useCallback(() => {
    if (!variableToDelete) return;
    const { area, variable } = variableToDelete;
    setVariables((current) => ({
      ...current,
      [area]: current[area].filter((item) => item.id !== variable.id),
    }));
    setVariableToDelete(null);
    toast(
      `已删除${isMergedVariable(variable) ? "变量" : "分组"}「${
        variable.name
      }」`,
      "success"
    );
  }, [variableToDelete, toast]);

  const handleExport = useCallback(async () => {
    try {
      const path = await save({
        title: "导出 Modbus 配置",
        defaultPath: exportFileName(),
        filters: [{ name: "JSON 配置", extensions: ["json"] }],
      });
      if (!path) return;
      const payload = buildBackup(variables, values);
      await api.writeConfigFile(path, JSON.stringify(payload, null, 2));
      toast(`配置已导出：${fileNameOf(path)}`, "success");
    } catch (error) {
      toast(errorText(error), "error");
    }
  }, [toast, values, variables]);

  const handleImport = useCallback(async () => {
    try {
      const selected = await open({
        title: "导入 Modbus 配置",
        multiple: false,
        directory: false,
        filters: [{ name: "JSON 配置", extensions: ["json"] }],
      });
      if (!selected || Array.isArray(selected)) return;
      const text = await api.readConfigFile(selected);
      const parsed = parseBackup(text);
      if (!parsed.ok) {
        toast(parsed.error, "error");
        return;
      }
      setPendingImport(parsed.backup);
    } catch (error) {
      toast(errorText(error), "error");
    }
  }, [toast]);

  const handleConfirmImport = useCallback(async () => {
    if (!pendingImport) return;
    const imported = pendingImport;
    setPendingImport(null);
    try {
      if (imported.values) {
        await api.restoreValues(imported.values);
        lastLocalEdit.current = Date.now();
        setValues(imported.values);
      }
      setVariables(imported.variables);
      const valueNote = imported.values ? " 和全部寄存器值" : "";
      toast(
        `已导入 ${imported.variableCount} 个变量/分组${valueNote}`,
        "success"
      );
    } catch (error) {
      toast(errorText(error), "error");
    }
  }, [pendingImport, toast]);

  const handleBulk = useCallback(
    async (action: "clear" | "random") => {
      const meta = areaMeta(activeArea);
      try {
        if (action === "clear") {
          await api.clearArea(activeArea);
          toast(`${meta.name}已清零`, "success");
        } else {
          await api.randomizeArea(activeArea);
          toast(`${meta.name}已随机填充`, "success");
        }
        lastLocalEdit.current = 0;
        await refresh(true);
      } catch (error) {
        toast(errorText(error), "error");
      }
    },
    [activeArea, refresh, toast]
  );

  const handleRandomizeAll = useCallback(async () => {
    try {
      await Promise.all(AREAS.map((area) => api.randomizeArea(area.id)));
      lastLocalEdit.current = 0;
      await refresh(true);
      toast("全部数据区已随机填充", "success");
    } catch (error) {
      toast(errorText(error), "error");
    }
  }, [refresh, toast]);

  const handleConfirmClearAll = useCallback(async () => {
    setConfirmClearAll(false);
    try {
      await api.clearAll();
      lastLocalEdit.current = 0;
      await refresh(true);
      toast("全部数据已清零", "success");
    } catch (error) {
      toast(errorText(error), "error");
    }
  }, [refresh, toast]);

  const handleClearLogs = useCallback(async () => {
    try {
      await api.clearLogs();
      await refresh();
    } catch (error) {
      toast(errorText(error), "error");
    }
  }, [refresh, toast]);

  const handleCopy = useCallback(
    async (text: string) => {
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else if (!fallbackCopy(text)) {
          throw new Error("copy failed");
        }
      } catch {
        if (!fallbackCopy(text)) {
          toast("复制失败，请手动选择", "error");
          return;
        }
      }
      toast(`已复制 ${text}`, "success");
    },
    [toast]
  );

  const handleInvalidInput = useCallback(
    (label: string) => {
      toast(
        `地址 ${label} 的输入无效：请输入十进制、有符号数、0xFFFF 或 1A2F 这样的十六进制`,
        "error"
      );
    },
    [toast]
  );

  const listenDisplay = running ? snapshot?.listenAddr ?? "—" : "—";
  const idleEndpoint =
    config.transport === "tcp"
      ? `${config.host}:${config.port || "—"}`
      : config.serialPort || "未选择串口";
  const endpointDisplay = running ? listenDisplay : idleEndpoint;
  const unitDisplay = running ? snapshot?.unitId : config.unitId;
  const logTransport = running
    ? transport
    : snapshot?.logs[0]?.transport ?? transport;
  const uptime =
    running && snapshot?.startedAt
      ? formatDuration(Date.now() - snapshot.startedAt)
      : "—";
  const totalRequests = snapshot?.totalRequests ?? 0;
  const activeConnections = snapshot?.activeConnections ?? 0;
  const isRtu = transport === "rtu";

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <rect width="32" height="32" rx="9" fill="#0B1220" />
              <path
                d="M9 22.5v-12l7 6.5 7-6.5v12"
                fill="none"
                stroke="#2DD4BF"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="16" cy="24.2" r="1.6" fill="#99F6E4" />
            </svg>
          </div>
          <div className="brand-copy">
            <h1>Modbus 从机模拟器</h1>
            <p>TCP / RTU · 实时寄存器仿真</p>
          </div>
        </div>

        <div className="top-actions">
          <div className={`status-pill ${running ? "on" : "off"}`}>
            <span className="dot" />
            {running
              ? isRtu
                ? "RTU 运行中"
                : "TCP 运行中"
              : "已停止"}
          </div>
          <div className="session-info" title={endpointDisplay}>
            <span className="session-endpoint">{endpointDisplay}</span>
            {unitDisplay && (
              <span className="unit-chip">从站 {unitDisplay}</span>
            )}
          </div>
          <button
            type="button"
            className={`start-button ${running ? "stop" : ""}`}
            onClick={handleToggle}
            disabled={busy}
          >
            <Icon name={running ? "stop" : "play"} size={13} />
            {busy ? "处理中…" : running ? "停止服务" : "启动服务"}
          </button>
        </div>
      </header>

      <div className="layout">
        <aside className="sidebar">
          <ConnectionPanel
            config={config}
            running={running}
            serialPorts={serialPorts}
            serialError={serialError}
            localIps={localIps}
            onChange={updateConfig}
            onRefreshPorts={() => void refreshSerialPorts()}
            onCopy={handleCopy}
          />

          <section className="card quick-card">
            <div className="card-title">
              <span>快捷操作</span>
              <span className="card-tag">全部数据区</span>
            </div>
            <div className="quick-actions">
              <button
                type="button"
                className="quick-btn"
                onClick={() => void handleRandomizeAll()}
              >
                <span className="quick-icon">
                  <Icon name="shuffle" size={14} />
                </span>
                <span className="quick-text">
                  <strong>随机填充</strong>
                  <small>四个数据区</small>
                </span>
              </button>
              <button
                type="button"
                className="quick-btn danger"
                onClick={() => setConfirmClearAll(true)}
              >
                <span className="quick-icon">
                  <Icon name="eraser" size={14} />
                </span>
                <span className="quick-text">
                  <strong>全部清零</strong>
                  <small>100 × 4 个点</small>
                </span>
              </button>
            </div>

            <div className="backup-block">
              <div className="backup-actions">
                <button
                  type="button"
                  className="backup-btn"
                  onClick={() => void handleExport()}
                  title="导出变量定义和全部寄存器/线圈值"
                >
                  <Icon name="download" size={12} />
                  导出配置
                </button>
                <button
                  type="button"
                  className="backup-btn"
                  onClick={() => void handleImport()}
                  title="从 JSON 文件导入变量定义和全部数值"
                >
                  <Icon name="upload" size={12} />
                  导入配置
                </button>
              </div>
            </div>
          </section>

          <section className="card stats-card">
            <div className="card-title">
              <span>运行状态</span>
              <span className={`mini-dot ${running ? "on" : ""}`} />
            </div>
            <div className="stat-row">
              <span>接收帧数</span>
              <strong className="mono">{totalRequests}</strong>
            </div>
            <div className="stat-row">
              <span>{isRtu ? "串口状态" : "活动连接"}</span>
              <strong>
                {isRtu
                  ? running
                    ? "已打开"
                    : "未打开"
                  : activeConnections}
              </strong>
            </div>
            <div className="stat-row">
              <span>运行时长</span>
              <strong className="mono">{uptime}</strong>
            </div>
            <div className="autosave">
              <Icon name="check" size={11} />
              参数与寄存器值自动保存
            </div>
          </section>
        </aside>

        <main className="main">
          {snapshot?.lastError && (
            <div className="error-banner" role="alert">
              <Icon name="alert" size={15} />
              <div>
                <strong>通信异常</strong>
                <span>{snapshot.lastError}</span>
              </div>
            </div>
          )}

          <ValueGrid
            activeArea={activeArea}
            values={values}
            variables={variables[activeArea]}
            tableView={tableView}
            onTableViewChange={setTableView}
            onTabChange={setActiveArea}
            onCommitRegister={handleCommitRegister}
            onToggleBit={handleToggleBit}
            onBulk={handleBulk}
            onInvalidInput={handleInvalidInput}
            onAddVariable={handleAddVariable}
            onEditVariable={handleEditVariable}
            onDeleteVariable={(variable) => {
              if (isRegisterArea(activeArea)) {
                setVariableToDelete({ area: activeArea, variable });
              }
            }}
            onToggleVariable={handleToggleVariable}
            onCommitVariable={handleCommitVariable}
            onInvalidVariable={(message) => toast(message, "error")}
          />

          <RequestLog
            logs={snapshot?.logs ?? []}
            collapsed={logsCollapsed}
            running={running}
            transport={logTransport}
            onClear={() => void handleClearLogs()}
            onToggle={() => setLogsCollapsed((current) => !current)}
          />
        </main>
      </div>

      <ConfirmDialog
        open={confirmClearAll}
        title="清零全部数据？"
        description="线圈、离散输入、保持寄存器和输入寄存器将全部重置为 0，此操作无法撤销。"
        confirmLabel="全部清零"
        onCancel={() => setConfirmClearAll(false)}
        onConfirm={() => void handleConfirmClearAll()}
      />

      <ConfirmDialog
        open={variableToDelete !== null}
        title={
          variableToDelete
            ? `删除${
                isMergedVariable(variableToDelete.variable)
                  ? "变量"
                  : "分组"
              }「${variableToDelete.variable.name}」？`
            : "删除变量/分组？"
        }
        description="只会移除界面上的变量或分组定义，不会修改寄存器数据或 Modbus 地址。"
        confirmLabel={
          variableToDelete && isMergedVariable(variableToDelete.variable)
            ? "删除变量"
            : "删除分组"
        }
        onCancel={() => setVariableToDelete(null)}
        onConfirm={handleDeleteVariable}
      />

      <ConfirmDialog
        open={pendingImport !== null}
        title="导入配置？"
        description={
          pendingImport
            ? `文件中包含 ${pendingImport.variableCount} 个变量/分组${
                pendingImport.values ? "，以及四个数据区的 400 个值" : ""
              }。导入会覆盖当前配置${
                pendingImport.values ? "和数值" : ""
              }；TCP/串口连接参数不受影响。`
            : ""
        }
        confirmLabel="导入配置"
        tone="primary"
        onCancel={() => setPendingImport(null)}
        onConfirm={() => void handleConfirmImport()}
      />

      {variableEditor && (
        <VariableDialog
          meta={areaMeta(variableEditor.area)}
          variables={variables[variableEditor.area]}
          editing={
            variableEditor.variableId
              ? variables[variableEditor.area].find(
                  (variable) => variable.id === variableEditor.variableId
                ) ?? null
              : null
          }
          registers={
            variableEditor.area === "holding"
              ? values.holding
              : values.input
          }
          initialStart={variableEditor.start}
          initialCount={variableEditor.count}
          onCancel={() => setVariableEditor(null)}
          onSave={handleSaveVariable}
        />
      )}

      <Toasts toasts={toasts} />
    </div>
  );
}
