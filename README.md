# AlrightLauncherV3

[![Build status](https://badge.buildkite.com/357ae70ac69e5f0a07d5e0f54a687e8f4df7310cc1278beae2.svg)](https://buildkite.com/batuhan-turkoglu/alrightlauncherv3)
[![Downloads](https://img.shields.io/github/downloads/batuhantrkgl/AlrightLauncherV3/total.svg)](https://github.com/batuhantrkgl/AlrightLauncherV3/releases)
[![License](https://img.shields.io/github/license/batuhantrkgl/AlrightLauncherV3.svg)](LICENSE)

Yet Another Minecraft Launcher — a modern, cross-platform Minecraft launcher built with Electron.

## Download

| Platform | Format | Build |
|---|---|---|
| Windows | `.exe` (NSIS installer) | ✅ |
| Linux | `.AppImage` (`.deb`, `.rpm`, `.snap`) | ✅ |
| macOS | `.zip` (.app bundle) | ✅ |

Grab the latest release from the [Releases page](https://github.com/batuhantrkgl/AlrightLauncherV3/releases).

## Features

### Core
- **Offline mode** — play without downloading anything; uses local files only
- **Version management** — install any Minecraft version with auto dependency resolution, version isolation, and automatic asset index fixes
- **Modloader support** — Fabric (full), Forge (experimental), Quilt (experimental)
- **Microsoft authentication** — full OAuth 2.0 flow via login.live.com + Xbox Live + Minecraft services
- **Mock auth servers** — play without a Minecraft account for testing and offline LAN
- **Built-in server manager** — download, create, start, stop, and manage Minecraft servers directly from the launcher UI; configure ports, RAM, whitelist, and online/offline mode
- **Standalone creator** — bundle the launcher with specific Minecraft versions, assets, and libraries into a portable package with launch scripts
- **Sound asset repair** — automatically downloads missing sound assets and creates fallback mappings
- **Auto-updater** — checks GitHub releases hourly, supports stable and beta channels with download progress and restart-to-install

### UI / UX
- **Modern Material Design** — clean, dark-themed UI with smooth animations and transitions
- **Discord Rich Presence** — shows what you're playing and your current launcher state
- **Ctrl+Shift+Click logout** — hold Ctrl+Shift and click your username to reveal the logout button (bypasses OAuth cache)
- **Ctrl+Alt+H** — show keyboard shortcuts help
- **Ctrl+Alt+A** — check auth status
- **Ctrl+Alt+D** — show debug info
- **Ctrl+Click version selector** — toggle modloader options
- **Direct logout fallback** — emergency logout via Ctrl+Alt+L when standard logout fails

### Cross-Platform
- **Windows** — NSIS installer, portable on request
- **Linux** — AppImage, deb, rpm, snap
- **macOS** — `.zip` with `.app` bundle (DMG requires a macOS build host)
- **Shared codebase** — all platform-specific paths, Java installs, and OS detection handled through `src/scripts/platform.js`

## Development

```bash
git clone https://github.com/batuhantrkgl/AlrightLauncherV3
cd AlrightLauncherV3

npm install
npm start          # or: npm run dev (DevTools enabled)
```

### Build

```bash
npm run build           # Windows (.exe)
npm run build:linux     # Linux (.AppImage)
npm run build:mac       # macOS (.zip)
```

### Scripts

| Script | Purpose |
|---|---|
| `npm start` | Launch in production mode |
| `npm run dev` | Launch with DevTools and `--dev` flag |
| `npm run build` | Build Windows installer (x64, ASAR) |
| `npm run build:linux` | Build Linux AppImage |
| `npm run build:mac` | Build macOS `.zip` |
| `npm run pack` | Package to directory (no installer) |
| `npm run rebuild` | Rebuild native modules for Electron |
| `npm run setup` | Install dependencies helper |

## CI/CD — Buildkite Pipeline

Every push to `master` or tag (`v*`) triggers a fully automated pipeline:

```
Version Info → [Build Linux · Build Windows · Build macOS] → Release (GitHub)
```

### Pipeline Steps

1. **Version Info** — `node:22-alpine` container resolves the release version and metadata
2. **Build Linux** — `electronuserland/builder:20` container, produces `.AppImage` (plus `.deb`, `.rpm`, `.snap`)
3. **Build Windows** — `electronuserland/builder:wine` container, produces NSIS `.exe`
4. **Build macOS** — `electronuserland/builder:20` container with `--config.mac.target=zip` (avoids `dmg-license` darwin-only dependency)
5. **Release** — collects all artifacts, creates:
   - **Tagged release**: `gh release create vX.Y.Z` with changelog (last 20 commits)
   - **Nightly release**: `nightly-<short-sha>` prerelease for non-tag pushes to master

All builds run in parallel on a single Linux Buildkite agent via Docker. Artifacts are uploaded and forwarded to the release step. The `GH_TOKEN` secret is injected via Buildkite Secrets with the `secrets:` pipeline directive.

## Shortcuts

| Shortcut | Action |
|---|---|
| **Ctrl+Shift** | Hold to reveal logout button (Microsoft auth) |
| **Ctrl+Click** version | Toggle modloader options (Fabric, Forge, Quilt) |
| **Ctrl+Alt+H** | Show keyboard shortcuts help |
| **Ctrl+Alt+A** | Check authentication status |
| **Ctrl+Alt+D** | Show debug info |
| **Ctrl+Alt+L** | Emergency direct logout |
| **Ctrl+Alt+Shift+D** | Make debug button visible |

## Architecture

```
src/
├── scripts/
│   ├── main.js                # Electron main process
│   ├── renderer.js            # UI logic & event handlers
│   ├── preload.js             # Context bridge
│   ├── index.js               # App entry & navigation
│   ├── platform.js            # Cross-platform utils (getOSName, getArchName, getAppDataDir)
│   ├── minecraft-launcher.js  # Core launcher engine
│   ├── minecraft-installer.js # Version download & installation
│   ├── auth-service.js        # Microsoft OAuth flow
│   ├── auth-helper.js         # Auth debug & keyboard shortcuts
│   ├── auth-integration.js    # Auth ↔ UI bridge
│   ├── login.js               # Login screen logic
│   ├── direct-logout.js       # Ctrl+Shift logout bypass
│   ├── server-manager.js      # Minecraft server lifecycle
│   ├── standalone-creator.js  # Portable bundle creator
│   ├── modloader-manager.js   # Fabric/Forge/Quilt installer
│   ├── asset-manager.js       # Asset index resolution & download
│   ├── versionManager.js      # Version metadata & manifest handling
│   ├── fileManager.js         # File operations & path resolution
│   ├── fileVerifier.js        # Integrity checksum verification
│   ├── java-installer.js      # Per-platform Java download & setup
│   ├── sound-repair.js        # Missing sound asset repair
│   ├── profile-manager.js     # Profile CRUD
│   ├── profile-creator.js     # Profile creation UI logic
│   ├── discord-rpc.js         # Discord Rich Presence
│   ├── update-service.js      # GitHub release checker & auto-update
│   ├── update-simulation.js   # Update flow test harness
│   ├── config.js              # Config file management
│   ├── logger.js              # Structured logging
│   ├── fix-assets.js          # Asset index patcher
│   ├── mock-auth-server.js    # Local mock auth endpoint
│   ├── create-profile.js      # Profile creation command
│   └── iconTest.js            # Icon verification
```

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Electron 28, Node.js ≥16 |
| UI | Vanilla JS, CSS3 with custom properties |
| Packaging | electron-builder 24 |
| Auth | Microsoft OAuth 2.0 + Xbox Live + Minecraft services |
| Build CI | Buildkite (Docker-based, cross-platform) |
| Artifacts | NSIS (Windows), AppImage (Linux), ZIP (macOS) |

## License

Copyright © 2021-2026 Batuhantrkgl (ZephyrStudios)
