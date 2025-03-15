const { app, BrowserWindow } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');
const { spawn } = require('child_process');
const UpdateSimulation = require('./update-simulation');

class UpdateService {
  constructor() {
    this.logger = require('./logger');
    this.baseUrl = 'https://github.com/batuhantrkgl/AlrightLauncherV3';
    this.updateSimulation = new UpdateSimulation();
    
    // Load the current version from package.json
    this.currentVersion = app.getVersion();
    this.logger.info(`Current version: ${this.currentVersion}`);
    
    // Initialize update check interval (defaulting to 1 hour)
    this.checkInterval = 60 * 60 * 1000; // 1 hour
    this.lastCheck = 0;
  }

  async checkForUpdates(channel = 'stable') {
    try {
      this.logger.info(`Checking for updates in ${channel} channel`);
      
      // If we're in simulation mode, log that
      if (this.updateSimulation.isEnabled()) {
        this.logger.info('Update simulation mode is enabled');
      }
      
      // Don't check too frequently
      const now = Date.now();
      if (now - this.lastCheck < 30000) { // 30 seconds
        this.logger.info('Update check throttled. Try again later.');
        return { updateAvailable: false, throttled: true };
      }
      this.lastCheck = now;

      // Fetch updates.json
      const updatesJsonPath = path.join(app.getAppPath(), 'updates.json');
      let updates;
      
      try {
        updates = await fs.readJson(updatesJsonPath);
      } catch (error) {
        this.logger.error('Failed to read updates.json:', error);
        return { updateAvailable: false, error: 'Failed to read updates.json' };
      }
      
      // Get update info for the requested channel
      const updateInfo = updates[channel];
      if (!updateInfo) {
        this.logger.warn(`No update information found for ${channel} channel`);
        return { updateAvailable: false, error: `No ${channel} channel found` };
      }
      
      // Compare versions
      const remoteVersion = updateInfo.version;
      const currentVersion = this.currentVersion;
      this.logger.info(`Comparing versions - Current: ${currentVersion}, Remote: ${remoteVersion}`);

      // Check if the remote version is newer than the current version
      if (this.isNewerVersion(remoteVersion, currentVersion) || updateInfo.isSimulated) {
        this.logger.info(`Update available: ${remoteVersion}`);
        
        // Return update information
        return {
          updateAvailable: true,
          currentVersion,
          remoteVersion,
          releaseDate: updateInfo.releaseDate,
          downloadUrl: updateInfo.downloadUrl,
          sha256: updateInfo.sha256,
          releaseNotes: updateInfo.releaseNotes,
          isSimulated: updateInfo.isSimulated || false
        };
      } else {
        this.logger.info('No update available');
        return { updateAvailable: false };
      }
    } catch (error) {
      this.logger.error('Error checking for updates:', error);
      return { updateAvailable: false, error: error.message };
    }
  }

  // Compare version strings
  isNewerVersion(remote, current) {
    if (!remote || !current) return false;
    
    // Handle beta versions specially
    const remoteBeta = remote.includes('beta') || remote.includes('alpha');
    const currentBeta = current.includes('beta') || current.includes('alpha');
    
    // Clean versions to compare numbers
    const cleanVersion = v => v.replace(/[^\d.]/g, '');
    const remoteClean = cleanVersion(remote);
    const currentClean = cleanVersion(current);
    
    // Split into parts for comparison
    const remoteParts = remoteClean.split('.').map(Number);
    const currentParts = currentClean.split('.').map(Number);
    
    // Compare version components
    for (let i = 0; i < Math.max(remoteParts.length, currentParts.length); i++) {
      const r = remoteParts[i] || 0;
      const c = currentParts[i] || 0;
      if (r > c) return true;
      if (r < c) return false;
    }
    
    // If versions are identical, a beta is considered older than a stable
    if (remoteParts.join('.') === currentParts.join('.')) {
      if (!remoteBeta && currentBeta) return true;
    }
    
    return false;
  }

