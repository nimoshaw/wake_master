// === Tauri API ===
const { invoke } = window.__TAURI__.core;

// === Config ===
const APP_VERSION = '0.5.7';
const GITHUB_REPO = 'nimoshaw/wake_master';

// === State ===
let machines = [];
let statusMap = {};
let agentMap = {};
let refreshTimer = null;

// === DOM Elements ===
const machinesGrid = document.getElementById('machinesGrid');
const refreshBtn = document.getElementById('refreshBtn');
const addMachineBtn = document.getElementById('addMachineBtn');
const addDropdownToggle = document.getElementById('addDropdownToggle');
const addDropdownMenu = document.getElementById('addDropdownMenu');
const addBtnGroup = document.getElementById('addBtnGroup');
const exportBtn = document.getElementById('exportBtn');
const importBtn = document.getElementById('importBtn');
const importFileInput = document.getElementById('importFileInput');
const scanBtn = document.getElementById('scanBtn');
const settingsBtn = document.getElementById('settingsBtn');
const refreshInterval = document.getElementById('refreshInterval');
const statusText = document.getElementById('statusText');
const lastUpdate = document.getElementById('lastUpdate');
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalClose = document.getElementById('modalClose');
const machineForm = document.getElementById('machineForm');
const cancelBtn = document.getElementById('cancelBtn');
const submitBtn = document.getElementById('submitBtn');
const scanModalOverlay = document.getElementById('scanModalOverlay');
const scanModalClose = document.getElementById('scanModalClose');
const scanCloseBtn = document.getElementById('scanCloseBtn');
const startScanBtn = document.getElementById('startScanBtn');
const scanStatus = document.getElementById('scanStatus');
const scanResults = document.getElementById('scanResults');
const toastContainer = document.getElementById('toastContainer');

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  loadMachines();  // loads and refreshes once
  setupEventListeners();
  // No auto-refresh by default (value=0)
  checkForUpdate();
});

// === Data Operations ===
async function loadMachines() {
  try {
    machines = await invoke('get_machines');
    renderMachines();
    refreshStatus();
  } catch (err) {
    showToast('加载机器列表失败: ' + err, 'error');
  }
}

async function refreshStatus() {
  machines.forEach(m => { statusMap[m.id] = null; });
  renderMachines();
  statusText.textContent = '正在检测状态...';

  try {
    const results = await invoke('check_status');
    results.forEach(r => {
      statusMap[r.id] = r.online;
      agentMap[r.id] = r.has_agent;
    });
    const onlineCount = results.filter(r => r.online).length;
    statusText.textContent = `共 ${machines.length} 台设备 · ${onlineCount} 台在线`;
    lastUpdate.textContent = `上次更新: ${new Date().toLocaleTimeString('zh-CN')}`;
  } catch (err) {
    statusText.textContent = '状态检测失败';
  }
  renderMachines();
}

async function wakeMachine(id) {
  const machine = machines.find(m => m.id === id);
  if (!machine) return;

  try {
    const result = await invoke('wake_machine', { id });
    if (result.success) {
      showToast(`⚡ ${result.message}`, 'success');
      setTimeout(() => refreshStatus(), 5000);
    } else {
      showToast(result.message, 'error');
    }
  } catch (err) {
    showToast(`唤醒失败: ${err}`, 'error');
  }
}

async function shutdownMachine(id) {
  const machine = machines.find(m => m.id === id);
  if (!machine) return;

  const confirmed = await showConfirm(`确定要关闭 "${machine.name}" 吗？\n机器将在 5 秒后关机。`, '关机');
  if (!confirmed) return;

  try {
    const result = await invoke('shutdown_machine', { id });
    if (result.success) {
      showToast(`🔌 ${result.message}`, 'warning');
      setTimeout(() => refreshStatus(), 10000);
    } else {
      showToast(result.message, 'error');
    }
  } catch (err) {
    showToast(`关机失败: ${err}`, 'error');
  }
}

