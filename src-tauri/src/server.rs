//! A small, resilient Modbus TCP slave server.

use std::collections::VecDeque;
use std::io;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio::task::JoinHandle;

use crate::modbus::{self, LogMeta, Registers};

pub const LOG_CAPACITY: usize = 200;

#[derive(Debug, Clone)]
pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub unit_id: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub seq: u64,
    pub time_ms: u64,
    pub transport: String,
    pub client: String,
    pub function: u8,
    pub address: u16,
    pub quantity: u16,
    pub exception: Option<u8>,
    pub ok: bool,
    pub reason: String,
    pub request_hex: String,
    pub response_hex: Option<String>,
}

/// State shared between the UI commands and the network tasks.
pub struct Shared {
    pub registers: RwLock<Registers>,
    pub logs: Mutex<VecDeque<LogEntry>>,
    pub sequence: AtomicU64,
    pub total_requests: AtomicU64,
    pub active_connections: AtomicU32,
    pub listen_addr: RwLock<Option<String>>,
    pub last_error: RwLock<Option<String>>,
}

impl Shared {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            registers: RwLock::new(Registers::default()),
            logs: Mutex::new(VecDeque::with_capacity(LOG_CAPACITY)),
            sequence: AtomicU64::new(0),
            total_requests: AtomicU64::new(0),
            active_connections: AtomicU32::new(0),
            listen_addr: RwLock::new(None),
            last_error: RwLock::new(None),
        })
    }

    pub fn reset_session(&self) {
        self.total_requests.store(0, Ordering::Relaxed);
        self.sequence.store(0, Ordering::Relaxed);
        self.clear_error();
        if let Ok(mut logs) = self.logs.lock() {
            logs.clear();
        }
    }

    pub fn set_error(&self, message: impl Into<String>) {
        if let Ok(mut error) = self.last_error.write() {
            *error = Some(message.into());
        }
    }

    pub fn clear_error(&self) {
        if let Ok(mut error) = self.last_error.write() {
            *error = None;
        }
    }

    pub fn last_error(&self) -> Option<String> {
        self.last_error.read().ok().and_then(|error| error.clone())
    }

    pub fn clear_logs(&self) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.clear();
        }
    }

    pub(crate) fn record(
        &self,
        transport: &str,
        client: &str,
        meta: LogMeta,
        ok: bool,
        reason: impl Into<String>,
        request_hex: String,
        response_hex: Option<String>,
    ) {
        self.total_requests.fetch_add(1, Ordering::Relaxed);
        let seq = self.sequence.fetch_add(1, Ordering::Relaxed) + 1;
        let entry = LogEntry {
            seq,
            time_ms: now_ms(),
            transport: transport.to_string(),
            client: client.to_string(),
            function: meta.function,
            address: meta.address,
            quantity: meta.quantity,
            exception: meta.exception,
            ok,
            reason: reason.into(),
            request_hex,
            response_hex,
        };
        if let Ok(mut logs) = self.logs.lock() {
            if logs.len() >= LOG_CAPACITY {
                logs.pop_front();
            }
            logs.push_back(entry);
        }
    }

    pub fn recent_logs(&self) -> Vec<LogEntry> {
        self.logs
            .lock()
            .map(|logs| logs.iter().rev().cloned().collect())
            .unwrap_or_default()
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

/// A running server instance. Dropping the handle without calling
/// [`shutdown`] leaves the accept loop running until the process ends.
pub struct Running {
    shutdown: watch::Sender<bool>,
    join: JoinHandle<()>,
    /// Actual bound port (useful for tests that bind port 0).
    #[allow(dead_code)]
    pub port: u16,
}

impl Running {
    pub fn is_running(&self) -> bool {
        !self.join.is_finished()
    }
}

pub async fn start(shared: Arc<Shared>, config: ServerConfig) -> Result<Running, String> {
    let listener = TcpListener::bind((config.host.as_str(), config.port))
        .await
        .map_err(friendly_bind_error)?;
    let local_addr = listener.local_addr().map_err(|error| error.to_string())?;

    if let Ok(mut listen_addr) = shared.listen_addr.write() {
        *listen_addr = Some(local_addr.to_string());
    }

    let (shutdown, shutdown_rx) = watch::channel(false);
    let accept_shared = Arc::clone(&shared);
    let unit_id = config.unit_id;

    let join = tokio::spawn(async move {
        loop {
            if *shutdown_rx.borrow() {
                break;
            }

            // A short accept timeout lets the loop notice a stop request
            // without needing a select! macro (keeps the tokio feature set
            // small).
            match tokio::time::timeout(Duration::from_millis(200), listener.accept()).await {
                Ok(Ok((stream, peer))) => {
                    accept_shared
                        .active_connections
                        .fetch_add(1, Ordering::Relaxed);
                    let connection_shared = Arc::clone(&accept_shared);
                    let connection_shutdown = shutdown_rx.clone();
                    tokio::spawn(async move {
                        let _guard = ConnectionGuard(Arc::clone(&connection_shared));
                        if let Err(error) = serve_connection(
                            stream,
                            peer,
                            connection_shared,
                            unit_id,
                            connection_shutdown,
                        )
                        .await
                        {
                            eprintln!("modbus connection {peer} closed: {error}");
                        }
                    });
                }
                Ok(Err(error)) => {
                    accept_shared.set_error(format!("网络监听异常：{error}"));
                    tokio::time::sleep(Duration::from_millis(100)).await;
                }
                Err(_) => {}
            }
        }

        if let Ok(mut listen_addr) = accept_shared.listen_addr.write() {
            *listen_addr = None;
        }
    });

    Ok(Running {
        shutdown,
        join,
        port: local_addr.port(),
    })
}

pub async fn shutdown(server: Running) {
    let _ = server.shutdown.send(true);
    let _ = tokio::time::timeout(Duration::from_secs(2), server.join).await;
}

struct ConnectionGuard(Arc<Shared>);

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        let _ = self.0.active_connections.fetch_update(
            Ordering::Relaxed,
            Ordering::Relaxed,
            |active| Some(active.saturating_sub(1)),
        );
    }
}

