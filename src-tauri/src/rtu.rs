//! Modbus RTU slave running on top of a serial port.
//!
//! RTU framing is detected by the silent interval between bytes.  The port is
//! read in a dedicated thread with a very short timeout, which keeps CPU usage
//! low while allowing the app to stop the server quickly.

use std::io::ErrorKind;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use serialport::{ClearBuffer, DataBits, Parity, SerialPort, StopBits};

use crate::modbus::{self, LogMeta};
use crate::server::Shared;

#[derive(Debug, Clone)]
pub struct RtuConfig {
    pub port_name: String,
    pub baud_rate: u32,
    pub data_bits: u8,
    pub parity: String,
    pub stop_bits: u8,
    pub unit_id: u8,
}

pub struct Running {
    stop: Arc<AtomicBool>,
    join: Option<JoinHandle<()>>,
}

impl Running {
    pub fn is_running(&self) -> bool {
        self.join
            .as_ref()
            .map(|join| !join.is_finished())
            .unwrap_or(false)
    }
}

pub fn start(shared: Arc<Shared>, config: RtuConfig) -> Result<Running, String> {
    let mut port = serialport::new(&config.port_name, config.baud_rate)
        .data_bits(data_bits(config.data_bits)?)
        .parity(parity(&config.parity)?)
        .stop_bits(stop_bits(config.stop_bits)?)
        .timeout(Duration::from_millis(2))
        .open()
        .map_err(|error| {
            format!(
                "无法打开串口 {}：{}（请检查设备是否被其他程序占用）",
                config.port_name, error
            )
        })?;

    // Drop bytes left over from a previous session.
    let _ = port.clear(ClearBuffer::Input);

    let stop = Arc::new(AtomicBool::new(false));
    let thread_stop = Arc::clone(&stop);
    let thread_shared = Arc::clone(&shared);
    let client = config.port_name.clone();
    let baud_rate = config.baud_rate;
    let unit_id = config.unit_id;
    let gap = inter_frame_gap(baud_rate);

    if let Ok(mut listen_addr) = shared.listen_addr.write() {
        *listen_addr = Some(format!(
            "{} · {} 8{}{}",
            config.port_name,
            baud_rate,
            parity_letter(&config.parity),
            config.stop_bits
        ));
    }
    shared.clear_error();

    let join = std::thread::Builder::new()
        .name("modbus-rtu".to_string())
        .spawn(move || {
            run_loop(
                port.as_mut(),
                &thread_shared,
                unit_id,
                &client,
                &thread_stop,
                gap,
            );
            if let Ok(mut listen_addr) = thread_shared.listen_addr.write() {
                *listen_addr = None;
            }
        })
        .map_err(|error| format!("无法创建串口线程：{error}"))?;

    Ok(Running {
        stop,
        join: Some(join),
    })
}

pub fn shutdown(mut running: Running) {
    running.stop.store(true, Ordering::Relaxed);
    if let Some(join) = running.join.take() {
        let _ = join.join();
    }
}

