const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const logger = require('./logger');

class JavaInstaller {
    constructor(options = {}) {
        this.javaVersion = options.javaVersion || 21;
        this.downloadUrl = options.downloadUrl || this._buildPrimaryUrl(this.javaVersion);
        this.fallbackUrl = options.fallbackUrl || this._buildFallbackUrl(this.javaVersion);
        this.installerFileName = options.installerFileName || `java_${this.javaVersion}_installer.msi`;
        this.tempDir = options.tempDir || process.env.TEMP || path.join(require('os').tmpdir());
        this.timeout = options.timeout || 120000;
    }

    _buildPrimaryUrl(version) {
        return `https://api.adoptium.net/v3/installer/latest/${version}/ga/windows/x64/jre/hotspot/normal/eclipse`;
    }

    _buildFallbackUrl(version) {
        // For known versions, use GitHub releases directly
        const knownFallbacks = {
            8: {
                repo: "temurin8-binaries",
                build: "jdk8u402-b06",
                file: "OpenJDK8U-jre_x64_windows_hotspot_8u402b06.msi"
            },
            17: {
                repo: "temurin17-binaries",
                build: "jdk-17.0.9+9",
                file: "OpenJDK17U-jre_x64_windows_hotspot_17.0.9_9.msi"
            },
            21: {
                repo: "temurin21-binaries",
                build: "jdk-21.0.2+13",
                file: "OpenJDK21U-jre_x64_windows_hotspot_21.0.2_13.msi"
            },
            25: {
                repo: "temurin25-binaries",
                build: "jdk-25.0.3+9",
                file: "OpenJDK25U-jre_x64_windows_hotspot_25.0.3_9.msi"
            },
        };
        const fb = knownFallbacks[version];
        if (fb) {
            return `https://github.com/adoptium/${fb.repo}/releases/download/${fb.build}/${fb.file}`;
        }
        // Fall back to the API for unknown versions
        return this._buildPrimaryUrl(version);
    }

    async downloadFile(destination, progressCallback) {
        return new Promise((resolve, reject) => {
            const destinationDir = path.dirname(destination);
            fs.ensureDirSync(destinationDir);

            let receivedBytes = 0;
            let totalBytes = 0;

            const downloadFromUrl = (url, redirectCount = 0) => {
                if (redirectCount > 5) {
                    return reject(new Error('Too many redirects'));
                }

                logger.info(`Starting download from: ${url}`);
                const file = fs.createWriteStream(destination);

                const request = https.get(url, { timeout: this.timeout }, (response) => {
                    if (response.statusCode >= 300 && response.statusCode < 400) {
                        const redirectUrl = response.headers.location;
                        logger.info(`Following redirect to: ${redirectUrl}`);
                        response.resume(); // Drain to free memory
                        file.close();
                        fs.removeSync(destination);
                        if (redirectUrl) {
                            downloadFromUrl(redirectUrl, redirectCount + 1);
                        } else {
                            reject(new Error('Redirect with no location header'));
                        }
                        return;
                    }

                    if (response.statusCode !== 200) {
                        file.close();
                        fs.removeSync(destination);
                        return reject(new Error(`Server returned ${response.statusCode}: ${response.statusMessage}`));
                    }

                    totalBytes = parseInt(response.headers['content-length'], 10) || 0;

                    response.on('data', (chunk) => {
                        receivedBytes += chunk.length;
                        if (progressCallback && totalBytes) {
                            progressCallback({
                                type: 'download',
                                progress: totalBytes ? (receivedBytes / totalBytes) * 100 : 0,
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

                file.on('error', (err) => {
                    file.close();
                    fs.removeSync(destination);
                    reject(new Error(`File write error: ${err.message}`));
                });
            };

            downloadFromUrl(this.downloadUrl);
        });
    }

    async verifyDownload(filePath) {
        try {
            const stats = await fs.stat(filePath);
            return stats.isFile() && stats.size > 0;
        } catch (error) {
            logger.error(`File verification failed: ${error.message}`);
            return false;
        }
    }

    async install(progressCallback) {
        const installerPath = path.join(this.tempDir, this.installerFileName);

        try {
            logger.info(`Starting Java ${this.javaVersion} installation process`);
            progressCallback?.({ type: 'status', message: `Downloading Eclipse Temurin ${this.javaVersion} JRE...` });

            if (await fs.pathExists(installerPath)) {
                await fs.remove(installerPath);
                logger.info('Removed existing installer file');
            }

            try {
                await this.downloadFile(installerPath, progressCallback);
            } catch (downloadError) {
                logger.warn(`Primary download failed: ${downloadError.message}. Trying fallback URL...`);
                progressCallback?.({ type: 'status', message: 'Trying alternative download source...' });
                if (await fs.pathExists(installerPath)) {
                    await fs.remove(installerPath);
                }
                const originalUrl = this.downloadUrl;
                this.downloadUrl = this.fallbackUrl;
                try {
                    await this.downloadFile(installerPath, progressCallback);
                } catch (fallbackError) {
                    // Restore primary URL for retry clarity
                    this.downloadUrl = originalUrl;
                    throw fallbackError;
                }
            }

            if (!(await this.verifyDownload(installerPath))) {
                throw new Error('Downloaded file is invalid or corrupt');
            }

            progressCallback?.({ type: 'status', message: 'Installing Java...' });

            await this.runInstaller(installerPath, progressCallback);

            progressCallback?.({ type: 'status', message: 'Java installation complete!' });

            try {
                await fs.remove(installerPath);
                logger.info('Cleaned up installer file');
            } catch (e) {
                logger.warn(`Failed to clean up installer: ${e.message}`);
            }

            return true;
        } catch (error) {
            logger.error(`Installation process failed: ${error.message}`);

            try {
                if (await fs.pathExists(installerPath)) {
                    await fs.remove(installerPath);
                }
            } catch (cleanupError) {
                logger.error(`Failed to clean up installer file: ${cleanupError.message}`);
            }

            progressCallback?.({ type: 'error', message: `Installation failed: ${error.message}` });

            throw error;
        }
    }

    runInstaller(installerPath, progressCallback) {
        return new Promise((resolve, reject) => {
            const cmd = `Start-Process msiexec -ArgumentList '/i "${installerPath}" /passive /norestart' -Verb RunAs -Wait`;
            logger.info(`Running installer with elevation: ${cmd}`);

            const installer = spawn('powershell', ['-Command', cmd], {
                stdio: 'ignore',
                shell: true
            });

            installer.on('error', (err) => {
                reject(new Error(`Failed to start installer: ${err.message}`));
            });

            installer.on('close', (code) => {
                if (code === 0) {
                    logger.info('MSI installer completed successfully');
                    resolve(true);
                } else {
                    reject(new Error(`Installer exited with code ${code}. Try installing manually.`));
                }
            });

            const timeout = setTimeout(() => {
                reject(new Error('Installation timed out after 5 minutes'));
            }, 300000);
        });
    }
}

module.exports = JavaInstaller;