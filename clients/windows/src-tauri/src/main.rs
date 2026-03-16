#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::fs;
use std::net::UdpSocket;
use std::path::PathBuf;
use std::process::Command;


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

// === File Helpers ===

fn get_machines_path() -> PathBuf {
    // Store machines.json next to the executable, or in app data
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    exe_dir.join("machines.json")
}

fn load_machines() -> Vec<Machine> {
    let path = get_machines_path();
    if let Ok(data) = fs::read_to_string(&path) {
        serde_json::from_str(&data).unwrap_or_default()
    } else {
        // Create default machines file
        let defaults = vec![
            Machine {
                id: "station".into(),
                name: "station".into(),
                mac: "D8:BB:C1:9A:9D:79".into(),
                ip: "192.168.0.100".into(),
                icon: "🖥️".into(),
            },
            Machine {
                id: "corebox".into(),
                name: "corebox".into(),
                mac: "D8:BB:C1:91:19:7F".into(),
                ip: "192.168.0.101".into(),
                icon: "📦".into(),
            },
            Machine {
                id: "light".into(),
                name: "light".into(),
                mac: "70:70:FC:03:EA:DB".into(),
                ip: "192.168.0.102".into(),
                icon: "💡".into(),
            },
            Machine {
                id: "nimo".into(),
                name: "nimo".into(),
                mac: "70:70:FC:06:B6:45".into(),
                ip: "192.168.0.103".into(),
                icon: "💻".into(),
            },
        ];
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
    let mut packet = vec![0xFFu8; 6]; // 6 bytes of 0xFF
    for _ in 0..16 {
        packet.extend_from_slice(mac); // 16 repetitions of MAC
    }
    packet
}

fn send_wol(mac_str: &str) -> Result<(), String> {
    let mac = parse_mac(mac_str)?;
    let packet = create_magic_packet(&mac);

    let socket = UdpSocket::bind("0.0.0.0:0")
        .map_err(|e| format!("Failed to bind socket: {}", e))?;
    socket
        .set_broadcast(true)
        .map_err(|e| format!("Failed to set broadcast: {}", e))?;
    socket
        .send_to(&packet, "255.255.255.255:9")
        .map_err(|e| format!("Failed to send packet: {}", e))?;

    // Also try subnet broadcast
    let _ = socket.send_to(&packet, "255.255.255.255:7");

    Ok(())
}

// === Ping ===

fn ping_host(ip: &str) -> bool {
    let output = Command::new("ping")
        .args(["-n", "1", "-w", "2000", ip])
        .output();

    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
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
        CommandResult { success: true, message: "已更新".into() }
    } else {
        CommandResult { success: false, message: "机器未找到".into() }
    }
}

#[tauri::command]
fn delete_machine(id: String) -> CommandResult {
    let mut machines = load_machines();
    let len_before = machines.len();
    machines.retain(|m| m.id != id);
    if machines.len() < len_before {
        save_machines(&machines);
        CommandResult { success: true, message: "已删除".into() }
    } else {
        CommandResult { success: false, message: "机器未找到".into() }
    }
}

#[tauri::command]
fn check_status() -> Vec<MachineStatus> {
    let machines = load_machines();
    // Use threads for parallel ping
    let handles: Vec<_> = machines
        .into_iter()
        .map(|m| {
            std::thread::spawn(move || MachineStatus {
                id: m.id,
                online: ping_host(&m.ip),
            })
        })
        .collect();

    handles.into_iter().filter_map(|h| h.join().ok()).collect()
}

#[tauri::command]
fn wake_machine(id: String) -> CommandResult {
    let machines = load_machines();
    if let Some(machine) = machines.iter().find(|m| m.id == id) {
        match send_wol(&machine.mac) {
            Ok(_) => CommandResult {
                success: true,
                message: format!("已发送唤醒包到 {} ({})", machine.name, machine.mac),
            },
            Err(e) => CommandResult {
                success: false,
                message: format!("唤醒失败: {}", e),
            },
        }
    } else {
        CommandResult { success: false, message: "机器未找到".into() }
    }
}

#[tauri::command]
fn shutdown_machine(id: String) -> CommandResult {
    let machines = load_machines();
    if let Some(machine) = machines.iter().find(|m| m.id == id) {
        // Try remote shutdown: shutdown /s /m \\ip /t 0
        let result = Command::new("shutdown")
            .args(["/s", "/m", &format!("\\\\{}", machine.ip), "/t", "5", "/c", "WakeMaster 远程关机"])
            .output();

        match result {
            Ok(output) => {
                if output.status.success() {
                    CommandResult {
                        success: true,
                        message: format!("{} 将在 5 秒后关机", machine.name),
                    }
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    CommandResult {
                        success: false,
                        message: format!("关机失败: {}（可能需要管理员权限或目标机器未开启远程关机服务）", stderr.trim()),
                    }
                }
            }
            Err(e) => CommandResult {
                success: false,
                message: format!("执行关机命令失败: {}", e),
            },
        }
    } else {
        CommandResult { success: false, message: "机器未找到".into() }
    }
}

#[tauri::command]
fn restart_machine(id: String) -> CommandResult {
    let machines = load_machines();
    if let Some(machine) = machines.iter().find(|m| m.id == id) {
        // Try remote restart: shutdown /r /m \\ip /t 0
        let result = Command::new("shutdown")
            .args(["/r", "/m", &format!("\\\\{}", machine.ip), "/t", "5", "/c", "WakeMaster 远程重启"])
            .output();

        match result {
            Ok(output) => {
                if output.status.success() {
                    CommandResult {
                        success: true,
                        message: format!("{} 将在 5 秒后重启", machine.name),
                    }
                } else {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    CommandResult {
                        success: false,
                        message: format!("重启失败: {}（可能需要管理员权限或目标机器未开启远程关机服务）", stderr.trim()),
                    }
                }
            }
            Err(e) => CommandResult {
                success: false,
                message: format!("执行重启命令失败: {}", e),
            },
        }
    } else {
        CommandResult { success: false, message: "机器未找到".into() }
    }
}

#[tauri::command]
fn scan_lan() -> Vec<LanDevice> {
    // Read ARP table: arp -a
    let output = Command::new("arp")
        .args(["-a"])
        .output();

    let mut devices = Vec::new();

    if let Ok(output) = output {
        let text = String::from_utf8_lossy(&output.stdout);
        for line in text.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Windows arp -a format: "  192.168.0.1          d4-6d-6d-xx-xx-xx     dynamic"
            if parts.len() >= 3 {
                let ip = parts[0];
                let mac = parts[1];
                let dtype = parts.get(2).unwrap_or(&"");

                // Validate IP format
                if ip.contains('.') && mac.contains('-') && *dtype != "static" {
                    // Skip broadcast and multicast
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
    }

    devices
}

// === Main ===

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