fn run_loop(
    port: &mut dyn SerialPort,
    shared: &Shared,
    unit_id: u8,
    client: &str,
    stop: &AtomicBool,
    gap: Duration,
) {
    let mut buffer: Vec<u8> = Vec::with_capacity(256);
    let mut last_rx = Instant::now();
    let mut chunk = [0u8; 256];

    while !stop.load(Ordering::Relaxed) {
        match port.read(&mut chunk) {
            Ok(0) => {}
            Ok(read) => {
                buffer.extend_from_slice(&chunk[..read]);
                last_rx = Instant::now();
                // A frame can never be longer than 256 bytes.  If we somehow
                // keep receiving without a gap, drop the garbage.
                if buffer.len() > 256 {
                    shared.record(
                        "rtu",
                        client,
                        modbus::meta_for_pdu(&[]),
                        false,
                        format!("接收帧过长（{} 字节）", buffer.len()),
                        modbus::to_hex(&buffer),
                        None,
                    );
                    buffer.clear();
                }
            }
            Err(error) if error.kind() == ErrorKind::TimedOut => {
                if !buffer.is_empty() && last_rx.elapsed() >= gap {
                    let frame = std::mem::take(&mut buffer);
                    if let Some(response) = process_frame(shared, unit_id, client, &frame) {
                        if let Err(error) = port.write_all(&response).and_then(|_| port.flush()) {
                            shared.set_error(format!("串口写入失败：{error}"));
                            shared.record(
                                "rtu",
                                client,
                                modbus::meta_for_pdu(&[]),
                                false,
                                format!("串口写入失败：{error}"),
                                String::new(),
                                None,
                            );
                            break;
                        }
                    }
                }
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => {
                shared.set_error(format!("串口读取失败，连接可能已断开：{error}"));
                shared.record(
                    "rtu",
                    client,
                    modbus::meta_for_pdu(&[]),
                    false,
                    format!("串口读取失败：{error}"),
                    String::new(),
                    None,
                );
                break;
            }
        }
    }
}

/// Parses a complete RTU frame, runs it against the shared registers and
/// returns the encoded response (if one is required).
fn process_frame(shared: &Shared, unit_id: u8, client: &str, bytes: &[u8]) -> Option<Vec<u8>> {
    let length = bytes.len();
    let request_hex = modbus::to_hex(bytes);
    if length < 4 {
        shared.record(
            "rtu",
            client,
            modbus::meta_for_pdu(&[]),
            false,
            format!("帧长度不足（{length} 字节）"),
            request_hex,
            None,
        );
        return None;
    }

    let payload = &bytes[..length - 2];
    let received_crc = u16::from_le_bytes([bytes[length - 2], bytes[length - 1]]);
    let address = payload[0];
    let pdu = &payload[1..];
    let meta = modbus::meta_for_pdu(pdu);

    if crc16(payload) != received_crc {
        shared.record(
            "rtu",
            client,
            meta,
            false,
            "CRC 校验错误",
            request_hex,
            None,
        );
        return None;
    }

    // Address 0 is the broadcast address: apply write commands silently.
    if address == 0 {
        if pdu.is_empty() {
            shared.record(
                "rtu",
                client,
                meta,
                false,
                "帧没有功能码",
                request_hex,
                None,
            );
            return None;
        }
        if is_write_function(pdu[0]) {
            if let Ok(mut registers) = shared.registers.write() {
                let (_, result_meta) = modbus::handle_pdu(pdu, &mut registers);
                if let Some(result_meta) = result_meta {
                    let ok = result_meta.exception.is_none();
                    let reason = if ok {
                        "广播写入（无响应）".to_string()
                    } else {
                        format!(
                            "广播写入失败：{}",
                            modbus::exception_reason(result_meta.exception)
                        )
                    };
                    shared.record("rtu", client, result_meta, ok, reason, request_hex, None);
                }
            }
        } else {
            shared.record(
                "rtu",
                client,
                meta,
                false,
                "广播地址不支持读取",
                request_hex,
                None,
            );
        }
        return None;
    }

    if address != unit_id {
        shared.record(
            "rtu",
            client,
            meta,
            false,
            format!("从站地址不匹配（收到 {address}，本机 {unit_id}）"),
            request_hex,
            None,
        );
        return None;
    }

    let (response_pdu, result_meta): (Vec<u8>, Option<LogMeta>) = {
        let mut registers = shared.registers.write().ok()?;
        modbus::handle_pdu(pdu, &mut registers)
    };

    let response_frame = build_frame(unit_id, &response_pdu);
    if let Some(result_meta) = result_meta {
        let ok = result_meta.exception.is_none();
        let reason = modbus::exception_reason(result_meta.exception);
        shared.record(
            "rtu",
            client,
            result_meta,
            ok,
            reason,
            request_hex,
            Some(modbus::to_hex(&response_frame)),
        );
    }

    Some(response_frame)
}

fn is_write_function(function: u8) -> bool {
    matches!(
        function,
        modbus::WRITE_SINGLE_COIL
            | modbus::WRITE_SINGLE_REGISTER
            | modbus::WRITE_MULTIPLE_COILS
            | modbus::WRITE_MULTIPLE_REGISTERS
    )
}

/// Computes the Modbus CRC-16 (polynomial 0xA001, initial value 0xFFFF).
pub fn crc16(data: &[u8]) -> u16 {
    let mut crc = 0xffff;
    for byte in data {
        crc ^= u16::from(*byte);
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xa001;
            } else {
                crc >>= 1;
            }
        }
    }
    crc
}

/// Adds the unit address and CRC to a PDU.
pub fn build_frame(unit_id: u8, pdu: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(pdu.len() + 3);
    frame.push(unit_id);
    frame.extend_from_slice(pdu);
    let crc = crc16(&frame);
    frame.extend_from_slice(&crc.to_le_bytes());
    frame
}

/// Validates the CRC and returns `(unit_id, PDU)`.
#[cfg(test)]
pub fn parse_frame(bytes: &[u8]) -> Option<(u8, Vec<u8>)> {
    if bytes.len() < 4 || bytes.len() > 256 {
        return None;
    }
    let (payload, crc_bytes) = bytes.split_at(bytes.len() - 2);
    let received = u16::from_le_bytes([crc_bytes[0], crc_bytes[1]]);
    if crc16(payload) != received {
        return None;
    }
    let address = payload[0];
    let pdu = payload[1..].to_vec();
    if pdu.is_empty() {
        return None;
    }
    Some((address, pdu))
}

fn inter_frame_gap(baud_rate: u32) -> Duration {
    // 3.5 characters of 11 bits, with a 2 ms floor for fast baud rates where
    // the operating system's timer resolution is the limiting factor.
    let baud = baud_rate.max(300) as f64;
    let micros = (3.5 * 11.0 / baud * 1_000_000.0) as u64;
    Duration::from_micros(micros.max(2_000))
}