struct Frame {
    transaction_id: u16,
    unit_id: u8,
    pdu: Vec<u8>,
}

async fn serve_connection<S>(
    mut stream: S,
    peer: SocketAddr,
    shared: Arc<Shared>,
    unit_id: u8,
    shutdown_rx: watch::Receiver<bool>,
) -> io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let client = peer.ip().to_string();
    let mut buffer: Vec<u8> = Vec::with_capacity(512);
    let mut chunk = [0u8; 1024];

    loop {
        if *shutdown_rx.borrow() {
            break;
        }

        let frame = match next_frame(&mut buffer) {
            Ok(Some(frame)) => Some(frame),
            Ok(None) => None,
            Err(error) => {
                shared.record(
                    "tcp",
                    &client,
                    modbus::meta_for_pdu(&[]),
                    false,
                    format!("TCP 帧格式错误：{error}"),
                    modbus::to_hex(&buffer),
                    None,
                );
                return Err(error);
            }
        };

        if let Some(frame) = frame {
            // Frames for another slave address are logged but not answered,
            // just like a real bus device that is not being addressed.
            if frame.unit_id != unit_id {
                let meta = modbus::meta_for_pdu(&frame.pdu);
                shared.record(
                    "tcp",
                    &client,
                    meta,
                    false,
                    format!("从站地址不匹配（收到 {}，本机 {}）", frame.unit_id, unit_id),
                    modbus::to_hex(&modbus::frame(
                        frame.transaction_id,
                        frame.unit_id,
                        &frame.pdu,
                    )),
                    None,
                );
                continue;
            }

            let (response_pdu, meta) = {
                let mut registers = shared
                    .registers
                    .write()
                    .map_err(|_| io::Error::other("register lock poisoned"))?;
                modbus::handle_pdu(&frame.pdu, &mut registers)
            };

            let request_hex = modbus::to_hex(&modbus::frame(
                frame.transaction_id,
                frame.unit_id,
                &frame.pdu,
            ));
            let response_frame = modbus::frame(frame.transaction_id, frame.unit_id, &response_pdu);

            if let Some(meta) = meta {
                let ok = meta.exception.is_none();
                let reason = modbus::exception_reason(meta.exception);
                shared.record(
                    "tcp",
                    &client,
                    meta,
                    ok,
                    reason,
                    request_hex,
                    Some(modbus::to_hex(&response_frame)),
                );
            }

            stream.write_all(&response_frame).await?;
            continue;
        }

        // Idle connections wake up regularly so a stop request is noticed
        // quickly, while a partially received frame stays in `buffer`.
        match tokio::time::timeout(Duration::from_millis(250), stream.read(&mut chunk)).await {
            Ok(Ok(0)) => break,
            Ok(Ok(read)) => {
                buffer.extend_from_slice(&chunk[..read]);
                if buffer.len() > 4096 {
                    shared.record(
                        "tcp",
                        &client,
                        modbus::meta_for_pdu(&[]),
                        false,
                        "TCP 接收数据超过 4 KB",
                        modbus::to_hex(&buffer),
                        None,
                    );
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        "TCP 接收数据超过 4 KB",
                    ));
                }
            }
            Ok(Err(error)) => return Err(error),
            Err(_) => continue,
        }
    }
    Ok(())
}

