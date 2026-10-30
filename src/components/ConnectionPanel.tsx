import { Icon } from "./Icon";
import type { AppConfig, SerialPortInfo } from "../types";

const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

interface ConnectionPanelProps {
  config: AppConfig;
  running: boolean;
  serialPorts: SerialPortInfo[];
  serialError: string | null;
  localIps: string[];
  onChange: (patch: Partial<AppConfig>) => void;
  onRefreshPorts: () => void;
  onCopy: (text: string) => void;
}

export function ConnectionPanel({
  config,
  running,
  serialPorts,
  serialError,
  localIps,
  onChange,
  onRefreshPorts,
  onCopy,
}: ConnectionPanelProps) {
  const selectedPort = serialPorts.find(
    (port) => port.portName === config.serialPort
  );
  const numericFilter = (value: string) => value.replace(/\D/g, "");
  const displayIps =
    config.host === "127.0.0.1" ? ["127.0.0.1"] : localIps;

  return (
    <section className="card connection-card">
      <div className="card-title">
        <span>连接设置</span>
        <span className={`card-status ${running ? "on" : ""}`}>
          {running ? "运行中" : "待机"}
        </span>
      </div>

      <div className="transport-switch" role="group" aria-label="通信方式">
        <button
          type="button"
          className={config.transport === "tcp" ? "active" : ""}
          onClick={() => onChange({ transport: "tcp" })}
          disabled={running}
        >
          <Icon name="network" size={14} />
          TCP 网络
        </button>
        <button
          type="button"
          className={config.transport === "rtu" ? "active" : ""}
          onClick={() => onChange({ transport: "rtu" })}
          disabled={running}
        >
          <Icon name="serial" size={14} />
          RTU 串口
        </button>
      </div>

      {config.transport === "tcp" ? (
        <>
          <label className="field">
            <span>监听地址</span>
            <select
              value={config.host}
              onChange={(event) => onChange({ host: event.target.value })}
              disabled={running}
            >
              <option value="0.0.0.0">0.0.0.0 · 所有网卡</option>
              <option value="127.0.0.1">127.0.0.1 · 仅本机</option>
            </select>
          </label>
          <div className="field-row">
            <label className="field">
              <span>TCP 端口</span>
              <input
                className="mono"
                inputMode="numeric"
                value={config.port}
                maxLength={5}
                onChange={(event) =>
                  onChange({ port: numericFilter(event.target.value) })
                }
                disabled={running}
              />
            </label>
            <label className="field">
              <span>从站地址</span>
              <input
                className="mono"
                inputMode="numeric"
                value={config.unitId}
                maxLength={3}
                onChange={(event) =>
                  onChange({ unitId: numericFilter(event.target.value) })
                }
                disabled={running}
              />
            </label>
          </div>
          <p className="field-hint">
            客户端通过下方地址连接，从站地址需与上方保持一致。
          </p>

          <div className="connect-block">
            <div className="mini-label">
              <Icon name="link" size={11} />
              客户端连接地址
            </div>
            <div className="addr-list">
              {displayIps.map((ip) => (
                <button
                  type="button"
                  className="addr-chip"
                  key={ip}
                  onClick={() => onCopy(`${ip}:${config.port || "5020"}`)}
                  title="点击复制"
                >
                  <span>
                    {ip}:{config.port || "5020"}
                  </span>
                  <Icon name="copy" size={10} />
                </button>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <label className="field">
            <span>
              串口设备
              <button
                type="button"
                className="inline-action"
                onClick={onRefreshPorts}
                disabled={running}
              >
                <Icon name="refresh" size={11} />
                刷新
              </button>
            </span>
            <select
              value={config.serialPort}
              onChange={(event) =>
                onChange({ serialPort: event.target.value })
              }
              disabled={running || serialPorts.length === 0}
            >
              {serialPorts.length === 0 ? (
                <option value="">
                  {serialError ? "读取串口列表失败" : "未检测到串口设备"}
                </option>
              ) : (
                <>
                  {!selectedPort && <option value="">请选择串口</option>}
                  {serialPorts.map((port) => (
                    <option key={port.portName} value={port.portName}>
                      {port.portName}
                      {port.detail ? ` · ${port.detail}` : ""}
                    </option>
                  ))}
                </>
              )}
            </select>
          </label>
          {selectedPort && (
            <div className="serial-meta">
              <span className="kind-badge">{selectedPort.kind}</span>
              <span>{selectedPort.detail ?? "串口设备"}</span>
            </div>
          )}
          {serialError && <p className="inline-error">{serialError}</p>}

          <div className="field-row">
            <label className="field">
              <span>波特率</span>
              <select
                value={config.baudRate}
                onChange={(event) =>
                  onChange({ baudRate: Number(event.target.value) })
                }
                disabled={running}
              >
                {BAUD_RATES.map((rate) => (
                  <option key={rate} value={rate}>
                    {rate}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>从站地址</span>
              <input
                className="mono"
                inputMode="numeric"
                value={config.unitId}
                maxLength={3}
                onChange={(event) =>
                  onChange({ unitId: numericFilter(event.target.value) })
                }
                disabled={running}
              />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>校验位</span>
              <select
                value={config.parity}
                onChange={(event) =>
                  onChange({
                    parity: event.target.value as AppConfig["parity"],
                  })
                }
                disabled={running}
              >
                <option value="none">无校验 (N)</option>
                <option value="even">偶校验 (E)</option>
                <option value="odd">奇校验 (O)</option>
              </select>
            </label>
            <label className="field">
              <span>停止位</span>
              <select
                value={config.stopBits}
                onChange={(event) =>
                  onChange({ stopBits: Number(event.target.value) })
                }
                disabled={running}
              >
                <option value={1}>1 位</option>
                <option value={2}>2 位</option>
              </select>
            </label>
          </div>
          <p className="field-hint">
            RS485 转换器常用 9600 8N1，数据位固定为 8。
          </p>
        </>
      )}

      <p className="field-hint muted-hint">
        {running
          ? "参数已锁定，停止服务后可修改。"
          : "修改参数后，点击右上角「启动服务」生效。"}
      </p>
    </section>
  );
}

