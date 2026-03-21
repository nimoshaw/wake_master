package com.wakemaster.app

import android.content.Context
import android.net.wifi.WifiManager
import kotlinx.coroutines.*
import java.io.BufferedReader
import java.io.FileReader
import java.net.InetAddress
import java.net.InetSocketAddress

/**
 * Discovered device on the LAN.
 */
data class ScannedDevice(
    val ip: String,
    val mac: String,
    val hostname: String
)

/**
 * Scans the local network for online devices using ping sweep + ARP table.
 */
object LanScanner {

    /**
     * Get the device's local IP prefix (e.g. "192.168.1.") from WifiManager.
     */
    fun getSubnetPrefix(context: Context): String? {
        val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            ?: return null
        val ip = wifiManager.connectionInfo?.ipAddress ?: return null
        if (ip == 0) return null
        // Android stores IP as little-endian int
        return "${ip and 0xFF}.${ip shr 8 and 0xFF}.${ip shr 16 and 0xFF}."
    }

    /**
     * Performs a full LAN scan:
     * 1. Ping sweep all IPs in the /24 subnet concurrently
     * 2. Read ARP table to get MAC addresses
     * 3. Try reverse DNS for hostnames
     *
     * @param onProgress called with (current, total) for progress updates
     */
    suspend fun scan(
        context: Context,
        onProgress: (current: Int, total: Int) -> Unit = { _, _ -> }
    ): List<ScannedDevice> = withContext(Dispatchers.IO) {
        val prefix = getSubnetPrefix(context) ?: return@withContext emptyList()
        val total = 254

        // Phase 1: Parallel ping sweep (fast, 32 concurrent)
        val semaphore = kotlinx.coroutines.sync.Semaphore(32)
        val jobs = (1..total).map { i ->
            async {
                semaphore.acquire()
                try {
                    val ip = "$prefix$i"
                    pingQuick(ip)
                    onProgress(i, total)
                } finally {
                    semaphore.release()
                }
            }
        }
        jobs.awaitAll()

        // Phase 2: Read ARP table for discovered devices
        val arpEntries = readArpTable()

        // Phase 3: Filter to our subnet and resolve hostnames
        arpEntries
            .filter { it.ip.startsWith(prefix) && it.mac != "00:00:00:00:00:00" }
            .map { entry ->
                val hostname = try {
                    InetAddress.getByName(entry.ip).canonicalHostName.let {
                        if (it == entry.ip) "" else it
                    }
                } catch (e: Exception) { "" }
                ScannedDevice(
                    ip = entry.ip,
                    mac = entry.mac.uppercase(),
                    hostname = hostname
                )
            }
            .distinctBy { it.mac }
    }

    /**
     * Quick ping — tries ICMP first, then TCP port 80 as fallback.
     */
    private fun pingQuick(ip: String) {
        try {
            val addr = InetAddress.getByName(ip)
            if (addr.isReachable(300)) return
        } catch (_: Exception) {}

        // TCP fallback on port 80
        try {
            val socket = java.net.Socket()
            socket.connect(InetSocketAddress(ip, 80), 300)
            socket.close()
        } catch (_: Exception) {}
    }

    /**
     * ARP table entry from /proc/net/arp
     */
    private data class ArpEntry(val ip: String, val mac: String)

    /**
     * Reads /proc/net/arp to get IP-to-MAC mappings.
     * Format: IP address | HW type | Flags | HW address | Mask | Device
     */
    private fun readArpTable(): List<ArpEntry> {
        val entries = mutableListOf<ArpEntry>()
        try {
            BufferedReader(FileReader("/proc/net/arp")).use { reader ->
                // Skip header line
                reader.readLine()
                var line = reader.readLine()
                while (line != null) {
                    val parts = line.trim().split(Regex("\\s+"))
                    if (parts.size >= 4) {
                        val ip = parts[0]
                        val flags = parts[2]
                        val mac = parts[3]
                        // flags "0x2" means the entry is reachable
                        if (flags != "0x0" && mac != "00:00:00:00:00:00") {
                            entries.add(ArpEntry(ip, mac))
                        }
                    }
                    line = reader.readLine()
                }
            }
        } catch (_: Exception) {}
        return entries
    }
}
