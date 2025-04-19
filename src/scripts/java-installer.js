const https = require('https');
const fs = require('fs-extra'); // Using fs-extra for better file operations
const path = require('path');
const { shell } = require('electron');
const logger = require('./logger');

class JavaInstaller {
    constructor(options = {}) {
        // Allow configuration through options with sensible defaults
        this.downloadUrl = options.downloadUrl || 
            "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.9%2B9/OpenJDK17U-jre_x64_windows_hotspot_17.0.9_9.msi";
        this.installerFileName = options.installerFileName || 'java_installer.msi';
        this.tempDir = options.tempDir || process.env.TEMP || path.join(require('os').tmpdir());
        this.timeout = options.timeout || 30000; // 30 seconds timeout for network requests
    }

    /**
     * Downloads a file from the specified URL to the destination path
     * @param {string} destination - The path where the file will be saved
     * @param {Function} progressCallback - Optional callback for progress updates
     * @returns {Promise<string>} - Resolves with the destination path when complete
     */
    async downloadFile(destination, progressCallback) {
        return new Promise((resolve, reject) => {
            // Ensure the directory exists
            const destinationDir = path.dirname(destination);
            fs.ensureDirSync(destinationDir);

            logger.info(`Starting download from: ${this.downloadUrl}`);
            const file = fs.createWriteStream(destination);
            let receivedBytes = 0;
            let totalBytes = 0;

            const handleResponse = (response) => {
                if (response.statusCode !== 200) {
                    file.close();
                    fs.removeSync(destination);
                    return reject(new Error(`Server returned ${response.statusCode}: ${response.statusMessage}`));
                }

                totalBytes = parseInt(response.headers['content-length'], 10) || 0;
                
                response.on('data', (chunk) => {
                    receivedBytes += chunk.length;
                    if (progressCallback && totalBytes) {
                        const percentComplete = totalBytes ? (receivedBytes / totalBytes) * 100 : 0;
                        progressCallback({
                            type: 'download',
                            progress: percentComplete,
                            receivedBytes,
                            totalBytes
                        });
                    }
                });

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    logger.info(`Download completed successfully: ${destination}`);
                    resolve(destination);
                });
            };

            const request = https.get(this.downloadUrl, { timeout: this.timeout }, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    // Handle redirects
                    const redirectUrl = response.headers.location;
                    logger.info(`Following redirect to: ${redirectUrl}`);
                    
                    // Abort current request
                    request.abort();
                    
                    // Follow the redirect
                    https.get(redirectUrl, { timeout: this.timeout }, handleResponse)
                        .on('error', (err) => {
                            file.close();
                            fs.removeSync(destination);
                            reject(new Error(`Redirect failed: ${err.message}`));
                        });
                } else if (response.statusCode === 200) {
                    handleResponse(response);
                } else {
                    file.close();
                    fs.removeSync(destination);
                    reject(new Error(`Server returned ${response.statusCode}: ${response.statusMessage}`));
                }
            });

            request.on('error', (err) => {
                file.close();
                fs.removeSync(destination);
                reject(new Error(`Download failed: ${err.message}`));
            });

            request.on('timeout', () => {
                request.abort();
                file.close();
                fs.removeSync(destination);
                reject(new Error(`Download timed out after ${this.timeout}ms`));
            });

            // Handle errors on the file stream
            file.on('error', (err) => {
                file.close();
                fs.removeSync(destination);
                reject(new Error(`File write error: ${err.message}`));
            });
        });
    }

    /**
     * Verifies if the downloaded file exists and has content
     * @param {string} filePath - Path to the file to verify
     * @returns {Promise<boolean>} - Whether the file is valid
     */
    async verifyDownload(filePath) {
        try {
            const stats = await fs.stat(filePath);
            return stats.isFile() && stats.size > 0;
        } catch (error) {
            logger.error(`File verification failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Installs Java by downloading and launching the installer
     * @param {Function} progressCallback - Optional callback for progress updates
     * @returns {Promise<boolean>} - Resolves with true when installation process completes
     */
    async install(progressCallback) {
        const installerPath = path.join(this.tempDir, this.installerFileName);
        
        try {
            logger.info('Starting Java installation process');
            progressCallback?.({ type: 'status', message: 'Downloading Java...' });

            // Check if installer already exists and remove it
            if (await fs.pathExists(installerPath)) {
                await fs.remove(installerPath);
                logger.info('Removed existing installer file');
            }

            // Download the installer
            await this.downloadFile(installerPath, progressCallback);
            
            // Verify the download succeeded
            if (!(await this.verifyDownload(installerPath))) {
                throw new Error('Downloaded file is invalid or corrupt');
            }

            progressCallback?.({ 
                type: 'status', 
                message: 'Download completed. Please install manually.' 
            });
            
            // Open the downloaded file location
            shell.showItemInFolder(installerPath);
            
            return true;
        } catch (error) {
            logger.error(`Installation process failed: ${error.message}`);
            
            // Clean up any partial downloads
            try {
                if (await fs.pathExists(installerPath)) {
                    await fs.remove(installerPath);
                }
            } catch (cleanupError) {
                logger.error(`Failed to clean up installer file: ${cleanupError.message}`);
            }
            
            progressCallback?.({ 
                type: 'error', 
                message: `Installation failed: ${error.message}` 
            });
            
            throw error;
        }
    }
}

module.exports = JavaInstaller;