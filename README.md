# Alright Launcher

Yet Another Minecraft Launcher - A modern, easy-to-use Minecraft launcher built with Electron.

## Features

- **Cross-platform** support (Windows, Linux, and macOS)
- **Local Server Management**
  - Create and manage Minecraft servers
  - Real-time server logs
  - Server configuration options (memory, players, gamemode, etc.)
  - Server status monitoring
- **Offline Mode Support**
  - Play without Microsoft account
  - Local authentication server
  - Multiplayer functionality in offline mode
- **Version Management**
  - Install any Minecraft version
  - Automatic Java detection and installation
  - Custom installation directory
- **User Interface**
  - Modern, clean design
  - Light/Dark theme support
  - Real-time logging
  - Debug console
- **Performance**
  - Memory usage optimization
  - Custom RAM allocation
  - Native system integration
- **Additional Features**
  - Standalone mode creation
  - Desktop shortcut creation
  - Crash reporting system
  - Auto-update functionality

## Installation

### For Users

1. Download the latest release for your operating system:
   - Windows: `Alright Launcher-Setup-[version].exe`
   - Linux: `Alright Launcher-[version].AppImage`
   - macOS: `Alright Launcher-[version].dmg`

2. Run the installer and follow the on-screen instructions.

### For Developers

```bash
# Clone the repository
git clone https://github.com/batuhantrkgl/AlrightLauncherV3

# Install dependencies
bun install    # or npm install

# Start the application
bun start     # or npm start

# Build the application
bun run build # or npm run build
```

## Development Scripts

- `bun start` - Start the application in development mode
- `bun run pack` - Create an unpacked build
- `bun run build` - Create a production build for Windows
- `bun run dist` - Create distributables for Windows

## Documentation

### Server Management
- Create local Minecraft servers
- Configure server properties
- Monitor server status and logs
- Manage multiple servers

### Offline Mode
- Play without authentication
- Join multiplayer servers
- Custom UUID generation
- Local session handling

### Version Management
- Install any Minecraft version
- Automatic dependency handling
- Custom installation paths
- Version isolation

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## License

Copyright © 2021-2025 Batuhantrkgl [ZephyrStudios]
