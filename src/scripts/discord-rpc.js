const DiscordRPC = require('discord-rpc');
const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');

// Discord Developer Application Client ID
const CLIENT_ID = '1065258622180921384'; // Replace with your Discord application client ID

class DiscordRPCClient {
    constructor() {
        this.rpc = new DiscordRPC.Client({ transport: 'ipc' });
        this.isConnected = false;
        this.version = app.getVersion();
        this.startTimestamp = new Date();
        this.clientId = CLIENT_ID;
    }

    async initialize() {
        try {
            // Check if Discord is running
            if (!this.isDiscordRunning()) {
                console.log('Discord is not running, RPC will not initialize');
                return false;
            }

            // Register event handlers
            this.rpc.on('ready', () => {
                this.isConnected = true;
                console.log('Discord RPC connected');
                this.setDefaultActivity();
            });

            // Connect to Discord
            await this.rpc.login({ clientId: this.clientId }).catch(console.error);
            return true;
        } catch (error) {
            console.error('Failed to initialize Discord RPC:', error);
            return false;
        }
    }

    isDiscordRunning() {
        // A simple check - we just try to connect and if it fails, Discord is not running
        // The actual connection will be handled in initialize()
        return true;
    }

    setDefaultActivity() {
        if (!this.isConnected) return;

        this.rpc.setActivity({
            details: 'In the launcher',
            state: 'Browsing versions',
            startTimestamp: this.startTimestamp,
            largeImageKey: 'launcher_logo',
            largeImageText: 'AlrightLauncher v' + this.version,
            smallImageKey: 'minecraft',
            smallImageText: 'Minecraft',
            buttons: [
                {
                    label: 'Download Launcher',
                    url: 'https://github.com/batuhantrkgl/AlrightLauncher/releases'
                },
                {
                    label: 'GitHub Repository',
                    url: 'https://github.com/batuhantrkgl/AlrightLauncher'
                }
            ]
        }).catch(console.error);
    }

    setPlayingActivity(version) {
        if (!this.isConnected) return;

        // Extract modloader type if present
        let versionDetails = 'Playing Minecraft';
        let smallImageKey = 'minecraft';
        let smallImageText = 'Vanilla';

        if (version.includes('fabric')) {
            smallImageKey = 'fabric';
            smallImageText = 'Fabric';
            versionDetails += ' with Fabric';
        } else if (version.includes('forge')) {
            smallImageKey = 'forge';
            smallImageText = 'Forge';
            versionDetails += ' with Forge';
        } else if (version.includes('quilt')) {
            smallImageKey = 'quilt';
            smallImageText = 'Quilt';
            versionDetails += ' with Quilt';
        }

        // Clean up version string for display
        let cleanVersion = version.replace('fabric-loader-', '')
                                  .replace('-fabric', '')
                                  .replace('-forge', '')
                                  .replace('-quilt', '');

        this.rpc.setActivity({
            details: versionDetails,
            state: `Version: ${cleanVersion}`,
            startTimestamp: new Date(),
            largeImageKey: 'launcher_logo',
            largeImageText: 'AlrightLauncher v' + this.version,
            smallImageKey: smallImageKey,
            smallImageText: smallImageText,
            buttons: [
                {
                    label: app.isPackaged ? 'Download Stable' : 'Download Beta',
                    url: 'https://github.com/batuhantrkgl/AlrightLauncher/releases'
                },
                {
                    label: 'GitHub Repository',
                    url: 'https://github.com/batuhantrkgl/AlrightLauncher'
                }
            ]
        }).catch(console.error);
    }

    setInstallingActivity(version) {
        if (!this.isConnected) return;

        this.rpc.setActivity({
            details: 'Installing Minecraft',
            state: `Version: ${version}`,
            startTimestamp: new Date(),
            largeImageKey: 'launcher_logo',
            largeImageText: 'AlrightLauncher v' + this.version,
            smallImageKey: 'download',
            smallImageText: 'Installing...',
            buttons: [
                {
                    label: app.isPackaged ? 'Download Stable' : 'Download Beta',
                    url: 'https://github.com/batuhantrkgl/AlrightLauncher/releases'
                },
                {
                    label: 'GitHub Repository',
                    url: 'https://github.com/batuhantrkgl/AlrightLauncher'
                }
            ]
        }).catch(console.error);
    }

    shutdown() {
        if (this.isConnected) {
            this.rpc.destroy().catch(console.error);
            this.isConnected = false;
        }
    }
}

module.exports = new DiscordRPCClient();
