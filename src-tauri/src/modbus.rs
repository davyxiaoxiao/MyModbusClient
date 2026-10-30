//! Modbus application protocol (PDU) handling.
//!
//! The server keeps four fixed-size data tables, exactly like a small PLC:
//! 100 coils, 100 discrete inputs, 100 holding registers and 100 input
//! registers.  Function codes 01, 02, 03, 04, 05, 06, 15 and 16 are
//! implemented.

use serde::Serialize;

pub const HOLDING_COUNT: usize = 100;
pub const INPUT_COUNT: usize = 100;
pub const COIL_COUNT: usize = 100;
pub const DISCRETE_COUNT: usize = 100;

pub const READ_COILS: u8 = 0x01;
pub const READ_DISCRETE_INPUTS: u8 = 0x02;
pub const READ_HOLDING_REGISTERS: u8 = 0x03;
pub const READ_INPUT_REGISTERS: u8 = 0x04;
pub const WRITE_SINGLE_COIL: u8 = 0x05;
pub const WRITE_SINGLE_REGISTER: u8 = 0x06;
pub const WRITE_MULTIPLE_COILS: u8 = 0x0f;
pub const WRITE_MULTIPLE_REGISTERS: u8 = 0x10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Exception {
    IllegalFunction,
    IllegalDataAddress,
    IllegalDataValue,
}

