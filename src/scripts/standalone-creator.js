const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');
const MinecraftInstaller = require('./minecraft-installer');
const MinecraftLauncher = require('./minecraft-launcher');
const cliProgress = require('cli-progress');

class StandaloneCreator {
    constructor() {
        this.requiredSpace = 1024 * 1024 * 1024; // 1GB minimum per version
        this.progressBar = null;
    }

    updateProgress(action, percent, details = '') {
        if (!this.progressBar) {
            this.progressBar = new cliProgress.SingleBar({
                format: `${action} |{bar}| {percentage}% | {details}`,
                barCompleteChar: '\u2588',
                barIncompleteChar: '\u2591',
                hideCursor: true,
                clearOnComplete: true
            });
            this.progressBar.start(100, 0, { details });
        }
        this.progressBar.update(percent, { details });
        if (percent >= 100) {
            this.progressBar.stop();
            this.progressBar = null;
        }
    }

    async copyWithProgress(src, dest, description) {
        const stats = await fs.stat(src);
        let copied = 0;

        await fs.copy(src, dest, {
            filter: (src, dest) => {
                copied += 1;
                const percent = Math.min(100, Math.round((copied / stats.size) * 100));
                this.updateProgress('Copying', percent, description);
                return true;
            }
        });
    }

    async installVersion(version, targetDir, installer) {
        logger.info(`Installing version ${version} to ${targetDir}`);
        
        // Create version directory
        const versionDir = path.join(targetDir, 'minecraft', 'versions', version);
        await fs.ensureDir(versionDir);

        // Install the version
        const success = await installer.installVersion(version, targetDir);
        if (!success) {
            throw new Error(`Failed to install version ${version}`);
        }

        logger.info(`Successfully installed version ${version}`);
        return true;
    }

    async testVersion(version, targetDir, javaPath) {
        logger.info(`Testing version ${version}`);
        
        const testLauncher = new MinecraftLauncher(path.join(targetDir, 'minecraft'));
        testLauncher.javaPath = javaPath;

        return new Promise(async (resolve) => {
            try {
                // Launch the game
                const process = await testLauncher.launch(version, 'TestUser', true);
                
                // Set timeout to kill the process after 10 seconds
                setTimeout(() => {
                    try {
                        process.kill();
                        logger.info(`Successfully tested version ${version}`);
                        resolve(true);
                    } catch (err) {
                        logger.error(`Error killing test process for ${version}: ${err.message}`);
                        resolve(false);
                    }
                }, 10000);

                // Handle process errors
                process.on('error', (err) => {
                    logger.error(`Test launch error for ${version}: ${err.message}`);
                    resolve(false);
                });
            } catch (error) {
                logger.error(`Failed to test version ${version}: ${error.message}`);
                resolve(false);
            }
        });
    }

    async createStandalone(targetPath, versions, javaPath) {
        try {
            logger.info(`Starting standalone creation at: ${targetPath} for versions: ${versions.join(', ')}`);
            let totalSteps = versions.length * 2 + 3; // Download + Install per version + Java + Launcher + Config
            let currentStep = 0;
            
            // Create directory structure
            this.updateProgress('Creating directories', 0, 'Setting up folder structure');
            const paths = {
                minecraft: path.join(targetPath, 'minecraft'),
                java: path.join(targetPath, 'java'),
                launcher: path.join(targetPath, 'launcher'),
                config: path.join(targetPath, 'config')
            };

            // Create directories
            for (const dir of Object.values(paths)) {
                await fs.ensureDir(dir);
                logger.info(`Created directory: ${dir}`);
            }

            currentStep++;
            this.updateProgress('Setup', (currentStep / totalSteps) * 100, 'Directories created');

            // Create minecraft installer instance
            const installer = new MinecraftInstaller();
            installer.baseDir = paths.minecraft; // Override base directory

            // Install versions one by one
            for (const version of versions) {
                this.updateProgress('Installing', ((++currentStep) / totalSteps) * 100, `Installing ${version}`);
                logger.info(`Starting installation of version ${version}`);
                await this.installVersion(version, targetPath, installer);
                logger.info(`Installed version ${version}`);
            }

            // Copy Java runtime
            this.updateProgress('Copying Java', ((++currentStep) / totalSteps) * 100, 'Copying Java runtime');
            logger.info('Copying Java runtime...');
            await this.copyWithProgress(
                path.dirname(path.dirname(javaPath)),
                paths.java,
                'Copying Java files'
            );

            // Copy launcher files
            this.updateProgress('Copying Launcher', ((++currentStep) / totalSteps) * 100, 'Copying launcher files');
            logger.info('Copying launcher files...');
            const launcherFiles = [
                'index.html', 'styles.css', 'renderer.js', 'main.js', 'preload.js',
                'minecraft-launcher.js', 'minecraft-installer.js', 'logger.js',
                'standalone-creator.js'
            ];
            
            for (const file of launcherFiles) {
                await fs.copy(
                    path.join(__dirname, file),
                    path.join(paths.launcher, file)
                );
            }

            // Create standalone config
            this.updateProgress('Finalizing', 100, 'Creating configuration');
            await fs.writeJson(
                path.join(paths.config, 'standalone.json'),
                {
                    versions,
                    javaPath: path.join('..', 'java', 'bin', 'java.exe'),
                    isStandalone: true,
                    minecraftPath: path.join('..', 'minecraft'),
                    lastUsername: 'Player'
                },
                { spaces: 2 }
            );

            // Test all versions
            logger.info('Testing installed versions...');
            for (const version of versions) {
                const testResult = await this.testVersion(version, targetPath, javaPath);
                if (!testResult) {
                    logger.warn(`Version ${version} test failed - it may not work properly`);
                }
            }

            // Create launch scripts
            const scriptContent = process.platform === 'win32' 
                ? '@echo off\ncd launcher\nstart "" electron .'
                : '#!/bin/bash\ncd launcher\nelectron .';

            await fs.writeFile(
                path.join(targetPath, process.platform === 'win32' ? 'launch.bat' : 'launch.sh'),
                scriptContent
            );

            logger.info('Standalone creation completed successfully');
            return true;

        } catch (error) {
            logger.error(`Standalone creation failed: ${error.message}`);
            throw error;
        }
    }
}

module.exports = StandaloneCreator;