async function restartMachine(id) {
  const machine = machines.find(m => m.id === id);
  if (!machine) return;

  const confirmed = await showConfirm(`确定要重启 "${machine.name}" 吗？\n机器将在 5 秒后重启。`, '重启');
  if (!confirmed) return;

  try {
    const result = await invoke('restart_machine', { id });
    if (result.success) {
      showToast(`🔄 ${result.message}`, 'warning');
      setTimeout(() => refreshStatus(), 15000);
    } else {
      showToast(result.message, 'error');
    }
  } catch (err) {
    showToast(`重启失败: ${err}`, 'error');
  }
}

async function addMachineToList(data) {
  try {
    const newMachine = await invoke('add_machine', data);
    machines.push(newMachine);
    statusMap[newMachine.id] = null;
    renderMachines();
    showToast(`✅ ${data.name} 已添加`, 'success');
    refreshStatus();
  } catch (err) {
    showToast('添加失败: ' + err, 'error');
  }
}

async function updateMachineInList(id, data) {
  try {
    const result = await invoke('update_machine', { id, ...data });
    if (result.success) {
      machines = await invoke('get_machines');
      renderMachines();
      showToast(`✅ ${data.name} 已更新`, 'success');
    } else {
      showToast(result.message, 'error');
    }
  } catch (err) {
    showToast('更新失败: ' + err, 'error');
  }
}

async function deleteMachine(id) {
  const machine = machines.find(m => m.id === id);
  if (!machine) return;

  const confirmed = await showConfirm(`确定要删除 "${machine.name}" 吗？`, '删除');
  if (!confirmed) return;

  try {
    const result = await invoke('delete_machine', { id });
    if (result.success) {
      machines = machines.filter(m => m.id !== id);
      delete statusMap[id];
      renderMachines();
      showToast(`🗑️ ${machine.name} 已删除`, 'info');
    } else {
      showToast(result.message, 'error');
    }
  } catch (err) {
    showToast('删除失败: ' + err, 'error');
  }
}

async function scanLan() {
  scanStatus.textContent = '🔍 正在扫描局域网...';
  scanResults.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">扫描中，请稍候...</div>';
  startScanBtn.disabled = true;

  try {
    const devices = await invoke('scan_lan');
    if (devices.length === 0) {
      scanStatus.textContent = '未发现设备（尝试先 ping 几台机器以刷新 ARP 表）';
      scanResults.innerHTML = '';
    } else {
      scanStatus.textContent = `发现 ${devices.length} 台设备`;
      renderScanResults(devices);
    }
  } catch (err) {
    scanStatus.textContent = '扫描失败: ' + err;
    scanResults.innerHTML = '';
  }

  startScanBtn.disabled = false;
}

// === Export / Import ===
function exportMachines() {
  try {
    const data = JSON.stringify(machines, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wakemaster-machines.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('📤 配置已导出', 'success');
  } catch (err) {
    showToast('导出失败: ' + err, 'error');
  }
}

async function importMachines(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      showToast('导入文件格式错误：需要 JSON 数组', 'error');
      return;
    }

    const existingMacs = new Set(machines.map(m => m.mac.toUpperCase().replace(/[:-]/g, '')));
    let added = 0;

    for (const item of data) {
      if (!item.name || !item.mac || !item.ip) continue;
      const normalizedMac = item.mac.toUpperCase().replace(/[:-]/g, '');
      if (existingMacs.has(normalizedMac)) continue;

      try {
        await invoke('add_machine', {
          name: item.name,
          mac: item.mac,
          ip: item.ip,
          icon: item.icon || '🖥️'
        });
        existingMacs.add(normalizedMac);
        added++;
      } catch (e) {
        // skip failed items
      }
    }

    showToast(`📥 导入完成：新增 ${added} 台`, 'success');
    machines = await invoke('get_machines');
    renderMachines();
    refreshStatus();
  } catch (err) {
    showToast('导入失败：文件解析错误', 'error');
  }
}

// === Dropdown ===
function toggleDropdown() {
  addDropdownMenu.classList.toggle('show');
}

function closeDropdown() {
  addDropdownMenu.classList.remove('show');
}

