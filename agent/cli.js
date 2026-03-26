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

const { loadMachines, saveMachines, sendWol, pingHost, findMachine, generateId } = require('../lib/core');

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
  const id = generateId(name);
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
