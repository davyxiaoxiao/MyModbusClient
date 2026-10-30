export type Transport = "tcp" | "rtu";
export type RegisterArea = "holding" | "input";
export type BitArea = "coil" | "discrete";
export type Area = RegisterArea | BitArea;

export type VariableType =
  | "uint16"
  | "int16"
  | "uint32"
  | "int32"
  | "float32"
  | "float64";

/** Byte ordering for 4-byte (ABCD…) or 8-byte (ABCDEFGH…) values. */
export type ByteOrder =
  | "ABCD"
  | "CDAB"
  | "BADC"
  | "DCBA"
  | "ABCDEFGH"
  | "GHEFCDAB"
  | "BADCFEHG"
  | "HGFEDCBA";

export type TableView = "registers" | "variables";

/**
 * A named variable backed by one or two consecutive registers.  The alias is
 * what the user edits; the underlying registers remain individually visible.
 */
export interface RegisterVariable {
  id: string;
  name: string;
  /** Zero-based protocol offsets, inclusive. */
  start: number;
  end: number;
  collapsed: boolean;
  /** True → interpret the registers as one typed value; false → alias group. */
  merged: boolean;
  type: VariableType;
  order: ByteOrder;
}

export type VariablesByArea = Record<Area, RegisterVariable[]>;

export interface Values {
  holding: number[];
  input: number[];
  coils: boolean[];
  discrete: boolean[];
}

export interface LogEntry {
  seq: number;
  timeMs: number;
  transport: Transport;
  client: string;
  function: number;
  address: number;
  quantity: number;
  exception: number | null;
  ok: boolean;
  reason: string;
  requestHex: string;
  responseHex: string | null;
}

export interface Snapshot {
  running: boolean;
  transport: Transport | "";
  host: string;
  port: number;
  unitId: number;
  serialPort: string;
  baudRate: number;
  dataBits: number;
  parity: "none" | "even" | "odd";
  stopBits: number;
  listenAddr: string | null;
  activeConnections: number;
  totalRequests: number;
  startedAt: number | null;
  lastError: string | null;
  values: Values;
  logs: LogEntry[];
}

export interface SerialPortInfo {
  portName: string;
  kind: string;
  detail: string | null;
}

export interface StartConfig {
  transport: Transport;
  host: string;
  port: number;
  unitId: number;
  serialPort: string;
  baudRate: number;
  dataBits: number;
  parity: "none" | "even" | "odd";
  stopBits: number;
}

export interface AppConfig {
  transport: Transport;
  host: string;
  port: string;
  unitId: string;
  serialPort: string;
  baudRate: number;
  parity: "none" | "even" | "odd";
  stopBits: number;
}

export type AreaKind = "register" | "bit";

export interface AreaMeta {
  id: Area;
  name: string;
  short: string;
  codes: string;
  base: number;
  kind: AreaKind;
}

export const REGISTER_COUNT = 100;
export const BIT_COUNT = 100;
export const AREA_SIZE = 100;

export const AREAS: AreaMeta[] = [
  {
    id: "holding",
    name: "保持寄存器",
    short: "4x",
    codes: "03 · 06 · 16",
    base: 40001,
    kind: "register",
  },
  {
    id: "input",
    name: "输入寄存器",
    short: "3x",
    codes: "04",
    base: 30001,
    kind: "register",
  },
  {
    id: "coil",
    name: "线圈",
    short: "0x",
    codes: "01 · 05 · 15",
    base: 1,
    kind: "bit",
  },
  {
    id: "discrete",
    name: "离散输入",
    short: "1x",
    codes: "02",
    base: 10001,
    kind: "bit",
  },
];

export function areaMeta(area: Area): AreaMeta {
  return AREAS.find((item) => item.id === area) ?? AREAS[0];
}

export function createEmptyValues(): Values {
  return {
    holding: Array.from({ length: REGISTER_COUNT }, () => 0),
    input: Array.from({ length: REGISTER_COUNT }, () => 0),
    coils: Array.from({ length: BIT_COUNT }, () => false),
    discrete: Array.from({ length: BIT_COUNT }, () => false),
  };
}

export interface ToastMessage {
  id: number;
  message: string;
  tone: "success" | "error" | "info";
}
