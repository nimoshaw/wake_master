#!/usr/bin/env node

/**
 * WakeMaster CLI — Command-line interface for Wake-on-LAN management.
 * Usable standalone or by AI agents / IDE extensions.
 *
 * Usage:
 *   wake-master list                    List all machines
 *   wake-master status                  Check online/offline status of all machines
 *   wake-master wake <id|name>          Send WOL packet to a machine
 *   wake-master add <name> <mac> <ip>   Add a new machine
 *   wake-master remove <id|name>        Remove a machine
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const dgram = require('dgram');

const MACHINES_FILE = path.join(__dirname, '..', 'machines.json');

// === Helpers ===

function loadMachines() {
  try {
    return JSON.parse(fs.readFileSync(MACHINES_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveMachines(machines) {
  fs.writeFileSync(MACHINES_FILE, JSON.stringify(machines, null, 2), 'utf8');
}

function parseMac(mac) {
  const parts = mac.split(/[:-]/);
  if (parts.length !== 6) throw new Error(`Invalid MAC: ${mac}`);
  return Buffer.from(parts.map(p => parseInt(p, 16)));
}

function buildMagicPacket(mac) {
  const macBuf = parseMac(mac);
  const packet = Buffer.alloc(6 + 16 * 6);
  packet.fill(0xFF, 0, 6);
  for (let i = 0; i < 16; i++) {
    macBuf.copy(packet, 6 + i * 6);
  }
  return packet;
}

function sendWol(mac) {
  return new Promise((resolve, reject) => {
    const packet = buildMagicPacket(mac);
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 0, packet.length, 9, '255.255.255.255', (err) => {
        socket.close();
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

function pingHost(ip) {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32'
      ? `ping -n 1 -w 2000 ${ip}`
      : `ping -c 1 -W 2 ${ip}`;
    exec(cmd, (error) => resolve(!error));
  });
}

function findMachine(machines, query) {
  return machines.find(m =>
    m.id === query ||
    m.name.toLowerCase() === query.toLowerCase()
  );
}

// === Commands ===

async function cmdList() {
  const machines = loadMachines();
  if (machines.length === 0) {
    console.log('No machines configured. Use "wake-master add" to add one.');
    return;
  }
  console.log(`\n  ⚡ WakeMaster — ${machines.length} machine(s)\n`);
  machines.forEach(m => {
    console.log(`  ${m.icon || '🖥️'}  ${m.name.padEnd(20)} ${m.mac}  (${m.ip})`);
  });
  console.log();
}

async function cmdStatus() {
  const machines = loadMachines();
  if (machines.length === 0) {
    console.log('No machines configured.');
    return;
  }
  console.log(`\n  🔍 Checking status of ${machines.length} machine(s)...\n`);
  const results = await Promise.all(
    machines.map(async (m) => ({
      ...m,
      online: await pingHost(m.ip),
    }))
  );
  results.forEach(m => {
    const status = m.online ? '🟢 online ' : '🔴 offline';
    console.log(`  ${m.icon || '🖥️'}  ${m.name.padEnd(20)} ${status}  ${m.ip}`);
  });
  const online = results.filter(r => r.online).length;
  console.log(`\n  📊 ${online}/${machines.length} online\n`);

  // Machine-readable JSON output for agents
  if (process.env.WAKE_MASTER_JSON) {
    console.log(JSON.stringify(results.map(r => ({
      id: r.id, name: r.name, ip: r.ip, mac: r.mac, online: r.online
    }))));
  }
}

async function cmdWake(query) {
  const machines = loadMachines();
  const machine = findMachine(machines, query);
  if (!machine) {
    console.error(`Machine not found: ${query}`);
    console.error('Available:', machines.map(m => m.name).join(', '));
    process.exit(1);
  }
  try {
    await sendWol(machine.mac);
    console.log(`⚡ WOL packet sent to ${machine.name} (${machine.mac})`);
  } catch (err) {
    console.error(`Failed to wake ${machine.name}:`, err.message);
    process.exit(1);
  }
}

function cmdAdd(name, mac, ip) {
  const machines = loadMachines();
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
  const newMachine = { id, name, mac, ip, icon: '🖥️' };
  machines.push(newMachine);
  saveMachines(machines);
  console.log(`✅ Added ${name} (${mac}, ${ip})`);
}

function cmdRemove(query) {
  const machines = loadMachines();
  const machine = findMachine(machines, query);
  if (!machine) {
    console.error(`Machine not found: ${query}`);
    process.exit(1);
  }
  const filtered = machines.filter(m => m.id !== machine.id);
  saveMachines(filtered);
  console.log(`🗑️  Removed ${machine.name}`);
}

// === Main ===

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'list':
    case 'ls':
      return cmdList();
    case 'status':
    case 'st':
      return cmdStatus();
    case 'wake':
    case 'w':
      if (!args[1]) { console.error('Usage: wake-master wake <id|name>'); process.exit(1); }
      return cmdWake(args[1]);
    case 'add':
      if (args.length < 4) { console.error('Usage: wake-master add <name> <mac> <ip>'); process.exit(1); }
      return cmdAdd(args[1], args[2], args[3]);
    case 'remove':
    case 'rm':
      if (!args[1]) { console.error('Usage: wake-master remove <id|name>'); process.exit(1); }
      return cmdRemove(args[1]);
    default:
      console.log(`
  ⚡ WakeMaster CLI

  Usage:
    wake-master list                    List all machines
    wake-master status                  Check online/offline status
    wake-master wake <id|name>          Send WOL packet
    wake-master add <name> <mac> <ip>   Add a machine
    wake-master remove <id|name>        Remove a machine

  Environment:
    WAKE_MASTER_JSON=1                  Output JSON for agent consumption
`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
