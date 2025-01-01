const https = require('https');
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const logger = require('./logger');

class JavaInstaller {
    constructor() {
        // Temurin JRE 17 direct download link
        this.downloadUrl = "https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.9%2B9/OpenJDK17U-jre_x64_windows_hotspot_17.0.9_9.msi";
    }

    async downloadFile(destination, progressCallback) {
        return new Promise((resolve, reject) => {
            logger.info(`Starting download from: ${this.downloadUrl}`);
            const file = fs.createWriteStream(destination);
            let receivedBytes = 0;

            const handleResponse = (response) => {
                const totalBytes = parseInt(response.headers['content-length'], 10);
                
                response.on('data', (chunk) => {
                    receivedBytes += chunk.length;
                    if (progressCallback && totalBytes) {
                        progressCallback({
                            type: 'download',
                            progress: (receivedBytes / totalBytes) * 100
                        });
                    }
                });

                response.pipe(file);

                file.on('finish', () => {
                    file.close();
                    logger.info('Download completed successfully');
                    resolve(destination);
                });

                file.on('error', (err) => {
                    fs.unlink(destination, () => {});
                    reject(err);
                });
            };

            const request = https.get(this.downloadUrl, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    logger.info(`Following redirect to: ${response.headers.location}`);
                    https.get(response.headers.location, handleResponse)
                        .on('error', (err) => {
                            fs.unlink(destination, () => {});
                            reject(err);
                        });
                } else if (response.statusCode === 200) {
                    handleResponse(response);
                } else {
                    reject(new Error(`Server returned ${response.statusCode}`));
                }
            });

            request.on('error', (err) => {
                fs.unlink(destination, () => {});
                reject(err);
            });
        });
    }

    async install(progressCallback) {
        try {
            logger.info('Starting Java installation process');
            progressCallback?.({ type: 'status', message: 'Downloading Java...' });

            const installerPath = path.join(process.env.TEMP, 'java_installer.msi');
            await this.downloadFile(installerPath, progressCallback);

            progressCallback?.({ type: 'status', message: 'Download completed. Please install manually.' });
            logger.info('Download completed. Please install manually.');

            // Open the downloaded file location
            shell.showItemInFolder(installerPath);

            return true;
        } catch (error) {
            logger.error(`Installation process failed: ${error.message}`);
            throw error;
        }
    }
}

module.exports = JavaInstaller;
