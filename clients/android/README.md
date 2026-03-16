# WakeMaster Android Client

A native Android Wake-on-LAN app built with **Kotlin** and **Jetpack Compose**.

## Features
- ⚡ Send WOL Magic Packets
- 📊 Ping-based status detection
- 🎨 Material 3 dark theme
- 📡 LAN device discovery
- 💾 Local machine list storage

## Build Requirements
- Android Studio Hedgehog (2023.1.1) or later
- Android SDK 34+
- Kotlin 1.9+

## Build & Run
```bash
# Open in Android Studio
# OR command line:
./gradlew assembleDebug

# Install on connected device
./gradlew installDebug
```

## Permissions Required
- `INTERNET` — Send WOL packets
- `CHANGE_WIFI_MULTICAST_STATE` — Broadcast on LAN
- `ACCESS_WIFI_STATE` — Detect network info
