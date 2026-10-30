import {
  AREA_SIZE,
  type ByteOrder,
  type RegisterVariable,
  type VariableType,
  type VariablesByArea,
} from "./types";

export interface VariableColor {
  accent: string;
  tint: string;
}

export interface VariableTypeInfo {
  label: string;
  badge: string;
  count: 1 | 2 | 4;
  min: number;
  max: number;
  integer: boolean;
  placeholder: string;
}

export type VariableFormat = VariableType | "group";

export interface VariableDraft {
  name: string;
  start: number;
  count: number;
  merged: boolean;
  type: VariableType;
  order: ByteOrder;
}

const COLORS: VariableColor[] = [
  { accent: "#0d9488", tint: "#eefbf7" },
  { accent: "#0284c7", tint: "#eff8fe" },
  { accent: "#d97706", tint: "#fff9ed" },
  { accent: "#7c3aed", tint: "#f6f2ff" },
  { accent: "#db2777", tint: "#fdf1f7" },
  { accent: "#4d7c0f", tint: "#f7fcec" },
];

export const VARIABLE_TYPES: Record<VariableType, VariableTypeInfo> = {
  uint16: {
    label: "16 位无符号整数",
    badge: "U16",
    count: 1,
    min: 0,
    max: 0xffff,
    integer: true,
    placeholder: "0 – 65535 / 0xFFFF",
  },
  int16: {
    label: "16 位有符号整数",
    badge: "I16",
    count: 1,
    min: -32768,
    max: 32767,
    integer: true,
    placeholder: "-32768 – 32767 / 0xFFFF",
  },
  uint32: {
    label: "32 位无符号整数",
    badge: "U32",
    count: 2,
    min: 0,
    max: 0xffffffff,
    integer: true,
    placeholder: "0 – 4294967295 / 0xFFFFFFFF",
  },
  int32: {
    label: "32 位有符号整数",
    badge: "I32",
    count: 2,
    min: -2147483648,
    max: 2147483647,
    integer: true,
    placeholder: "-2147483648 – 2147483647 / 0xFFFFFFFF",
  },
  float32: {
    label: "32 位浮点数（4 字节）",
    badge: "F32",
    count: 2,
    min: -3.4028235e38,
    max: 3.4028235e38,
    integer: false,
    placeholder: "25.6 / 0x41CCCCCD",
  },
  float64: {
    label: "64 位浮点数（8 字节）",
    badge: "F64",
    count: 4,
    min: -Number.MAX_VALUE,
    max: Number.MAX_VALUE,
    integer: false,
    placeholder: "25.6 / 0x403999999999999A",
  },
};

export const BYTE_ORDERS_32: { value: ByteOrder; label: string }[] = [
  { value: "ABCD", label: "ABCD · 高字在前（常用）" },
  { value: "CDAB", label: "CDAB · 字交换" },
  { value: "BADC", label: "BADC · 字节交换" },
  { value: "DCBA", label: "DCBA · 低字在前" },
];

export const BYTE_ORDERS_64: { value: ByteOrder; label: string }[] = [
  { value: "ABCDEFGH", label: "ABCDEFGH · 大端（常用）" },
  { value: "GHEFCDAB", label: "GHEFCDAB · 字交换" },
  { value: "BADCFEHG", label: "BADCFEHG · 字节交换" },
  { value: "HGFEDCBA", label: "HGFEDCBA · 小端" },
];

const ORDER_32 = new Set<ByteOrder>(BYTE_ORDERS_32.map((item) => item.value));
const ORDER_64 = new Set<ByteOrder>(BYTE_ORDERS_64.map((item) => item.value));

export function byteOrdersForCount(count: number): {
  value: ByteOrder;
  label: string;
}[] {
  if (count === 2) return BYTE_ORDERS_32;
  if (count === 4) return BYTE_ORDERS_64;
  return [];
}

export function byteOrderLabel(order: ByteOrder): string {
  return (
    [...BYTE_ORDERS_32, ...BYTE_ORDERS_64].find((item) => item.value === order)
      ?.label ?? order
  );
}

export function variableTypesForCount(count: number): VariableType[] {
  if (count === 1) return ["uint16", "int16"];
  if (count === 2) return ["uint32", "int32", "float32"];
  if (count === 4) return ["float64"];
  return [];
}

export function defaultTypeForCount(count: number): VariableType {
  if (count === 4) return "float64";
  return count === 1 ? "uint16" : "uint32";
}

export function defaultOrderForCount(count: number): ByteOrder {
  return count === 4 ? "ABCDEFGH" : "ABCD";
}

