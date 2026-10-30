import type { AreaMeta, LogEntry } from "./types";

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

export function formatClock(ms: number): string {
  const date = new Date(ms);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}.${pad(date.getMilliseconds(), 3)}`;
}

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}时${minutes}分`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds} 秒`;
}

export function formatHexDigits(value: number): string {
  return value.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Parses 1-4 hex digits (with or without a `0x` prefix) into a u16.
 */
export function parseHexInput(input: string): number | null {
  let text = input.trim().replace(/[\s_]/g, "");
  if (/^0x/i.test(text)) text = text.slice(2);
  if (!/^[0-9a-f]{1,4}$/i.test(text)) return null;
  return Number.parseInt(text, 16);
}

export function signedValue(value: number): number {
  return value > 0x7fff ? value - 0x10000 : value;
}

/**
 * Accepts decimal (0..65535), signed decimal (-32768..32767) or 0x hex.
 * Returns a 16-bit unsigned value.
 */
export function parseRegisterInput(input: string): number | null {
  const text = input.trim().replace(/[\s_]/g, "");
  if (!text) return null;

  let value: number;
  if (/^0x[0-9a-f]+$/i.test(text)) {
    value = Number.parseInt(text.slice(2), 16);
  } else if (/^[+-]?\d+$/.test(text)) {
    value = Number.parseInt(text, 10);
  } else {
    return null;
  }

  if (!Number.isFinite(value) || value < -32768 || value > 65535) {
    return null;
  }
  return value & 0xffff;
}

export function plcLabel(meta: AreaMeta, address: number): string {
  return String(meta.base + address).padStart(5, "0");
}

/**
 * Parses a variable address field. Hex input (0x… or containing A–F) is
 * treated as a protocol offset, e.g. `000D` → 13. Decimal input may be a PLC
 * address (40001) or a protocol offset (0–99).
 */
export function parseAddressInput(
  input: string,
  meta: AreaMeta
):
  | { ok: true; offset: number }
  | { ok: false; error: string } {
  const text = input.trim();
  if (!text) return { ok: false, error: "请输入起始地址" };

  const isHex = /^0x/i.test(text) || /[a-f]/i.test(text);
  if (isHex) {
    const digits = text.replace(/^0x/i, "").replace(/[\s_]/g, "");
    if (!/^[0-9a-f]+$/i.test(digits)) {
      return {
        ok: false,
        error: "十六进制地址格式无效，例如 000D",
      };
    }
    const offset = Number.parseInt(digits, 16);
    if (offset < 0 || offset >= 100) {
      return {
        ok: false,
        error: "十六进制协议偏移需在 0x00 – 0x63（0 – 99）之间",
      };
    }
    return { ok: true, offset };
  }

  const digits = text.replace(/[\s_]/g, "");
  if (!/^\d+$/.test(digits)) {
    return {
      ok: false,
      error: `请输入 PLC 地址 ${meta.base} – ${meta.base + 99}、协议偏移 0 – 99，或十六进制（如 000D）`,
    };
  }
  const value = Number.parseInt(digits, 10);
  if (value >= meta.base && value < meta.base + 100) {
    return { ok: true, offset: value - meta.base };
  }
  if (value >= 0 && value < 100) {
    return { ok: true, offset: value };
  }
  return {
    ok: false,
    error: `请输入 PLC 地址 ${meta.base} – ${meta.base + 99} 或协议偏移 0 – 99`,
  };
}

export interface FunctionMeta {
  name: string;
  write: boolean;
}

export const FUNCTION_META: Record<number, FunctionMeta> = {
  1: { name: "读取线圈", write: false },
  2: { name: "读取离散输入", write: false },
  3: { name: "读取保持寄存器", write: false },
  4: { name: "读取输入寄存器", write: false },
  5: { name: "写单个线圈", write: true },
  6: { name: "写单个寄存器", write: true },
  15: { name: "写多个线圈", write: true },
  16: { name: "写多个寄存器", write: true },
};

export function functionName(functionCode: number): string {
  return FUNCTION_META[functionCode]?.name ?? `功能码 ${functionCode}`;
}

export function exceptionText(code: number): string {
  switch (code) {
    case 1:
      return "非法功能";
    case 2:
      return "非法地址";
    case 3:
      return "非法数据值";
    default:
      return "设备异常";
  }
}

export function logAddress(log: LogEntry): string {
  if (log.quantity <= 0) return "—";
  if (log.quantity === 1) return `#${log.address}`;
  return `${log.address} – ${log.address + log.quantity - 1}`;
}
