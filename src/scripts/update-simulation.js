const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

class UpdateSimulation {
  constructor() {
    this.simulationMode = false;
    this.simulationConfig = null;
    this.configPath = path.join(app.getPath('userData'), 'simulation.json');
    this.loadConfig();
  }

  async loadConfig() {
    try {
      if (await fs.pathExists(this.configPath)) {
        this.simulationConfig = await fs.readJson(this.configPath);
        this.simulationMode = this.simulationConfig.enabled || false;
      } else {
        this.simulationConfig = { enabled: false };
      }
    } catch (error) {
      console.error('Failed to load simulation config:', error);
      this.simulationConfig = { enabled: false };
    }
  }

  async saveConfig() {
    try {
      await fs.writeJson(this.configPath, this.simulationConfig, { spaces: 2 });
    } catch (error) {
      console.error('Failed to save simulation config:', error);
    }
  }

  isEnabled() {
    return this.simulationMode;
  }

  async enable(options = {}) {
    this.simulationMode = true;
    this.simulationConfig = {
      enabled: true,
      version: options.version || '9.9.9',
      channel: options.channel || 'beta',
      failDownload: options.failDownload || false,
      failInstall: options.failInstall || false,
      ...options
    };
    
    await this.saveConfig();

    // Generate the simulated update
    try {
      const simulateUpdate = require('../../scripts/simulate-update');
      simulateUpdate.simulateUpdate({
        version: this.simulationConfig.version,
        channel: this.simulationConfig.channel,
        shouldFail: this.simulationConfig.failDownload
      });
    } catch (error) {
      console.error('Failed to generate simulated update:', error);
    }
    
    return this.simulationConfig;
  }

  async disable() {
    this.simulationMode = false;
    this.simulationConfig = { enabled: false };
    await this.saveConfig();
    
    // Restore the original updates.json
    try {
      const simulateUpdate = require('../../scripts/simulate-update');
      simulateUpdate.restoreUpdatesJson();
    } catch (error) {
      console.error('Failed to restore updates.json:', error);
    }
    
    return this.simulationConfig;
  }

  getConfig() {
    return this.simulationConfig;
  }
}

module.exports = UpdateSimulation;
