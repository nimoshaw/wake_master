#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{Read, Write};
use std::net::UdpSocket;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use hmac::{Hmac, Mac};
use sha2::Sha256;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

/// Windows flag to prevent console windows from appearing
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// P2P command server port
const COMMAND_PORT: u16 = 9090;

/// Timestamp tolerance (seconds)
const TIMESTAMP_TOLERANCE: u64 = 300;

/// Create a Command that won't show a console window on Windows
fn silent_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

// === Data Models ===

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Machine {
    id: String,
    name: String,
    mac: String,
    ip: String,
    #[serde(default = "default_icon")]
    icon: String,
}

fn default_icon() -> String {
    "🖥️".to_string()
}

#[derive(Debug, Serialize)]
struct MachineStatus {
    id: String,
    online: bool,
    has_agent: bool,
}

#[derive(Debug, Serialize)]
struct LanDevice {
    ip: String,
    mac: String,
    device_type: String,
}

#[derive(Debug, Serialize)]
struct CommandResult {
    success: bool,
    message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct AppConfig {
    #[serde(default)]
    group_password: String,
    #[serde(default = "default_command_port")]
    command_port: u16,
}

fn default_command_port() -> u16 {
    COMMAND_PORT
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            group_password: String::new(),
            command_port: COMMAND_PORT,
        }
    }
}

#[derive(Debug, Deserialize)]
struct P2PCommand {
    action: String,
    timestamp: u64,
    hmac: String,
}

// === File Helpers ===

fn get_data_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

fn get_machines_path() -> PathBuf {
    get_data_dir().join("machines.json")
}

fn get_config_path() -> PathBuf {
    get_data_dir().join("config.json")
}

fn load_machines() -> Vec<Machine> {
    let path = get_machines_path();
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        let defaults: Vec<Machine> = vec![];
        save_machines(&defaults);
        defaults
    }
}

fn save_machines(machines: &[Machine]) {
    let path = get_machines_path();
    if let Ok(data) = serde_json::to_string_pretty(machines) {
        let _ = fs::write(path, data);
    }
}

fn load_config() -> AppConfig {
    let path = get_config_path();
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        let config = AppConfig::default();
        save_config(&config);
        config
    }
}

fn save_config(config: &AppConfig) {
    let path = get_config_path();
    if let Ok(data) = serde_json::to_string_pretty(config) {
        let _ = fs::write(path, data);
    }
}

// === HMAC Auth ===

type HmacSha256 = Hmac<Sha256>;

