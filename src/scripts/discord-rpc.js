const DiscordRPC = require('discord-rpc');
const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');

// Discord Developer Application Client ID
const CLIENT_ID = '1065258622180921384';

// Repository and download links
const REPO_URL = 'https://github.com/batuhantrkgl/AlrightLauncher';
const RELEASES_URL = `${REPO_URL}/releases`;

// Image assets
const ASSETS = {
  LAUNCHER: 'launcher_logo',
  MINECRAFT: 'minecraft',
  FABRIC: 'fabric',
  FORGE: 'forge',
  QUILT: 'quilt',
  DOWNLOAD: 'download'
};

// Modloader identifiers
const MODLOADERS = {
  FABRIC: { key: 'fabric', name: 'Fabric', regexPattern: /fabric/ },
  FORGE: { key: 'forge', name: 'Forge', regexPattern: /forge/ },
  QUILT: { key: 'quilt', name: 'Quilt', regexPattern: /quilt/ }
};

class DiscordRPCClient {
  constructor() {
    this.rpc = new DiscordRPC.Client({ transport: 'ipc' });
    this.isConnected = false;
    this.version = app.getVersion();
    this.clientId = CLIENT_ID;
    this.startTimestamp = new Date();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimeout = null;
  }

  async initialize() {
    try {
      // Register event handlers
      this.rpc.on('ready', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        console.log('Discord RPC connected');
        this.setDefaultActivity();
      });

      this.rpc.on('disconnected', () => {
        console.log('Discord RPC disconnected');
        this.isConnected = false;
        this.attemptReconnect();
      });

      // Connect to Discord
      await this.connect();
      return true;
    } catch (error) {
      console.error('Failed to initialize Discord RPC:', error);
      this.attemptReconnect();
      return false;
    }
  }

  async connect() {
    try {
      await this.rpc.login({ clientId: this.clientId });
      return true;
    } catch (error) {
      console.error('Discord RPC login failed:', error);
      return false;
    }
  }

  attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;
    const delay = Math.min(30000, Math.pow(2, this.reconnectAttempts) * 1000);
    
    console.log(`Attempting to reconnect in ${delay/1000} seconds (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    this.reconnectTimeout = setTimeout(async () => {
      if (!this.isConnected) {
        await this.connect();
      }
    }, delay);
  }

  /**
   * Get button configuration for activities
   * @returns {Array} Array of button objects
   */
  getDefaultButtons() {
    return [
      {
        label: app.isPackaged ? 'Download Stable' : 'Download Beta',
        url: RELEASES_URL
      },
      {
        label: 'GitHub Repository',
        url: REPO_URL
      }
    ];
  }

  /**
   * Creates a base activity object with common properties
   * @param {Object} customProps - Custom properties to merge
   * @returns {Object} The activity object
   */
  createBaseActivity(customProps = {}) {
    return {
      largeImageKey: ASSETS.LAUNCHER,
      largeImageText: `AlrightLauncher v${this.version}`,
      buttons: this.getDefaultButtons(),
      ...customProps
    };
  }

  setDefaultActivity() {
    if (!this.isConnected) return false;

    try {
      this.rpc.setActivity(this.createBaseActivity({
        details: 'In the launcher',
        state: 'Browsing versions',
        startTimestamp: this.startTimestamp,
        smallImageKey: ASSETS.MINECRAFT,
        smallImageText: 'Minecraft'
      }));
      return true;
    } catch (error) {
      console.error('Failed to set default activity:', error);
      return false;
    }
  }

  /**
   * Detect modloader from version string
   * @param {string} version - Minecraft version string
   * @returns {Object} Modloader info or null for vanilla
   */
  detectModloader(version) {
    for (const [key, modloader] of Object.entries(MODLOADERS)) {
      if (modloader.regexPattern.test(version)) {
        return modloader;
      }
    }
    return null; // Vanilla Minecraft
  }

  /**
   * Clean up version string for display
   * @param {string} version - Raw version string
   * @returns {string} Cleaned version string
   */
  cleanVersionString(version) {
    return version
      .replace('fabric-loader-', '')
      .replace('-fabric', '')
      .replace('-forge', '')
      .replace('-quilt', '');
  }

  setPlayingActivity(version) {
    if (!this.isConnected) return false;

    // Detect modloader
    const modloader = this.detectModloader(version);
    const cleanVersion = this.cleanVersionString(version);
    
    let versionDetails = 'Playing Minecraft';
    let smallImageKey = ASSETS.MINECRAFT;
    let smallImageText = 'Vanilla';

    if (modloader) {
      smallImageKey = modloader.key;
      smallImageText = modloader.name;
      versionDetails += ` with ${modloader.name}`;
    }

    try {
      this.rpc.setActivity(this.createBaseActivity({
        details: versionDetails,
        state: `Version: ${cleanVersion}`,
        startTimestamp: new Date(),
        smallImageKey: smallImageKey,
        smallImageText: smallImageText
      }));
      return true;
    } catch (error) {
      console.error('Failed to set playing activity:', error);
      return false;
    }
  }

  setInstallingActivity(version) {
    if (!this.isConnected) return false;

    try {
      this.rpc.setActivity(this.createBaseActivity({
        details: 'Installing Minecraft',
        state: `Version: ${version}`,
        startTimestamp: new Date(),
        smallImageKey: ASSETS.DOWNLOAD,
        smallImageText: 'Installing...'
      }));
      return true;
    } catch (error) {
      console.error('Failed to set installing activity:', error);
      return false;
    }
  }

  shutdown() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    if (this.isConnected) {
      try {
        this.rpc.destroy();
      } catch (error) {
        console.error('Error shutting down Discord RPC:', error);
      } finally {
        this.isConnected = false;
      }
    }
  }
}

module.exports = new DiscordRPCClient();