impl Exception {
    pub fn code(self) -> u8 {
        match self {
            Exception::IllegalFunction => 0x01,
            Exception::IllegalDataAddress => 0x02,
            Exception::IllegalDataValue => 0x03,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Area {
    Holding,
    Input,
    Coil,
    Discrete,
}

impl Area {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "holding" => Some(Area::Holding),
            "input" => Some(Area::Input),
            "coil" => Some(Area::Coil),
            "discrete" => Some(Area::Discrete),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Registers {
    pub holding: Vec<u16>,
    pub input: Vec<u16>,
    pub coils: Vec<bool>,
    pub discrete: Vec<bool>,
}

impl Default for Registers {
    fn default() -> Self {
        Self {
            holding: vec![0; HOLDING_COUNT],
            input: vec![0; INPUT_COUNT],
            coils: vec![false; COIL_COUNT],
            discrete: vec![false; DISCRETE_COUNT],
        }
    }
}

impl Registers {
    pub fn clear_area(&mut self, area: Area) {
        match area {
            Area::Holding => self.holding.fill(0),
            Area::Input => self.input.fill(0),
            Area::Coil => self.coils.fill(false),
            Area::Discrete => self.discrete.fill(false),
        }
    }

    pub fn randomize_area(&mut self, area: Area, seed: u64) {
        let mut state = seed | 1;
        let mut next = move || {
            state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
            let mut z = state;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
            z ^ (z >> 31)
        };
        match area {
            Area::Holding => self.holding.iter_mut().for_each(|v| *v = next() as u16),
            Area::Input => self.input.iter_mut().for_each(|v| *v = next() as u16),
            Area::Coil => self.coils.iter_mut().for_each(|v| *v = next() & 1 == 1),
            Area::Discrete => self.discrete.iter_mut().for_each(|v| *v = next() & 1 == 1),
        }
    }
}

/// Information about a request, used by the UI request log.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogMeta {
    pub function: u8,
    pub address: u16,
    pub quantity: u16,
    /// `None` when the request was answered normally.
    pub exception: Option<u8>,
}

/// Formats bytes as uppercase hex separated by spaces for the UI log.
pub fn to_hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|byte| format!("{byte:02X}"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Builds a complete MBAP frame (header + PDU).
pub fn frame(transaction_id: u16, unit_id: u8, pdu: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(pdu.len() + 7);
    out.extend_from_slice(&transaction_id.to_be_bytes());
    out.extend_from_slice(&[0, 0]);
    out.extend_from_slice(&((pdu.len() + 1) as u16).to_be_bytes());
    out.push(unit_id);
    out.extend_from_slice(pdu);
    out
}

fn exception_pdu(function: u8, exception: Exception) -> Vec<u8> {
    vec![function | 0x80, exception.code()]
}

/// Executes one PDU and returns the response PDU plus log information.
pub fn handle_pdu(pdu: &[u8], registers: &mut Registers) -> (Vec<u8>, Option<LogMeta>) {
    let Some(&function) = pdu.first() else {
        return (Vec::new(), None);
    };

    let mut address = if pdu.len() >= 3 {
        u16::from_be_bytes([pdu[1], pdu[2]])
    } else {
        0
    };
    let mut quantity = if pdu.len() >= 5 {
        u16::from_be_bytes([pdu[3], pdu[4]])
    } else {
        0
    };
    if matches!(function, WRITE_SINGLE_COIL | WRITE_SINGLE_REGISTER) {
        quantity = 1;
    }

    let result = match function {
        READ_COILS => read_bits(pdu, &registers.coils),
        READ_DISCRETE_INPUTS => read_bits(pdu, &registers.discrete),
        READ_HOLDING_REGISTERS => read_registers(pdu, &registers.holding),
        READ_INPUT_REGISTERS => read_registers(pdu, &registers.input),
        WRITE_SINGLE_COIL => write_single_coil(pdu, registers),
        WRITE_SINGLE_REGISTER => write_single_register(pdu, registers),
        WRITE_MULTIPLE_COILS => {
            if pdu.len() >= 5 {
                address = u16::from_be_bytes([pdu[1], pdu[2]]);
                quantity = u16::from_be_bytes([pdu[3], pdu[4]]);
            }
            write_multiple_coils(pdu, registers)
        }
        WRITE_MULTIPLE_REGISTERS => {
            if pdu.len() >= 5 {
                address = u16::from_be_bytes([pdu[1], pdu[2]]);
                quantity = u16::from_be_bytes([pdu[3], pdu[4]]);
            }
            write_multiple_registers(pdu, registers)
        }
        _ => Err(Exception::IllegalFunction),
    };

    let (response, exception) = match result {
        Ok(response) => (response, None),
        Err(exception) => (exception_pdu(function, exception), Some(exception.code())),
    };

    let meta = LogMeta {
        function,
        address,
        quantity,
        exception,
    };
    (response, Some(meta))
}

/// Extracts display fields from a PDU without validating or executing it.
/// Useful for logging requests that are ignored (wrong unit id, bad CRC…).
pub fn meta_for_pdu(pdu: &[u8]) -> LogMeta {
    let function = pdu.first().copied().unwrap_or(0);
    let address = if pdu.len() >= 3 {
        u16::from_be_bytes([pdu[1], pdu[2]])
    } else {
        0
    };
    let mut quantity = if pdu.len() >= 5 {
        u16::from_be_bytes([pdu[3], pdu[4]])
    } else {
        0
    };
    if matches!(function, WRITE_SINGLE_COIL | WRITE_SINGLE_REGISTER) {
        quantity = 1;
    }
    LogMeta {
        function,
        address,
        quantity,
        exception: None,
    }
}

pub fn exception_reason(exception: Option<u8>) -> &'static str {
    match exception {
        Some(0x01) => "非法功能码",
        Some(0x02) => "非法地址",
        Some(0x03) => "非法数据值",
        Some(_) => "设备异常",
        None => "正常",
    }
}

fn read_request(pdu: &[u8]) -> Result<(u16, u16), Exception> {
    if pdu.len() != 5 {
        return Err(Exception::IllegalDataValue);
    }
    Ok((
        u16::from_be_bytes([pdu[1], pdu[2]]),
        u16::from_be_bytes([pdu[3], pdu[4]]),
    ))
}

fn read_bits(pdu: &[u8], bits: &[bool]) -> Result<Vec<u8>, Exception> {
    let (address, quantity) = read_request(pdu)?;
    if quantity == 0 || quantity > 2000 {
        return Err(Exception::IllegalDataValue);
    }
    let start = address as usize;
    let quantity = quantity as usize;
    let end = start + quantity;
    if end > bits.len() {
        return Err(Exception::IllegalDataAddress);
    }

    let byte_count = quantity.div_ceil(8);
    let mut data = vec![0u8; byte_count];
    for offset in 0..quantity {
        if bits[start + offset] {
            data[offset / 8] |= 1 << (offset % 8);
        }
    }

    let mut response = Vec::with_capacity(2 + byte_count);
    response.push(pdu[0]);
    response.push(byte_count as u8);
    response.extend_from_slice(&data);
    Ok(response)
}

fn read_registers(pdu: &[u8], registers: &[u16]) -> Result<Vec<u8>, Exception> {
    let (address, quantity) = read_request(pdu)?;
    if quantity == 0 || quantity > 125 {
        return Err(Exception::IllegalDataValue);
    }
    let start = address as usize;
    let quantity = quantity as usize;
    let end = start + quantity;
    if end > registers.len() {
        return Err(Exception::IllegalDataAddress);
    }

    let mut response = Vec::with_capacity(2 + quantity * 2);
    response.push(pdu[0]);
    response.push((quantity * 2) as u8);
    for value in &registers[start..end] {
        response.extend_from_slice(&value.to_be_bytes());
    }
    Ok(response)
}

fn write_single_coil(pdu: &[u8], registers: &mut Registers) -> Result<Vec<u8>, Exception> {
    if pdu.len() != 5 {
        return Err(Exception::IllegalDataValue);
    }
    let address = u16::from_be_bytes([pdu[1], pdu[2]]) as usize;
    if address >= registers.coils.len() {
        return Err(Exception::IllegalDataAddress);
    }
    let value = u16::from_be_bytes([pdu[3], pdu[4]]);
    let coil = match value {
        0xff00 => true,
        0x0000 => false,
        _ => return Err(Exception::IllegalDataValue),
    };
    registers.coils[address] = coil;
    Ok(pdu.to_vec())
}

fn write_single_register(pdu: &[u8], registers: &mut Registers) -> Result<Vec<u8>, Exception> {
    if pdu.len() != 5 {
        return Err(Exception::IllegalDataValue);
    }
    let address = u16::from_be_bytes([pdu[1], pdu[2]]) as usize;
    if address >= registers.holding.len() {
        return Err(Exception::IllegalDataAddress);
    }
    registers.holding[address] = u16::from_be_bytes([pdu[3], pdu[4]]);
    Ok(pdu.to_vec())
}

fn write_multiple_coils(pdu: &[u8], registers: &mut Registers) -> Result<Vec<u8>, Exception> {
    if pdu.len() < 6 {
        return Err(Exception::IllegalDataValue);
    }
    let address = u16::from_be_bytes([pdu[1], pdu[2]]);
    let quantity = u16::from_be_bytes([pdu[3], pdu[4]]);
    let byte_count = pdu[5] as usize;
    if quantity == 0 || quantity > 1968 {
        return Err(Exception::IllegalDataValue);
    }
    let expected = (quantity as usize).div_ceil(8);
    if byte_count != expected || pdu.len() != 6 + byte_count {
        return Err(Exception::IllegalDataValue);
    }
    let start = address as usize;
    let quantity = quantity as usize;
    let end = start + quantity;
    if end > registers.coils.len() {
        return Err(Exception::IllegalDataAddress);
    }

    for offset in 0..quantity {
        let byte = pdu[6 + offset / 8];
        registers.coils[start + offset] = (byte >> (offset % 8)) & 1 == 1;
    }

    Ok(vec![pdu[0], pdu[1], pdu[2], pdu[3], pdu[4]])
}

fn write_multiple_registers(pdu: &[u8], registers: &mut Registers) -> Result<Vec<u8>, Exception> {
    if pdu.len() < 6 {
        return Err(Exception::IllegalDataValue);
    }
    let address = u16::from_be_bytes([pdu[1], pdu[2]]);
    let quantity = u16::from_be_bytes([pdu[3], pdu[4]]);
    let byte_count = pdu[5] as usize;
    if quantity == 0 || quantity > 123 {
        return Err(Exception::IllegalDataValue);
    }
    if byte_count != quantity as usize * 2 || pdu.len() != 6 + byte_count {
        return Err(Exception::IllegalDataValue);
    }
    let start = address as usize;
    let quantity = quantity as usize;
    let end = start + quantity;
    if end > registers.holding.len() {
        return Err(Exception::IllegalDataAddress);
    }

    for offset in 0..quantity {
        let index = 6 + offset * 2;
        registers.holding[start + offset] = u16::from_be_bytes([pdu[index], pdu[index + 1]]);
    }

    Ok(vec![pdu[0], pdu[1], pdu[2], pdu[3], pdu[4]])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read(fc: u8, address: u16, quantity: u16) -> Vec<u8> {
        let mut pdu = vec![fc];
        pdu.extend_from_slice(&address.to_be_bytes());
        pdu.extend_from_slice(&quantity.to_be_bytes());
        pdu
    }

    #[test]
    fn reads_holding_registers() {
        let mut registers = Registers::default();
        registers.holding[0] = 0x1234;
        registers.holding[1] = 0xabcd;

        let (response, meta) = handle_pdu(&read(READ_HOLDING_REGISTERS, 0, 2), &mut registers);
        assert_eq!(response, vec![0x03, 0x04, 0x12, 0x34, 0xab, 0xcd]);
        let meta = meta.unwrap();
        assert_eq!(meta.address, 0);
        assert_eq!(meta.quantity, 2);
        assert_eq!(meta.exception, None);
    }

    #[test]
    fn packs_coils_lsb_first() {
        let mut registers = Registers::default();
        registers.coils[0] = true;
        registers.coils[2] = true;
        registers.coils[9] = true;

        let (response, _) = handle_pdu(&read(READ_COILS, 0, 10), &mut registers);
        assert_eq!(response, vec![0x01, 0x02, 0b0000_0101, 0b0000_0010]);
    }

    #[test]
    fn writes_single_register() {
        let mut registers = Registers::default();
        let pdu = vec![0x06, 0x00, 0x07, 0xbe, 0xef];
        let (response, _) = handle_pdu(&pdu, &mut registers);
        assert_eq!(response, pdu);
        assert_eq!(registers.holding[7], 0xbeef);
    }

    #[test]
    fn writes_multiple_registers() {
        let mut registers = Registers::default();
        let pdu = vec![0x10, 0x00, 0x01, 0x00, 0x02, 0x04, 0x11, 0x11, 0x22, 0x22];
        let (response, _) = handle_pdu(&pdu, &mut registers);
        assert_eq!(response, vec![0x10, 0x00, 0x01, 0x00, 0x02]);
        assert_eq!(registers.holding[1], 0x1111);
        assert_eq!(registers.holding[2], 0x2222);
    }

    #[test]
    fn writes_multiple_coils() {
        let mut registers = Registers::default();
        let pdu = vec![0x0f, 0x00, 0x02, 0x00, 0x04, 0x01, 0b0000_1010];
        let (response, _) = handle_pdu(&pdu, &mut registers);
        assert_eq!(response, vec![0x0f, 0x00, 0x02, 0x00, 0x04]);
        assert!(!registers.coils[2]);
        assert!(registers.coils[3]);
        assert!(!registers.coils[4]);
        assert!(registers.coils[5]);
    }

    #[test]
    fn rejects_out_of_range_address() {
        let mut registers = Registers::default();
        let (response, meta) = handle_pdu(&read(READ_HOLDING_REGISTERS, 99, 2), &mut registers);
        assert_eq!(response, vec![0x83, 0x02]);
        assert_eq!(meta.unwrap().exception, Some(0x02));
    }

    #[test]
    fn rejects_invalid_coil_value() {
        let mut registers = Registers::default();
        let pdu = vec![0x05, 0x00, 0x00, 0x12, 0x34];
        let (response, _) = handle_pdu(&pdu, &mut registers);
        assert_eq!(response, vec![0x85, 0x03]);
    }

    #[test]
    fn rejects_unsupported_function() {
        let mut registers = Registers::default();
        let (response, _) = handle_pdu(&[0x2b, 0x0e, 0x01, 0x00], &mut registers);
        assert_eq!(response, vec![0xab, 0x01]);
    }

    #[test]
    fn frame_has_valid_mbap_header() {
        let frame = frame(0x1234, 0x11, &[0x03, 0x02, 0x00, 0x2a]);
        assert_eq!(
            frame,
            vec![0x12, 0x34, 0x00, 0x00, 0x00, 0x05, 0x11, 0x03, 0x02, 0x00, 0x2a]
        );
    }
}
