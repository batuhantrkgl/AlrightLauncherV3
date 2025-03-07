const { app, BrowserWindow, dialog } = require('electron');
const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
const { spawn } = require('child_process');
const logger = require('./logger');
const { createHash } = require('crypto');

class UpdateService {
    constructor() {
        this.updateUrl = 'https://raw.githubusercontent.com/batuhantrkgl/AlrightLauncher/main/updates.json';
        this.updateDir = path.join(app.getPath('temp'), 'alrightlauncher-updates');
        this.isChecking = false;
        this.isDownloading = false;
        this.downloadProgress = 0;
        this.currentVersion = app.getVersion();
        fs.ensureDirSync(this.updateDir);
    }

    async checkForUpdates(channel = 'stable') {
        if (this.isChecking) return { checking: true };
        
        try {
            this.isChecking = true;
            logger.info(`Checking for updates in ${channel} channel`);
            
            const response = await fetch(this.updateUrl, { 
                timeout: 10000,
                headers: { 'Cache-Control': 'no-cache' }
            });
            
            if (!response.ok) throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
            
            const updateData = await response.json();
            this.isChecking = false;
            
            const channelData = updateData[channel] || updateData.stable;
            if (!channelData) throw new Error('Update channel not found');
            
            const remoteVersion = channelData.version;
            const updateAvailable = this.compareVersions(this.currentVersion, remoteVersion) < 0;
            
            logger.info(`Update check complete. Current: ${this.currentVersion}, Remote: ${remoteVersion}, Available: ${updateAvailable}`);
            
            return {
                currentVersion: this.currentVersion,
                remoteVersion: remoteVersion,
                updateAvailable,
                releaseNotes: channelData.releaseNotes,
                downloadUrl: channelData.downloadUrl,
                sha256: channelData.sha256,
                channel
            };
        } catch (error) {
            this.isChecking = false;
            logger.error('Update check failed:', error.message);
            return { 
                error: error.message,
                currentVersion: this.currentVersion 
            };
        }
    }

    async downloadUpdate(updateInfo) {
        if (this.isDownloading) return { downloading: true, progress: this.downloadProgress };
        
        try {
            this.isDownloading = true;
            this.downloadProgress = 0;
            
            logger.info(`Downloading update from ${updateInfo.downloadUrl}`);
            
            // Create download directory
            await fs.ensureDir(this.updateDir);
            
            // Determine file extension from URL
            const fileExtension = path.extname(updateInfo.downloadUrl) || '.exe';
            const downloadPath = path.join(this.updateDir, `update${fileExtension}`);
            
            // Delete any existing update file
            if (await fs.pathExists(downloadPath)) {
                await fs.unlink(downloadPath);
            }
            
            // Download the file
            const response = await fetch(updateInfo.downloadUrl);
            
            if (!response.ok) {
                throw new Error(`Server responded with ${response.status}: ${response.statusText}`);
            }
            
            const totalSize = parseInt(response.headers.get('content-length') || '0', 10);
            let downloadedSize = 0;
            
            const fileStream = fs.createWriteStream(downloadPath);
            
            return new Promise((resolve, reject) => {
                response.body.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (totalSize > 0) {
                        this.downloadProgress = Math.round((downloadedSize / totalSize) * 100);
                        this.notifyDownloadProgress(this.downloadProgress);
                    }
                });
                
                response.body.pipe(fileStream);
                
                fileStream.on('finish', async () => {
                    fileStream.close();
                    
                    try {
                        // Verify file hash if provided
                        if (updateInfo.sha256) {
                            logger.info('Verifying download integrity...');
                            const fileHash = await this.calculateHash(downloadPath);
                            
                            if (fileHash !== updateInfo.sha256) {
                                throw new Error(`Hash verification failed. Expected: ${updateInfo.sha256}, Got: ${fileHash}`);
                            }
                            logger.info('File integrity verified successfully');
                        }
                        
                        this.isDownloading = false;
                        this.downloadProgress = 100;
                        logger.info('Update downloaded successfully');
                        
                        resolve({
                            success: true,
                            downloadPath,
                            version: updateInfo.remoteVersion
                        });
                    } catch (error) {
                        this.isDownloading = false;
                        reject(error);
                    }
                });
                
                fileStream.on('error', (err) => {
                    this.isDownloading = false;
                    fs.unlink(downloadPath, () => {});
                    reject(err);
                });
            });
        } catch (error) {
            this.isDownloading = false;
            logger.error('Download failed:', error.message);
            return { error: error.message };
        }
    }
    
    async installUpdate(updateInfo) {
        try {
            logger.info(`Installing update: ${updateInfo.version} from ${updateInfo.downloadPath}`);
            
            // Different installation methods based on platform
            if (process.platform === 'win32') {
                await this.installUpdateWindows(updateInfo.downloadPath);
            } else if (process.platform === 'darwin') {
                await this.installUpdateMacOS(updateInfo.downloadPath);
            } else {
                await this.installUpdateLinux(updateInfo.downloadPath);
            }
            
            return { success: true };
        } catch (error) {
            logger.error('Installation failed:', error.message);
            return { error: error.message };
        }
    }
    
    async installUpdateWindows(filePath) {
        // For .exe installers
        if (path.extname(filePath) === '.exe') {
            // Spawn the installer and quit this app
            spawn(filePath, ['/SILENT'], { detached: true });
            app.quit();
            return;
        }
        
        // For .zip files, need to extract them
        if (path.extname(filePath) === '.zip') {
            throw new Error('ZIP installation not implemented yet');
        }
        
        throw new Error(`Unsupported update file format: ${path.extname(filePath)}`);
    }
    
    async installUpdateMacOS(filePath) {
        // macOS implementation
        throw new Error('macOS update installation not implemented');
    }
    
    async installUpdateLinux(filePath) {
        // Linux implementation
        throw new Error('Linux update installation not implemented');
    }
    
    // Helper method to calculate SHA-256 hash
    async calculateHash(filePath) {
        return new Promise((resolve, reject) => {
            try {
                const hash = createHash('sha256');
                const stream = fs.createReadStream(filePath);
                
                stream.on('data', (data) => hash.update(data));
                stream.on('end', () => resolve(hash.digest('hex')));
                stream.on('error', reject);
            } catch (error) {
                reject(error);
            }
        });
    }
    
    // Compare versions (semver-like)
    compareVersions(a, b) {
        const aParts = a.split('.').map(part => parseInt(part, 10));
        const bParts = b.split('.').map(part => parseInt(part, 10));
        
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const aVal = i < aParts.length ? aParts[i] : 0;
            const bVal = i < bParts.length ? bParts[i] : 0;
            
            if (aVal !== bVal) {
                return aVal - bVal; // positive if a > b, negative if a < b
            }
        }
        
        return 0; // versions are equal
    }
    
    // Notify all windows about download progress
    notifyDownloadProgress(progress) {
        BrowserWindow.getAllWindows().forEach(window => {
            if (!window.isDestroyed()) {
                window.webContents.send('update-download-progress', { progress });
            }
        });
    }
}

module.exports = UpdateService;
