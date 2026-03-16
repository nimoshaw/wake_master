package com.wakemaster.app

import android.content.Context
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken

/**
 * Data model for a managed machine.
 */
data class Machine(
    val id: String,
    val name: String,
    val mac: String,
    val ip: String,
    val icon: String = "🖥️"
)

/**
 * Simple persistence layer using SharedPreferences + Gson.
 */
class MachineStore(context: Context) {
    private val prefs = context.getSharedPreferences("wakemaster", Context.MODE_PRIVATE)
    private val gson = Gson()
    private val type = object : TypeToken<List<Machine>>() {}.type

    fun loadMachines(): List<Machine> {
        val json = prefs.getString("machines", null) ?: return emptyList()
        return try {
            gson.fromJson(json, type)
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun saveMachines(machines: List<Machine>) {
        prefs.edit().putString("machines", gson.toJson(machines)).apply()
    }

    fun addMachine(name: String, mac: String, ip: String, icon: String): Machine {
        val machines = loadMachines().toMutableList()
        val id = "${name.lowercase().replace(Regex("[^a-z0-9]"), "_")}_${System.currentTimeMillis()}"
        val machine = Machine(id, name, mac, ip, icon.ifEmpty { "🖥️" })
        machines.add(machine)
        saveMachines(machines)
        return machine
    }

    fun deleteMachine(id: String) {
        val machines = loadMachines().filter { it.id != id }
        saveMachines(machines)
    }

    fun updateMachine(id: String, name: String, mac: String, ip: String, icon: String) {
        val machines = loadMachines().map {
            if (it.id == id) it.copy(
                name = name.ifEmpty { it.name },
                mac = mac.ifEmpty { it.mac },
                ip = ip.ifEmpty { it.ip },
                icon = icon.ifEmpty { it.icon }
            ) else it
        }
        saveMachines(machines)
    }
}
