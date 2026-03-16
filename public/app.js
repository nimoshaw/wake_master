// === State ===
let machines = [];
let statusMap = {};  // { id: true/false/null }
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
const refreshInterval = document.getElementById('refreshInterval');
const statusText = document.getElementById('statusText');
const lastUpdate = document.getElementById('lastUpdate');
const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalClose = document.getElementById('modalClose');
const machineForm = document.getElementById('machineForm');
const cancelBtn = document.getElementById('cancelBtn');
const submitBtn = document.getElementById('submitBtn');
const toastContainer = document.getElementById('toastContainer');

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  loadMachines();  // loadMachines calls refreshStatus once
  setupEventListeners();
  // No auto-refresh by default (value=0)
});

// === API ===
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  return res.json();
}

async function loadMachines() {
  try {
    machines = await api('/api/machines');
    renderMachines();
    refreshStatus();
  } catch (err) {
    showToast('加载机器列表失败', 'error');
  }
}

async function refreshStatus() {
  // Set all to checking
  machines.forEach(m => { statusMap[m.id] = null; });
  renderMachines();
  statusText.textContent = '正在检测状态...';

  try {
    const results = await api('/api/machines/status');
    results.forEach(r => { statusMap[r.id] = r.online; });

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

  // Visual feedback
  const card = document.querySelector(`[data-machine-id="${id}"]`);
  const wakeBtn = card?.querySelector('.wake-btn');
  if (wakeBtn) {
    wakeBtn.classList.add('waking');
    wakeBtn.querySelector('.wake-text').textContent = '正在发送唤醒包...';
  }

  try {
    const result = await api(`/api/machines/${id}/wake`, { method: 'POST' });
    showToast(`⚡ ${machine.name} 唤醒包已发送`, 'success');

    // After a delay, re-check status
    setTimeout(() => {
      refreshStatus();
    }, 5000);
  } catch (err) {
    showToast(`唤醒 ${machine.name} 失败`, 'error');
  } finally {
    if (wakeBtn) {
      wakeBtn.classList.remove('waking');
      wakeBtn.querySelector('.wake-text').textContent = '唤醒';
    }
  }
}

async function addMachine(data) {
  try {
    const newMachine = await api('/api/machines', { method: 'POST', body: data });
    machines.push(newMachine);
    statusMap[newMachine.id] = null;
    renderMachines();
    showToast(`✅ ${data.name} 已添加`, 'success');
    refreshStatus();
  } catch (err) {
    showToast('添加失败', 'error');
  }
}

async function updateMachine(id, data) {
  try {
    const updated = await api(`/api/machines/${id}`, { method: 'PUT', body: data });
    const idx = machines.findIndex(m => m.id === id);
    if (idx !== -1) machines[idx] = updated;
    renderMachines();
    showToast(`✅ ${data.name} 已更新`, 'success');
  } catch (err) {
    showToast('更新失败', 'error');
  }
}

async function deleteMachine(id) {
  const machine = machines.find(m => m.id === id);
  if (!machine) return;

  const confirmed = await showConfirm(`确定要删除 "${machine.name}" 吗？`);
  if (!confirmed) return;

  try {
    await api(`/api/machines/${id}`, { method: 'DELETE' });
    machines = machines.filter(m => m.id !== id);
    delete statusMap[id];
    renderMachines();
    showToast(`🗑️ ${machine.name} 已删除`, 'info');
  } catch (err) {
    showToast('删除失败', 'error');
  }
}

// === Export / Import ===
async function exportMachines() {
  try {
    const data = await api('/api/machines');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
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
    showToast('导出失败', 'error');
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
    const result = await api('/api/machines/import', { method: 'POST', body: data });
    if (result.success) {
      showToast(`📥 导入完成：新增 ${result.added} 台，共 ${result.total} 台`, 'success');
      await loadMachines();
    } else {
      showToast('导入失败: ' + (result.error || '未知错误'), 'error');
    }
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

// === Rendering ===
function renderMachines() {
  machinesGrid.innerHTML = machines.map(m => {
    const status = statusMap[m.id];
    const statusClass = status === null ? 'checking' : (status ? 'online' : 'offline');
    const statusLabel = status === null ? '检测中...' : (status ? '在线' : '离线');
    const cardClass = status ? 'online' : '';
    const wakeBtnClass = status ? 'online-btn' : '';

    return `
      <div class="machine-card ${cardClass}" data-machine-id="${m.id}">
        <div class="card-header">
          <div class="card-identity">
            <div class="card-icon">${m.icon || '🖥️'}</div>
            <div class="card-info">
              <h3>${escapeHtml(m.name)}</h3>
              <div class="card-mac">${escapeHtml(m.mac)}</div>
            </div>
          </div>
          <div class="card-actions">
            <button class="card-action-btn edit" title="编辑" onclick="openEditModal('${m.id}')">✏️</button>
            <button class="card-action-btn delete" title="删除" onclick="deleteMachine('${m.id}')">🗑️</button>
          </div>
        </div>
        <div class="status-indicator ${statusClass}">
          <div class="status-dot"></div>
          <span class="status-label">${statusLabel}</span>
        </div>
        <div class="card-ip">IP: ${escapeHtml(m.ip)}</div>
        <button class="wake-btn ${wakeBtnClass}" onclick="wakeMachine('${m.id}')">
          <span>⚡</span>
          <span class="wake-text">${status ? '重新唤醒' : '唤醒'}</span>
        </button>
      </div>
    `;
  }).join('');

  if (machines.length === 0) {
    machinesGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--text-muted);">
        <div style="font-size: 48px; margin-bottom: 16px;">🖧</div>
        <p style="font-size: 16px; margin-bottom: 8px;">暂无机器</p>
        <p style="font-size: 13px;">点击右上角「添加」按钮添加你的第一台机器</p>
      </div>
    `;
  }
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

function closeModal() {
  modalOverlay.classList.remove('active');
}

function selectIcon(icon) {
  document.querySelectorAll('.icon-option').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.icon === icon);
  });
  document.getElementById('machineIcon').value = icon;
}

// === Toast ===
function showToast(message, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type]}</span> ${escapeHtml(message)}`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// === Confirm Dialog ===
function showConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <p>${escapeHtml(message)}</p>
        <div class="form-actions">
          <button class="btn btn-secondary" id="confirmCancel">取消</button>
          <button class="btn-danger" id="confirmOk">删除</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#confirmCancel').onclick = () => {
      overlay.remove();
      resolve(false);
    };
    overlay.querySelector('#confirmOk').onclick = () => {
      overlay.remove();
      resolve(true);
    };
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
  modalClose.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
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
      e.target.value = '';  // reset so same file can be re-imported
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

  // Icon picker
  document.querySelectorAll('.icon-option').forEach(btn => {
    btn.addEventListener('click', () => selectIcon(btn.dataset.icon));
  });

  // Form submit
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
      updateMachine(editId, data);
    } else {
      addMachine(data);
    }
    closeModal();
  });

  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

// === Utils ===
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function normalizeMac(input) {
  // Strip all common separators: colon, dash, space, dot
  const raw = input.replace(/[:\-\s.]/g, '').toUpperCase();
  // Must be exactly 12 hex characters
  if (!/^[0-9A-F]{12}$/.test(raw)) return input; // return as-is if invalid
  // Format as XX:XX:XX:XX:XX:XX
  return raw.match(/.{2}/g).join(':');
}
