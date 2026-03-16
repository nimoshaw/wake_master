import SwiftUI

// MARK: - Color Palette (matching desktop)
extension Color {
    static let bgPrimary = Color(red: 0.04, green: 0.055, blue: 0.102)
    static let bgSecondary = Color(red: 0.067, green: 0.094, blue: 0.153)
    static let bgCard = Color(red: 0.067, green: 0.094, blue: 0.153).opacity(0.7)
    static let textPrimary = Color(red: 0.945, green: 0.961, blue: 0.976)
    static let textSecondary = Color(red: 0.58, green: 0.639, blue: 0.722)
    static let textMuted = Color(red: 0.392, green: 0.455, blue: 0.545)
    static let accent = Color(red: 0.388, green: 0.400, blue: 0.945)
    static let statusGreen = Color(red: 0.133, green: 0.773, blue: 0.369)
    static let statusOrange = Color(red: 0.961, green: 0.620, blue: 0.043)
}

// MARK: - Content View
struct ContentView: View {
    @EnvironmentObject var viewModel: MachineViewModel
    @State private var showAddSheet = false

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgPrimary.ignoresSafeArea()

                if viewModel.machines.isEmpty {
                    emptyState
                } else {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 300))], spacing: 12) {
                            ForEach(viewModel.machines) { machine in
                                MachineCardView(
                                    machine: machine,
                                    status: viewModel.statusMap[machine.id] ?? nil,
                                    onWake: { viewModel.wakeMachine(machine.id) },
                                    onDelete: { viewModel.deleteMachine(machine.id) }
                                )
                            }
                        }
                        .padding()
                    }
                }

                // Toast
                if let toast = viewModel.toastMessage {
                    VStack {
                        Spacer()
                        Text(toast)
                            .font(.footnote.weight(.medium))
                            .foregroundColor(.textPrimary)
                            .padding(.horizontal, 20)
                            .padding(.vertical, 12)
                            .background(.ultraThinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                            .padding(.bottom, 40)
                    }
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .animation(.spring(), value: viewModel.toastMessage)
                }
            }
            .navigationTitle("⚡ WakeMaster")
            .toolbarBackground(Color.bgSecondary, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { viewModel.refreshStatus() } label: {
                        Image(systemName: "arrow.clockwise")
                            .foregroundColor(.textSecondary)
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showAddSheet = true } label: {
                        Image(systemName: "plus.circle.fill")
                            .foregroundColor(.accent)
                    }
                }
            }
            .sheet(isPresented: $showAddSheet) {
                AddMachineSheet(isPresented: $showAddSheet) { name, mac, ip, icon in
                    viewModel.addMachine(name: name, mac: mac, ip: ip, icon: icon)
                }
            }
        }
    }

    var emptyState: some View {
        VStack(spacing: 16) {
            Text("🖧").font(.system(size: 48))
            Text("No machines yet")
                .font(.headline)
                .foregroundColor(.textMuted)
            Text("Tap + to add your first machine")
                .font(.caption)
                .foregroundColor(.textMuted)
        }
    }
}

// MARK: - Machine Card
struct MachineCardView: View {
    let machine: Machine
    let status: Bool?
    let onWake: () -> Void
    let onDelete: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header
            HStack {
                Text(machine.icon).font(.title)
                VStack(alignment: .leading, spacing: 2) {
                    Text(machine.name)
                        .font(.headline)
                        .foregroundColor(.textPrimary)
                    Text(machine.mac)
                        .font(.caption2.monospaced())
                        .foregroundColor(.textMuted)
                }
                Spacer()
                Button(action: onDelete) {
                    Image(systemName: "trash")
                        .font(.caption)
                        .foregroundColor(.textMuted)
                }
            }

            // Status
            HStack(spacing: 8) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                Text(statusText)
                    .font(.caption.weight(.medium))
                    .foregroundColor(statusColor)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(statusColor.opacity(0.1))
            .clipShape(RoundedRectangle(cornerRadius: 8))

            // IP
            Text("IP: \(machine.ip)")
                .font(.caption.monospaced())
                .foregroundColor(.textMuted)

            // Wake button
            Button(action: onWake) {
                HStack {
                    Text("⚡")
                    Text(status == true ? "Rewake" : "Wake")
                        .fontWeight(.medium)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color.accent.opacity(status == true ? 0.3 : 1.0))
                .foregroundColor(.white)
                .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            .disabled(status == true)
        }
        .padding(20)
        .background(Color.bgCard)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(borderColor, lineWidth: 1)
        )
    }

    var statusColor: Color {
        switch status {
        case .some(true): return .statusGreen
        case .some(false): return .textMuted
        case .none: return .statusOrange
        }
    }

    var statusText: String {
        switch status {
        case .some(true): return "Online"
        case .some(false): return "Offline"
        case .none: return "Checking..."
        }
    }

    var borderColor: Color {
        switch status {
        case .some(true): return .statusGreen.opacity(0.3)
        case .some(false): return .textMuted.opacity(0.1)
        case .none: return .statusOrange.opacity(0.2)
        }
    }
}

// MARK: - Add Machine Sheet
struct AddMachineSheet: View {
    @Binding var isPresented: Bool
    var onAdd: (String, String, String, String) -> Void

    @State private var name = ""
    @State private var mac = ""
    @State private var ip = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Machine Info") {
                    TextField("Host Name", text: $name)
                    TextField("MAC Address (e.g. D8:BB:C1:9A:9D:79)", text: $mac)
                    TextField("IP Address (e.g. 192.168.0.100)", text: $ip)
                }
            }
            .navigationTitle("Add Machine")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        onAdd(name, mac, ip, "🖥️")
                        isPresented = false
                    }
                    .disabled(name.isEmpty || mac.isEmpty || ip.isEmpty)
                }
            }
        }
    }
}
