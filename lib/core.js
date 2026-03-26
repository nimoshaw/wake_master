/**
 * WakeMaster Core — Shared logic for server, CLI, and MCP.
 *
 * Provides: machine CRUD, WOL magic packet, ping, MAC utilities.
 * All consumers import from here instead of duplicating.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const dgram = require('dgram');

// === Default data file path (overridable by consumer) ===

const DEFAULT_MACHINES_FILE = process.env.MACHINES_FILE
  || path.join(__dirname, '..', 'machines.json');

// === Machine CRUD ===

function loadMachines(filePath) {
  const p = filePath || DEFAULT_MACHINES_FILE;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return [];
  }
}

function saveMachines(machines, filePath) {
  const p = filePath || DEFAULT_MACHINES_FILE;
  fs.writeFileSync(p, JSON.stringify(machines, null, 2), 'utf8');
}

function findMachine(machines, query) {
  return machines.find(m =>
    m.id === query ||
    m.name.toLowerCase() === query.toLowerCase()
  );
}

function generateId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
}

// === MAC Utilities ===

/**
 * Normalize a MAC address to AA:BB:CC:DD:EE:FF format.
 * Accepts colon, dash, space, or dot as separators.
 */
function normalizeMac(input) {
  const raw = input.replace(/[:\-\s.]/g, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(raw)) return input;
  return raw.match(/.{2}/g).join(':');
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

// === WOL ===

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

// === Ping (safe — uses spawn, no shell injection) ===

function pingHost(ip) {
  return new Promise((resolve) => {
    // Validate IP format to prevent argument injection
    if (!/^[\d.]+$/.test(ip) && !/^[a-fA-F0-9:]+$/.test(ip)) {
      return resolve(false);
    }
    const args = process.platform === 'win32'
      ? ['-n', '1', '-w', '2000', ip]
      : ['-c', '1', '-W', '2', ip];
    const proc = spawn('ping', args, { stdio: 'ignore' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

module.exports = {
  loadMachines,
  saveMachines,
  findMachine,
  generateId,
  normalizeMac,
  parseMac,
  buildMagicPacket,
  sendWol,
  pingHost,
  DEFAULT_MACHINES_FILE,
};
