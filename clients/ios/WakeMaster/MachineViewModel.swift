import Foundation

@MainActor
class MachineViewModel: ObservableObject {
    @Published var machines: [Machine] = []
    @Published var statusMap: [String: Bool?] = [:] // nil = checking
    @Published var isRefreshing = false
    @Published var toastMessage: String?

    private let store = MachineStore()

    init() {
        loadMachines()
    }

    func loadMachines() {
        machines = store.load()
        refreshStatus()
    }

    func refreshStatus() {
        isRefreshing = true
        for m in machines { statusMap[m.id] = nil }

        let machinesCopy = machines
        Task {
            for machine in machinesCopy {
                let ip = machine.ip
                let id = machine.id
                WOLSender.ping(ip: ip) { [weak self] online in
                    Task { @MainActor in
                        self?.statusMap[id] = online
                    }
                }
            }
            try? await Task.sleep(nanoseconds: 3_000_000_000) // Wait for pings
            isRefreshing = false
        }
    }

    func wakeMachine(_ id: String) {
        guard let machine = machines.first(where: { $0.id == id }) else { return }
        WOLSender.wake(mac: machine.mac) { [weak self] success, message in
            Task { @MainActor in
                if success {
                    self?.showToast("⚡ WOL packet sent to \(machine.name)")
                    // Re-check after delay
                    try? await Task.sleep(nanoseconds: 5_000_000_000)
                    self?.refreshStatus()
                } else {
                    self?.showToast("Wake failed: \(message)")
                }
            }
        }
    }

    func addMachine(name: String, mac: String, ip: String, icon: String) {
        let machine = Machine(name: name, mac: mac, ip: ip, icon: icon.isEmpty ? "🖥️" : icon)
        machines.append(machine)
        store.save(machines)
        showToast("✅ \(name) added")
        refreshStatus()
    }

    func deleteMachine(_ id: String) {
        let name = machines.first(where: { $0.id == id })?.name ?? "Machine"
        machines.removeAll { $0.id == id }
        statusMap.removeValue(forKey: id)
        store.save(machines)
        showToast("🗑️ \(name) deleted")
    }

    func showToast(_ message: String) {
        toastMessage = message
        Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            toastMessage = nil
        }
    }
}
