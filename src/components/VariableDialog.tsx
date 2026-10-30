import { useEffect, useRef, useState, type FormEvent } from "react";
import { Icon } from "./Icon";
import { parseAddressInput, plcLabel } from "../format";
import {
  VARIABLE_TYPES,
  byteOrdersForCount,
  decodeVariable,
  defaultOrderForCount,
  defaultTypeForCount,
  formatVariableValue,
  isMergedVariable,
  validateVariable,
  variableRegisterCount,
  variableTypesForCount,
  type VariableDraft,
  type VariableFormat,
} from "../variables";
import type {
  AreaMeta,
  ByteOrder,
  RegisterVariable,
  VariableType,
} from "../types";

interface VariableDialogProps {
  meta: AreaMeta;
  variables: RegisterVariable[];
  editing: RegisterVariable | null;
  registers: number[];
  initialStart: number;
  initialCount: number;
  onCancel: () => void;
  onSave: (draft: VariableDraft) => void;
}

export function VariableDialog({
  meta,
  variables,
  editing,
  registers,
  initialStart,
  initialCount,
  onCancel,
  onSave,
}: VariableDialogProps) {
  const initialCountValue = editing
    ? variableRegisterCount(editing)
    : initialCount;
  const initialFormat: VariableFormat = editing
    ? isMergedVariable(editing)
      ? editing.type
      : "group"
    : variableTypesForCount(initialCountValue)[0] ?? "group";

  const [name, setName] = useState(editing?.name ?? "");
  const [startAddress, setStartAddress] = useState(
    String(meta.base + (editing?.start ?? initialStart))
  );
  const [countText, setCountText] = useState(String(initialCountValue));
  const [format, setFormat] = useState<VariableFormat>(initialFormat);
  const [order, setOrder] = useState<ByteOrder>(
    editing?.order ?? defaultOrderForCount(initialCountValue)
  );
  const [error, setError] = useState<string | null>(null);
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const count = Number(countText);
  const countValid =
    Number.isInteger(count) && count >= 1 && count <= 100;
  const scalarTypes = countValid ? variableTypesForCount(count) : [];
  const merged =
    format !== "group" &&
    scalarTypes.includes(format as VariableType);
  const mergedType: VariableType | null = merged
    ? (format as VariableType)
    : null;
  const orderOptions = merged ? byteOrdersForCount(count) : [];
  const orderValid = orderOptions.some((item) => item.value === order);
  const effectiveOrder: ByteOrder =
    merged && countValid
      ? orderValid
        ? order
        : defaultOrderForCount(count)
      : "ABCD";
  const address = parseAddressInput(startAddress, meta);
  const startOffset = address.ok ? address.offset : null;
  const validRange =
    startOffset !== null &&
    countValid &&
    startOffset + count <= 100;
  const currentValue =
    validRange && mergedType
      ? decodeVariable(
          registers.slice(startOffset, startOffset + count),
          mergedType,
          effectiveOrder
        )
      : null;
  const currentLabel =
    currentValue === null
      ? "—"
      : formatVariableValue(currentValue, mergedType ?? "uint32");
  const isGroup = !merged;

  const title = editing
    ? isGroup
      ? "编辑分组"
      : "编辑变量"
    : isGroup
      ? "新建分组"
      : "新建变量";

  const changeCount = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 3);
    setCountText(digits);
    setError(null);
    const next = Number(digits);
    if (!Number.isInteger(next) || next < 1 || next > 100) return;
    const types = variableTypesForCount(next);
    if (format !== "group" && !types.includes(format as VariableType)) {
      setFormat(types[0] ?? "group");
    }
    if (format !== "group") {
      setOrder(defaultOrderForCount(next));
    }
  };

  const changeFormat = (value: VariableFormat) => {
    setFormat(value);
    setError(null);
    if (value !== "group") {
      const options = byteOrdersForCount(count);
      if (!options.some((item) => item.value === order)) {
        setOrder(defaultOrderForCount(count));
      }
    }
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const parsedAddress = parseAddressInput(startAddress, meta);
    if (!parsedAddress.ok) {
      setError(parsedAddress.error);
      return;
    }
    if (!countValid) {
      setError("寄存器数量需在 1 – 100 之间");
      return;
    }
    if (parsedAddress.offset + count > 100) {
      setError("起始地址加寄存器数量超出数据区范围");
      return;
    }

    const nextTypes = variableTypesForCount(count);
    const nextMerged =
      format !== "group" &&
      nextTypes.includes(format as VariableType);
    const draft: VariableDraft = {
      name,
      start: parsedAddress.offset,
      count,
      merged: nextMerged,
      type: nextMerged
        ? (format as VariableType)
        : defaultTypeForCount(count),
      order: nextMerged ? effectiveOrder : "ABCD",
    };
    const message = validateVariable(draft, variables, editing?.id);
    if (message) {
      setError(message);
      return;
    }
    onSave({ ...draft, name: name.trim() });
  };

  const formatSelect = (
    <select
      value={format}
      disabled={!countValid}
      onChange={(event) =>
        changeFormat(event.target.value as VariableFormat)
      }
    >
      {scalarTypes.map((option) => (
        <option key={option} value={option}>
          {VARIABLE_TYPES[option].label}
        </option>
      ))}
      <option value="group">仅分组（不合并数值）</option>
    </select>
  );

  const orderSelect = (
    <select
      value={effectiveOrder}
      onChange={(event) => setOrder(event.target.value as ByteOrder)}
    >
      {orderOptions.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );

  return (
    <div
      className="dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <form
        className="dialog group-dialog variable-dialog"
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="variable-dialog-title"
      >
        <div className="dialog-icon neutral">
          <Icon name="tag" size={18} />
        </div>
        <h3 id="variable-dialog-title">{title}</h3>
        <p>
          {isGroup
            ? "把一段连续寄存器合并成带别名的分组。分组只影响界面展示，不改变 Modbus 数据；每个寄存器的 HEX 仍在寄存器视图中单独显示。"
            : "把连续寄存器解释为一个 16/32/64 位数值，可直接编辑整体值；原始寄存器仍保留在表格中，可单独修改。"}
        </p>

        <label className="field">
          <span>变量别名</span>
          <input
            value={name}
            maxLength={30}
            autoFocus
            placeholder={isGroup ? "例如：参数区" : "例如：温度"}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>起始地址</span>
            <input
              className="mono"
              value={startAddress}
              maxLength={8}
              title="支持 PLC 地址、协议偏移或十六进制，例如 40001 / 13 / 000D"
              onChange={(event) => {
                setStartAddress(
                  event.target.value
                    .replace(/[^0-9a-fA-FxX]/g, "")
                    .slice(0, 8)
                );
                setError(null);
              }}
            />
          </label>
          <label className="field">
            <span>寄存器数量</span>
            <input
              className="mono"
              inputMode="numeric"
              value={countText}
              maxLength={3}
              placeholder="1 – 100"
              onChange={(event) => changeCount(event.target.value)}
            />
          </label>
        </div>
        <p className="field-hint address-hint">
          地址支持 PLC 编号（40001）、协议偏移（13）或十六进制偏移（000D /
          0x000D）。1 个寄存器 = 16 位，2 个 = 32 位，4 个 = 64 位。
        </p>

        {merged ? (
          <div className="field-row">
            <label className="field">
              <span>数据格式</span>
              {formatSelect}
            </label>
            <label className="field">
              <span>字节序</span>
              {count >= 2 ? (
                orderSelect
              ) : (
                <input className="mono" value="—" disabled readOnly />
              )}
            </label>
          </div>
        ) : (
          <>
            <label className="field">
              <span>数据格式</span>
              {formatSelect}
            </label>
            {scalarTypes.length === 0 && countValid && (
              <p className="dialog-note">
                {count} 个寄存器没有对应的单值格式，将作为带别名的分组使用。
              </p>
            )}
          </>
        )}

        <p className="dialog-note">
          {validRange
            ? `${plcLabel(meta, startOffset)} – ${plcLabel(
                meta,
                startOffset + count - 1
              )} · 协议偏移 ${startOffset} – ${
                startOffset + count - 1
              } · 共 ${count} 个寄存器 · ${
                merged ? `当前值 ${currentLabel}` : "仅分组"
              }`
            : address.ok
              ? "地址范围超出数据区，请调整起始地址或数量"
              : address.error}
        </p>

        <p className="dialog-note value-hint">
          {merged
            ? "变量值支持十进制、浮点数或 0x 十六进制；浮点数也可直接输入 IEEE 原始位型（如 0x41CCCCCD）。"
            : "分组只保存别名和地址范围，不合并数值；每个寄存器的 HEX 请在寄存器视图中查看。"}
        </p>

        {error && <div className="dialog-error">{error}</div>}

        <div className="dialog-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            取消
          </button>
          <button type="submit" className="btn-primary">
            {editing
              ? isGroup
                ? "保存分组"
                : "保存变量"
              : isGroup
                ? "创建分组"
                : "创建变量"}
          </button>
        </div>
      </form>
    </div>
  );
}
