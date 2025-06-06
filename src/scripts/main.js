const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const MinecraftLauncher = require('./minecraft-launcher');
const MinecraftInstaller = require('./minecraft-installer');
const { checkIcon } = require('./iconTest');
const ServerManager = require('./server-manager');
const MockAuthServer = require('./mock-auth-server');
const FileManager = require('./fileManager');
const UpdateService = require('./update-service');
const logger = require('./logger');
const discordRPC = require('./discord-rpc');
const AuthService = require('./auth-service');
// Import the auth integration module
const { initAuthIntegration } = require('./auth-integration');

// Add this helper function at the top level
function resolveAppPath(relativePath) {
    // First try the development path
    let devPath = path.join(app.getAppPath(), relativePath);
    if (fs.existsSync(devPath)) return devPath;
    
    // Then try the production path
    let prodPath = path.join(process.resourcesPath, relativePath);
    if (fs.existsSync(prodPath)) return prodPath;
    
    // Finally try relative to __dirname
    return path.join(__dirname, '..', relativePath);
}

// Add this at the top level, after the existing imports
function parseCommandLineArgs() {
    const args = process.argv.slice(2);
    let minecraftFolder = null;

    for (const arg of args) {
        if (arg.startsWith('--minecraft-folder=')) {
            minecraftFolder = arg.split('=')[1];
        } else if (arg === '--minecraft-folder' && args[args.indexOf(arg) + 1]) {
            minecraftFolder = args[args.indexOf(arg) + 1];
        }
    }

    return {
        minecraftFolder: minecraftFolder ? path.resolve(minecraftFolder) : null
    };
}

// Replace the existing ensureDirectories function
async function ensureDirectories() {
    const args = parseCommandLineArgs();
    const minecraftDir = args.minecraftFolder || path.join(app.getPath('appData'), '.alrightlauncher');
    
    // Store the minecraft directory path globally
    global.minecraftPath = minecraftDir;
    console.log('Using Minecraft directory:', minecraftDir);

    // Create necessary directories
    const directories = [
        path.join(minecraftDir, 'versions'),
        path.join(minecraftDir, 'assets'),
        path.join(minecraftDir, 'libraries'),
        path.join(minecraftDir, 'crash-reports'),
        path.join(minecraftDir, 'logs')
    ];

    for (const dir of directories) {
        await fs.ensureDir(dir);
        console.log('Directory created/verified:', dir);
    }
}

let mainWindow = null;
let minecraftLauncher = null;
let serverManager = null;
let mockAuthServer = null;
let fileManager = null;
let updateService = null;
let authService = null;
let authCleanup = null; // Add variable to store auth cleanup function

