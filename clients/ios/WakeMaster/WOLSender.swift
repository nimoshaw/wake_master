import Foundation
import Network

/// Sends Wake-on-LAN Magic Packets via UDP broadcast.
class WOLSender {

    /// Send a WOL Magic Packet for the given MAC address.
    static func wake(mac: String, completion: @escaping (Bool, String) -> Void) {
        guard let macBytes = parseMac(mac) else {
            completion(false, "Invalid MAC address: \(mac)")
            return
        }

        let packet = buildMagicPacket(mac: macBytes)

        // Use NWConnection for UDP broadcast
        let host = NWEndpoint.Host("255.255.255.255")
        let port = NWEndpoint.Port(rawValue: 9)!
        let params = NWParameters.udp
        // Allow broadcast
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: "0.0.0.0", port: 0)

        let connection = NWConnection(host: host, port: port, using: params)
        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                connection.send(content: packet, completion: .contentProcessed { error in
                    if let error = error {
                        completion(false, "Send failed: \(error.localizedDescription)")
                    } else {
                        completion(true, "WOL packet sent")
                    }
                    connection.cancel()
                })
            case .failed(let error):
                completion(false, "Connection failed: \(error.localizedDescription)")
                connection.cancel()
            default:
                break
            }
        }
        connection.start(queue: .global())
    }

    /// Ping a host by attempting a TCP connection (iOS doesn't support ICMP ping without entitlements).
    static func ping(ip: String, timeout: TimeInterval = 2.0, completion: @escaping (Bool) -> Void) {
        let host = NWEndpoint.Host(ip)
        // Try common ports to detect if host is up
        let connection = NWConnection(host: host, port: 80, using: .tcp)
        var completed = false

        connection.stateUpdateHandler = { state in
            guard !completed else { return }
            switch state {
            case .ready:
                completed = true
                completion(true)
                connection.cancel()
            case .failed:
                completed = true
                completion(false)
                connection.cancel()
            default:
                break
            }
        }
        connection.start(queue: .global())

        // Timeout
        DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
            guard !completed else { return }
            completed = true
            completion(false)
            connection.cancel()
        }
    }

    // MARK: - Private

    private static func parseMac(_ mac: String) -> [UInt8]? {
        let parts = mac.split(separator: ":").count > 1
            ? mac.split(separator: ":")
            : mac.split(separator: "-")
        guard parts.count == 6 else { return nil }
        var bytes = [UInt8]()
        for part in parts {
            guard let byte = UInt8(part, radix: 16) else { return nil }
            bytes.append(byte)
        }
        return bytes
    }

    private static func buildMagicPacket(mac: [UInt8]) -> Data {
        var packet = Data(repeating: 0xFF, count: 6)
        for _ in 0..<16 {
            packet.append(contentsOf: mac)
        }
        return packet
    }
}
