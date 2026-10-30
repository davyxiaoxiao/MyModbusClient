import { invoke } from "@tauri-apps/api/core";
import type {
  Area,
  SerialPortInfo,
  Snapshot,
  StartConfig,
  Values,
} from "./types";

export const api = {
  start: (config: StartConfig) => invoke<void>("start_server", { config }),
  stop: () => invoke<void>("stop_server"),
  snapshot: () => invoke<Snapshot>("get_snapshot"),
  localIps: () => invoke<string[]>("get_local_ips"),
  serialPorts: () => invoke<SerialPortInfo[]>("list_serial_ports"),
  writeConfigFile: (path: string, contents: string) =>
    invoke<void>("write_config_file", { path, contents }),
  readConfigFile: (path: string) => invoke<string>("read_config_file", { path }),
  writeRegister: (area: string, address: number, value: number) =>
    invoke<void>("write_register", { area, address, value }),
  writeRegisters: (area: string, address: number, values: number[]) =>
    invoke<void>("write_registers", { area, address, values }),
  writeCoil: (area: string, address: number, value: boolean) =>
    invoke<void>("write_coil", { area, address, value }),
  clearArea: (area: Area) => invoke<void>("clear_area", { area }),
  randomizeArea: (area: Area) => invoke<void>("randomize_area", { area }),
  clearAll: () => invoke<void>("clear_all"),
  clearLogs: () => invoke<void>("clear_logs"),
  restoreValues: (values: Values) =>
    invoke<void>("restore_values", {
      holding: values.holding,
      input: values.input,
      coils: values.coils,
      discrete: values.discrete,
    }),
};