// === Software Update ===
async function checkForUpdate() {
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`);
    if (!res.ok) return;
    const release = await res.json();
    const latestTag = release.tag_name.replace(/^v/, '');

    if (latestTag !== APP_VERSION && compareVersions(latestTag, APP_VERSION) > 0) {
      const versionTag = document.getElementById('versionTag');
      if (versionTag) {
        versionTag.textContent = `v${APP_VERSION} → v${latestTag} 可更新`;
        versionTag.classList.add('update-available');
        versionTag.style.cursor = 'pointer';
        versionTag.onclick = () => {
          invoke('plugin:shell|open', { value: release.html_url });
        };
      }
      showToast(`🆕 新版本 v${latestTag} 可用！点击版本号下载`, 'info');
    }
  } catch (err) {
    // Silent fail
  }
}

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

// === Rendering ===
function renderMachines() {
  if (machines.length === 0) {
    machinesGrid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🖧</div>
        <p class="empty-state-title">暂无机器</p>
        <p class="empty-state-desc">点击右上角「添加」按钮或「扫描」发现局域网设备</p>
      </div>`;
    return;
  }

  machinesGrid.innerHTML = machines.map(m => {
    const status = statusMap[m.id];
    const statusClass = status === null ? 'checking' : (status ? 'online' : 'offline');
    const statusLabel = status === null ? '检测中...' : (status ? '在线' : '离线');
    const isOnline = status === true;
    const isOffline = status === false;
    const cardClass = isOnline ? 'online' : '';

    return `
      <div class="machine-card ${cardClass}" data-machine-id="${m.id}" draggable="true">
        <div class="card-header">
          <div class="card-identity">
            <div class="card-icon">${m.icon || '🖥️'}</div>
            <div class="card-info">
              <h3>${esc(m.name)}</h3>
              <div class="card-mac">${esc(m.mac)}</div>
            </div>
          </div>
          <div class="card-actions">
            <button class="card-action-btn" title="编辑" onclick="openEditModal('${m.id}')">✏️</button>
            <button class="card-action-btn delete" title="删除" onclick="deleteMachine('${m.id}')">🗑️</button>
          </div>
        </div>
        <div class="status-indicator ${statusClass}">
          <div class="status-dot"></div>
          <span class="status-label">${statusLabel}</span>
        </div>
        <div class="card-ip">IP: ${esc(m.ip)}</div>
        <div class="card-btn-row ${!agentMap[m.id] ? 'wake-only' : ''}">
          <button class="action-btn wake-btn" onclick="wakeMachine('${m.id}')">
            <span>⚡</span><span>唤醒</span>
          </button>
          ${agentMap[m.id] ? `
          <button class="action-btn restart-btn ${isOffline ? 'disabled' : ''}" onclick="restartMachine('${m.id}')" ${isOffline ? 'disabled' : ''}>
            <span>🔄</span><span>重启</span>
          </button>
          <button class="action-btn shutdown-btn ${isOffline ? 'disabled' : ''}" onclick="shutdownMachine('${m.id}')" ${isOffline ? 'disabled' : ''}>
            <span>🔌</span><span>关机</span>
          </button>
          ` : ''}
        </div>
      </div>`;
  }).join('');
  setupDragAndDrop();
}

// === Drag and Drop ===
let dragSrcId = null;

function setupDragAndDrop() {
  const cards = document.querySelectorAll('.machine-card');
  cards.forEach(card => {
    card.addEventListener('dragstart', (e) => {
      dragSrcId = card.dataset.machineId;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      document.querySelectorAll('.machine-card').forEach(c => c.classList.remove('drag-over'));
      dragSrcId = null;
    });

    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (card.dataset.machineId !== dragSrcId) {
        card.classList.add('drag-over');
      }
    });

    card.addEventListener('dragleave', () => {
      card.classList.remove('drag-over');
    });

    card.addEventListener('drop', (e) => {
      e.preventDefault();
      card.classList.remove('drag-over');
      const targetId = card.dataset.machineId;
      if (dragSrcId && dragSrcId !== targetId) {
        const srcIdx = machines.findIndex(m => m.id === dragSrcId);
        const tgtIdx = machines.findIndex(m => m.id === targetId);
        if (srcIdx !== -1 && tgtIdx !== -1) {
          const [moved] = machines.splice(srcIdx, 1);
          machines.splice(tgtIdx, 0, moved);
          renderMachines();
          // Persist new order
          const ids = machines.map(m => m.id);
          invoke('reorder_machines', { ids }).catch(() => {});
        }
      }
    });
  });
}

