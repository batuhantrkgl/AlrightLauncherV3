# Alright Launcher

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

# Build the application
bun run bunbuild.js # or npm run build
```

## Development Scripts

- `bun start` - Start the application in development mode
- `bun run pack` - Create an unpacked build
- `bun run bunbuild.js` - Create a production build for Windows
- `npm run build` - Create a production build for Windows

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
- Version isolation

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
