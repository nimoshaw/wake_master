package com.wakemaster.app

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class MachineUiState(
    val machines: List<Machine> = emptyList(),
    val statusMap: Map<String, Boolean?> = emptyMap(), // null = checking
    val isRefreshing: Boolean = false,
    val toastMessage: String? = null,
    // Scan state
    val isScanning: Boolean = false,
    val scanProgress: Float = 0f,
    val scanResults: List<ScannedDevice> = emptyList(),
    val showScanDialog: Boolean = false
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val store = MachineStore(application)
    private val _state = MutableStateFlow(MachineUiState())
    val state: StateFlow<MachineUiState> = _state

    init {
        loadMachines()
    }

    fun loadMachines() {
        val machines = store.loadMachines()
        _state.value = _state.value.copy(machines = machines)
        refreshStatus()
    }

    fun refreshStatus() {
        val machines = _state.value.machines
        _state.value = _state.value.copy(
            isRefreshing = true,
            statusMap = machines.associate { it.id to null }
        )

        viewModelScope.launch {
            val results = withContext(Dispatchers.IO) {
                machines.map { m ->
                    m.id to WolSender.pingHost(m.ip)
                }.toMap()
            }
            _state.value = _state.value.copy(
                statusMap = results,
                isRefreshing = false
            )
        }
    }

    fun wakeMachine(id: String) {
        val machine = _state.value.machines.find { it.id == id } ?: return
        viewModelScope.launch {
            try {
                withContext(Dispatchers.IO) {
                    WolSender.sendMagicPacket(machine.mac)
                }
                showToast("⚡ WOL packet sent to ${machine.name}")
                // Re-check status after delay
                kotlinx.coroutines.delay(5000)
                refreshStatus()
            } catch (e: Exception) {
                showToast("Wake failed: ${e.message}")
            }
        }
    }

    fun addMachine(name: String, mac: String, ip: String, icon: String) {
        val normalizedMac = normalizeMac(mac)
        store.addMachine(name, normalizedMac, ip, icon)
        loadMachines()
        showToast("✅ $name added")
    }

    fun deleteMachine(id: String) {
        val machine = _state.value.machines.find { it.id == id }
        store.deleteMachine(id)
        loadMachines()
        showToast("🗑️ ${machine?.name ?: "Machine"} deleted")
    }

    // === Scan ===

    fun startScan() {
        _state.value = _state.value.copy(
            isScanning = true,
            scanProgress = 0f,
            scanResults = emptyList(),
            showScanDialog = true
        )

        viewModelScope.launch {
            try {
                val results = LanScanner.scan(
                    context = getApplication(),
                    onProgress = { current, total ->
                        _state.value = _state.value.copy(
                            scanProgress = current.toFloat() / total.toFloat()
                        )
                    }
                )
                _state.value = _state.value.copy(
                    isScanning = false,
                    scanProgress = 1f,
                    scanResults = results
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    isScanning = false,
                    scanProgress = 0f
                )
                showToast("Scan failed: ${e.message}")
            }
        }
    }

    fun dismissScanDialog() {
        _state.value = _state.value.copy(showScanDialog = false, scanResults = emptyList())
    }

    fun addScannedDevice(device: ScannedDevice) {
        val name = device.hostname.ifEmpty { "Device-${device.ip.substringAfterLast(".")}" }
        store.addMachine(name, device.mac, device.ip, "🖥️")
        loadMachines()
        showToast("✅ $name added")
    }

    fun isMacAlreadyAdded(mac: String): Boolean {
        val normalizedMac = mac.uppercase().replace(Regex("[:-]"), "")
        return _state.value.machines.any {
            it.mac.uppercase().replace(Regex("[:-]"), "") == normalizedMac
        }
    }

    // === Reorder ===

    fun moveMachine(fromIndex: Int, toIndex: Int) {
        val machines = _state.value.machines.toMutableList()
        if (fromIndex < 0 || fromIndex >= machines.size || toIndex < 0 || toIndex >= machines.size) return
        val item = machines.removeAt(fromIndex)
        machines.add(toIndex, item)
        _state.value = _state.value.copy(machines = machines)
        store.saveMachines(machines)
    }

    fun showToast(message: String) {
        _state.value = _state.value.copy(toastMessage = message)
        viewModelScope.launch {
            kotlinx.coroutines.delay(3000)
            _state.value = _state.value.copy(toastMessage = null)
        }
    }
}