fn data_bits(value: u8) -> Result<DataBits, String> {
    match value {
        7 => Ok(DataBits::Seven),
        8 => Ok(DataBits::Eight),
        _ => Err("仅支持 7 或 8 位数据位".to_string()),
    }
}

fn parity(value: &str) -> Result<Parity, String> {
    match value {
        "none" => Ok(Parity::None),
        "even" => Ok(Parity::Even),
        "odd" => Ok(Parity::Odd),
        _ => Err("校验位参数无效".to_string()),
    }
}

fn parity_letter(value: &str) -> &'static str {
    match value {
        "even" => "E",
        "odd" => "O",
        _ => "N",
    }
}

fn stop_bits(value: u8) -> Result<StopBits, String> {
    match value {
        1 => Ok(StopBits::One),
        2 => Ok(StopBits::Two),
        _ => Err("停止位参数无效".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_matches_known_vector() {
        let request = [0x01, 0x03, 0x00, 0x00, 0x00, 0x01];
        assert_eq!(crc16(&request), 0x0a84);
    }

    #[test]
    fn builds_and_parses_frame() {
        let frame = build_frame(1, &[0x03, 0x00, 0x00, 0x00, 0x01]);
        assert_eq!(frame, vec![0x01, 0x03, 0x00, 0x00, 0x00, 0x01, 0x84, 0x0a]);
        assert_eq!(
            parse_frame(&frame),
            Some((1, vec![0x03, 0x00, 0x00, 0x00, 0x01]))
        );
    }

    #[test]
    fn rejects_bad_crc() {
        let mut frame = build_frame(1, &[0x03, 0x00, 0x00, 0x00, 0x01]);
        let last = frame.len() - 1;
        frame[last] ^= 0xff;
        assert_eq!(parse_frame(&frame), None);
    }

    #[test]
    fn responds_to_read_request() {
        let shared = Shared::new();
        shared.registers.write().unwrap().holding[0] = 42;

        let request = build_frame(1, &[0x03, 0x00, 0x00, 0x00, 0x01]);
        let response = process_frame(&shared, 1, "/dev/test", &request).unwrap();
        assert_eq!(
            parse_frame(&response),
            Some((1, vec![0x03, 0x02, 0x00, 0x2a]))
        );
        assert_eq!(shared.total_requests.load(Ordering::Relaxed), 1);
        let logs = shared.recent_logs();
        assert_eq!(logs.len(), 1);
        assert!(logs[0].ok);
        assert_eq!(logs[0].reason, "正常");
        assert!(!logs[0].request_hex.is_empty());
        assert!(logs[0]
            .response_hex
            .as_deref()
            .unwrap_or_default()
            .starts_with("01 03 02 00 2A"));
    }

    #[test]
    fn broadcast_write_is_applied_without_response() {
        let shared = Shared::new();
        let request = build_frame(0, &[0x06, 0x00, 0x02, 0x00, 0x63]);
        assert_eq!(process_frame(&shared, 1, "/dev/test", &request), None);
        assert_eq!(shared.registers.read().unwrap().holding[2], 0x0063);
        let logs = shared.recent_logs();
        assert_eq!(logs.len(), 1);
        assert!(logs[0].ok);
        assert!(logs[0].reason.contains("广播写入"));
    }

    #[test]
    fn logs_other_slave_address_with_reason() {
        let shared = Shared::new();
        let request = build_frame(9, &[0x06, 0x00, 0x02, 0x00, 0x63]);
        assert_eq!(process_frame(&shared, 1, "/dev/test", &request), None);
        assert_eq!(shared.registers.read().unwrap().holding[2], 0);
        let logs = shared.recent_logs();
        assert_eq!(logs.len(), 1);
        assert!(!logs[0].ok);
        assert!(logs[0].reason.contains("从站地址不匹配"));
    }

    #[test]
    fn logs_bad_crc_with_reason() {
        let shared = Shared::new();
        let mut request = build_frame(1, &[0x03, 0x00, 0x00, 0x00, 0x01]);
        let last = request.len() - 1;
        request[last] ^= 0xff;
        assert_eq!(process_frame(&shared, 1, "/dev/test", &request), None);
        let logs = shared.recent_logs();
        assert_eq!(logs.len(), 1);
        assert!(!logs[0].ok);
        assert_eq!(logs[0].reason, "CRC 校验错误");
        assert_eq!(logs[0].function, 3);
        assert!(!logs[0].request_hex.is_empty());
        assert!(logs[0].response_hex.is_none());
    }

    #[test]
    fn logs_short_frame_with_reason() {
        let shared = Shared::new();
        assert_eq!(process_frame(&shared, 1, "/dev/test", &[0x01, 0x03]), None);
        let logs = shared.recent_logs();
        assert_eq!(logs.len(), 1);
        assert!(!logs[0].ok);
        assert!(logs[0].reason.contains("帧长度不足"));
    }

    #[test]
    fn gap_shrinks_for_high_baud_rates() {
        assert!(inter_frame_gap(115200) >= Duration::from_millis(2));
        assert!(inter_frame_gap(9600) > inter_frame_gap(115200));
    }
}
