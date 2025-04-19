const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const { app } = require('electron');
const VersionManager = require('./versionManager');
const logger = require('./logger');
const { promisify } = require('util');
const { spawn } = require('child_process');

/**
 * Manages file operations for the Minecraft launcher
 */
class FileManager {
    /**
     * Creates a new FileManager instance
     * @param {string} minecraftDir - Directory for Minecraft files
     */
    constructor(minecraftDir) {
        this.minecraftDir = minecraftDir || path.join(process.env.APPDATA, '.alrightlauncher', 'minecraft');
        this.versionManager = new VersionManager(this.minecraftDir);
        this.tempDir = path.join(app.getPath('temp'), 'alrightlauncher');
        
        // Ensure the temp directory exists
        fs.ensureDirSync(this.tempDir);
    }

    /**
     * Gets a list of installed Minecraft versions
     * @returns {Promise<Array>} List of installed versions
     */
    async getInstalledVersions() {
        try {
            logger.info('Getting installed versions');
            return await this.versionManager.getInstalledVersions();
        } catch (error) {
            logger.error('Failed to get installed versions:', error);
            return [];
        }
    }

    /**
     * Verifies game files for the specified version
     * @param {string} version - Minecraft version to verify
     * @returns {Promise<Object>} Verification result
     */
    async verifyGameFiles(version) {
        if (!version) {
            return {
                success: false,
                error: 'No version specified'
            };
        }

        try {
            logger.info(`Verifying game files for ${version}`);
            return await this.versionManager.verifyGameFiles(version);
        } catch (error) {
            logger.error(`Failed to verify game files for ${version}:`, error);
            return {
                success: false,
                error: error.message || 'Unknown error occurred'
            };
        }
    }

    /**
     * Gets file status for the specified version
     * @param {string} version - Minecraft version to check
     * @returns {Promise<Object>} File status information
     */
    async getFileStatus(version) {
        if (!version) {
            return {
                error: 'No version specified'
            };
        }

        try {
            logger.info(`Getting file status for ${version}`);
            return await this.versionManager.getFileStatus(version);
        } catch (error) {
            logger.error(`Failed to get file status for ${version}:`, error);
            return {
                error: error.message || 'Unknown error occurred'
            };
        }
    }

    /**
     * Downloads and installs Java from the provided URL
     * @param {string} url - URL to the Java installer
     * @returns {Promise<boolean>} Success status
     */
    async downloadJava(url) {
        if (!url) {
            throw new Error('No URL provided for Java download');
        }

        logger.info(`Downloading Java from ${url}`);
        const filePath = path.join(this.tempDir, 'jdk-installer.msi');
        
        try {
            await this.downloadFile(url, filePath);
            logger.info('Java download completed, launching installer');
            
            return await this.launchInstaller(filePath);
        } catch (error) {
            // Clean up the file if it exists
            try {
                await fs.remove(filePath);
            } catch (cleanupError) {
                logger.warn('Failed to clean up installer file:', cleanupError);
            }
            
            logger.error('Java download/installation failed:', error);
            throw error;
        }
    }
    
    /**
     * Downloads a file from a URL to the specified path
     * @private
     * @param {string} url - URL to download from
     * @param {string} destPath - Destination file path
     * @returns {Promise<void>}
     */
    async downloadFile(url, destPath) {
        return new Promise((resolve, reject) => {
            const file = fs.createWriteStream(destPath);
            
            const request = https.get(url, { 
                rejectUnauthorized: false, 
                headers: { 'User-Agent': 'AlrightLauncher' } 
            }, (response) => {
                if (response.statusCode === 302 || response.statusCode === 301) {
                    // Handle redirects
                    this.downloadFile(response.headers.location, destPath)
                        .then(resolve)
                        .catch(reject);
                    return;
                }
                
                if (response.statusCode !== 200) {
                    reject(new Error(`Server responded with status code: ${response.statusCode}`));
                    return;
                }
                
                // Calculate and log download progress
                const totalSize = parseInt(response.headers['content-length'], 10);
                let downloadedSize = 0;
                
                response.on('data', (chunk) => {
                    downloadedSize += chunk.length;
                    if (totalSize) {
                        const progress = Math.round((downloadedSize / totalSize) * 100);
                        if (progress % 10 === 0) { // Log every 10%
                            logger.info(`Download progress: ${progress}%`);
                        }
                    }
                });
                
                // Pipe the download to the file
                response.pipe(file);
                
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
                
                file.on('error', (err) => {
                    fs.unlink(destPath, () => {}); // Delete the file on error
                    reject(err);
                });
            });
            
            request.on('error', (err) => {
                fs.unlink(destPath, () => {}); // Delete the file on error
                reject(err);
            });
            
            // Set timeout for the request
            request.setTimeout(30000, () => {
                request.abort();
                reject(new Error('Download request timed out'));
            });
        });
    }
    
    /**
     * Launches an MSI installer
     * @private
     * @param {string} filePath - Path to the installer file
     * @returns {Promise<boolean>} Success status
     */
    async launchInstaller(filePath) {
        return new Promise((resolve, reject) => {
            const installer = spawn('msiexec', ['/i', filePath], {
                detached: true,
                stdio: 'ignore',
                shell: true,
                windowsHide: false
            });
            
            installer.on('error', (err) => {
                logger.error('Failed to start installer:', err);
                reject(err);
            });
            
            // Detach the process so it continues running independently
            installer.unref();
            resolve(true);
        });
    }
    
    /**
     * Cleans up temporary files and directories
     * @returns {Promise<void>}
     */
    async cleanup() {
        try {
            await fs.emptyDir(this.tempDir);
            logger.info('Temporary files cleaned up');
        } catch (error) {
            logger.warn('Failed to clean up temporary files:', error);
        }
    }
}

module.exports = FileManager;