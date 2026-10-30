import {
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";
import {
  colorForVariable,
  decodeVariable,
  encodeVariable,
  formatVariableValue,
  isMergedVariable,
  parseVariableHexInput,
  parseVariableInput,
  variableHexDigits,
  variableRegisterCount,
  VARIABLE_TYPES,
  type VariableColor,
} from "../variables";
import {
  formatHexDigits,
  parseHexInput,
  parseRegisterInput,
  plcLabel,
  signedValue,
} from "../format";
import {
  AREAS,
  areaMeta,
  type Area,
  type AreaMeta,
  type BitArea,
  type RegisterArea,
  type RegisterVariable,
  type TableView,
  type Values,
} from "../types";

interface ValueGridProps {
  activeArea: Area;
  values: Values;
  variables: RegisterVariable[];
  tableView: TableView;
  onTableViewChange: (view: TableView) => void;
  onTabChange: (area: Area) => void;
  onCommitRegister: (
    area: RegisterArea,
    address: number,
    value: number
  ) => void;
  onToggleBit: (area: BitArea, address: number, value: boolean) => void;
  onBulk: (action: "clear" | "random") => void;
  onInvalidInput: (label: string) => void;
  onAddVariable: () => void;
  onEditVariable: (variable: RegisterVariable) => void;
  onDeleteVariable: (variable: RegisterVariable) => void;
  onToggleVariable: (variable: RegisterVariable) => void;
  onCommitVariable: (
    area: RegisterArea,
    variable: RegisterVariable,
    registers: number[]
  ) => void;
  onInvalidVariable: (message: string) => void;
}

function variableStyle(variable: RegisterVariable): CSSProperties {
  const color: VariableColor = colorForVariable(variable.id);
  return {
    "--group-accent": color.accent,
    "--group-tint": color.tint,
  } as CSSProperties;
}

export function ValueGrid({
  activeArea,
  values,
  variables,
  tableView,
  onTableViewChange,
  onTabChange,
  onCommitRegister,
  onToggleBit,
  onBulk,
  onInvalidInput,
  onAddVariable,
  onEditVariable,
  onDeleteVariable,
  onToggleVariable,
  onCommitVariable,
  onInvalidVariable,
}: ValueGridProps) {
  const meta = areaMeta(activeArea);
  const registerValues =
    activeArea === "holding" ? values.holding : values.input;
  const bitValues = activeArea === "coil" ? values.coils : values.discrete;
  const orderedVariables = [...variables].sort((a, b) => a.start - b.start);
  const variableByStart = new Map(
    orderedVariables.map((variable) => [variable.start, variable])
  );
  const showVariableList =
    meta.kind === "register" && tableView === "variables";

  const renderRegisterRow = (
    index: number,
    variable: RegisterVariable | null
  ): ReactNode => {
    const value = registerValues[index];
    return (
      <tr
        key={index}
        className={`${value !== 0 ? "has-value" : ""} ${
          variable ? "grouped" : ""
        }`}
        style={variable ? variableStyle(variable) : undefined}
      >
        <td className="cell-plc">{plcLabel(meta, index)}</td>
        <td className="cell-offset">{index}</td>
        <td className="cell-edit">
          <RegisterInput
            address={index}
            label={plcLabel(meta, index)}
            value={value}
            onCommit={(address, nextValue) =>
              onCommitRegister(activeArea as RegisterArea, address, nextValue)
            }
            onInvalid={() => onInvalidInput(plcLabel(meta, index))}
          />
        </td>
        <td className="cell-edit">
          <HexInput
            address={index}
            label={plcLabel(meta, index)}
            value={value}
            onCommit={(address, nextValue) =>
              onCommitRegister(activeArea as RegisterArea, address, nextValue)
            }
            onInvalid={() => onInvalidInput(plcLabel(meta, index))}
          />
        </td>
        <td className={`cell-mono ${value === 0 ? "dim" : ""}`}>
          {signedValue(value)}
        </td>
      </tr>
    );
  };

  const buildRegisterRows = (): ReactNode[] => {
    const rows: ReactNode[] = [];
    let index = 0;
    while (index < registerValues.length) {
      const variable = variableByStart.get(index);
      if (variable) {
        rows.push(
          <VariableHeaderRow
            key={`variable-${variable.id}`}
            variable={variable}
            meta={meta}
            registers={registerValues.slice(
              variable.start,
              variable.end + 1
            )}
            area={activeArea as RegisterArea}
            onToggle={onToggleVariable}
            onEdit={onEditVariable}
            onDelete={onDeleteVariable}
            onCommit={onCommitVariable}
            onInvalid={onInvalidVariable}
          />
        );
        if (!variable.collapsed) {
          for (let offset = variable.start; offset <= variable.end; offset += 1) {
            rows.push(renderRegisterRow(offset, variable));
          }
        }
        index = variable.end + 1;
      } else {
        rows.push(renderRegisterRow(index, null));
        index += 1;
      }
    }
    return rows;
  };

  const registerRows = buildRegisterRows();

  return (
    <section className="card workspace-card">
      <div className="workspace-top">
        <div className="tabs" role="tablist" aria-label="数据区">
          {AREAS.map((area) => (
            <button
              type="button"
              role="tab"
              key={area.id}
              aria-selected={activeArea === area.id}
              className={`tab ${activeArea === area.id ? "active" : ""}`}
              onClick={() => onTabChange(area.id)}
            >
              <span className="tab-name">{area.name}</span>
              <span className="tab-badge">{area.short}</span>
            </button>
          ))}
        </div>
        {meta.kind === "register" && (
          <div className="view-switch" role="group" aria-label="表格视图">
            <button
              type="button"
              className={tableView === "registers" ? "active" : ""}
              onClick={() => onTableViewChange("registers")}
            >
              寄存器
            </button>
            <button
              type="button"
              className={tableView === "variables" ? "active" : ""}
              onClick={() => onTableViewChange("variables")}
            >
              变量
            </button>
          </div>
        )}
      </div>

      <div className="value-toolbar">
        <div className="area-heading">
          <h2>{meta.name}</h2>
          <span className="area-sub">
            功能码 {meta.codes} · 100 个{meta.kind === "bit" ? "位" : "寄存器"}
            {meta.kind === "register" && orderedVariables.length > 0
              ? ` · ${orderedVariables.length} 个变量/分组`
              : ""}
            {meta.kind === "register"
              ? " · 数值 / HEX 可编辑"
              : " · 点击状态切换"}
          </span>
        </div>
        <div className="toolbar-actions">
          {meta.kind === "register" && (
            <button
              type="button"
              className="ghost-btn"
              onClick={onAddVariable}
              title="新建变量或分组"
            >
              <Icon name="tag" size={12} />
              新建变量
            </button>
          )}
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onBulk("random")}
          >
            <Icon name="shuffle" size={12} />
            随机
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onBulk("clear")}
          >
            <Icon name="eraser" size={12} />
            清零
          </button>
        </div>
      </div>

      <div className="table-scroll">
        {showVariableList ? (
          <VariableList
            variables={orderedVariables}
            registers={registerValues}
            meta={meta}
            area={activeArea as RegisterArea}
            onAddVariable={onAddVariable}
            onEdit={onEditVariable}
            onDelete={onDeleteVariable}
            onCommit={onCommitVariable}
            onInvalid={onInvalidVariable}
          />
        ) : (
          <table
            className={`data-table ${meta.kind === "register" ? "registers" : "bits"}`}
          >
            <thead>
              {meta.kind === "register" ? (
                <tr>
                  <th>PLC 地址</th>
                  <th>协议偏移</th>
                  <th>数值</th>
                  <th>十六进制</th>
                  <th>有符号</th>
                </tr>
              ) : (
                <tr>
                  <th>PLC 地址</th>
                  <th>协议偏移</th>
                  <th>状态</th>
                  <th>数值</th>
                </tr>
              )}
            </thead>
            <tbody>
              {meta.kind === "register"
                ? registerRows
                : bitValues.map((value, index) => (
                    <tr key={index} className={value ? "on" : ""}>
                      <td className="cell-plc">{plcLabel(meta, index)}</td>
                      <td className="cell-offset">{index}</td>
                      <td className="cell-status">
                        <button
                          type="button"
                          className="status-button"
                          onClick={() =>
                            onToggleBit(activeArea as BitArea, index, !value)
                          }
                          aria-pressed={value}
                          aria-label={`${plcLabel(meta, index)} ${
                            value ? "置位" : "复位"
                          }，点击切换`}
                        >
                          <span
                            className={`switch ${value ? "on" : ""}`}
                            aria-hidden="true"
                          />
                          <span className={`bit-label ${value ? "on" : ""}`}>
                            {value ? "ON · 置位" : "OFF · 复位"}
                          </span>
                        </button>
                      </td>
                      <td className={`cell-bit ${value ? "on" : ""}`}>
                        {value ? "1" : "0"}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

interface VariableListProps {
  variables: RegisterVariable[];
  registers: number[];
  meta: AreaMeta;
  area: RegisterArea;
  onAddVariable: () => void;
  onEdit: (variable: RegisterVariable) => void;
  onDelete: (variable: RegisterVariable) => void;
  onCommit: (
    area: RegisterArea,
    variable: RegisterVariable,
    registers: number[]
  ) => void;
  onInvalid: (message: string) => void;
}

function VariableList({
  variables,
  registers,
  meta,
  area,
  onAddVariable,
  onEdit,
  onDelete,
  onCommit,
  onInvalid,
}: VariableListProps) {
  if (variables.length === 0) {
    return (
      <div className="variable-empty">
        <div className="variable-empty-icon">
          <Icon name="tag" size={20} />
        </div>
        <strong>还没有变量</strong>
        <p>
          1–4 个寄存器可以合并成一个数值；其它数量或不需要合并时，也可以只做
          带别名的分组。原始寄存器始终保留在寄存器视图中。
        </p>
        <button type="button" className="btn-primary" onClick={onAddVariable}>
          新建变量
        </button>
      </div>
    );
  }

  return (
    <>
      <table className="data-table variables-view">
        <thead>
          <tr>
            <th>变量</th>
            <th>地址范围</th>
            <th>格式</th>
            <th>数值</th>
            <th>十六进制</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {variables.map((variable) => {
            const info = VARIABLE_TYPES[variable.type];
            const count = variableRegisterCount(variable);
            const merged = isMergedVariable(variable);
            return (
              <tr
                key={variable.id}
                className="variable-list-row"
                style={variableStyle(variable)}
              >
                <td className="cell-variable-name">
                  <span className="group-dot" aria-hidden="true" />
                  <strong>{variable.name}</strong>
                </td>
                <td className="cell-mono">
                  {plcLabel(meta, variable.start)} –{" "}
                  {plcLabel(meta, variable.end)}
                </td>
                <td className="cell-variable-type">
                  <span
                    className="type-badge"
                    title={
                      merged ? info.label : "仅分组（不合并数值）"
                    }
                  >
                    {merged ? info.badge : "组"}
                  </span>
                  {merged && count >= 2 && (
                    <span className="order-badge">{variable.order}</span>
                  )}
                </td>
                <td className="cell-variable-value">
                  {merged ? (
                    <VariableValueEditor
                      variable={variable}
                      registers={registers.slice(
                        variable.start,
                        variable.end + 1
                      )}
                      onCommit={(nextRegisters) =>
                        onCommit(area, variable, nextRegisters)
                      }
                      onInvalid={onInvalid}
                    />
                  ) : (
                    <span className="group-only-label">
                      {count} 个寄存器 · 仅分组
                    </span>
                  )}
                </td>
                <td className="cell-variable-hex">
                  {merged ? (
                    <VariableHexEditor
                      variable={variable}
                      registers={registers.slice(
                        variable.start,
                        variable.end + 1
                      )}
                      onCommit={(nextRegisters) =>
                        onCommit(area, variable, nextRegisters)
                      }
                      onInvalid={onInvalid}
                    />
                  ) : (
                    <span className="group-only-hex">—</span>
                  )}
                </td>
                <td className="cell-variable-actions">
                  <div className="group-actions">
                    <button
                      type="button"
                      className="group-action"
                      onClick={() => onEdit(variable)}
                      title="编辑变量"
                      aria-label={`编辑变量 ${variable.name}`}
                    >
                      <Icon name="edit" size={12} />
                    </button>
                    <button
                      type="button"
                      className="group-action danger"
                      onClick={() => onDelete(variable)}
                      title="删除变量"
                      aria-label={`删除变量 ${variable.name}`}
                    >
                      <Icon name="trash" size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="variable-view-note">
        数值框和 HEX 框都可编辑；HEX 是合并值的位型（如 F32 的
        41CCCCCD）。1–4 个寄存器显示合并值，其它数量作为分组别名。切回「寄存器」视图可查看按字节序拆分的逐寄存器 HEX。
      </p>
    </>
  );
}

interface VariableHeaderRowProps {
  variable: RegisterVariable;
  meta: AreaMeta;
  registers: number[];
  area: RegisterArea;
  onToggle: (variable: RegisterVariable) => void;
  onEdit: (variable: RegisterVariable) => void;
  onDelete: (variable: RegisterVariable) => void;
  onCommit: (
    area: RegisterArea,
    variable: RegisterVariable,
    registers: number[]
  ) => void;
  onInvalid: (message: string) => void;
}

function VariableHeaderRow({
  variable,
  meta,
  registers,
  area,
  onToggle,
  onEdit,
  onDelete,
  onCommit,
  onInvalid,
}: VariableHeaderRowProps) {
  const info = VARIABLE_TYPES[variable.type];
  const count = variableRegisterCount(variable);
  const merged = isMergedVariable(variable);

  return (
    <tr
      className={`group-header-row variable-row ${merged ? "" : "group-only"}`}
      style={variableStyle(variable)}
    >
      <td colSpan={5}>
        <div className="group-bar variable-bar">
          <button
            type="button"
            className={`group-main ${variable.collapsed ? "collapsed" : ""}`}
            onClick={() => onToggle(variable)}
            aria-expanded={!variable.collapsed}
            title={variable.collapsed ? "展开寄存器" : "收起寄存器"}
          >
            <Icon name="chevron" size={12} className="group-chevron" />
            <span className="group-dot" aria-hidden="true" />
            <strong className="group-name">{variable.name}</strong>
            <span className="group-range">
              {plcLabel(meta, variable.start)} – {plcLabel(meta, variable.end)}
            </span>
          </button>

          <span
            className="type-badge"
            title={merged ? info.label : "仅分组（不合并数值）"}
          >
            {merged ? info.badge : "组"}
          </span>
          {merged && count >= 2 && (
            <span className="order-badge" title="字节序">
              {variable.order}
            </span>
          )}

          {merged ? (
            <VariableValueEditor
              variable={variable}
              registers={registers}
              onCommit={(nextRegisters) =>
                onCommit(area, variable, nextRegisters)
              }
              onInvalid={onInvalid}
            />
          ) : (
            <span className="group-count">共 {count} 个</span>
          )}

          <div className="group-actions">
            <button
              type="button"
              className="group-action"
              onClick={() => onEdit(variable)}
              title="编辑变量"
              aria-label={`编辑变量 ${variable.name}`}
            >
              <Icon name="edit" size={12} />
            </button>
            <button
              type="button"
              className="group-action danger"
              onClick={() => onDelete(variable)}
              title="删除变量"
              aria-label={`删除变量 ${variable.name}`}
            >
              <Icon name="trash" size={12} />
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
}

interface VariableValueEditorProps {
  variable: RegisterVariable;
  registers: number[];
  onCommit: (registers: number[]) => void;
  onInvalid: (message: string) => void;
}

function VariableValueEditor({
  variable,
  registers,
  onCommit,
  onInvalid,
}: VariableValueEditorProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const decoded = decodeVariable(registers, variable.type, variable.order);
  const display =
    decoded === null ? "—" : formatVariableValue(decoded, variable.type);
  const info = VARIABLE_TYPES[variable.type];

  const commit = () => {
    if (draft === null) return;
    const parsed = parseVariableInput(variable.type, draft);
    setDraft(null);
    if (!parsed.ok) {
      onInvalid(`${variable.name}：${parsed.error}`);
      return;
    }
    const encoded = encodeVariable(parsed.value, variable.type, variable.order);
    if (!encoded) {
      onInvalid(`${variable.name}：数值无法写入该格式`);
      return;
    }
    onCommit(encoded);
  };

  return (
    <label
      className="variable-value"
      title={`${info.label} · ${variable.order} · 支持 0x 十六进制 · 点击修改`}
    >
      <input
        value={draft ?? display}
        spellCheck={false}
        autoComplete="off"
        aria-label={`变量 ${variable.name} 的值`}
        placeholder={info.placeholder}
        onFocus={(event) => {
          cancelled.current = false;
          setDraft(display === "—" ? "" : display);
          const input = event.currentTarget;
          requestAnimationFrame(() => input.select());
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            setDraft(null);
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

interface VariableHexEditorProps {
  variable: RegisterVariable;
  registers: number[];
  onCommit: (registers: number[]) => void;
  onInvalid: (message: string) => void;
}

function VariableHexEditor({
  variable,
  registers,
  onCommit,
  onInvalid,
}: VariableHexEditorProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const decoded = decodeVariable(registers, variable.type, variable.order);
  const digits =
    decoded === null ? "" : variableHexDigits(decoded, variable.type);
  const maxLength = VARIABLE_TYPES[variable.type].count * 4 + 2;

  const commit = () => {
    if (draft === null) return;
    const parsed = parseVariableHexInput(variable.type, draft);
    setDraft(null);
    if (!parsed.ok) {
      onInvalid(`${variable.name}：${parsed.error}`);
      return;
    }
    const encoded = encodeVariable(
      parsed.value,
      variable.type,
      variable.order
    );
    if (!encoded) {
      onInvalid(`${variable.name}：十六进制数值无法写入该格式`);
      return;
    }
    onCommit(encoded);
  };

  return (
    <label
      className="hex-field variable-hex-field"
      title={`${variable.name} 的十六进制位型（合并值，不含字节序拆分）`}
    >
      <span className="hex-prefix">0x</span>
      <input
        className="hex-input"
        value={draft ?? digits}
        spellCheck={false}
        autoComplete="off"
        maxLength={maxLength}
        placeholder="—"
        aria-label={`变量 ${variable.name} 的十六进制值`}
        onFocus={(event) => {
          cancelled.current = false;
          setDraft(digits);
          const input = event.currentTarget;
          requestAnimationFrame(() => input.select());
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            setDraft(null);
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}

interface RegisterInputProps {
  address: number;
  label: string;
  value: number;
  onCommit: (address: number, value: number) => void;
  onInvalid: () => void;
}

function RegisterInput({
  address,
  label,
  value,
  onCommit,
  onInvalid,
}: RegisterInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseRegisterInput(draft);
    setDraft(null);
    if (parsed === null) {
      onInvalid();
      return;
    }
    if (parsed !== value) {
      onCommit(address, parsed);
    }
  };

  return (
    <input
      className={`table-input ${value === 0 ? "zero" : ""}`}
      value={draft ?? String(value)}
      spellCheck={false}
      autoComplete="off"
      aria-label={`寄存器 ${label} 的数值`}
      title="支持十进制、有符号数或 0x 十六进制"
      onFocus={(event) => {
        cancelled.current = false;
        setDraft(String(value));
        const input = event.currentTarget;
        requestAnimationFrame(() => input.select());
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelled.current) {
          cancelled.current = false;
          setDraft(null);
          return;
        }
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

interface HexInputProps {
  address: number;
  label: string;
  value: number;
  onCommit: (address: number, value: number) => void;
  onInvalid: () => void;
}

function HexInput({
  address,
  label,
  value,
  onCommit,
  onInvalid,
}: HexInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  const display = formatHexDigits(value);

  const commit = () => {
    if (draft === null) return;
    const parsed = parseHexInput(draft);
    setDraft(null);
    if (parsed === null) {
      onInvalid();
      return;
    }
    if (parsed !== value) {
      onCommit(address, parsed);
    }
  };

  return (
    <label className="hex-field">
      <span className="hex-prefix">0x</span>
      <input
        className="hex-input"
        value={draft ?? display}
        spellCheck={false}
        autoComplete="off"
        maxLength={6}
        aria-label={`寄存器 ${label} 的十六进制值`}
        title="输入 1–4 位十六进制，例如 1A2F"
        onFocus={(event) => {
          cancelled.current = false;
          setDraft(display);
          const input = event.currentTarget;
          requestAnimationFrame(() => input.select());
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (cancelled.current) {
            cancelled.current = false;
            setDraft(null);
            return;
          }
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === "Escape") {
            event.preventDefault();
            cancelled.current = true;
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
}
