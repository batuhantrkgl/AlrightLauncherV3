# AlrightLauncherV3

[![Build and Release](https://github.com/batuhantrkgl/AlrightLauncherV3/actions/workflows/release.yml/badge.svg)](https://github.com/batuhantrkgl/AlrightLauncherV3/actions/workflows/release.yml)[![Downloads](https://img.shields.io/github/downloads/batuhantrkgl/AlrightLauncherV3/total.svg)](https://github.com/batuhantrkgl/AlrightLauncherV3/releases)
[![CodeFactor](https://www.codefactor.io/repository/github/batuhantrkgl/alrightlauncherv3/badge)](https://www.codefactor.io/repository/github/batuhantrkgl/alrightlauncherv3)
[![License](https://img.shields.io/github/license/batuhantrkgl/AlrightLauncherV3.svg)](LICENSE)

Yet Another Minecraft Launcher - A modern, easy-to-use Minecraft launcher built with Electron.


## Installation

### For Users

1. Download the latest release for your operating system:
   - Windows: `Alright Launcher-Setup-[version].exe`
   - Linux: `Alright Launcher-[version].AppImage` (Soon)
   - macOS: `Alright Launcher-[version].dmg` (Soon)

2. Run the installer and follow the on-screen instructions.

### For Developers

```bash
# Clone the repository
git clone https://github.com/batuhantrkgl/AlrightLauncherV3

# Install dependencies
bun install    # or npm install

# Start the application
bun start     # or npm start
bun start --dev # Enables DevTools
```

## Documentation

### Offline Mode
- What does offline-mode settings do is making launcher completely offline. It will not download any files from the internet.
- It will use the local files instead.
- It will not check for updates.

### Version Management
- Install any Minecraft version
- Automatic dependency handling
- Version isolation
- Automatic Asset Index update/fixes

### Mocking Auth Servers
- This project let's you play minecraft without even having an account.
- If you're willing to play minecraft with your microsoft account which should has minecraft puchased already, you can.

### Modloader Support
- Fabric (Guranteed)
- Forge (Not Tested)
- Quilt (Not Tested)

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## Shortcuts
- Ctrl + Shift: Shows the log-out button (if user is authenticated with Microsoft Account)
- Ctrl + Clicking to Version Selector: Shows/Hides the custom modloaders, for example: fabric


## License

Copyright © 2021-2025 Batuhantrkgl [ZephyrStudios]
