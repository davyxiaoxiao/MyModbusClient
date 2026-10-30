import { sanitizeVariables } from "./variables";
import {
  BIT_COUNT,
  REGISTER_COUNT,
  type Values,
  type VariablesByArea,
} from "./types";

export const BACKUP_FORMAT = "modbus-slave-studio";
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  variables: VariablesByArea;
  values: Values;
}

export interface ParsedBackup {
  variables: VariablesByArea;
  values: Values | null;
  variableCount: number;
}

export function buildBackup(
  variables: VariablesByArea,
  values: Values
): BackupFile {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    variables,
    values,
  };
}

function isRegisterArray(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(
      (item) =>
        typeof item === "number" &&
        Number.isInteger(item) &&
        item >= 0 &&
        item <= 0xffff
    )
  );
}

function isBitArray(value: unknown, length: number): value is boolean[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === "boolean")
  );
}

function parseValues(value: unknown): Values | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (
    !isRegisterArray(raw.holding, REGISTER_COUNT) ||
    !isRegisterArray(raw.input, REGISTER_COUNT) ||
    !isBitArray(raw.coils, BIT_COUNT) ||
    !isBitArray(raw.discrete, BIT_COUNT)
  ) {
    return null;
  }
  return {
    holding: raw.holding,
    input: raw.input,
    coils: raw.coils,
    discrete: raw.discrete,
  };
}

export function parseBackup(
  text: string
):
  | { ok: true; backup: ParsedBackup }
  | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "文件不是有效的 JSON" };
  }
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: "配置文件格式不正确" };
  }
  const data = raw as Record<string, unknown>;
  if (data.format !== BACKUP_FORMAT || data.version !== BACKUP_VERSION) {
    return { ok: false, error: "这不是 Modbus 从机模拟器的配置文件" };
  }

  const rawVariables =
    data.variables && typeof data.variables === "object"
      ? (data.variables as Record<string, unknown>)
      : {};
  const variables: VariablesByArea = {
    holding: sanitizeVariables(rawVariables.holding),
    input: sanitizeVariables(rawVariables.input),
    coil: sanitizeVariables(rawVariables.coil),
    discrete: sanitizeVariables(rawVariables.discrete),
  };
  const variableCount =
    variables.holding.length +
    variables.input.length +
    variables.coil.length +
    variables.discrete.length;

  let values: Values | null = null;
  if (data.values !== undefined) {
    values = parseValues(data.values);
    if (!values) {
      return { ok: false, error: "配置文件中的寄存器数值无效" };
    }
  }

  if (variableCount === 0 && !values) {
    return { ok: false, error: "配置文件中没有可导入的变量或数值" };
  }
  return { ok: true, backup: { variables, values, variableCount } };
}

export function exportFileName(): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `modbus-slave-config-${date.getFullYear()}${pad(
    date.getMonth() + 1
  )}${pad(date.getDate())}-${pad(date.getHours())}${pad(
    date.getMinutes()
  )}.json`;
}

export function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
