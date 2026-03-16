<div align="center">

# ⚡ Wake Master

**局域网机器管理神器 — 一键唤醒、关机、重启，告别繁琐的路由器后台操作！**

[![GitHub stars](https://img.shields.io/github/stars/nichaos2/wake_master?style=social)](https://github.com/nichaos2/wake_master)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-blue)](https://github.com/nichaos2/wake_master/releases)

</div>

---

你是否厌倦了每次要唤醒一台机器，就得：

1. 🔗 打开路由器管理页面
2. 🔑 输入密码登录
3. 📂 翻好几层菜单找到"网络唤醒"
4. 🖱️ 找到对应机器，点击唤醒

**Wake Master 让这一切变成一个按钮的事！**

## ✨ 功能亮点

| 功能 | 说明 |
|------|------|
| ⚡ **一键唤醒** | 发送 WOL Magic Packet，秒级唤醒局域网内任意机器 |
| 📊 **实时状态** | 自动 Ping 检测在线/离线，支持 30秒 ~ 1小时自动刷新 |
| 🔌 **远程关机** | 一键远程关闭目标机器 |
| 🔄 **远程重启** | 一键远程重启目标机器 |
| 📡 **局域网扫描** | 自动发现同网段的设备，一键添加到管理列表 |
| 🎨 **暗色主题** | 精心设计的深色 UI，Glassmorphism 风格，赏心悦目 |
| 📱 **响应式布局** | 自适应窗口大小，宽屏多列、窄屏单列，随你调整 |

## 🖼️ 界面预览

> 深色 Glassmorphism 设计 · 一目了然的状态指示 · 流畅的动画交互

<div align="center">
<img src="docs/screenshot.png" alt="Wake Master Screenshot" width="800">
</div>

## 🚀 快速开始

### Windows 免安装版（推荐）

1. 从 [Releases](https://github.com/nichaos2/wake_master/releases) 下载 `WakeMaster_x.x.x_x64-setup.exe`
2. 双击运行，开箱即用！
3. 添加你的机器（主机名、MAC 地址、IP 地址）
4. 享受一键管理的快感 🎉

### 从源码构建

**前置要求**：[Node.js](https://nodejs.org/) 18+ · [Rust](https://rustup.rs/) 1.70+

```bash
# 克隆仓库
git clone https://github.com/nichaos2/wake_master.git
cd wake_master

# === Web 版 ===
npm install
npm start
# 访问 http://localhost:3000

# === Windows 桌面版 ===
cd clients/windows
cargo tauri dev      # 开发调试
cargo tauri build    # 构建发布版
```

## 📖 使用指南

### 添加机器

点击右上角「➕ 添加」按钮，填入：
- **主机名称**: 方便你识别的名字
- **MAC 地址**: 目标机器的网卡 MAC（格式：`D8:BB:C1:9A:9D:79`）
- **IP 地址**: 目标机器在局域网的 IP

> 💡 也可以点「📡 扫描」自动发现局域网设备，一键添加！

### 远程关机/重启

> ⚠️ 远程关机/重启依赖 Windows 远程管理服务。目标机器需要：
> - 开启 Remote Registry 服务
> - 防火墙允许远程关机
> - 两台机器使用相同的管理员账户，或已配置远程权限

### Wake-on-LAN 前置配置

确保目标机器的 BIOS 和网卡已开启 WOL 支持：
1. **BIOS**: 开启 `Wake on PCI(E) Device` 或 `Resume by LAN`
2. **网卡属性**: 开启 `允许此设备唤醒计算机` + `Magic Packet 唤醒`

## 🏗️ 项目结构

```
wake_master/
├── server.js              # Web 版后端 (Express)
├── public/                # Web 版前端
├── machines.json          # 机器配置文件
└── clients/
    └── windows/           # Windows 桌面版 (Tauri + Rust)
        ├── src/           # 前端 (HTML/CSS/JS)
        └── src-tauri/     # Rust 后端
```

## 🗺️ Roadmap

- [x] 🖥️ Windows 桌面版
- [ ] 🐧 Linux 版
- [ ] 🍎 macOS 版
- [ ] 📱 Android 版
- [ ] 📱 iOS 版
- [ ] 🌐 远程唤醒（通过互联网 WOL）
- [ ] 📊 设备在线时间统计

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！无论是 Bug 报告、功能建议还是代码贡献，都非常感谢！

## 📄 License

[MIT](LICENSE) © Wake Master

---

<div align="center">

**如果 Wake Master 帮到了你，请给个 ⭐ Star 支持一下！**

**每一个 Star 都是我们继续开发的动力 🚀**

感谢每一位 Stargazer ❤️

</div>
