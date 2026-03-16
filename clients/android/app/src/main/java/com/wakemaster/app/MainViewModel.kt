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
    val toastMessage: String? = null
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

    fun showToast(message: String) {
        _state.value = _state.value.copy(toastMessage = message)
        viewModelScope.launch {
            kotlinx.coroutines.delay(3000)
            _state.value = _state.value.copy(toastMessage = null)
        }
    }
}
