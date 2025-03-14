const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');
const MinecraftInstaller = require('./minecraft-installer');

class StandaloneCreator {
    constructor(launcherPath) {
        this.requiredSpace = 1024 * 1024 * 1024;
        this.launcherPath = launcherPath || path.join(process.env.APPDATA, '.alrightlauncher');
    }

    async getInstalledVersions() {
        const versionsPath = path.join(this.launcherPath, 'versions');
        try {
            const dirs = await fs.readdir(versionsPath);
            const installedVersions = [];
            
            for (const dir of dirs) {
                const versionJsonPath = path.join(versionsPath, dir, `${dir}.json`);
                const versionJarPath = path.join(versionsPath, dir, `${dir}.jar`);
                
                if (await fs.pathExists(versionJsonPath) && await fs.pathExists(versionJarPath)) {
                    installedVersions.push(dir);
                }
            }
            
            return installedVersions;
        } catch (error) {
            logger.error(`Failed to get installed versions from ${versionsPath}: ${error}`);
            return [];
        }
    }

    async createStandalone(targetPath, versions, javaPath) {
        try {
            logger.info('Starting standalone creation...');
            logger.info(`Using launcher path: ${this.launcherPath}`);
            
            // Verify versions are installed
            const installedVersions = await this.getInstalledVersions();
            const missingVersions = versions.filter(v => !installedVersions.includes(v));
            
            if (missingVersions.length > 0) {
                throw new Error(`Versions not installed: ${missingVersions.join(', ')}`);
            }

            // Setup directory structure
            const sourcePath = path.dirname(path.dirname(__dirname));
            const targetPaths = {
                root: targetPath,
                minecraft: path.join(targetPath, 'minecraft'),
                launcher: path.join(targetPath, 'launcher')
            };

            // Create directories
            await fs.ensureDir(targetPaths.minecraft);
            await fs.ensureDir(targetPaths.launcher);

            // Copy project files
            logger.info('Copying project files...');
            const filesToCopy = [
                'package.json',
                'package-lock.json',
                '.env',
                '.gitignore',
                'README.md',
                'LICENSE'
            ];

            for (const file of filesToCopy) {
                const sourcefile = path.join(sourcePath, file);
                if (await fs.pathExists(sourcefile)) {
                    await fs.copy(sourcefile, path.join(targetPaths.launcher, file));
                }
            }

            // Copy source code
            await fs.copy(
                path.join(sourcePath, 'src'),
                path.join(targetPaths.launcher, 'src'),
                {
                    filter: (src) => !src.includes('node_modules')
                }
            );

            // Copy Minecraft files
            const foldersToSync = ['versions', 'assets', 'libraries'];
            
            for (const folder of foldersToSync) {
                const sourceFolder = path.join(this.launcherPath, folder);
                const targetFolder = path.join(targetPaths.minecraft, folder);
                
                if (!await fs.pathExists(sourceFolder)) {
                    logger.warn(`Source folder not found: ${sourceFolder}`);
                    continue;
                }

                if (folder === 'versions') {
                    // Only copy selected versions
                    for (const version of versions) {
                        const versionSrc = path.join(sourceFolder, version);
                        const versionDest = path.join(targetFolder, version);
                        if (await fs.pathExists(versionSrc)) {
                            await fs.copy(versionSrc, versionDest);
                        } else {
                            logger.warn(`Version folder not found: ${versionSrc}`);
                        }
                    }
                } else {
                    // Copy entire folder for assets and libraries
                    await fs.copy(sourceFolder, targetFolder);
                }
            }

            // Create standalone config
            const config = {
                versions,
                isStandalone: true,
                minecraftPath: path.join('..', 'minecraft'),
                lastUsername: 'Player',
                offlineMode: true,
                launcherPath: this.launcherPath
            };

            await fs.writeJson(
                path.join(targetPaths.launcher, 'standalone.json'),
                config,
                { spaces: 2 }
            );

            // Create launch scripts
            const scriptContent = process.platform === 'win32'
                ? '@echo off\ncd "%~dp0\\launcher"\nnpm install --omit=dev\nelectron . --minecraft-folder="../minecraft"'
                : '#!/bin/bash\ncd "$(dirname "$0")/launcher"\nnpm install --omit=dev\nelectron . --minecraft-folder="../minecraft"';

            await fs.writeFile(
                path.join(targetPath, process.platform === 'win32' ? 'launch.bat' : 'launch.sh'),
                scriptContent
            );

            if (process.platform !== 'win32') {
                await fs.chmod(path.join(targetPath, 'launch.sh'), '755');
            }

            logger.info('Standalone creation completed successfully');
            return true;

        } catch (error) {
            logger.error(`Standalone creation failed: ${error}`);
            throw error;
        }
    }

    async setupNodeJS() {
        try {
            // Check if Node.js is installed
            await this.executeCommand('node --version');
            logger.info('Node.js is already installed');
        } catch {
            logger.info('Installing Node.js...');
            if (process.platform === 'win32') {
                // Try winget first
                try {
                    await this.executeCommand('winget install OpenJS.NodeJS.LTS');
                } catch {
                    throw new Error('Please install Node.js from https://nodejs.org/');
                }
            } else {
                throw new Error('Please install Node.js from https://nodejs.org/');
            }
        }
    }

    async executeCommand(command, options = {}) {
        return new Promise((resolve, reject) => {
            const proc = require('child_process').exec(command, options, (error, stdout, stderr) => {
                if (error) reject(error);
                else resolve({ stdout, stderr });
            });
        });
    }
}

module.exports = StandaloneCreator;
