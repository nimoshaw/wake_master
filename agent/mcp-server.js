#!/usr/bin/env node

/**
 * WakeMaster MCP Server
 *
 * Model Context Protocol server that exposes Wake-on-LAN functionality
 * as tools for AI coding assistants (Cursor, Copilot, Claude, etc.)
 *
 * Tools provided:
 *   - wake_master_list:     List all managed machines
 *   - wake_master_status:   Check online/offline status
 *   - wake_master_wake:     Send WOL Magic Packet to wake a machine
 *   - wake_master_add:      Add a new machine
 *   - wake_master_remove:   Remove a machine
 *
 * Setup (add to your IDE's MCP config):
 *   {
 *     "mcpServers": {
 *       "wake-master": {
 *         "command": "node",
 *         "args": ["path/to/wake_master/agent/mcp-server.js"]
 *       }
 *     }
 *   }
 */

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const dgram = require('dgram');
const readline = require('readline');

const MACHINES_FILE = path.join(__dirname, '..', 'machines.json');

// === Shared Logic ===

function loadMachines() {
  try { return JSON.parse(fs.readFileSync(MACHINES_FILE, 'utf8')); }
  catch { return []; }
}

function saveMachines(machines) {
  fs.writeFileSync(MACHINES_FILE, JSON.stringify(machines, null, 2), 'utf8');
}

function parseMac(mac) {
  const parts = mac.split(/[:-]/);
  if (parts.length !== 6) throw new Error(`Invalid MAC: ${mac}`);
  return Buffer.from(parts.map(p => parseInt(p, 16)));
}

function sendWol(mac) {
  return new Promise((resolve, reject) => {
    const macBuf = parseMac(mac);
    const packet = Buffer.alloc(102);
    packet.fill(0xFF, 0, 6);
    for (let i = 0; i < 16; i++) macBuf.copy(packet, 6 + i * 6);
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.bind(() => {
      socket.setBroadcast(true);
      socket.send(packet, 0, 102, 9, '255.255.255.255', (err) => {
        socket.close();
        err ? reject(err) : resolve();
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

// === MCP Protocol (JSON-RPC over stdio) ===

const TOOLS = [
  {
    name: 'wake_master_list',
    description: 'List all machines managed by WakeMaster with their name, MAC, IP, and icon.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'wake_master_status',
    description: 'Check the online/offline status of all managed machines via ping.',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'wake_master_wake',
    description: 'Send a Wake-on-LAN Magic Packet to wake up a specific machine.',
    inputSchema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Machine ID or name to wake' }
      },
      required: ['machine']
    }
  },
  {
    name: 'wake_master_add',
    description: 'Add a new machine to WakeMaster.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Machine name' },
        mac: { type: 'string', description: 'MAC address (format: AA:BB:CC:DD:EE:FF)' },
        ip: { type: 'string', description: 'IP address' }
      },
      required: ['name', 'mac', 'ip']
    }
  },
  {
    name: 'wake_master_remove',
    description: 'Remove a machine from WakeMaster.',
    inputSchema: {
      type: 'object',
      properties: {
        machine: { type: 'string', description: 'Machine ID or name to remove' }
      },
      required: ['machine']
    }
  }
];

async function handleToolCall(name, args) {
  switch (name) {
    case 'wake_master_list': {
      const machines = loadMachines();
      if (machines.length === 0) return { content: [{ type: 'text', text: 'No machines configured.' }] };
      const text = machines.map(m => `${m.icon} ${m.name} — MAC: ${m.mac}, IP: ${m.ip}`).join('\n');
      return { content: [{ type: 'text', text: `${machines.length} machine(s):\n${text}` }] };
    }
    case 'wake_master_status': {
      const machines = loadMachines();
      if (machines.length === 0) return { content: [{ type: 'text', text: 'No machines configured.' }] };
      const results = await Promise.all(machines.map(async m => {
        const online = await pingHost(m.ip);
        return `${online ? '🟢' : '🔴'} ${m.name} (${m.ip}) — ${online ? 'online' : 'offline'}`;
      }));
      return { content: [{ type: 'text', text: results.join('\n') }] };
    }
    case 'wake_master_wake': {
      const machines = loadMachines();
      const machine = machines.find(m => m.id === args.machine || m.name.toLowerCase() === args.machine.toLowerCase());
      if (!machine) return { content: [{ type: 'text', text: `Machine not found: ${args.machine}. Available: ${machines.map(m => m.name).join(', ')}` }], isError: true };
      try {
        await sendWol(machine.mac);
        return { content: [{ type: 'text', text: `⚡ WOL packet sent to ${machine.name} (${machine.mac})` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Failed: ${err.message}` }], isError: true };
      }
    }
    case 'wake_master_add': {
      const machines = loadMachines();
      const id = args.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
      machines.push({ id, name: args.name, mac: args.mac, ip: args.ip, icon: '🖥️' });
      saveMachines(machines);
      return { content: [{ type: 'text', text: `✅ Added ${args.name} (${args.mac}, ${args.ip})` }] };
    }
    case 'wake_master_remove': {
      const machines = loadMachines();
      const machine = machines.find(m => m.id === args.machine || m.name.toLowerCase() === args.machine.toLowerCase());
      if (!machine) return { content: [{ type: 'text', text: `Machine not found: ${args.machine}` }], isError: true };
      saveMachines(machines.filter(m => m.id !== machine.id));
      return { content: [{ type: 'text', text: `🗑️ Removed ${machine.name}` }] };
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

function handleRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'wake-master', version: '1.0.0' }
        }
      };
    case 'notifications/initialized':
      return null; // No response needed
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    case 'tools/call':
      return handleToolCall(params.name, params.arguments || {}).then(result => ({
        jsonrpc: '2.0', id, result
      }));
    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };
    default:
      return {
        jsonrpc: '2.0', id,
        error: { code: -32601, message: `Method not found: ${method}` }
      };
  }
}

// === Stdio Transport ===

const rl = readline.createInterface({ input: process.stdin });
let buffer = '';

rl.on('line', async (line) => {
  try {
    const request = JSON.parse(line);
    const response = await handleRequest(request);
    if (response) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (err) {
    // Ignore parse errors
  }
});

process.stderr.write('WakeMaster MCP Server started\n');