function renderScanResults(devices) {
  const existingMacs = new Set(machines.map(m => m.mac.toUpperCase().replace(/[:-]/g, '')));

  scanResults.innerHTML = devices.map(d => {
    const normalizedMac = d.mac.toUpperCase().replace(/[:-]/g, '');
    const alreadyAdded = existingMacs.has(normalizedMac);

    return `
      <div class="scan-device ${alreadyAdded ? 'already-added' : ''}">
        <div class="scan-device-info">
          <span class="scan-device-ip">${esc(d.ip)}</span>
          <span class="scan-device-mac">${esc(d.mac)}</span>
        </div>
        ${alreadyAdded
          ? '<span style="font-size:12px; color:var(--text-muted);">已添加</span>'
          : `<button class="btn btn-primary btn-sm" onclick="addFromScan('${esc(d.ip)}', '${esc(d.mac)}')">
              <span class="btn-icon">➕</span> 添加
            </button>`
        }
      </div>`;
  }).join('');
}

// === Add from scan ===
function addFromScan(ip, mac) {
  closeModal('scanModalOverlay');
  document.getElementById('editId').value = '';
  document.getElementById('machineName').value = '';
  document.getElementById('machineMac').value = mac;
  document.getElementById('machineIp').value = ip;
  document.getElementById('machineIcon').value = '🖥️';
  selectIcon('🖥️');
  modalTitle.textContent = '添加扫描到的设备';
  submitBtn.textContent = '添加';
  modalOverlay.classList.add('active');
  document.getElementById('machineName').focus();
}

// === Modal ===
function openAddModal() {
  modalTitle.textContent = '添加机器';
  submitBtn.textContent = '添加';
  document.getElementById('editId').value = '';
  document.getElementById('machineName').value = '';
  document.getElementById('machineMac').value = '';
  document.getElementById('machineIp').value = '';
  document.getElementById('machineIcon').value = '🖥️';
  selectIcon('🖥️');
  modalOverlay.classList.add('active');
}

function openEditModal(id) {
  const machine = machines.find(m => m.id === id);
  if (!machine) return;
  modalTitle.textContent = '编辑机器';
  submitBtn.textContent = '保存';
  document.getElementById('editId').value = id;
  document.getElementById('machineName').value = machine.name;
  document.getElementById('machineMac').value = machine.mac;
  document.getElementById('machineIp').value = machine.ip;
  document.getElementById('machineIcon').value = machine.icon || '🖥️';
  selectIcon(machine.icon || '🖥️');
  modalOverlay.classList.add('active');
}

function openScanModal() {
  scanStatus.textContent = '点击「开始扫描」发现局域网设备';
  scanResults.innerHTML = '';
  scanModalOverlay.classList.add('active');
}

function closeModal(overlayId) {
  document.getElementById(overlayId || 'modalOverlay').classList.remove('active');
}

function selectIcon(icon) {
  document.querySelectorAll('.icon-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.icon === icon);
  });
  document.getElementById('machineIcon').value = icon;
}