/// Pops one complete MBAP frame from the receive buffer.
fn next_frame(buffer: &mut Vec<u8>) -> io::Result<Option<Frame>> {
    if buffer.len() < 7 {
        return Ok(None);
    }

    if buffer[2] != 0 || buffer[3] != 0 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "MBAP 协议标识不是 0",
        ));
    }

    let length = u16::from_be_bytes([buffer[4], buffer[5]]) as usize;
    // Length includes the unit id, so a valid PDU is 1..=253 bytes.
    if !(2..=254).contains(&length) {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "MBAP 长度无效"));
    }

    let total = 6 + length;
    if buffer.len() < total {
        return Ok(None);
    }

    let bytes: Vec<u8> = buffer.drain(..total).collect();
    Ok(Some(Frame {
        transaction_id: u16::from_be_bytes([bytes[0], bytes[1]]),
        unit_id: bytes[6],
        pdu: bytes[7..].to_vec(),
    }))
}

/// Returns the machine's LAN address (when available) plus localhost.
pub fn local_ips() -> Vec<String> {
    let mut addresses = Vec::new();
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("8.8.8.8:80").is_ok() {
            if let Ok(local) = socket.local_addr() {
                let ip = local.ip().to_string();
                if ip != "0.0.0.0" {
                    addresses.push(ip);
                }
            }
        }
    }
    addresses.push("127.0.0.1".to_string());
    addresses.dedup();
    addresses
}

