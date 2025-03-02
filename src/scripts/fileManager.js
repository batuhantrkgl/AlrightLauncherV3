const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const { app } = require('electron');
const VersionManager = require('./versionManager');
const logger = require('./logger');

class FileManager {
    constructor(minecraftDir) {
        this.minecraftDir = minecraftDir || path.join(process.env.APPDATA, '.alrightlauncher', 'minecraft');
        this.versionManager = new VersionManager(this.minecraftDir);
    }

    async getInstalledVersions() {
        try {
            logger.info('Getting installed versions');
            return await this.versionManager.getInstalledVersions();
        } catch (error) {
            logger.error('Failed to get installed versions:', error.message);
            return [];
        }
    }

    async verifyGameFiles(version) {
        try {
            logger.info(`Verifying game files for ${version}`);
            return await this.versionManager.verifyGameFiles(version);
        } catch (error) {
            logger.error(`Failed to verify game files for ${version}:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getFileStatus(version) {
        try {
            logger.info(`Getting file status for ${version}`);
            return await this.versionManager.getFileStatus(version);
        } catch (error) {
            logger.error(`Failed to get file status for ${version}:`, error.message);
            return {
                error: error.message
            };
        }
    }

    async downloadJava(url) {
        return new Promise((resolve, reject) => {
            logger.info(`Downloading Java from ${url}`);
            
            // Create download directory
            const downloadDir = path.join(app.getPath('temp'), 'alrightlauncher');
            fs.ensureDirSync(downloadDir);
            
            const filePath = path.join(downloadDir, 'jdk-installer.msi');
            const file = fs.createWriteStream(filePath);
            
            // Download the file
            https.get(url, { 
                rejectUnauthorized: false, 
                headers: { 'User-Agent': 'AlrightLauncher' } 
            }, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Server responded with status code: ${response.statusCode}`));
                    return;
                }
                
                // Pipe the download to the file
                response.pipe(file);
                
                // Handle completion
                file.on('finish', () => {
                    file.close();
                    logger.info('Java download completed, launching installer');
                    
                    // Launch installer
                    const { spawn } = require('child_process');
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
                    
                    installer.unref();
                    resolve(true);
                });
            }).on('error', (err) => {
                fs.unlink(filePath, () => {}); // Delete the file on error
                logger.error('Download failed:', err);
                reject(err);
            });
        });
    }
}

module.exports = FileManager;
