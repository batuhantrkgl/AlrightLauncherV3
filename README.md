# AlrightLauncherV3

[![Build status](https://badge.buildkite.com/PASTE_YOUR_BUILDKITE_TOKEN_HERE/alrightlauncherv3.svg)](https://buildkite.com/batuhantrkgl/alrightlauncherv3)
[![Downloads](https://img.shields.io/github/downloads/batuhantrkgl/AlrightLauncherV3/total.svg)](https://github.com/batuhantrkgl/AlrightLauncherV3/releases)
[![License](https://img.shields.io/github/license/batuhantrkgl/AlrightLauncherV3.svg)](LICENSE)

Yet Another Minecraft Launcher — a modern, easy-to-use Minecraft launcher built with Electron.

## Download

| Platform | Format | Status |
|---|---|---|
| Windows | `.exe` (NSIS installer) | ✅ |
| Linux | `.AppImage` | ✅ |
| macOS | `.zip` (.app bundle) | ✅ |

Grab the latest release from the [Releases page](https://github.com/batuhantrkgl/AlrightLauncherV3/releases).

## Features

- **Offline mode** — play without downloading anything; uses local files only
- **Version management** — install any Minecraft version, auto dependency resolution, version isolation, automatic asset index fixes
- **Mock auth servers** — play without a Minecraft account, or sign in with Microsoft
- **Modloader support** — Fabric (guaranteed), Forge (experimental), Quilt (experimental)
- **Discord Rich Presence** integration
- **Cross-platform** — Windows, Linux, macOS

## Development

```bash
git clone https://github.com/batuhantrkgl/AlrightLauncherV3
cd AlrightLauncherV3

# Install dependencies
npm install        # or bun install

# Run
npm start          # or bun start
npm run dev        # DevTools enabled
```

### Build

```bash
npm run build           # Windows
npm run build:linux     # Linux
npm run build:mac       # macOS
```

## Shortcuts

- **Ctrl + Shift** — shows logout button (when signed in with Microsoft)
- **Ctrl + Click** version selector — toggles modloader options (e.g. Fabric)

## License

Copyright © 2021-2025 Batuhantrkgl (ZephyrStudios)
