mod modbus;
mod rtu;
mod server;

use std::net::IpAddr;
use std::sync::{Arc, Mutex, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serialport::SerialPortType;
use tauri::State;

use modbus::{Area, Registers, COIL_COUNT, DISCRETE_COUNT, HOLDING_COUNT, INPUT_COUNT};
use server::Shared;

/// Settings sent by the UI when starting a server, for either transport.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartConfig {
    pub transport: String,
    pub host: String,
    pub port: u16,
    pub unit_id: u8,
    pub serial_port: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub parity: String,
    pub stop_bits: u8,
}

enum Engine {
    Tcp(server::Running),
    Rtu(rtu::Running),
}

impl Engine {
    fn is_running(&self) -> bool {
        match self {
            Engine::Tcp(running) => running.is_running(),
            Engine::Rtu(running) => running.is_running(),
        }
    }
}

pub struct AppState {
    shared: Arc<Shared>,
    engine: Mutex<Option<(StartConfig, Engine)>>,
    started_at: RwLock<Option<u64>>,
}

impl AppState {
    fn new() -> Self {
        Self {
            shared: Shared::new(),
            engine: Mutex::new(None),
            started_at: RwLock::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub running: bool,
    pub transport: String,
    pub host: String,
    pub port: u16,
    pub unit_id: u8,
    pub serial_port: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub parity: String,
    pub stop_bits: u8,
    pub listen_addr: Option<String>,
    pub active_connections: u32,
    pub total_requests: u64,
    pub started_at: Option<u64>,
    pub last_error: Option<String>,
    pub values: Registers,
    pub logs: Vec<server::LogEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerialPortOption {
    pub port_name: String,
    pub kind: String,
    pub detail: Option<String>,
}

#[tauri::command]
async fn start_server(state: State<'_, AppState>, config: StartConfig) -> Result<(), String> {
    validate_config(&config)?;
    stop_engine(&state).await;

    let shared = Arc::clone(&state.shared);
    let engine = match config.transport.as_str() {
        "tcp" => {
            let running = server::start(
                Arc::clone(&shared),
                server::ServerConfig {
                    host: config.host.clone(),
                    port: config.port,
                    unit_id: config.unit_id,
                },
            )
            .await?;
            Engine::Tcp(running)
        }
        "rtu" => {
            let running = rtu::start(
                Arc::clone(&shared),
                rtu::RtuConfig {
                    port_name: config.serial_port.clone(),
                    baud_rate: config.baud_rate,
                    data_bits: config.data_bits,
                    parity: config.parity.clone(),
                    stop_bits: config.stop_bits,
                    unit_id: config.unit_id,
                },
            )?;
            Engine::Rtu(running)
        }
        _ => return Err("未知的连接方式".to_string()),
    };

    shared.reset_session();
    if let Ok(mut started_at) = state.started_at.write() {
        *started_at = Some(server::now_ms());
    }
    if let Ok(mut slot) = state.engine.lock() {
        *slot = Some((config, engine));
    }
    Ok(())
}

#[tauri::command]
async fn stop_server(state: State<'_, AppState>) -> Result<(), String> {
    stop_engine(&state).await;
    Ok(())
}

async fn stop_engine(state: &AppState) {
    let running = state
        .engine
        .lock()
        .map(|mut slot| slot.take())
        .unwrap_or(None);

    if let Some((_config, engine)) = running {
        match engine {
            Engine::Tcp(running) => server::shutdown(running).await,
            Engine::Rtu(running) => rtu::shutdown(running),
        }
    }

    if let Ok(mut listen_addr) = state.shared.listen_addr.write() {
        *listen_addr = None;
    }
    if let Ok(mut started_at) = state.started_at.write() {
        *started_at = None;
    }
    state.shared.clear_error();
}

#[tauri::command]
fn get_snapshot(state: State<'_, AppState>) -> Snapshot {
    let (running, config) = state
        .engine
        .lock()
        .map(|slot| match slot.as_ref() {
            Some((config, engine)) => (engine.is_running(), Some(config.clone())),
            None => (false, None),
        })
        .unwrap_or((false, None));

    let listen_addr = state
        .shared
        .listen_addr
        .read()
        .ok()
        .and_then(|address| address.clone());
    let values = state
        .shared
        .registers
        .read()
        .map(|registers| registers.clone())
        .unwrap_or_default();
    let logs = state.shared.recent_logs();
    let started_at = state.started_at.read().ok().and_then(|value| *value);
    let last_error = state.shared.last_error();
    let tcp_connections = state
        .shared
        .active_connections
        .load(std::sync::atomic::Ordering::Relaxed);

    let config = config.unwrap_or(StartConfig {
        transport: String::new(),
        host: String::new(),
        port: 0,
        unit_id: 0,
        serial_port: String::new(),
        baud_rate: 0,
        data_bits: 8,
        parity: "none".to_string(),
        stop_bits: 1,
    });
    let rtu = config.transport == "rtu";

    Snapshot {
        running,
        active_connections: if running {
            if rtu {
                1
            } else {
                tcp_connections
            }
        } else {
            0
        },
        transport: config.transport,
        host: config.host,
        port: config.port,
        unit_id: config.unit_id,
        serial_port: config.serial_port,
        baud_rate: config.baud_rate,
        data_bits: config.data_bits,
        parity: config.parity,
        stop_bits: config.stop_bits,
        listen_addr,
        total_requests: state
            .shared
            .total_requests
            .load(std::sync::atomic::Ordering::Relaxed),
        started_at,
        last_error,
        values,
        logs,
    }
}

#[tauri::command]
fn get_local_ips() -> Vec<String> {
    server::local_ips()
}

#[tauri::command]
fn write_config_file(path: String, contents: String) -> Result<(), String> {
    if contents.len() > 8 * 1024 * 1024 {
        return Err("配置文件过大（超过 8 MB）".to_string());
    }
    std::fs::write(&path, contents).map_err(|error| format!("保存配置文件失败：{error}"))
}

#[tauri::command]
fn read_config_file(path: String) -> Result<String, String> {
    let metadata =
        std::fs::metadata(&path).map_err(|error| format!("无法读取配置文件：{error}"))?;
    if metadata.len() > 8 * 1024 * 1024 {
        return Err("配置文件过大（超过 8 MB）".to_string());
    }
    std::fs::read_to_string(&path).map_err(|error| format!("读取配置文件失败：{error}"))
}

#[tauri::command]
fn list_serial_ports() -> Result<Vec<SerialPortOption>, String> {
    let mut ports =
        serialport::available_ports().map_err(|error| format!("读取串口列表失败：{error}"))?;

    // On macOS the same device often appears as both /dev/tty.* and /dev/cu.*.
    // Prefer the callout device for outgoing Modbus traffic.
    let names: Vec<String> = ports.iter().map(|port| port.port_name.clone()).collect();
    ports.retain(|port| {
        if let Some(rest) = port.port_name.strip_prefix("/dev/tty.") {
            let callout = format!("/dev/cu.{rest}");
            return !names.contains(&callout);
        }
        true
    });

    // USB adapters first, Bluetooth last: that is almost always what a
    // Modbus RTU user is looking for.
    ports.sort_by(|a, b| {
        port_priority(&a.port_type)
            .cmp(&port_priority(&b.port_type))
            .then_with(|| a.port_name.cmp(&b.port_name))
    });

    Ok(ports
        .into_iter()
        .map(|port| {
            let (kind, detail) = match port.port_type {
                SerialPortType::UsbPort(info) => {
                    ("USB".to_string(), info.product.or(info.manufacturer))
                }
                SerialPortType::PciPort => ("PCI".to_string(), None),
                SerialPortType::BluetoothPort => ("蓝牙".to_string(), None),
                SerialPortType::Unknown => ("串口".to_string(), None),
            };
            SerialPortOption {
                port_name: port.port_name,
                kind,
                detail,
            }
        })
        .collect())
}

fn port_priority(port_type: &SerialPortType) -> u8 {
    match port_type {
        SerialPortType::UsbPort(_) => 0,
        SerialPortType::PciPort => 1,
        SerialPortType::Unknown => 2,
        SerialPortType::BluetoothPort => 3,
    }
}

#[tauri::command]
fn write_register(
    state: State<'_, AppState>,
    area: String,
    address: usize,
    value: u16,
) -> Result<(), String> {
    let area = Area::parse(&area).ok_or_else(|| "未知的寄存器区域".to_string())?;
    let mut registers = state
        .shared
        .registers
        .write()
        .map_err(|_| "寄存器数据锁定失败".to_string())?;
    match area {
        Area::Holding => {
            if address >= registers.holding.len() {
                return Err("寄存器地址超出范围".to_string());
            }
            registers.holding[address] = value;
        }
        Area::Input => {
            if address >= registers.input.len() {
                return Err("寄存器地址超出范围".to_string());
            }
            registers.input[address] = value;
        }
        _ => return Err("该区域不是寄存器".to_string()),
    }
    Ok(())
}

#[tauri::command]
fn write_registers(
    state: State<'_, AppState>,
    area: String,
    address: usize,
    values: Vec<u16>,
) -> Result<(), String> {
    let area = Area::parse(&area).ok_or_else(|| "未知的寄存器区域".to_string())?;
    if values.is_empty() {
        return Err("写入数据不能为空".to_string());
    }
    let mut registers = state
        .shared
        .registers
        .write()
        .map_err(|_| "寄存器数据锁定失败".to_string())?;
    let target = match area {
        Area::Holding => &mut registers.holding,
        Area::Input => &mut registers.input,
        _ => return Err("该区域不是寄存器".to_string()),
    };
    let end = address
        .checked_add(values.len())
        .ok_or_else(|| "寄存器地址超出范围".to_string())?;
    if end > target.len() {
        return Err("寄存器地址超出范围".to_string());
    }
    target[address..end].copy_from_slice(&values);
    Ok(())
}

#[tauri::command]
fn write_coil(
    state: State<'_, AppState>,
    area: String,
    address: usize,
    value: bool,
) -> Result<(), String> {
    let area = Area::parse(&area).ok_or_else(|| "未知的寄存器区域".to_string())?;
    let mut registers = state
        .shared
        .registers
        .write()
        .map_err(|_| "寄存器数据锁定失败".to_string())?;
    match area {
        Area::Coil => {
            if address >= registers.coils.len() {
                return Err("线圈地址超出范围".to_string());
            }
            registers.coils[address] = value;
        }
        Area::Discrete => {
            if address >= registers.discrete.len() {
                return Err("离散输入地址超出范围".to_string());
            }
            registers.discrete[address] = value;
        }
        _ => return Err("该区域不是位数据".to_string()),
    }
    Ok(())
}

#[tauri::command]
fn clear_area(state: State<'_, AppState>, area: String) -> Result<(), String> {
    let area = Area::parse(&area).ok_or_else(|| "未知的寄存器区域".to_string())?;
    let mut registers = state
        .shared
        .registers
        .write()
        .map_err(|_| "寄存器数据锁定失败".to_string())?;
    registers.clear_area(area);
    Ok(())
}

#[tauri::command]
fn randomize_area(state: State<'_, AppState>, area: String) -> Result<(), String> {
    let area = Area::parse(&area).ok_or_else(|| "未知的寄存器区域".to_string())?;
    let mut registers = state
        .shared
        .registers
        .write()
        .map_err(|_| "寄存器数据锁定失败".to_string())?;
    registers.randomize_area(area, new_seed());
    Ok(())
}

#[tauri::command]
fn clear_all(state: State<'_, AppState>) -> Result<(), String> {
    let mut registers = state
        .shared
        .registers
        .write()
        .map_err(|_| "寄存器数据锁定失败".to_string())?;
    *registers = Registers::default();
    Ok(())
}

#[tauri::command]
fn clear_logs(state: State<'_, AppState>) {
    state.shared.clear_logs();
}

#[tauri::command]
fn restore_values(
    state: State<'_, AppState>,
    holding: Vec<u16>,
    input: Vec<u16>,
    coils: Vec<bool>,
    discrete: Vec<bool>,
) -> Result<(), String> {
    if holding.len() != HOLDING_COUNT
        || input.len() != INPUT_COUNT
        || coils.len() != COIL_COUNT
        || discrete.len() != DISCRETE_COUNT
    {
        return Err("保存的数据长度不匹配，已忽略".to_string());
    }
    let mut registers = state
        .shared
        .registers
        .write()
        .map_err(|_| "寄存器数据锁定失败".to_string())?;
    registers.holding = holding;
    registers.input = input;
    registers.coils = coils;
    registers.discrete = discrete;
    Ok(())
}

fn validate_config(config: &StartConfig) -> Result<(), String> {
    if config.unit_id == 0 {
        return Err("从站地址需在 1-255 之间".to_string());
    }
    if config.baud_rate < 300 || config.baud_rate > 4_000_000 {
        return Err("波特率参数无效".to_string());
    }
    if !matches!(config.data_bits, 7 | 8) {
        return Err("数据位仅支持 7 或 8".to_string());
    }
    if !matches!(config.parity.as_str(), "none" | "even" | "odd") {
        return Err("校验位参数无效".to_string());
    }
    if !matches!(config.stop_bits, 1 | 2) {
        return Err("停止位仅支持 1 或 2".to_string());
    }

    match config.transport.as_str() {
        "tcp" => {
            if config.port == 0 {
                return Err("端口需在 1-65535 之间".to_string());
            }
            if config.host.parse::<IpAddr>().is_err() {
                return Err("监听地址无效".to_string());
            }
        }
        "rtu" => {
            if config.serial_port.trim().is_empty() {
                return Err("请选择串口设备".to_string());
            }
        }
        _ => return Err("未知的连接方式".to_string()),
    }
    Ok(())
}

fn new_seed() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos() as u64)
        .unwrap_or(1)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            start_server,
            stop_server,
            get_snapshot,
            get_local_ips,
            list_serial_ports,
            write_config_file,
            read_config_file,
            write_register,
            write_registers,
            write_coil,
            clear_area,
            randomize_area,
            clear_all,
            clear_logs,
            restore_values
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::server::now_ms;

    #[test]
    fn config_file_roundtrip() {
        let path = std::env::temp_dir().join(format!(
            "modbus-slave-config-test-{}-{}.json",
            std::process::id(),
            now_ms()
        ));
        let path_string = path.to_string_lossy().to_string();
        let contents = "{\"format\":\"modbus-slave-studio\",\"version\":1}";
        write_config_file(path_string.clone(), contents.to_string()).unwrap();
        assert_eq!(read_config_file(path_string).unwrap(), contents);
        let _ = std::fs::remove_file(path);
    }
}
