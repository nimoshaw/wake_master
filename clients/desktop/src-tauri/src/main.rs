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
    let _ = socket.send_to(&packet, "255.255.255.255:7");

    Ok(())
}

// === Ping (Cross-Platform) ===

fn ping_host(ip: &str) -> bool {
    let output = if cfg!(target_os = "windows") {
        Command::new("ping")
            .args(["-n", "1", "-w", "2000", ip])
            .output()
    } else {
        // macOS / Linux
        Command::new("ping")
            .args(["-c", "1", "-W", "2", ip])
            .output()
    };

    match output {
        Ok(o) => o.status.success(),
        Err(_) => false,
    }
}

// === Remote Power Control (Cross-Platform) ===

fn remote_shutdown(ip: &str, name: &str) -> CommandResult {
    if cfg!(target_os = "windows") {
        // Windows: shutdown /s /m \\ip /t 5
        let result = Command::new("shutdown")
            .args(["/s", "/m", &format!("\\\\{}", ip), "/t", "5", "/c", "WakeMaster remote shutdown"])
            .output();
        match result {
            Ok(output) if output.status.success() => CommandResult {
                success: true,
                message: format!("{} will shut down in 5 seconds", name),
            },
            Ok(output) => CommandResult {
                success: false,
                message: format!("Shutdown failed: {} (target may need remote shutdown enabled)", String::from_utf8_lossy(&output.stderr).trim()),
            },
            Err(e) => CommandResult {
                success: false,
                message: format!("Failed to execute shutdown: {}", e),
            },
        }
    } else {
        // macOS / Linux: requires SSH access
        let result = Command::new("ssh")
            .args(["-o", "ConnectTimeout=5", "-o", "StrictHostKeyChecking=no", &format!("root@{}", ip), "shutdown", "-h", "now"])
            .output();
        match result {
            Ok(output) if output.status.success() => CommandResult {
                success: true,
                message: format!("{} shutdown command sent via SSH", name),
            },
            Ok(output) => CommandResult {
                success: false,
                message: format!("SSH shutdown failed: {} (ensure SSH access is configured)", String::from_utf8_lossy(&output.stderr).trim()),
            },
            Err(e) => CommandResult {
                success: false,
                message: format!("Failed to execute SSH shutdown: {}", e),
            },
        }
    }
}

fn remote_restart(ip: &str, name: &str) -> CommandResult {
    if cfg!(target_os = "windows") {
        let result = Command::new("shutdown")
            .args(["/r", "/m", &format!("\\\\{}", ip), "/t", "5", "/c", "WakeMaster remote restart"])
            .output();
        match result {
            Ok(output) if output.status.success() => CommandResult {
                success: true,
                message: format!("{} will restart in 5 seconds", name),
            },
            Ok(output) => CommandResult {
                success: false,
                message: format!("Restart failed: {} (target may need remote shutdown enabled)", String::from_utf8_lossy(&output.stderr).trim()),
            },
            Err(e) => CommandResult {
                success: false,
                message: format!("Failed to execute restart: {}", e),
            },
        }
    } else {
        let result = Command::new("ssh")
            .args(["-o", "ConnectTimeout=5", "-o", "StrictHostKeyChecking=no", &format!("root@{}", ip), "shutdown", "-r", "now"])
            .output();
        match result {
            Ok(output) if output.status.success() => CommandResult {
                success: true,
                message: format!("{} restart command sent via SSH", name),
            },
            Ok(output) => CommandResult {
                success: false,
                message: format!("SSH restart failed: {} (ensure SSH access is configured)", String::from_utf8_lossy(&output.stderr).trim()),
            },
            Err(e) => CommandResult {
                success: false,
                message: format!("Failed to execute SSH restart: {}", e),
            },
        }
    }
}

// === LAN Scan (Cross-Platform) ===

fn scan_arp_table() -> Vec<LanDevice> {
    let output = if cfg!(target_os = "windows") {
        Command::new("arp").args(["-a"]).output()
    } else {
        Command::new("arp").args(["-a"]).output()
    };

    let mut devices = Vec::new();

    if let Ok(output) = output {
        let text = String::from_utf8_lossy(&output.stdout);

        if cfg!(target_os = "windows") {
            // Windows: "  192.168.0.1          d4-6d-6d-xx-xx-xx     dynamic"
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
            // macOS: "? (192.168.0.1) at d4:6d:6d:xx:xx:xx on en0 ifscope [ethernet]"
            // Linux: "? (192.168.0.1) at d4:6d:6d:xx:xx:xx [ether] on eth0"
            for line in text.lines() {
                let line = line.trim();
                // Extract IP from parentheses
                if let (Some(ip_start), Some(ip_end)) = (line.find('('), line.find(')')) {
                    let ip = &line[ip_start + 1..ip_end];
                    // Extract MAC after " at "
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

#[tauri::command]
fn check_status() -> Vec<MachineStatus> {
    let machines = load_machines();
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
    if let Some(machine) = machines.iter().find(|m| m.id == id) {
        remote_shutdown(&machine.ip, &machine.name)
    } else {
        CommandResult { success: false, message: "Machine not found".into() }
    }
}

#[tauri::command]
fn restart_machine(id: String) -> CommandResult {
    let machines = load_machines();
    if let Some(machine) = machines.iter().find(|m| m.id == id) {
        remote_restart(&machine.ip, &machine.name)
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
            get_platform,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
