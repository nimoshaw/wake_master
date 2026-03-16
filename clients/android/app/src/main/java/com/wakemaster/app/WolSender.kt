package com.wakemaster.app

import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.InetSocketAddress

/**
 * Wake-on-LAN utility: sends a WOL Magic Packet to the broadcast address.
 */
object WolSender {

    /**
     * Sends a WOL Magic Packet for the given MAC address.
     * @param macAddress MAC in format "AA:BB:CC:DD:EE:FF" or "AA-BB-CC-DD-EE-FF"
     */
    fun sendMagicPacket(macAddress: String) {
        val mac = parseMac(macAddress)
        val packet = buildMagicPacket(mac)

        val socket = DatagramSocket()
        socket.broadcast = true

        // Send to broadcast on port 9
        val broadcastAddr = InetAddress.getByName("255.255.255.255")
        val datagram = DatagramPacket(packet, packet.size, broadcastAddr, 9)
        socket.send(datagram)

        // Also try port 7
        val datagram7 = DatagramPacket(packet, packet.size, broadcastAddr, 7)
        socket.send(datagram7)

        socket.close()
    }

    /**
     * Pings a host and returns true if reachable.
     */
    fun pingHost(ip: String, timeoutMs: Int = 2000): Boolean {
        return try {
            val address = InetAddress.getByName(ip)
            address.isReachable(timeoutMs)
        } catch (e: Exception) {
            false
        }
    }

    private fun parseMac(macStr: String): ByteArray {
        val parts = macStr.split(":", "-")
        require(parts.size == 6) { "Invalid MAC address: $macStr" }
        return parts.map { it.toInt(16).toByte() }.toByteArray()
    }

    private fun buildMagicPacket(mac: ByteArray): ByteArray {
        val packet = ByteArray(6 + 16 * 6)
        // 6 bytes of 0xFF
        for (i in 0..5) packet[i] = 0xFF.toByte()
        // 16 repetitions of MAC
        for (i in 0..15) {
            System.arraycopy(mac, 0, packet, 6 + i * 6, 6)
        }
        return packet
    }
}