// === Toast ===
function showToast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || ''}</span> ${esc(message)}`;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// === Confirm ===
function showConfirm(message, actionLabel = '确认') {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    const btnClass = actionLabel === '删除' ? 'btn-danger' : (actionLabel === '关机' ? 'btn-danger' : 'btn-warning');
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <p>${esc(message)}</p>
        <div class="form-actions">
          <button class="btn btn-secondary" id="confirmCancel">取消</button>
          <button class="btn ${btnClass}" id="confirmOk">${esc(actionLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('#confirmCancel').onclick = () => { overlay.remove(); resolve(false); };
    overlay.querySelector('#confirmOk').onclick = () => { overlay.remove(); resolve(true); };
  });
}

// === Auto Refresh ===
function startAutoRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  const seconds = parseInt(refreshInterval.value, 10);
  if (seconds > 0) {
    refreshTimer = setInterval(() => refreshStatus(), seconds * 1000);
  }
}

// === Event Listeners ===
function setupEventListeners() {
  refreshBtn.addEventListener('click', () => refreshStatus());
  addMachineBtn.addEventListener('click', () => { closeDropdown(); openAddModal(); });
  scanBtn.addEventListener('click', openScanModal);
  modalClose.addEventListener('click', () => closeModal('modalOverlay'));
  cancelBtn.addEventListener('click', () => closeModal('modalOverlay'));
  scanModalClose.addEventListener('click', () => closeModal('scanModalOverlay'));
  scanCloseBtn.addEventListener('click', () => closeModal('scanModalOverlay'));
  startScanBtn.addEventListener('click', scanLan);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal('modalOverlay');
  });
  scanModalOverlay.addEventListener('click', (e) => {
    if (e.target === scanModalOverlay) closeModal('scanModalOverlay');
  });

  // Dropdown toggle
  addDropdownToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
  });

  // Export / Import
  exportBtn.addEventListener('click', () => { closeDropdown(); exportMachines(); });
  importBtn.addEventListener('click', () => { closeDropdown(); importFileInput.click(); });
  importFileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importMachines(e.target.files[0]);
      e.target.value = '';
    }
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!addBtnGroup.contains(e.target)) {
      closeDropdown();
    }
  });

  refreshInterval.addEventListener('change', () => {
    const label = refreshInterval.options[refreshInterval.selectedIndex].text;
    showToast(`自动刷新已设为「${label}」`, 'info');
    refreshStatus();   // refresh once immediately on config change
    startAutoRefresh();
  });

  // MAC address auto-format on blur
  document.getElementById('machineMac').addEventListener('blur', (e) => {
    e.target.value = normalizeMac(e.target.value.trim());
  });

  document.querySelectorAll('.icon-option').forEach(btn => {
    btn.addEventListener('click', () => selectIcon(btn.dataset.icon));
  });

  machineForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const editId = document.getElementById('editId').value;
    const macInput = document.getElementById('machineMac');
    macInput.value = normalizeMac(macInput.value.trim());
    const data = {
      name: document.getElementById('machineName').value.trim(),
      mac: macInput.value,
      ip: document.getElementById('machineIp').value.trim(),
      icon: document.getElementById('machineIcon').value,
    };
    if (editId) {
      updateMachineInList(editId, data);
    } else {
      addMachineToList(data);
    }
    closeModal('modalOverlay');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal('modalOverlay');
      closeModal('scanModalOverlay');
      closeModal('settingsModalOverlay');
    }
  });

  // === Settings Modal ===
  settingsBtn.addEventListener('click', async () => {
    try {
      const password = await invoke('get_group_password');
      document.getElementById('groupPassword').value = password;
      // Check autostart status
      try {
        const isEnabled = await invoke('plugin:autostart|is_enabled');
        document.getElementById('autoStartToggle').checked = isEnabled;
      } catch (e) {
        document.getElementById('autoStartToggle').checked = false;
      }
      const statusEl = document.getElementById('p2pStatus');
      if (password) {
        statusEl.textContent = '🔒 命令监听端口: 9090 (已配置密码)';
      } else {
        statusEl.textContent = '⚠️ 命令监听端口: 9090 (未配置密码，无法接收指令)';
      }
      openModal('settingsModalOverlay');
    } catch (e) {
      showToast('读取设置失败', 'error');
    }
  });

  document.getElementById('settingsModalClose').addEventListener('click', () => closeModal('settingsModalOverlay'));
  document.getElementById('settingsCancelBtn').addEventListener('click', () => closeModal('settingsModalOverlay'));

  document.getElementById('settingsSaveBtn').addEventListener('click', async () => {
    const password = document.getElementById('groupPassword').value.trim();
    const autoStart = document.getElementById('autoStartToggle').checked;

    try {
      await invoke('set_group_password', { password });

      // Toggle autostart
      try {
        if (autoStart) {
          await invoke('plugin:autostart|enable');
        } else {
          await invoke('plugin:autostart|disable');
        }
      } catch (e) {
        console.warn('Autostart toggle failed:', e);
      }

      showToast('✅ 设置已保存', 'success');
      closeModal('settingsModalOverlay');
    } catch (e) {
      showToast('保存设置失败: ' + e, 'error');
    }
  });
}

// === Utils ===
function esc(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function normalizeMac(input) {
  const raw = input.replace(/[:\-\s.]/g, '').toUpperCase();
  if (!/^[0-9A-F]{12}$/.test(raw)) return input;
  return raw.match(/.{2}/g).join(':');
}
