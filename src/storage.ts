import { sanitizeVariables, emptyVariables } from "./variables";
import {
  BIT_COUNT,
  REGISTER_COUNT,
  type AppConfig,
  type TableView,
  type Values,
  type VariablesByArea,
} from "./types";

const CONFIG_KEY = "modbus-slave-studio.config.v1";
const VALUES_KEY = "modbus-slave-studio.values.v1";
const VARIABLES_KEY = "modbus-slave-studio.variables.v1";
const VIEW_KEY = "modbus-slave-studio.view.v1";

export const DEFAULT_CONFIG: AppConfig = {
  transport: "tcp",
  host: "0.0.0.0",
  port: "5020",
  unitId: "1",
  serialPort: "",
  baudRate: 9600,
  parity: "none",
  stopBits: 1,
};

export function loadConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const saved = JSON.parse(raw) as Partial<AppConfig>;
    return {
      transport: saved.transport === "rtu" ? "rtu" : "tcp",
      host: saved.host === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0",
      port:
        typeof saved.port === "string" && /^\d{0,5}$/.test(saved.port)
          ? saved.port
          : DEFAULT_CONFIG.port,
      unitId:
        typeof saved.unitId === "string" && /^\d{0,3}$/.test(saved.unitId)
          ? saved.unitId
          : DEFAULT_CONFIG.unitId,
      serialPort:
        typeof saved.serialPort === "string" ? saved.serialPort : "",
      baudRate:
        typeof saved.baudRate === "number" && saved.baudRate > 0
          ? saved.baudRate
          : DEFAULT_CONFIG.baudRate,
      parity:
        saved.parity === "even" || saved.parity === "odd"
          ? saved.parity
          : "none",
      stopBits: saved.stopBits === 2 ? 2 : 1,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: AppConfig): void {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Storage can be unavailable; the app still works without persistence.
  }
}

function isRegisterArray(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(
      (item) => typeof item === "number" && item >= 0 && item <= 0xffff
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

export function loadValues(): Values | null {
  try {
    const raw = localStorage.getItem(VALUES_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Partial<Values>;
    if (
      !isRegisterArray(saved.holding, REGISTER_COUNT) ||
      !isRegisterArray(saved.input, REGISTER_COUNT) ||
      !isBitArray(saved.coils, BIT_COUNT) ||
      !isBitArray(saved.discrete, BIT_COUNT)
    ) {
      return null;
    }
    return {
      holding: saved.holding,
      input: saved.input,
      coils: saved.coils,
      discrete: saved.discrete,
    };
  } catch {
    return null;
  }
}

export function saveValues(values: Values): void {
  try {
    localStorage.setItem(VALUES_KEY, JSON.stringify(values));
  } catch {
    // Ignore storage quota / privacy mode errors.
  }
}

export function loadVariables(): VariablesByArea {
  try {
    const raw = localStorage.getItem(VARIABLES_KEY);
    if (!raw) return emptyVariables();
    const saved = JSON.parse(raw) as Record<string, unknown>;
    return {
      holding: sanitizeVariables(saved.holding),
      input: sanitizeVariables(saved.input),
      coil: sanitizeVariables(saved.coil),
      discrete: sanitizeVariables(saved.discrete),
    };
  } catch {
    return emptyVariables();
  }
}

export function saveVariables(variables: VariablesByArea): void {
  try {
    localStorage.setItem(VARIABLES_KEY, JSON.stringify(variables));
  } catch {
    // Ignore storage errors.
  }
}

export function loadTableView(): TableView {
  try {
    return localStorage.getItem(VIEW_KEY) === "variables"
      ? "variables"
      : "registers";
  } catch {
    return "registers";
  }
}

export function saveTableView(view: TableView): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Ignore storage errors.
  }
}
