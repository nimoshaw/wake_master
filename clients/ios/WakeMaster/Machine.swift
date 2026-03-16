import Foundation

struct Machine: Identifiable, Codable {
    let id: String
    var name: String
    var mac: String
    var ip: String
    var icon: String

    init(id: String = UUID().uuidString, name: String, mac: String, ip: String, icon: String = "🖥️") {
        self.id = id
        self.name = name
        self.mac = mac
        self.ip = ip
        self.icon = icon
    }
}

class MachineStore {
    private let key = "wakemaster_machines"

    func load() -> [Machine] {
        guard let data = UserDefaults.standard.data(forKey: key),
              let machines = try? JSONDecoder().decode([Machine].self, from: data)
        else { return [] }
        return machines
    }

    func save(_ machines: [Machine]) {
        if let data = try? JSONEncoder().encode(machines) {
            UserDefaults.standard.set(data, forKey: key)
        }
    }
}
