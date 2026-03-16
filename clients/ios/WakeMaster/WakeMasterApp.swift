import SwiftUI

@main
struct WakeMasterApp: App {
    @StateObject private var viewModel = MachineViewModel()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(viewModel)
                .preferredColorScheme(.dark)
        }
    }
}