fn compute_hmac(action: &str, timestamp: u64, password: &str) -> String {
    let message = format!("{}|{}", action, timestamp);
    let mut mac = HmacSha256::new_from_slice(password.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(message.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

fn verify_hmac(action: &str, timestamp: u64, provided_hmac: &str, password: &str) -> bool {
    if password.is_empty() {
        return false; // No password set = reject all
    }
    let expected = compute_hmac(action, timestamp, password);
    expected == provided_hmac
}

fn current_timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

// === WOL Magic Packet ===

fn parse_mac(mac_str: &str) -> Result<[u8; 6], String> {
    let parts: Vec<&str> = mac_str.split(|c| c == ':' || c == '-').collect();
    if parts.len() != 6 {
        return Err(format!("Invalid MAC address: {}", mac_str));
    }
    let mut mac = [0u8; 6];
    for (i, part) in parts.iter().enumerate() {
        mac[i] = u8::from_str_radix(part, 16)
            .map_err(|_| format!("Invalid MAC byte: {}", part))?;
    }
    Ok(mac)
}

fn create_magic_packet(mac: &[u8; 6]) -> Vec<u8> {
    let mut packet = vec![0xFFu8; 6];
    for _ in 0..16 {
        packet.extend_from_slice(mac);
    }
    packet
}

fn send_wol(mac_str: &str, target_ip: &str) -> Result<(), String> {
    let mac = parse_mac(mac_str)?;
    let packet = create_magic_packet(&mac);

    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Failed to bind socket: {}", e))?;
    socket
        .set_broadcast(true)
        .map_err(|e| format!("Failed to set broadcast: {}", e))?;

    let mut targets = vec!["255.255.255.255".to_string()];
    if let Some(last_dot) = target_ip.rfind('.') {
        let subnet_broadcast = format!("{}255", &target_ip[..=last_dot]);
        targets.push(subnet_broadcast);
    }

    let ports = [9, 7, 0];
    for _ in 0..3 {
        for target in &targets {
            for port in &ports {
                let addr = format!("{}:{}", target, port);
                let _ = socket.send_to(&packet, &addr);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }

    Ok(())
}

// === Ping (Cross-Platform) ===

fn ping_host(ip: &str) -> bool {
    let output = if cfg!(target_os = "windows") {
        silent_command("ping")
            .args(["-n", "1", "-w", "2000", ip])
            .output()
    } else {
        silent_command("ping")
            .args(["-c", "1", "-W", "2", ip])
            .output()
    };

    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

// === Local Power Control ===

fn local_shutdown() -> bool {
    let result = if cfg!(target_os = "windows") {
        silent_command("shutdown")
            .args(["/s", "/t", "5", "/c", "WakeMaster remote shutdown"])
            .output()
    } else {
        silent_command("shutdown")
            .args(["-h", "+0"])
            .output()
    };
    result.map(|o| o.status.success()).unwrap_or(false)
}

fn local_restart() -> bool {
    let result = if cfg!(target_os = "windows") {
        silent_command("shutdown")
            .args(["/r", "/t", "5", "/c", "WakeMaster remote restart"])
            .output()
    } else {
        silent_command("shutdown")
            .args(["-r", "+0"])
            .output()
    };
    result.map(|o| o.status.success()).unwrap_or(false)
}

// === P2P Command Server ===

fn start_command_server(config: Arc<std::sync::Mutex<AppConfig>>) {
    let addr = format!("0.0.0.0:{}", COMMAND_PORT);
    let server = match tiny_http::Server::http(&addr) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to start command server on {}: {}", addr, e);
            return;
        }
    };
    println!("🔒 P2P command server listening on port {}", COMMAND_PORT);

    for mut request in server.incoming_requests() {
        // GET /ping — agent identity check
        if request.method() == &tiny_http::Method::Get {
            let resp = tiny_http::Response::from_string("{\"agent\":\"wakemaster\"}")
                .with_status_code(200)
                .with_header(
                    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
                );
            let _ = request.respond(resp);
            continue;
        }

        if request.method() != &tiny_http::Method::Post {
            let resp = tiny_http::Response::from_string("{\"error\":\"method not allowed\"}")
                .with_status_code(405)
                .with_header(
                    tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
                );
            let _ = request.respond(resp);
            continue;
        }

        // Read body
        let mut body = String::new();
        let mut reader = request.as_reader();
        if reader.read_to_string(&mut body).is_err() {
            let resp = tiny_http::Response::from_string("{\"error\":\"bad request\"}")
                .with_status_code(400);
            let _ = request.respond(resp);
            continue;
        }

        // Parse command
        let cmd: P2PCommand = match serde_json::from_str(&body) {
            Ok(c) => c,
            Err(_) => {
                let resp = tiny_http::Response::from_string("{\"error\":\"invalid json\"}")
                    .with_status_code(400);
                let _ = request.respond(resp);
                continue;
            }
        };

        // Verify authentication
        let password = {
            let cfg = config.lock().unwrap();
            cfg.group_password.clone()
        };

        if password.is_empty() {
            let resp = tiny_http::Response::from_string("{\"error\":\"no group password configured on this machine\"}")
                .with_status_code(403);
            let _ = request.respond(resp);
            continue;
        }

        // Timestamp check
        let now = current_timestamp();
        let diff = if now > cmd.timestamp { now - cmd.timestamp } else { cmd.timestamp - now };
        if diff > TIMESTAMP_TOLERANCE {
            let resp = tiny_http::Response::from_string("{\"error\":\"timestamp expired\"}")
                .with_status_code(403);
            let _ = request.respond(resp);
            continue;
        }

        // HMAC check
        if !verify_hmac(&cmd.action, cmd.timestamp, &cmd.hmac, &password) {
            let resp = tiny_http::Response::from_string("{\"error\":\"authentication failed\"}")
                .with_status_code(403);
            let _ = request.respond(resp);
            continue;
        }

        // Execute command
        let success = match cmd.action.as_str() {
            "shutdown" => {
                println!("🔌 Received authenticated shutdown command");
                local_shutdown()
            }
            "restart" => {
                println!("🔄 Received authenticated restart command");
                local_restart()
            }
            _ => false,
        };

        let resp_body = if success {
            "{\"success\":true}"
        } else {
            "{\"success\":false,\"error\":\"command execution failed\"}"
        };
        let status = if success { 200 } else { 500 };
        let resp = tiny_http::Response::from_string(resp_body)
            .with_status_code(status)
            .with_header(
                tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap(),
            );
        let _ = request.respond(resp);
    }
}

// === P2P Command Sender ===

fn send_p2p_command(ip: &str, action: &str, password: &str) -> CommandResult {
    if password.is_empty() {
        return CommandResult {
            success: false,
            message: "请先在设置中配置组密码".to_string(),
        };
    }

    let timestamp = current_timestamp();
    let hmac_hex = compute_hmac(action, timestamp, password);
    let body = serde_json::json!({
        "action": action,
        "timestamp": timestamp,
        "hmac": hmac_hex,
    });

    let url = format!("http://{}:{}/command", ip, COMMAND_PORT);

    // Use a simple TCP connection for HTTP POST (avoid extra deps)
    let addr = format!("{}:{}", ip, COMMAND_PORT);
    let body_str = body.to_string();
    let http_request = format!(
        "POST /command HTTP/1.1\r\nHost: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        addr, body_str.len(), body_str
    );

    match std::net::TcpStream::connect_timeout(
        &addr.parse().unwrap_or_else(|_| format!("{}:{}", ip, COMMAND_PORT).parse().unwrap()),
        std::time::Duration::from_secs(5),
    ) {
        Ok(mut stream) => {
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
            if stream.write_all(http_request.as_bytes()).is_err() {
                return CommandResult {
                    success: false,
                    message: format!("发送命令失败: 无法连接到 {}", url),
                };
            }
            let mut response = String::new();
            let _ = stream.read_to_string(&mut response);

            if response.contains("\"success\":true") {
                let action_name = if action == "shutdown" { "关机" } else { "重启" };
                CommandResult {
                    success: true,
                    message: format!("{} 指令已发送并执行", action_name),
                }
            } else if response.contains("authentication failed") {
                CommandResult {
                    success: false,
                    message: "认证失败: 组密码不匹配".to_string(),
                }
            } else if response.contains("no group password") {
                CommandResult {
                    success: false,
                    message: "目标机器未配置组密码".to_string(),
                }
            } else if response.contains("timestamp expired") {
                CommandResult {
                    success: false,
                    message: "时间戳过期: 请确保两台机器时间同步".to_string(),
                }
            } else {
                CommandResult {
                    success: false,
                    message: format!("目标机器返回错误"),
                }
            }
        }
        Err(_) => CommandResult {
            success: false,
            message: format!("无法连接到 {} (目标机器可能未运行 WakeMaster 或端口 {} 被防火墙拦截)", ip, COMMAND_PORT),
        },
    }
}

// === LAN Scan ===

fn scan_arp_table() -> Vec<LanDevice> {
    let output = silent_command("arp").args(["-a"]).output();

    let mut devices = Vec::new();

    if let Ok(output) = output {
        let text = String::from_utf8_lossy(&output.stdout);

        if cfg!(target_os = "windows") {
            for line in text.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    let ip = parts[0];
                    let mac = parts[1];
                    let dtype = parts.get(2).unwrap_or(&"");
                    if ip.contains('.') && mac.contains('-') && *dtype != "static" {
                        if !ip.ends_with(".255") && !mac.starts_with("ff-ff-ff") && !mac.starts_with("01-00-5e") {
                            devices.push(LanDevice {
                                ip: ip.to_string(),
                                mac: mac.to_uppercase().replace('-', ":"),
                                device_type: dtype.to_string(),
                            });
                        }
                    }
                }
            }
        } else {
            for line in text.lines() {
                let line = line.trim();
                if let (Some(ip_start), Some(ip_end)) = (line.find('('), line.find(')')) {
                    let ip = &line[ip_start + 1..ip_end];
                    if let Some(at_idx) = line.find(" at ") {
                        let rest = &line[at_idx + 4..];
                        let mac = rest.split_whitespace().next().unwrap_or("");
                        if mac.contains(':') && mac != "(incomplete)" && !mac.starts_with("ff:ff:ff") {
                            devices.push(LanDevice {
                                ip: ip.to_string(),
                                mac: mac.to_uppercase(),
                                device_type: "dynamic".to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    devices
}

// === Tauri Commands ===

#[tauri::command]
fn get_machines() -> Vec<Machine> {
    load_machines()
}

#[tauri::command]
fn add_machine(name: String, mac: String, ip: String, icon: String) -> Machine {
    let mut machines = load_machines();
    let id = format!(
        "{}_{}",
        name.to_lowercase().replace(|c: char| !c.is_alphanumeric(), "_"),
        uuid::Uuid::new_v4().to_string().split('-').next().unwrap_or("0")
    );
    let new_machine = Machine {
        id: id.clone(),
        name,
        mac,
        ip,
        icon: if icon.is_empty() { default_icon() } else { icon },
    };
    machines.push(new_machine.clone());
    save_machines(&machines);
    new_machine
}

#[tauri::command]
fn update_machine(id: String, name: String, mac: String, ip: String, icon: String) -> CommandResult {
    let mut machines = load_machines();
    if let Some(m) = machines.iter_mut().find(|m| m.id == id) {
        if !name.is_empty() { m.name = name; }
        if !mac.is_empty() { m.mac = mac; }
        if !ip.is_empty() { m.ip = ip; }
        if !icon.is_empty() { m.icon = icon; }
        save_machines(&machines);
        CommandResult { success: true, message: "Updated".into() }
    } else {
        CommandResult { success: false, message: "Machine not found".into() }
    }
}

#[tauri::command]
fn delete_machine(id: String) -> CommandResult {
    let mut machines = load_machines();
    let len_before = machines.len();
    machines.retain(|m| m.id != id);
    if machines.len() < len_before {
        save_machines(&machines);
        CommandResult { success: true, message: "Deleted".into() }
    } else {
        CommandResult { success: false, message: "Machine not found".into() }
    }
}

fn check_tcp_port(ip: &str, port: u16, timeout_ms: u64) -> bool {
    let addr = format!("{}:{}", ip, port);
    if let Ok(addr) = addr.parse::<std::net::SocketAddr>() {
        std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_millis(timeout_ms)).is_ok()
    } else {
        false
    }
}

#[tauri::command]
fn check_status() -> Vec<MachineStatus> {
    let machines = load_machines();
    let handles: Vec<_> = machines
        .into_iter()
        .map(|m| {
            std::thread::spawn(move || {
                // 1. Try ping first
                let mut online = ping_host(&m.ip);
                
                // 2. Fallback: check common ports if ping fails
                if !online {
                    let common_ports = [22, 80, 443, 8006, 3389, 5900];
                    for port in common_ports {
                        if check_tcp_port(&m.ip, port, 1000) {
                            online = true;
                            break;
                        }
                    }
                }

                let has_agent = if online {
                    // HTTP GET /ping to verify WakeMaster agent
                    let addr = format!("{}:{}", m.ip, COMMAND_PORT);
                    if let Ok(addr) = addr.parse::<std::net::SocketAddr>() {
                        match std::net::TcpStream::connect_timeout(
                            &addr,
                            std::time::Duration::from_millis(1500),
                        ) {
                            Ok(mut stream) => {
                                let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(1500)));
                                let req = format!("GET /ping HTTP/1.1\r\nHost: {}\r\nConnection: close\r\n\r\n", addr);
                                if stream.write_all(req.as_bytes()).is_ok() {
                                    let mut buf = String::new();
                                    let _ = stream.read_to_string(&mut buf);
                                    buf.contains("wakemaster")
                                } else {
                                    false
                                }
                            }
                            Err(_) => false,
                        }
                    } else {
                        false
                    }
                } else {
                    false
                };
                MachineStatus { id: m.id, online, has_agent }
            })
        })
        .collect();
    handles.into_iter().filter_map(|h| h.join().ok()).collect()
}

#[tauri::command]
fn wake_machine(id: String) -> CommandResult {
    let machines = load_machines();
    if let Some(machine) = machines.iter().find(|m| m.id == id) {
        match send_wol(&machine.mac, &machine.ip) {
            Ok(_) => CommandResult {
                success: true,
                message: format!("WOL packet sent to {} ({})", machine.name, machine.mac),
            },
            Err(e) => CommandResult {
                success: false,
                message: format!("Wake failed: {}", e),
            },
        }
    } else {
        CommandResult { success: false, message: "Machine not found".into() }
    }
}

#[tauri::command]
fn shutdown_machine(id: String) -> CommandResult {
    let machines = load_machines();
    let config = load_config();
    if let Some(machine) = machines.iter().find(|m| m.id == id) {
        send_p2p_command(&machine.ip, "shutdown", &config.group_password)
    } else {
        CommandResult { success: false, message: "Machine not found".into() }
    }
}

#[tauri::command]
fn restart_machine(id: String) -> CommandResult {
    let machines = load_machines();
    let config = load_config();
    if let Some(machine) = machines.iter().find(|m| m.id == id) {
        send_p2p_command(&machine.ip, "restart", &config.group_password)
    } else {
        CommandResult { success: false, message: "Machine not found".into() }
    }
}

#[tauri::command]
fn scan_lan() -> Vec<LanDevice> {
    scan_arp_table()
}

#[tauri::command]
fn get_platform() -> String {
    if cfg!(target_os = "windows") {
        "windows".to_string()
    } else if cfg!(target_os = "macos") {
        "macos".to_string()
    } else {
        "linux".to_string()
    }
}

#[tauri::command]
fn get_group_password() -> String {
    load_config().group_password
}

#[tauri::command]
fn set_group_password(password: String) -> CommandResult {
    let mut config = load_config();
    config.group_password = password;
    save_config(&config);
    CommandResult {
        success: true,
        message: "组密码已保存".to_string(),
    }
}
#[tauri::command]
fn reorder_machines(ids: Vec<String>) -> CommandResult {
    let machines = load_machines();
    let mut reordered: Vec<Machine> = Vec::new();
    for id in &ids {
        if let Some(m) = machines.iter().find(|m| &m.id == id) {
            reordered.push(m.clone());
        }
    }
    // Add any machines not in the ids list (safety)
    for m in &machines {
        if !ids.contains(&m.id) {
            reordered.push(m.clone());
        }
    }
    save_machines(&reordered);
    CommandResult { success: true, message: "Reordered".into() }
}

// === Main ===

fn main() {
    // Start P2P command listener in background thread
    let config = Arc::new(std::sync::Mutex::new(load_config()));
    let config_clone = config.clone();
    std::thread::spawn(move || {
        start_command_server(config_clone);
    });

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .invoke_handler(tauri::generate_handler![
            get_machines,
            add_machine,
            update_machine,
            delete_machine,
            check_status,
            wake_machine,
            shutdown_machine,
            restart_machine,
            scan_lan,
            get_platform,
            get_group_password,
            set_group_password,
            reorder_machines,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