async function registerIpcHandlers() {
    // Clear existing handlers first
    ipcMain.removeHandler('is-fullscreen');
    ipcMain.removeHandler('toggle-fullscreen');

    // Register fullscreen handlers
    ipcMain.handle('is-fullscreen', () => {
        return mainWindow ? mainWindow.isFullScreen() : false;
    });

    ipcMain.handle('toggle-fullscreen', () => {
        if (!mainWindow) return false;
        const currentState = mainWindow.isFullScreen();
        mainWindow.setFullScreen(!currentState);
        return !currentState;
    });

    // Register other handlers
    ipcMain.handle('verify-java', async () => {
        console.log('Verify Java handler called');
        return new Promise((resolve) => {
            try {
                const javaProcess = spawn('java', ['-version']);

                javaProcess.on('error', (error) => {
                    console.log('Java not found:', error);
                    resolve({
                        installed: false,
                        message: 'No Java installed, please install "Temurin 21 JRE" and relaunch.'
                    });
                });

                javaProcess.stderr.on('data', (data) => {
                    console.log('Java version output:', data.toString());
                    resolve({installed: true, version: data.toString()});
                });

                javaProcess.on('close', (code) => {
                    console.log('Java verification process closed with code:', code);
                    if (code !== 0) {
                        resolve({
                            installed: false,
                            message: 'No Java installed, please install "Temurin 21 JRE" and relaunch.'
                        });
                    }
                });
            } catch (error) {
                console.error('Java verification exception:', error);
                resolve({
                    installed: false,
                    message: 'No Java installed, please install "Temurin 21 JRE" and relaunch.'
                });
            }
        });
    });

    ipcMain.handle('get-java-path', async () => {
        console.log('Get Java path handler called');
        return new Promise((resolve) => {
            const command = process.platform === 'win32' ? 'where java' : 'which java';
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.log('Java path error:', error);
                    resolve(null);
                    return;
                }
                resolve(stdout.trim());
            });
        });
    });

    ipcMain.handle('save-dialog', async () => {
        try {
            if (!mainWindow) throw new Error('Main window not initialized');

            const result = await dialog.showSaveDialog(mainWindow, {
                filters: [{name: 'Log Files', extensions: ['log']}],
                defaultPath: path.join(app.getPath('downloads'), 'launcher.log')
            });

            console.log('Save dialog result:', result.filePath);
            return result.filePath;
        } catch (error) {
            console.error('Error in save-dialog handler:', error);
            return null;
        }
    });

    ipcMain.handle('maximize-window', () => {
        if (!mainWindow) return false;
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
        return mainWindow.isMaximized();
    });

    ipcMain.handle('is-maximized', () => mainWindow ? mainWindow.isMaximized() : false);

    // Update the install-version handler
    ipcMain.handle('install-version', async (event, version) => {
        try {
            logger.info(`Starting installation of Minecraft ${version}`);

            // Update Discord RPC status to show installation
            discordRPC.setInstallingActivity(version);

            // Notify renderer that installation has started
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('installation-status', {
                    version,
                    status: 'started',
                    progress: 0
                });
            }

            const installer = new MinecraftInstaller();

            // Set mainWindow reference if your installer needs to send progress updates
            installer.mainWindow = mainWindow;

            // Install the version
            const result = await installer.installVersion(version);

            // Reset Discord RPC after installation completes
            discordRPC.setDefaultActivity();

            // Send final status to renderer
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('installation-status', {
                    version,
                    status: result ? 'completed' : 'error',
                    progress: result ? 100 : 0,
                    error: result ? null : 'Installation failed'
                });
            }

            return result;
        } catch (error) {
            // Reset Discord RPC on error
            discordRPC.setDefaultActivity();

            logger.error(`Installation error for ${version}:`, error);

            // Send error to renderer
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('installation-status', {
                    version,
                    status: 'error',
                    error: error.message
                });
            }

            return false;
        }
    });

    // Make sure mockAuthServer is initialized before the game launch
    if (!mockAuthServer) {
        mockAuthServer = new MockAuthServer(authService || null);
        try {
            await mockAuthServer.start();
            logger.info(`Auth server initialized on port ${await mockAuthServer.getPort()}`);
        } catch (error) {
            logger.error(`Failed to start auth server: ${error.message}`);
            // Continue without auth server - initialize a dummy one or handle the fallback
        }
    }

    ipcMain.handle('launch-game', async (event, options) => {
        try {
            logger.info(`Launch request received for Minecraft ${options.version} with username ${options.username}`);

            // First ensure a profile exists for this version
            const ProfileCreator = require('./profile-creator');
            const profileCreator = new ProfileCreator(global.minecraftPath);

            logger.info(`Ensuring profile exists for version ${options.version}`);
            const profileResult = await profileCreator.ensureProfileExists(options.version);

            if (!profileResult.success) {
                logger.warn(`Could not ensure profile for ${options.version}: ${profileResult.error}`);
                // Continue anyway as this is not critical
            } else if (profileResult.created) {
                logger.info(`Created new profile for ${options.version}: ${profileResult.id}`);
            }

            // Set a timeout for the launch process
            const launchTimeout = setTimeout(() => {
                logger.error(`Launch timed out for Minecraft ${options.version}`);
                throw new Error('Launch operation timed out after 60 seconds');
            }, 60000); // 60 second timeout

            if (!minecraftLauncher) {
                const baseDir = global.minecraftPath;
                minecraftLauncher = new MinecraftLauncher(baseDir);
                logger.info(`Created new MinecraftLauncher instance with baseDir: ${baseDir}`);
            }

            // Determine if we should use online mode
            const useOnlineMode = !options.offline;

            // If online mode is requested, get auth data
            let authData = null;
            if (useOnlineMode) {
                try {
                    authData = await authService.getGameAuthData();
                    if (authData) {
                        logger.info(`Using Microsoft authentication for ${authData.profile.name}`);
                    } else {
                        logger.warn('Failed to get auth data, falling back to offline mode');
                    }
                } catch (error) {
                    logger.error(`Error getting auth data: ${error.message}`);
                }
            }

            logger.info(`Calling minecraftLauncher.launch for ${options.version}...`);
            const result = await minecraftLauncher.launch(options.version, options.username, {
                ...options,
                authData,
                authServer: mockAuthServer,
                offline: !authData // Set offline mode based on whether we have auth data
            });

            // Clear the timeout since we got a response
            clearTimeout(launchTimeout);

            if (!result) {
                logger.error('Launch failed - no result returned');
                return {success: false, error: 'Launch failed - no result returned from launcher'};
            }

            if (!result.success) {
                logger.error(`Launch failed: ${result.error}`);
                return {success: false, error: result.error || 'Unknown launch error'};
            }

            logger.info(`Game launched successfully with PID: ${result.pid || 'unknown'}`);

            // Update Discord RPC when game launches
            if (result.success) {
                discordRPC.setPlayingActivity(options.version);
            }

            // Monitor for crashes
            if (result.process) {
                // Store the version with the process object to use it in the close event handler
                result.process.gameVersion = options.version;

                result.process.on('exit', async (code) => {
                    // Use the stored version property instead of relying on a closure variable
                    const gameVersion = result.process.gameVersion || 'unknown';
                    logger.info(`Game process exited with code ${code} for version ${gameVersion}`);

                    // Reset Discord RPC status when game exits
                    discordRPC.setDefaultActivity();

                    // Check for crash reports only on abnormal exits
                    if (code !== 0) {
                        try {
                            // Use the stored game version here
                            const crashReportFound = await checkForCrashReport(gameVersion);
                            if (crashReportFound) {
                                logger.info('Crash report was found and sent to renderer');
                            }
                        } catch (err) {
                            logger.error(`Error checking crash reports: ${err.message}`);
                        }
                    }

                    // Always send game-closed event with the correct version from the process object
                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('game-closed', {
                            version: gameVersion,
                            code,
                            message: code === 0 ? 'normal exit' : 'error exit'
                        });
                    }
                });

                return {success: true, pid: result.pid || 0};
            } else {
                logger.warn('Game launched but no process object was returned');
                return {success: true, warning: 'No process handle available'};
            }
        } catch (error) {
            logger.error(`Launch error: ${error.message}`);
            logger.error(error.stack);
            return {success: false, error: error.message};
        }
    });

    // Helper function to check for crash reports
    async function checkForCrashReport(version) {
        try {
            // Check multiple possible crash report locations
            const crashLocations = [
                path.join(global.minecraftPath, 'crash-reports'),
                path.join(process.cwd(), 'crash-reports')
            ];

            for (const crashDir of crashLocations) {
                // Ensure crash directory exists
                await fs.ensureDir(crashDir);

                const files = await fs.readdir(crashDir);
                if (files.length > 0) {
                    // Get the most recent crash file
                    const latestCrash = files
                        .map(file => ({
                            name: file,
                            path: path.join(crashDir, file),
                            time: fs.statSync(path.join(crashDir, file)).mtime
                        }))
                        .sort((a, b) => b.time - a.time)[0];

                    if (latestCrash && Date.now() - latestCrash.time < 5000) {
                        // Only if crash file is recent (within 5 seconds)
                        const crashContent = await fs.readFile(latestCrash.path, 'utf8');
                        if (mainWindow && !mainWindow.isDestroyed()) {
                            mainWindow.webContents.send('game-crashed', {
                                version,
                                crashFile: latestCrash.name,
                                crashContent: crashContent
                            });
                            return true;
                        }
                    }
                }
            }
            return false;
        } catch (error) {
            logger.error(`Error checking crash reports: ${error.message}`);
            return false;
        }
    }

    ipcMain.handle('get-versions', async () => {
        try {
            const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();

            // Sort versions by version ID (newest first)
            data.versions.sort((a, b) => compareVersions(a.id, b.id));

            return data.versions;
        } catch (error) {
            console.error('Error fetching versions:', error);
            return [];
        }
    });

    ipcMain.handle('create-standalone', async (event, {version, launcherPath}) => {
        try {
            const StandaloneCreator = require('./standalone-creator');
            // Use the custom minecraft path
            const creator = new StandaloneCreator(global.minecraftPath);

            // Create AOS directory if it doesn't exist
            const defaultPath = path.join(process.env.USERPROFILE, 'Desktop', 'AOS');
            await fs.ensureDir(defaultPath);

            // Show folder selection dialog
            const result = await dialog.showOpenDialog(mainWindow, {
                title: 'Select Installation Directory',
                defaultPath: defaultPath,
                properties: ['openDirectory', 'createDirectory'],
                buttonLabel: 'Select Directory',
                message: 'Choose where to create the standalone version'
            });

            if (result.canceled) {
                return {success: false, reason: 'cancelled'};
            }

            const selectedPath = result.filePaths[0];
            console.log('Selected directory:', selectedPath);
            console.log('Using launcher path:', launcherPath);

            // Create standalone version
            await creator.createStandalone(selectedPath, [version], null); // Java path is optional in offline mode
            return {success: true};

        } catch (error) {
            console.error('Failed to create standalone:', error);
            return {
                success: false,
                reason: 'error',
                error: error.message
            };
        }
    });

    ipcMain.handle('is-game-running', async (event, version) => {
        try {
            if (!minecraftLauncher) return false;
            return minecraftLauncher.isGameRunning(version);
        } catch (error) {
            console.error('Error checking game status:', error);
            return false;
        }
    });

    // Add server-related handlers
    ipcMain.handle('create-server', async (event, options) => {
        try {
            if (!serverManager) {
                serverManager = new ServerManager(global.minecraftPath);
                await serverManager.initialize();
            }
            return await serverManager.createServer(options);
        } catch (error) {
            console.error('Server creation error:', error);
            return {error: error.message};
        }
    });

    ipcMain.handle('start-server', async (event, {name, memory}) => {
        try {
            if (!serverManager) return {error: 'Server manager not initialized'};
            return await serverManager.startServer(name, memory);
        } catch (error) {
            console.error('Server start error:', error);
            return {error: error.message};
        }
    });

    ipcMain.handle('stop-server', async (event, name) => {
        try {
            if (!serverManager) return false;
            return serverManager.stopServer(name);
        } catch (error) {
            console.error('Server stop error:', error);
            return false;
        }
    });

    ipcMain.handle('get-servers', async () => {
        try {
            if (!serverManager) {
                serverManager = new ServerManager(global.minecraftPath);
                await serverManager.initialize();
            }
            return await serverManager.getServerList();
        } catch (error) {
            console.error('Get servers error:', error);
            return [];
        }
    });

    // Add file-related handlers
    ipcMain.handle('get-installed-versions', async () => {
        try {
            if (!fileManager) {
                fileManager = new FileManager(global.minecraftPath);
            }
            return await fileManager.getInstalledVersions();
        } catch (error) {
            console.error('Error getting installed versions:', error);
            return [];
        }
    });

    ipcMain.handle('verify-game-files', async (event, version) => {
        try {
            if (!fileManager) {
                fileManager = new FileManager(global.minecraftPath);
            }
            return await fileManager.verifyGameFiles(version);
        } catch (error) {
            console.error('Error verifying game files:', error);
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle('get-file-status', async (event, version) => {
        try {
            if (!fileManager) {
                fileManager = new FileManager(global.minecraftPath);
            }
            return await fileManager.getFileStatus(version);
        } catch (error) {
            console.error('Error getting file status:', error);
            return {error: error.message};
        }
    });

    ipcMain.handle('download-java', async (event, url) => {
        try {
            if (!fileManager) {
                fileManager = new FileManager(global.minecraftPath);
            }
            return await fileManager.downloadJava(url);
        } catch (error) {
            console.error('Error downloading Java:', error);
            return false;
        }
    });

    // Add update handlers
    ipcMain.handle('check-for-updates', async (event, channel) => {
        try {
            if (!updateService) {
                updateService = new UpdateService();
            }
            return await updateService.checkForUpdates(channel);
        } catch (error) {
            console.error('Error checking for updates:', error);
            return {error: error.message};
        }
    });

    ipcMain.handle('download-update', async (event, updateInfo) => {
        try {
            if (!updateService) {
                updateService = new UpdateService();
            }
            return await updateService.downloadUpdate(updateInfo);
        } catch (error) {
            console.error('Error downloading update:', error);
            return {error: error.message};
        }
    });

    ipcMain.handle('install-update', async (event, updateInfo) => {
        try {
            if (!updateService) {
                updateService = new UpdateService();
            }
            return await updateService.installUpdate(updateInfo);
        } catch (error) {
            console.error('Error installing update:', error);
            return {error: error.message};
        }
    });

    // Add window management handlers
    ipcMain.handle('hide-window', () => {
        if (!mainWindow) return false;

        // On Windows, minimize to taskbar
        if (process.platform === 'win32') {
            mainWindow.minimize();
            // Optional: Hide from taskbar
            // mainWindow.setSkipTaskbar(true);
        } else {
            // On other platforms, hide the window
            mainWindow.hide();
        }

        console.log('Launcher hidden while game is running');
        return true;
    });

    ipcMain.handle('show-window', () => {
        if (!mainWindow) return false;

        // Restore window visibility
        if (process.platform === 'win32') {
            // mainWindow.setSkipTaskbar(false);
            mainWindow.restore();
        } else {
            mainWindow.show();
        }

        // Make sure window is focused
        mainWindow.focus();
        console.log('Launcher restored after game closed');
        return true;
    });

    // Add sound repair handler
    ipcMain.handle('repair-sound-assets', async (event, version) => {
        try {
            logger.info(`Sound repair request received for Minecraft ${version}`);
            const SoundRepairUtility = require('./sound-repair');
            const soundRepair = new SoundRepairUtility(global.minecraftPath);

            await soundRepair.initialize();
            return await soundRepair.repairSoundsForVersion(version);
        } catch (error) {
            logger.error(`Sound repair failed: ${error.message}`);
            return {success: false, error: error.message};
        }
    });

    // Profile management handlers
    ipcMain.handle('get-profiles', async () => {
        try {
            const ProfileManager = require('./profile-manager');
            const profileManager = new ProfileManager(global.minecraftPath);

            logger.info('Initializing ProfileManager for get-profiles');
            await profileManager.initialize();

            const profiles = profileManager.getProfiles();
            const defaultProfile = profileManager.getDefaultProfile();

            logger.info(`Retrieved ${Object.keys(profiles).length} profiles successfully`);
            return {
                profiles,
                defaultProfile
            };
        } catch (error) {
            logger.error(`Error getting profiles: ${error.message}`);
            logger.error(error.stack);
            return {error: error.message};
        }
    });

    ipcMain.handle('create-profile', async (event, profileData) => {
        try {
            const ProfileManager = require('./profile-manager');
            const profileManager = new ProfileManager(global.minecraftPath);
            await profileManager.initialize();
            return await profileManager.createProfile(profileData);
        } catch (error) {
            logger.error(`Error creating profile: ${error.message}`);
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle('update-profile', async (event, {id, profileData}) => {
        try {
            const ProfileManager = require('./profile-manager');
            const profileManager = new ProfileManager(global.minecraftPath);
            await profileManager.initialize();
            return await profileManager.updateProfile(id, profileData);
        } catch (error) {
            logger.error(`Error updating profile: ${error.message}`);
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle('delete-profile', async (event, id) => {
        try {
            const ProfileManager = require('./profile-manager');
            const profileManager = new ProfileManager(global.minecraftPath);
            await profileManager.initialize();
            return await profileManager.deleteProfile(id);
        } catch (error) {
            logger.error(`Error deleting profile: ${error.message}`);
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle('set-default-profile', async (event, id) => {
        try {
            const ProfileManager = require('./profile-manager');
            const profileManager = new ProfileManager(global.minecraftPath);
            await profileManager.initialize();
            return await profileManager.setDefaultProfile(id);
        } catch (error) {
            logger.error(`Error setting default profile: ${error.message}`);
            return {success: false, error: error.message};
        }
    });

    // Add a new handler to directly create profiles
    ipcMain.handle('ensure-profiles-created', async () => {
        try {
            const ProfileManager = require('./profile-manager');
            const profileManager = new ProfileManager(global.minecraftPath);

            logger.info('Force creating profiles via ensure-profiles-created handler');
            await profileManager.createDefaultProfiles(true); // Force recreation
            return {success: true};
        } catch (error) {
            logger.error(`Error ensuring profiles: ${error.message}`);
            logger.error(error.stack);
            return {success: false, error: error.message};
        }
    });

    // Add handler for importing profiles from Minecraft launcher
    ipcMain.handle('import-minecraft-profiles', async (event, customPath = null) => {
        try {
            const ProfileManager = require('./profile-manager');
            const profileManager = new ProfileManager(global.minecraftPath);
            await profileManager.initialize();

            logger.info(`Importing Minecraft profiles${customPath ? ' from custom path' : ''}`);
            const result = await profileManager.importMinecraftProfiles(customPath);

            return result;
        } catch (error) {
            logger.error(`Error importing profiles: ${error.message}`);
            return {success: false, error: error.message};
        }
    });

    // Add handler for selecting custom minecraft profile path
    ipcMain.handle('select-minecraft-profiles-path', async () => {
        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                title: 'Select launcher_profiles.json',
                filters: [
                    {name: 'JSON Files', extensions: ['json']},
                    {name: 'All Files', extensions: ['*']}
                ],
                properties: ['openFile']
            });

            if (result.canceled) {
                return {canceled: true};
            }

            return {canceled: false, path: result.filePaths[0]};
        } catch (error) {
            logger.error(`Error in profile path selection: ${error.message}`);
            return {canceled: true, error: error.message};
        }
    });

    // Modloader handlers
    ipcMain.handle('get-forge-versions', async (event, minecraftVersion) => {
        try {
            const ModLoaderManager = require('./modloader-manager');
            const modLoaderManager = new ModLoaderManager(global.minecraftPath);
            return await modLoaderManager.getForgeVersions(minecraftVersion);
        } catch (error) {
            logger.error(`Error getting Forge versions: ${error.message}`);
            return [];
        }
    });

    ipcMain.handle('get-fabric-versions', async () => {
        try {
            const ModLoaderManager = require('./modloader-manager');
            const modLoaderManager = new ModLoaderManager(global.minecraftPath);
            return await modLoaderManager.getFabricVersions();
        } catch (error) {
            logger.error(`Error getting Fabric versions: ${error.message}`);
            return [];
        }
    });

    ipcMain.handle('get-fabric-game-versions', async () => {
        try {
            const ModLoaderManager = require('./modloader-manager');
            const modLoaderManager = new ModLoaderManager(global.minecraftPath);
            return await modLoaderManager.getFabricGameVersions();
        } catch (error) {
            logger.error(`Error getting Fabric game versions: ${error.message}`);
            return [];
        }
    });

    ipcMain.handle('install-fabric', async (event, {minecraftVersion, loaderVersion}) => {
        try {
            const ModLoaderManager = require('./modloader-manager');
            const modLoaderManager = new ModLoaderManager(global.minecraftPath);

            const success = await modLoaderManager.installFabric(minecraftVersion, loaderVersion);

            if (success) {
                // Create a profile for the new installation
                const ProfileManager = require('./profile-manager');
                const profileManager = new ProfileManager(global.minecraftPath);
                await profileManager.createFabricProfile(minecraftVersion, loaderVersion);
            }

            return {success};
        } catch (error) {
            logger.error(`Error installing Fabric: ${error.message}`);
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle('install-forge', async (event, {minecraftVersion, forgeVersion}) => {
        try {
            const ModLoaderManager = require('./modloader-manager');
            const modLoaderManager = new ModLoaderManager(global.minecraftPath);

            const success = await modLoaderManager.installForge(minecraftVersion, forgeVersion);

            if (success) {
                // Create a profile for the new installation
                const ProfileManager = require('./profile-manager');
                const profileManager = new ProfileManager(global.minecraftPath);
                await profileManager.createForgeProfile(minecraftVersion, forgeVersion);
            }

            return {success};
        } catch (error) {
            logger.error(`Error installing Forge: ${error.message}`);
            return {success: false, error: error.message};
        }
    });

    // Add asset handlers
    ipcMain.handle('download-assets', async (event, version) => {
        try {
            const AssetManager = require('./asset-manager');
            const assetManager = new AssetManager(global.minecraftPath);

            await assetManager.initialize();

            // First download the asset index
            await assetManager.downloadAssetIndex(version);

            // Then start downloading assets
            const result = await assetManager.downloadAssets(version, (progress) => {
                // Send progress updates to the renderer
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('asset-download-progress', progress);
                }
            });

            return result;
        } catch (error) {
            logger.error(`Error downloading assets: ${error.message}`);
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle('setup-game-icons', async (event, version) => {
        try {
            const AssetManager = require('./asset-manager');
            const assetManager = new AssetManager(global.minecraftPath);

            await assetManager.initialize();
            return await assetManager.setupGameIcons(version);
        } catch (error) {
            logger.error(`Error setting up game icons: ${error.message}`);
            return false;
        }
    });

    // Add handler for auto-creating missing profiles
    ipcMain.handle('create-missing-profiles', async () => {
        try {
            const ProfileCreator = require('./profile-creator');
            const profileCreator = new ProfileCreator(global.minecraftPath);

            logger.info('Checking for missing profiles for installed versions');
            return await profileCreator.createMissingProfiles();
        } catch (error) {
            logger.error(`Error creating missing profiles: ${error.message}`);
            return {success: false, error: error.message};
        }
    });

    // Add simulation mode handlers
    ipcMain.handle('toggle-update-simulation', async (event, {enable, options = {}}) => {
        try {
            if (!updateService) {
                updateService = new UpdateService();
            }
            return await updateService.toggleSimulationMode(enable, options);
        } catch (error) {
            logger.error('Error toggling simulation mode:', error);
            return {success: false, error: error.message};
        }
    });

    ipcMain.handle('get-simulation-status', async () => {
        try {
            if (!updateService) {
                updateService = new UpdateService();
            }
            return {
                enabled: updateService.updateSimulation.isEnabled(),
                config: updateService.updateSimulation.getConfig()
            };
        } catch (error) {
            logger.error('Error getting simulation status:', error);
            return {enabled: false, error: error.message};
        }
    });

    // Add the system info handler in the registerIpcHandlers function
    ipcMain.handle('get-system-info', async () => {
        try {
            const os = require('os');
            const totalMemoryBytes = os.totalmem();
            const totalMemoryMB = Math.floor(totalMemoryBytes / (1024 * 1024));

            return {
                totalMemoryMB,
                freeMemoryMB: Math.floor(os.freemem() / (1024 * 1024)),
                cpus: os.cpus().length,
                platform: os.platform()
            };
        } catch (error) {
            console.error('Error getting system info:', error);
            return {
                totalMemoryMB: 8192, // Default to 8GB if error
                freeMemoryMB: 4096,
                cpus: 4,
                platform: process.platform
            };
        }
    });

    // Add authentication handlers
    ipcMain.handle('authenticate', async () => {
        try {
            if (!authService) {
                authService = new AuthService();
            }

            const profile = await authService.login();

            // Send profile update to all windows
            BrowserWindow.getAllWindows().forEach(win => {
                if (!win.isDestroyed()) {
                    win.webContents.send('profile-updated', profile);
                }
            });

            return profile;
        } catch (error) {
            logger.error('Authentication failed:', error);
            return {error: error.message};
        }
    });

    ipcMain.handle('logout', async () => {
        try {
            if (!authService) {
                authService = new AuthService();
            }

            const result = await authService.logout();

            // Send profile update to all windows
            BrowserWindow.getAllWindows().forEach(win => {
                if (!win.isDestroyed()) {
                    win.webContents.send('profile-updated', null);
                }
            });

            return result;
        } catch (error) {
            logger.error('Logout failed:', error);
            return false;
        }
    });

    ipcMain.handle('get-profile', async () => {
        try {
            if (!authService) {
                authService = new AuthService();
            }

            return authService.getProfile();
        } catch (error) {
            logger.error('Get profile failed:', error);
            return null;
        }
    });

    // Add handler for opening external links
    ipcMain.handle('open-external', async (event, url) => {
        try {
            // Validate URL to prevent security issues
            const validUrl = new URL(url);
            const allowedProtocols = ['https:', 'http:'];

            if (allowedProtocols.includes(validUrl.protocol)) {
                await shell.openExternal(url);
                return true;
            } else {
                logger.warn(`Blocked attempt to open URL with disallowed protocol: ${url}`);
                return false;
            }
        } catch (error) {
            logger.error(`Error opening external URL: ${error.message}`);
            return false;
        }
    });
}

// Modify the isDevelopmentMode function to ONLY check for --dev flag
const isDevelopmentMode = () => {
    // ONLY check for --dev flag in command line arguments
    return process.argv.includes('--dev');
};

async function createWindow() {
    // Start mock auth server
    mockAuthServer = new MockAuthServer();
    mockAuthServer.start();

    // Check icon paths before creating window
    checkIcon();

    const iconPath = resolveAppPath('build/icon.ico');
    console.log('Using icon path:', iconPath);

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        icon: iconPath,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true
        },
        fullscreenable: true,
        maximizable: true,
        frame: true,
        titleBarStyle: 'default'
    });

    // Remove the top menu bar completely
    mainWindow.setMenu(null);

    // Update the file path to use index.html instead of main.html
    const mainHtmlPath = resolveAppPath('src/pages/index.html');
    
    // Check if the file exists before loading
    try {
        await fs.access(mainHtmlPath);
        mainWindow.loadFile(mainHtmlPath);
    } catch (error) {
        console.error(`Failed to load HTML file at ${mainHtmlPath}:`, error);
        app.quit();
    }

    // Set proper CSP
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
        callback({
            responseHeaders: {
                ...details.responseHeaders,
                'Content-Security-Policy': [
                    "default-src 'self';" +
                    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;" +
                    "font-src 'self' https://fonts.gstatic.com;" +
                    "img-src 'self' data: https:;" +
                    "script-src 'self';" +
                    "connect-src 'self' https://piston-meta.mojang.com https://launchermeta.mojang.com https://resources.download.minecraft.net https://libraries.minecraft.net;"
                ]
            }
        });
    });

    // Initialize minecraft launcher with custom path
    const baseDir = global.minecraftPath;
    minecraftLauncher = new MinecraftLauncher(baseDir);
    
    // Initialize authentication service
    authService = new AuthService();
    
    // Initialize auth integration
    authCleanup = initAuthIntegration(authService, minecraftLauncher);

    // Register IPC handlers before loading the file
    registerIpcHandlers();

    // Only open DevTools when --dev flag is present
    if (isDevelopmentMode()) {
        console.log('Running in development mode with --dev flag, opening DevTools');
        mainWindow.webContents.openDevTools();
    } else {
        console.log('DevTools disabled. Use --dev flag to enable.');
        
        // Disable DevTools keyboard shortcuts
        mainWindow.webContents.on('before-input-event', (event, input) => {
            // Block Ctrl+Shift+I, F12, and Cmd+Alt+I (macOS)
            const isDevToolsShortcut = 
                (input.control && input.shift && input.key.toLowerCase() === 'i') ||
                (input.key === 'F12') ||
                (input.meta && input.alt && input.key.toLowerCase() === 'i');
                
            if (isDevToolsShortcut) event.preventDefault();
        });
    }

    mainWindow.webContents.on('did-finish-load', () => {
        console.log('[Main] Window content loaded');
        console.log('[Main] Available IPC handlers:', ipcMain.eventNames());
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Add window state listeners
    mainWindow.on('enter-full-screen', () => {
        console.log('[Main] Window entered fullscreen mode');
        try {
            mainWindow.webContents.send('fullscreen-change', true);
            console.log('[Main] Fullscreen change event sent: true');
        } catch (error) {
            console.error('[Main] Failed to send fullscreen change event:', error);
        }
    });

    mainWindow.on('leave-full-screen', () => {
        console.log('[Main] Window left fullscreen mode');
        mainWindow.webContents.send('fullscreen-change', false);
    });

    mainWindow.on('maximize', () => {
        console.log('[Main] Window maximized');
    });

    mainWindow.on('unmaximize', () => {
        console.log('[Main] Window unmaximized');
    });

    console.log('Window created, available IPC handlers:', ipcMain.eventNames());
}

// Initialize app
app.whenReady().then(async () => {
    await ensureDirectories();
    createWindow();
    initializeUpdateService();
    
    // Initialize Discord RPC
    await discordRPC.initialize();
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

app.on('window-all-closed', () => {
    if (mockAuthServer) {
        mockAuthServer.stop();
    }
    // Shut down Discord RPC before quitting
    discordRPC.shutdown();
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('will-quit', () => {
    // Perform cleanup operations
    if (authCleanup) authCleanup();
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

// Add version comparison helper function
function compareVersions(a, b) {
    const aParts = a.split('.').map(part => parseInt(part, 10) || 0);
    const bParts = b.split('.').map(part => parseInt(part, 10) || 0);
    
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) {
            return bVal - aVal; // Descending order (newer first)
        }
    }
    return 0;
}

async function getVersions() {
    try {
        const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', {
            timeout: 30000 // Increase timeout to 30 seconds
        });
        const data = await response.json();
        
        // Sort versions by version ID (newest first)
        data.versions.sort((a, b) => compareVersions(a.id, b.id));
        
        return data.versions;
    } catch (error) {
        logger.warn(`Failed to fetch versions online: ${error}`);
        
        // Fallback to installed versions
        try {
            const standaloneCreator = new (require('./standalone-creator'))();
            const installedVersions = await standaloneCreator.getInstalledVersions();
            
            if (installedVersions.length > 0) {
                logger.info(`Using offline version list: ${installedVersions.join(', ')}`);
                
                // Sort installed versions
                installedVersions.sort((a, b) => compareVersions(a, b));
                
                return installedVersions.map(version => ({
                    id: version,
                    type: 'release', // Assume release type for offline versions
                    url: null,
                    time: new Date().toISOString(),
                    releaseTime: new Date().toISOString()
                }));
            }
        } catch (fallbackError) {
            logger.error(`Fallback version detection failed: ${fallbackError}`);
        }
        
        throw new Error('Could not fetch versions and no installed versions found');
    }
}

// Replace the existing version fetching code with:
ipcMain.handle('fetch-versions', async () => {
    try {
        return await getVersions();
    } catch (error) {
        logger.error(`Error fetching versions: ${error}`);
        throw error;
    }
});

// Initialize update service and check for updates on app start
async function initializeUpdateService() {
    updateService = new UpdateService();
    
    // Check for updates in the background after a short delay
    setTimeout(async () => {
        try {
            // Get update channel preference from settings
            const updateChannel = global.settings?.updateChannel || 'stable';
            const result = await updateService.checkForUpdates(updateChannel);
            
            // If update is available, notify the main window
            if (result.updateAvailable) {
                const mainWindow = BrowserWindow.getAllWindows()[0];
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('update-available', result);
                }
            }
        } catch (error) {
            logger.error('Background update check failed:', error.message);
        }
    }, 5000);
}

// Find the game launch function that starts the child process
// Around line 300-330, there should be code like this:

function launchGame(options) {
    // ...existing code...
    
    const gameProcess = spawn('java', javaArgs, { cwd });
    
    // Store the version with the process
    gameProcess.gameVersion = options.version || 'unknown';
    
    // When the game process closes
    gameProcess.on('close', (code) => {
        // Use the stored version instead of an undefined variable
        logger.info(`Game process exited with code ${code} for version ${gameProcess.gameVersion}`);
        
        // Notify renderer
        mainWindow.webContents.send('game-closed', {
            code,
            version: gameProcess.gameVersion  // Use the stored version here
        });
        
        // ...existing code...
    });
    
    // ...existing code...
}