fn friendly_bind_error(error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::AddrInUse => "端口已被占用，请换一个端口".to_string(),
        io::ErrorKind::PermissionDenied => {
            "没有权限绑定该端口（1024 以下端口需要管理员权限），请改用 1024 以上的端口".to_string()
        }
        io::ErrorKind::AddrNotAvailable => {
            "监听地址不可用，请选择 0.0.0.0 或 127.0.0.1".to_string()
        }
        _ => format!("无法启动服务：{error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpStream;

    async fn read_response<S>(stream: &mut S) -> io::Result<Vec<u8>>
    where
        S: AsyncRead + Unpin,
    {
        let mut header = [0u8; 7];
        stream.read_exact(&mut header).await?;
        let length = u16::from_be_bytes([header[4], header[5]]) as usize;
        let mut pdu = vec![0u8; length - 1];
        stream.read_exact(&mut pdu).await?;
        Ok(pdu)
    }

    fn block_on<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap()
            .block_on(future)
    }

    #[test]
    fn serves_reads_and_writes_over_tcp() {
        block_on(async {
            let shared = Shared::new();
            let server = start(
                Arc::clone(&shared),
                ServerConfig {
                    host: "127.0.0.1".into(),
                    port: 0,
                    unit_id: 1,
                },
            )
            .await
            .expect("server should start");

            let mut stream = TcpStream::connect(("127.0.0.1", server.port))
                .await
                .expect("client should connect");

            // Write register 3 = 1234 (FC06).
            stream
                .write_all(&modbus::frame(1, 1, &[0x06, 0x00, 0x03, 0x04, 0xd2]))
                .await
                .unwrap();
            assert_eq!(
                read_response(&mut stream).await.unwrap(),
                vec![0x06, 0x00, 0x03, 0x04, 0xd2]
            );

            // Read back registers 0..4 (FC03).
            stream
                .write_all(&modbus::frame(2, 1, &[0x03, 0x00, 0x00, 0x00, 0x04]))
                .await
                .unwrap();
            assert_eq!(
                read_response(&mut stream).await.unwrap(),
                vec![0x03, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x04, 0xd2]
            );

            // Requests to another unit id must be ignored.
            stream
                .write_all(&modbus::frame(3, 9, &[0x03, 0x00, 0x00, 0x00, 0x01]))
                .await
                .unwrap();
            stream
                .write_all(&modbus::frame(4, 1, &[0x03, 0x00, 0x03, 0x00, 0x01]))
                .await
                .unwrap();
            let response = read_response(&mut stream).await.unwrap();
            assert_eq!(response, vec![0x03, 0x02, 0x04, 0xd2]);

            assert_eq!(shared.total_requests.load(Ordering::Relaxed), 4);
            let logs = shared.recent_logs();
            assert_eq!(logs.len(), 4);
            assert_eq!(logs[0].address, 3);
            assert!(logs[0].ok);
            assert!(!logs[0].request_hex.is_empty());
            assert!(logs[0].response_hex.is_some());
            assert_eq!(logs[1].reason, "从站地址不匹配（收到 9，本机 1）");
            assert!(!logs[1].ok);
            assert!(logs[1].response_hex.is_none());

            drop(stream);
            shutdown(server).await;
        });
    }

    #[test]
    fn logs_malformed_mbap_frame() {
        block_on(async {
            let shared = Shared::new();
            let server = start(
                Arc::clone(&shared),
                ServerConfig {
                    host: "127.0.0.1".into(),
                    port: 0,
                    unit_id: 1,
                },
            )
            .await
            .unwrap();

            let mut stream = TcpStream::connect(("127.0.0.1", server.port))
                .await
                .unwrap();
            // MBAP with protocol id 1 (invalid).
            stream
                .write_all(&[0x00, 0x01, 0x00, 0x01, 0x00, 0x02, 0x01])
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(200)).await;

            let logs = shared.recent_logs();
            assert_eq!(logs.len(), 1);
            assert!(!logs[0].ok);
            assert!(logs[0].reason.contains("TCP 帧格式错误"));

            drop(stream);
            shutdown(server).await;
        });
    }

    #[test]
    fn returns_illegal_address_exception() {
        block_on(async {
            let shared = Shared::new();
            let server = start(
                Arc::clone(&shared),
                ServerConfig {
                    host: "127.0.0.1".into(),
                    port: 0,
                    unit_id: 7,
                },
            )
            .await
            .unwrap();

            let mut stream = TcpStream::connect(("127.0.0.1", server.port))
                .await
                .unwrap();
            stream
                .write_all(&modbus::frame(1, 7, &[0x03, 0x00, 0xff, 0x00, 0x02]))
                .await
                .unwrap();
            assert_eq!(read_response(&mut stream).await.unwrap(), vec![0x83, 0x02]);

            drop(stream);
            shutdown(server).await;
        });
    }
}
