const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const FileVerifier = require('./fileVerifier');
const logger = require('./logger');

class VersionManager {
    constructor(minecraftDir) {
        this.minecraftDir = minecraftDir || path.join(process.env.APPDATA, '.alrightlauncher', 'minecraft');
        this.verifier = new FileVerifier(this.minecraftDir);
        
        // Ensure core directories exist
        this.ensureDirectories();
        
        // Don't register IPC handlers here anymore - moved to main process
    }

    ensureDirectories() {
        const dirs = [
            path.join(this.minecraftDir, 'versions'),
            path.join(this.minecraftDir, 'assets'),
            path.join(this.minecraftDir, 'libraries'),
            path.join(this.minecraftDir, 'crash-reports'),
            path.join(this.minecraftDir, 'logs')
        ];
        
        dirs.forEach(dir => {
            fs.ensureDirSync(dir);
            console.log(`Directory created/verified: ${dir}`);
        });
    }

    async getInstalledVersions() {
        try {
            logger.info('Getting installed versions from version manager');
            return await this.verifier.getInstalledVersions();
        } catch (error) {
            logger.error('Failed to get installed versions:', error.message);
            return [];
        }
    }

    async verifyGameFiles(version) {
        try {
            logger.info(`Verifying files for ${version}`);
            return await this.verifier.verifyFiles(version);
        } catch (error) {
            logger.error(`Failed to verify files for ${version}:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async getFileStatus(version) {
        try {
            return await this.verifier.getFileStatus(version);
        } catch (error) {
            logger.error(`Failed to get file status for ${version}:`, error.message);
            return {
                error: error.message
            };
        }
    }

    async generateChecksums(version) {
        try {
            logger.info(`Generating checksums for ${version}`);
            return await this.verifier.generateChecksums(version);
        } catch (error) {
            logger.error(`Failed to generate checksums for ${version}:`, error.message);
            return null;
        }
    }

    // Call this when a version is successfully downloaded/installed
    async onVersionInstalled(version) {
        logger.info(`Version ${version} installed, generating checksums`);
        return this.generateChecksums(version);
    }
}

module.exports = VersionManager;
