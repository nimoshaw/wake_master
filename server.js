const express = require('express');
const path = require('path');
const { loadMachines: loadFromDisk, saveMachines: saveToDisk, pingHost, sendWol, generateId } = require('./lib/core');

const app = express();
const PORT = (() => {
  const portArg = process.argv.find((a, i) => process.argv[i - 1] === '--port');
  return parseInt(portArg || process.env.PORT || '3000', 10);
})();
const MACHINES_FILE = process.env.MACHINES_FILE || path.join(__dirname, 'machines.json');
const API_TOKEN = process.env.API_TOKEN || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Optional Bearer Token auth (set API_TOKEN env var to enable) ---

if (API_TOKEN) {
  app.use('/api', (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || auth !== `Bearer ${API_TOKEN}`) {
      return res.status(401).json({ error: '未授权: 需要有效的 Bearer Token' });
    }
    next();
  });
  console.log('  🔒 API 认证已启用 (Bearer Token)');
}

// --- In-memory cache with debounced write-back ---

let _machines = null;
let _writeTimer = null;

function getMachines() {
  if (!_machines) _machines = loadFromDisk(MACHINES_FILE);
  return _machines;
}

function setMachines(machines) {
  _machines = machines;
  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => saveToDisk(machines, MACHINES_FILE), 500);
}

// --- API Routes ---

// Get all machines
app.get('/api/machines', (req, res) => {
  res.json(getMachines());
});

// Batch ping all machines for status
app.get('/api/machines/status', async (req, res) => {
  const machines = getMachines();
  const results = await Promise.all(
    machines.map(async (m) => ({
      id: m.id,
      online: await pingHost(m.ip),
    }))
  );
  res.json(results);
});

// Wake a machine
app.post('/api/machines/:id/wake', async (req, res) => {
  const machines = getMachines();
  const machine = machines.find(m => m.id === req.params.id);
  if (!machine) {
    return res.status(404).json({ error: '机器未找到' });
  }
  try {
    await sendWol(machine.mac);
    res.json({ success: true, message: `已发送唤醒包到 ${machine.name} (${machine.mac})` });
  } catch (err) {
    res.status(500).json({ error: `唤醒失败: ${err.message}` });
  }
});

// Add a new machine
app.post('/api/machines', (req, res) => {
  const { name, mac, ip, icon } = req.body;
  if (!name || !mac || !ip) {
    return res.status(400).json({ error: '名称、MAC 和 IP 都是必填项' });
  }
  const machines = getMachines();
  const id = generateId(name);
  const newMachine = { id, name, mac, ip, icon: icon || '🖥️' };
  machines.push(newMachine);
  setMachines(machines);
  res.json(newMachine);
});

// Update a machine
app.put('/api/machines/:id', (req, res) => {
  const machines = getMachines();
  const idx = machines.findIndex(m => m.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: '机器未找到' });
  }
  const { name, mac, ip, icon } = req.body;
  if (name) machines[idx].name = name;
  if (mac) machines[idx].mac = mac;
  if (ip) machines[idx].ip = ip;
  if (icon !== undefined) machines[idx].icon = icon;
  setMachines(machines);
  res.json(machines[idx]);
});

// Delete a machine
app.delete('/api/machines/:id', (req, res) => {
  const machines = getMachines();
  const idx = machines.findIndex(m => m.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: '机器未找到' });
  }
  const removed = machines.splice(idx, 1)[0];
  setMachines(machines);
  res.json({ success: true, removed });
});

// Export machines as JSON download
app.get('/api/machines/export', (req, res) => {
  const machines = getMachines();
  res.setHeader('Content-Disposition', 'attachment; filename="wakemaster-machines.json"');
  res.setHeader('Content-Type', 'application/json');
  res.json(machines);
});

// Import machines from JSON (merge by MAC, skip duplicates)
app.post('/api/machines/import', (req, res) => {
  const incoming = req.body;
  if (!Array.isArray(incoming)) {
    return res.status(400).json({ error: '导入数据必须是 JSON 数组' });
  }

  const machines = getMachines();
  const existingMacs = new Set(machines.map(m => m.mac.toUpperCase().replace(/[:-]/g, '')));
  let added = 0;

  for (const item of incoming) {
    if (!item.name || !item.mac || !item.ip) continue;
    const normalizedMac = item.mac.toUpperCase().replace(/[:-]/g, '');
    if (existingMacs.has(normalizedMac)) continue;

    const id = generateId(item.name) + '_' + added;
    machines.push({ id, name: item.name, mac: item.mac, ip: item.ip, icon: item.icon || '🖥️' });
    existingMacs.add(normalizedMac);
    added++;
  }

  setMachines(machines);
  res.json({ success: true, added, total: machines.length });
});

// --- Start Server ---

app.listen(PORT, () => {
  console.log(`\n  🌐 WakeMaster 已启动`);
  console.log(`  📍 访问地址: http://localhost:${PORT}`);
  console.log(`  📋 已加载 ${getMachines().length} 台机器\n`);
});