  async downloadUpdate(updateInfo) {
    try {
      this.logger.info(`Downloading update from ${updateInfo.downloadUrl}`);
      
      // Create downloads directory if it doesn't exist
      const downloadsDir = path.join(app.getPath('temp'), 'alrightlauncher-updates');
      await fs.ensureDir(downloadsDir);
      
      const downloadPath = path.join(downloadsDir, `update-${updateInfo.remoteVersion}.exe`);
      this.logger.info(`Download target: ${downloadPath}`);
      
      // If this is a simulated update, handle file URLs properly
      if (updateInfo.isSimulated) {
        this.logger.info('Processing simulated update download');
        
        // If the update is configured to fail download, simulate that
        if (this.updateSimulation.getConfig()?.failDownload) {
          this.logger.info('Simulating download failure');
          throw new Error('Simulated download failure');
        }
        
        // Handle file:// URL for simulated updates
        if (updateInfo.downloadUrl.startsWith('file://')) {
          const filePath = updateInfo.downloadUrl.replace('file://', '');
          
          if (await fs.pathExists(filePath)) {
            await fs.copy(filePath, downloadPath);
            this.logger.info('Simulated update file copied successfully');
          } else {
            throw new Error(`Simulated update file not found: ${filePath}`);
          }
        } else {
          throw new Error('Unsupported URL scheme for simulated update');
        }
      } else {
        // Real download
        const response = await fetch(updateInfo.downloadUrl);
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }
        
        const fileStream = fs.createWriteStream(downloadPath);
        const contentLength = parseInt(response.headers.get('content-length'), 10);
        let downloadedBytes = 0;
        
        return new Promise((resolve, reject) => {
          response.body.pipe(fileStream);
          
          response.body.on('data', (chunk) => {
            downloadedBytes += chunk.length;
            const progress = contentLength ? Math.round((downloadedBytes / contentLength) * 100) : 0;
            
            // Emit progress event
            this.emitProgress(progress);
          });
          
          fileStream.on('finish', () => {
            fileStream.close();
            
            // Verify checksum
            this.verifyDownload(downloadPath, updateInfo.sha256)
              .then(() => {
                resolve({
                  success: true,
                  downloadPath,
                  remoteVersion: updateInfo.remoteVersion,
                  isSimulated: updateInfo.isSimulated
                });
              })
              .catch(reject);
          });
          
          fileStream.on('error', reject);
          response.body.on('error', reject);
        });
      }
      
      // For simulated downloads, we already copied the file, so just verify it
      const verified = await this.verifyDownload(downloadPath, updateInfo.sha256);
      
      return {
        success: true,
        downloadPath,
        remoteVersion: updateInfo.remoteVersion,
        isSimulated: updateInfo.isSimulated
      };
      
    } catch (error) {
      this.logger.error('Update download failed:', error);
      return { success: false, error: error.message };
    }
  }

  async verifyDownload(filePath, expectedHash) {
    try {
      this.logger.info(`Verifying download integrity: ${filePath}`);
      
      // Skip verification for simulated updates if needed
      if (this.updateSimulation.isEnabled() && this.updateSimulation.getConfig()?.skipVerification) {
        this.logger.info('Skipping hash verification for simulated update');
        return true;
      }
      
      return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        const stream = fs.createReadStream(filePath);
        
        stream.on('data', data => hash.update(data));
        stream.on('end', () => {
          const fileHash = hash.digest('hex');
          
          if (fileHash.toLowerCase() === expectedHash.toLowerCase()) {
            this.logger.info('File hash verification successful');
            resolve(true);
          } else {
            this.logger.error(`Hash mismatch. Expected: ${expectedHash}, Got: ${fileHash}`);
            reject(new Error('Hash verification failed'));
          }
        });
        
        stream.on('error', err => {
          this.logger.error('Hash verification error:', err);
          reject(err);
        });
      });
    } catch (error) {
      this.logger.error('Verification failed:', error);
      throw error;
    }
  }

  async installUpdate(updateInfo) {
    try {
      this.logger.info(`Installing update ${updateInfo.remoteVersion}`);
      
      // If this is a simulated update and configured to fail installation
      if (updateInfo.isSimulated && this.updateSimulation.getConfig()?.failInstall) {
        this.logger.info('Simulating installation failure');
        throw new Error('Simulated installation failure');
      }
      
      // For simulated updates, just pretend to install and restart
      if (updateInfo.isSimulated) {
        this.logger.info('This is a simulated update - would normally run installer');
        
        // Wait a moment and then restart the app to simulate the update process
        return new Promise(resolve => {
          setTimeout(() => {
            this.logger.info('Simulated update complete, restarting app');
            app.relaunch();
            app.exit(0);
            resolve({ success: true });
          }, 2000);
        });
      }
      
      // For real updates, start the installer
      return new Promise((resolve, reject) => {
        const installer = spawn(updateInfo.downloadPath, ['--updated'], {
          detached: true,
          stdio: 'ignore'
        });
        
        installer.unref();
        
        // We assume the installer will close the current app
        setTimeout(() => {
          this.logger.info('Quitting app for update installation');
          resolve({ success: true });
          app.quit();
        }, 1000);
      });
    } catch (error) {
      this.logger.error('Update installation failed:', error);
      return { success: false, error: error.message };
    }
  }

  emitProgress(progress) {
    try {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        const mainWindow = windows[0];
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update-download-progress', { progress });
        }
      }
    } catch (error) {
      this.logger.error('Error emitting progress:', error);
    }
  }

  async toggleSimulationMode(enable, options = {}) {
    if (enable) {
      return await this.updateSimulation.enable(options);
    } else {
      return await this.updateSimulation.disable();
    }
  }
}

module.exports = UpdateService;
