const express = require('express');
const wol = require('wake_on_lan');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = (() => {
  const portArg = process.argv.find((a, i) => process.argv[i - 1] === '--port');
  return parseInt(portArg || process.env.PORT || '3000', 10);
})();
const MACHINES_FILE = process.env.MACHINES_FILE || path.join(__dirname, 'machines.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Helpers ---

function loadMachines() {
  try {
    const data = fs.readFileSync(MACHINES_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function saveMachines(machines) {
  fs.writeFileSync(MACHINES_FILE, JSON.stringify(machines, null, 2), 'utf8');
}

function pingHost(ip) {
  return new Promise((resolve) => {
    // Windows: ping -n 1 -w 2000 (1 packet, 2s timeout)
    const cmd = process.platform === 'win32'
      ? `ping -n 1 -w 2000 ${ip}`
      : `ping -c 1 -W 2 ${ip}`;

    exec(cmd, (error) => {
      resolve(!error);
    });
  });
}

function sendWol(mac) {
  return new Promise((resolve, reject) => {
    wol.wake(mac, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

// --- API Routes ---

// Get all machines with status
app.get('/api/machines', (req, res) => {
  const machines = loadMachines();
  res.json(machines);
});

// Batch ping all machines for status
app.get('/api/machines/status', async (req, res) => {
  const machines = loadMachines();
  const results = await Promise.all(
    machines.map(async (m) => {
      const online = await pingHost(m.ip);
      return { id: m.id, online };
    })
  );
  res.json(results);
});

// Wake a machine
app.post('/api/machines/:id/wake', async (req, res) => {
  const machines = loadMachines();
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
  const machines = loadMachines();
  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
  const newMachine = { id, name, mac, ip, icon: icon || '🖥️' };
  machines.push(newMachine);
  saveMachines(machines);
  res.json(newMachine);
});

// Update a machine
app.put('/api/machines/:id', (req, res) => {
  const machines = loadMachines();
  const idx = machines.findIndex(m => m.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: '机器未找到' });
  }
  const { name, mac, ip, icon } = req.body;
  if (name) machines[idx].name = name;
  if (mac) machines[idx].mac = mac;
  if (ip) machines[idx].ip = ip;
  if (icon !== undefined) machines[idx].icon = icon;
  saveMachines(machines);
  res.json(machines[idx]);
});

// Delete a machine
app.delete('/api/machines/:id', (req, res) => {
  let machines = loadMachines();
  const idx = machines.findIndex(m => m.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: '机器未找到' });
  }
  const removed = machines.splice(idx, 1)[0];
  saveMachines(machines);
  res.json({ success: true, removed });
});

// Export machines as JSON download
app.get('/api/machines/export', (req, res) => {
  const machines = loadMachines();
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

  const machines = loadMachines();
  const existingMacs = new Set(machines.map(m => m.mac.toUpperCase().replace(/[:-]/g, '')));
  let added = 0;

  for (const item of incoming) {
    if (!item.name || !item.mac || !item.ip) continue;
    const normalizedMac = item.mac.toUpperCase().replace(/[:-]/g, '');
    if (existingMacs.has(normalizedMac)) continue;

    const id = item.name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now() + '_' + added;
    machines.push({ id, name: item.name, mac: item.mac, ip: item.ip, icon: item.icon || '🖥️' });
    existingMacs.add(normalizedMac);
    added++;
  }

  saveMachines(machines);
  res.json({ success: true, added, total: machines.length });
});

// --- Start Server ---

app.listen(PORT, () => {
  console.log(`\n  🌐 WakeMaster 已启动`);
  console.log(`  📍 访问地址: http://localhost:${PORT}`);
  console.log(`  📋 已加载 ${loadMachines().length} 台机器\n`);
});