export function variableRegisterCount(variable: {
  start: number;
  end: number;
}): number {
  return variable.end - variable.start + 1;
}

export function isMergedVariable(variable: RegisterVariable): boolean {
  const count = variableRegisterCount(variable);
  return (
    variable.merged &&
    count <= 4 &&
    VARIABLE_TYPES[variable.type].count === count
  );
}

export function emptyVariables(): VariablesByArea {
  return {
    holding: [],
    input: [],
    coil: [],
    discrete: [],
  };
}

export function colorForVariable(id: string): VariableColor {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

export function newVariableId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `variable-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function applyOrder(bytes: number[], order: ByteOrder): number[] {
  if (bytes.length === 4) {
    switch (order) {
      case "CDAB":
        return [bytes[2], bytes[3], bytes[0], bytes[1]];
      case "BADC":
        return [bytes[1], bytes[0], bytes[3], bytes[2]];
      case "DCBA":
        return [bytes[3], bytes[2], bytes[1], bytes[0]];
      default:
        return bytes;
    }
  }

  if (bytes.length === 8) {
    switch (order) {
      case "GHEFCDAB":
        return [
          bytes[6],
          bytes[7],
          bytes[4],
          bytes[5],
          bytes[2],
          bytes[3],
          bytes[0],
          bytes[1],
        ];
      case "BADCFEHG":
        return [
          bytes[1],
          bytes[0],
          bytes[3],
          bytes[2],
          bytes[5],
          bytes[4],
          bytes[7],
          bytes[6],
        ];
      case "HGFEDCBA":
        return [...bytes].reverse();
      default:
        return bytes;
    }
  }

  return bytes;
}

export function validateVariableValue(
  type: VariableType,
  value: number
): string | null {
  const info = VARIABLE_TYPES[type];
  if (!Number.isFinite(value)) return "请输入有效的数值";
  if (info.integer && !Number.isInteger(value)) return "该格式需要整数";
  if (value < info.min || value > info.max) {
    return `取值范围为 ${info.min} – ${info.max}`;
  }
  if (type === "float32" && !Number.isFinite(Math.fround(value))) {
    return "数值超出 32 位浮点数范围";
  }
  return null;
}

export function parseVariableInput(
  type: VariableType,
  input: string
): { ok: true; value: number } | { ok: false; error: string } {
  const text = input.trim();
  const info = VARIABLE_TYPES[type];
  if (!text) return { ok: false, error: "请输入数值" };

  const hex = text.match(/^0x([0-9a-f]+)$/i);
  if (hex) {
    const digits = hex[1];
    const maxDigits = (info.count * 16) / 4;
    if (digits.length > maxDigits) {
      return {
        ok: false,
        error: `该格式最多 ${maxDigits} 位十六进制`,
      };
    }

    if (type === "uint16" || type === "int16") {
      const raw = Number.parseInt(digits, 16);
      return {
        ok: true,
        value: type === "int16" && raw >= 0x8000 ? raw - 0x10000 : raw,
      };
    }
    if (type === "uint32" || type === "int32") {
      const raw = Number.parseInt(digits, 16);
      return {
        ok: true,
        value:
          type === "int32" && raw >= 0x80000000
            ? raw - 0x100000000
            : raw,
      };
    }
    if (type === "float32") {
      const view = new DataView(new ArrayBuffer(4));
      view.setUint32(0, Number.parseInt(digits.padStart(8, "0"), 16), false);
      const value = view.getFloat32(0, false);
      if (!Number.isFinite(value)) {
        return { ok: false, error: "该十六进制不是有限的 32 位浮点数" };
      }
      return { ok: true, value };
    }
    // float64
    if (digits.length > 16) {
      return { ok: false, error: "该格式最多 16 位十六进制" };
    }
    const view = new DataView(new ArrayBuffer(8));
    view.setBigUint64(0, BigInt(`0x${digits.padStart(16, "0")}`), false);
    const value = view.getFloat64(0, false);
    if (!Number.isFinite(value)) {
      return { ok: false, error: "该十六进制不是有限的 64 位浮点数" };
    }
    return { ok: true, value };
  }

  if (type === "float32" || type === "float64") {
    const value = Number(text);
    const error = validateVariableValue(type, value);
    if (error) return { ok: false, error };
    return { ok: true, value };
  }

  let raw = text.replace(/[\s_]/g, "");
  let negative = false;
  if (raw.startsWith("-")) {
    negative = true;
    raw = raw.slice(1);
  }
  if (!/^\d+$/.test(raw)) {
    return { ok: false, error: "请输入十进制整数或 0x 十六进制" };
  }
  let value = Number.parseInt(raw, 10);
  if (negative) value = -value;
  const error = validateVariableValue(type, value);
  if (error) return { ok: false, error };
  return { ok: true, value };
}

/**
 * Canonical (big-endian) hex digits for a merged value, without the 0x
 * prefix. Byte order only affects how the value is split into registers.
 */
export function variableHexDigits(
  value: number,
  type: VariableType
): string {
  const registers = encodeVariable(
    value,
    type,
    defaultOrderForCount(VARIABLE_TYPES[type].count)
  );
  if (!registers) return "";
  return registers
    .map((word) => word.toString(16).toUpperCase().padStart(4, "0"))
    .join("");
}

export function parseVariableHexInput(
  type: VariableType,
  input: string
): { ok: true; value: number } | { ok: false; error: string } {
  let text = input.trim().replace(/[\s_]/g, "");
  if (/^0x/i.test(text)) text = text.slice(2);
  const maxDigits = VARIABLE_TYPES[type].count * 4;
  if (!/^[0-9a-f]+$/i.test(text)) {
    return { ok: false, error: "请输入十六进制数值" };
  }
  if (text.length > maxDigits) {
    return {
      ok: false,
      error: `该格式最多 ${maxDigits} 位十六进制`,
    };
  }
  return parseVariableInput(type, `0x${text}`);
}

export function formatVariableValue(
  value: number,
  type: VariableType
): string {
  if (type === "float32" || type === "float64") {
    if (!Number.isFinite(value)) return String(value);
    const rounded = Number(
      value.toPrecision(type === "float32" ? 7 : 15)
    );
    return Object.is(rounded, -0) ? "0" : String(rounded);
  }
  return String(value);
}

export function encodeVariable(
  value: number,
  type: VariableType,
  order: ByteOrder
): number[] | null {
  if (validateVariableValue(type, value)) return null;
  const count = VARIABLE_TYPES[type].count;
  if (count === 1) {
    return [value < 0 ? value + 0x10000 : value];
  }

  const buffer = new ArrayBuffer(count * 2);
  const view = new DataView(buffer);
  if (type === "float32") {
    view.setFloat32(0, value, false);
  } else if (type === "float64") {
    view.setFloat64(0, value, false);
  } else if (type === "int32") {
    view.setInt32(0, value, false);
  } else {
    view.setUint32(0, value, false);
  }

  const bytes = applyOrder(Array.from(new Uint8Array(buffer)), order);
  const registers: number[] = [];
  for (let index = 0; index < bytes.length; index += 2) {
    registers.push(((bytes[index] << 8) | bytes[index + 1]) & 0xffff);
  }
  return registers;
}

export function decodeVariable(
  registers: number[],
  type: VariableType,
  order: ByteOrder
): number | null {
  const count = VARIABLE_TYPES[type].count;
  if (registers.length < count) return null;

  if (count === 1) {
    const raw = registers[0] & 0xffff;
    return type === "int16" && raw > 0x7fff ? raw - 0x10000 : raw;
  }

  const bytes: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const word = registers[index] & 0xffff;
    bytes.push(word >> 8, word & 0xff);
  }
  const ordered = applyOrder(bytes, order);
  const buffer = new ArrayBuffer(count * 2);
  const view = new DataView(buffer);
  ordered.forEach((byte, index) => view.setUint8(index, byte));

  if (type === "float32") return view.getFloat32(0, false);
  if (type === "float64") return view.getFloat64(0, false);
  if (type === "int32") return view.getInt32(0, false);
  return view.getUint32(0, false);
}

export function validateVariable(
  draft: VariableDraft,
  variables: RegisterVariable[],
  editingId?: string
): string | null {
  const name = draft.name.trim();
  if (!name) return "请填写变量别名";
  if ([...name].length > 30) return "变量别名不能超过 30 个字符";
  if (
    !Number.isInteger(draft.count) ||
    draft.count < 1 ||
    draft.count > AREA_SIZE
  ) {
    return "寄存器数量需在 1 – 100 之间";
  }
  if (
    !Number.isInteger(draft.start) ||
    draft.start < 0 ||
    draft.start >= AREA_SIZE ||
    draft.start + draft.count > AREA_SIZE
  ) {
    return "变量地址超出数据区范围";
  }

  if (draft.merged) {
    if (!(draft.type in VARIABLE_TYPES)) return "数据格式无效";
    if (VARIABLE_TYPES[draft.type].count !== draft.count) {
      return "数据格式与寄存器数量不匹配";
    }
    if (draft.count === 2 && !ORDER_32.has(draft.order)) {
      return "32 位变量的字节序参数无效";
    }
    if (draft.count === 4 && !ORDER_64.has(draft.order)) {
      return "64 位变量的字节序参数无效";
    }
  }

  const end = draft.start + draft.count - 1;
  const others = variables.filter((variable) => variable.id !== editingId);
  if (
    others.some(
      (variable) =>
        variable.name.trim().toLowerCase() === name.toLowerCase()
    )
  ) {
    return "该变量别名已存在";
  }
  if (
    others.some(
      (variable) => draft.start <= variable.end && end >= variable.start
    )
  ) {
    return "该寄存器范围已被其它变量占用";
  }
  return null;
}

export function defaultVariableRange(variables: RegisterVariable[]): {
  start: number;
  count: 1 | 2;
} {
  const sorted = [...variables].sort((a, b) => a.start - b.start);
  let start = 0;
  while (start < AREA_SIZE) {
    const occupied = sorted.find(
      (variable) => start >= variable.start && start <= variable.end
    );
    if (!occupied) break;
    start = occupied.end + 1;
  }
  if (start >= AREA_SIZE) return { start: 0, count: 1 };

  const nextOccupied = sorted.some(
    (variable) => start + 1 >= variable.start && start + 1 <= variable.end
  );
  return {
    start,
    count: start + 1 < AREA_SIZE && !nextOccupied ? 2 : 1,
  };
}

function isVariableType(value: unknown): value is VariableType {
  return (
    value === "uint16" ||
    value === "int16" ||
    value === "uint32" ||
    value === "int32" ||
    value === "float32" ||
    value === "float64"
  );
}

function isByteOrder(value: unknown): value is ByteOrder {
  return (
    typeof value === "string" &&
    [...ORDER_32, ...ORDER_64].includes(value as ByteOrder)
  );
}

/** Drops malformed variables and infers fields for older saved data. */
export function sanitizeVariables(value: unknown): RegisterVariable[] {
  if (!Array.isArray(value)) return [];
  const result: RegisterVariable[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();

  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const entry = candidate as Record<string, unknown>;
    if (typeof entry.id !== "string" || !entry.id) continue;
    if (typeof entry.name !== "string" || !entry.name.trim()) continue;
    if (
      typeof entry.start !== "number" ||
      !Number.isInteger(entry.start) ||
      entry.start < 0 ||
      entry.start >= AREA_SIZE
    ) {
      continue;
    }
    if (
      typeof entry.end !== "number" ||
      !Number.isInteger(entry.end) ||
      entry.end < entry.start
    ) {
      continue;
    }

    const start = entry.start;
    const end = entry.end;
    const count = end - start + 1;
    if (count < 1 || count > AREA_SIZE) continue;
    if (ids.has(entry.id)) continue;
    const name = entry.name.trim().slice(0, 30);
    if (names.has(name.toLowerCase())) continue;
    if (
      result.some(
        (variable) => start <= variable.end && end >= variable.start
      )
    ) {
      continue;
    }

    const storedType = isVariableType(entry.type) ? entry.type : null;
    const explicitMerged =
      typeof entry.merged === "boolean" ? entry.merged : undefined;
    const typeMatchesCount =
      storedType !== null && VARIABLE_TYPES[storedType].count === count;

    let merged = explicitMerged ?? typeMatchesCount;
    if (merged && !typeMatchesCount) {
      if (variableTypesForCount(count).length > 0) {
        merged = true;
      } else {
        merged = false;
      }
    }

    const type = merged && typeMatchesCount && storedType
      ? storedType
      : defaultTypeForCount(count);
    let order = isByteOrder(entry.order)
      ? entry.order
      : defaultOrderForCount(count);
    if (merged && count === 2 && !ORDER_32.has(order)) {
      order = "ABCD";
    }
    if (merged && count === 4 && !ORDER_64.has(order)) {
      order = "ABCDEFGH";
    }
    if (!merged) {
      order = "ABCD";
    }

    result.push({
      id: entry.id,
      name,
      start,
      end,
      collapsed: typeof entry.collapsed === "boolean" ? entry.collapsed : false,
      merged,
      type,
      order,
    });
    ids.add(entry.id);
    names.add(name.toLowerCase());
  }

  return result.sort((a, b) => a.start - b.start);
}
