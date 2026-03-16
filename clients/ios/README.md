# WakeMaster iOS Client

A native iOS Wake-on-LAN app built with **SwiftUI**.

## Features
- ⚡ Send WOL Magic Packets
- 📊 Ping-based status detection
- 🎨 Dark theme matching desktop UI
- 💾 Local machine list storage via UserDefaults

## Build Requirements
- Xcode 15+
- iOS 16+ deployment target
- Swift 5.9+

## Build & Run
1. Open `WakeMaster.xcodeproj` in Xcode
2. Select your target device/simulator
3. Press Cmd+R to build and run

## Notes
- WOL works when the device is on the **same WiFi network** as the target machines
- iOS does not support raw sockets, so we use UDP broadcast via `NWConnection`
- No special entitlements required for local network broadcast
