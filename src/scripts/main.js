const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const MinecraftLauncher = require('./minecraft-launcher');
const MinecraftInstaller = require('./minecraft-installer');
const { checkIcon } = require('./iconTest');
const ServerManager = require('./server-manager');
const MockAuthServer = require('./mock-auth-server');

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

function registerIpcHandlers() {
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
                    resolve({ installed: false, message: 'No Java installed, please install "Temurin 21 JRE" and relaunch.' });
                });

                javaProcess.stderr.on('data', (data) => {
                    console.log('Java version output:', data.toString());
                    resolve({ installed: true, version: data.toString() });
                });

                javaProcess.on('close', (code) => {
                    console.log('Java verification process closed with code:', code);
                    if (code !== 0) {
                        resolve({ installed: false, message: 'No Java installed, please install "Temurin 21 JRE" and relaunch.' });
                    }
                });
            } catch (error) {
                console.error('Java verification exception:', error);
                resolve({ installed: false, message: 'No Java installed, please install "Temurin 21 JRE" and relaunch.' });
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
                filters: [{ name: 'Log Files', extensions: ['log'] }],
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

    // Add Minecraft handlers
    ipcMain.handle('install-version', async (event, version) => {
        try {
            const installer = new MinecraftInstaller();
            return await installer.installVersion(version);
        } catch (error) {
            console.error('Installation error:', error);
            return false;
        }
    });

    ipcMain.handle('launch-game', async (event, { version, username }) => {
        try {
            if (!minecraftLauncher) {
                const baseDir = global.minecraftPath;
                minecraftLauncher = new MinecraftLauncher(baseDir);
            }

            const result = await minecraftLauncher.launch(version, username);
            if (!result || !result.process) {
                return { success: false, error: 'Failed to start game' };
            }

            // Monitor for crashes
            result.process.on('exit', async (code) => {
                if (code !== 0) {
                    // Check multiple possible crash report locations
                    const crashLocations = [
                        path.join(global.minecraftPath, 'crash-reports'),
                        path.join(process.cwd(), 'crash-reports')
                    ];

                    for (const crashDir of crashLocations) {
                        try {
                            // Ensure crash directory exists
                            await fs.ensureDir(crashDir);
                            
                            const files = await fs.readdir(crashDir);
                            if (files.length > 0) {
                                const latestCrash = files
                                    .map(file => ({
                                        name: file,
                                        path: path.join(crashDir, file),
                                        time: fs.statSync(path.join(crashDir, file)).mtime
                                    }))
                                    .sort((a, b) => b.time - a.time)[0];

                                if (latestCrash && Date.now() - latestCrash.time < 5000) { // Only if crash file is recent
                                    const crashContent = await fs.readFile(latestCrash.path, 'utf8');
                                    mainWindow.webContents.send('game-crashed', {
                                        version,
                                        crashFile: latestCrash.name,
                                        crashContent: crashContent
                                    });
                                    break; // Stop checking other locations if we found a crash report
                                }
                            }
                        } catch (error) {
                            console.log(`No crash reports found in ${crashDir}`);
                        }
                    }

                    // If no crash report found, send a generic crash message
                    if (!mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('game-crashed', {
                            version,
                            crashFile: 'unknown',
                            crashContent: `Game exited with code ${code}. No crash report found.`
                        });
                    }
                }

                // Always send game-closed event
                if (!mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('game-closed', { 
                        version, 
                        code,
                        message: code === 0 ? 'normal exit' : 'error exit'
                    });
                }
            });

            return { success: true, pid: result.pid };
        } catch (error) {
            console.error('Launch error:', error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-versions', async () => {
        try {
            const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            return data.versions;
        } catch (error) {
            console.error('Error fetching versions:', error);
            return [];
        }
    });

    ipcMain.handle('create-standalone', async (event, { version, launcherPath }) => {
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
                return { success: false, reason: 'cancelled' };
            }

            const selectedPath = result.filePaths[0];
            console.log('Selected directory:', selectedPath);
            console.log('Using launcher path:', launcherPath);

            // Create standalone version
            await creator.createStandalone(selectedPath, [version], null); // Java path is optional in offline mode
            return { success: true };

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
            return { error: error.message };
        }
    });

    ipcMain.handle('start-server', async (event, { name, memory }) => {
        try {
            if (!serverManager) return { error: 'Server manager not initialized' };
            return await serverManager.startServer(name, memory);
        } catch (error) {
            console.error('Server start error:', error);
            return { error: error.message };
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

    // Remove authentication-related handlers
}

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

    // Register IPC handlers before loading the file
    registerIpcHandlers();

    mainWindow.webContents.openDevTools();

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
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
});

async function getVersions() {
    try {
        const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', {
            timeout: 30000 // Increase timeout to 30 seconds
        });
        const data = await response.json();
        return data.versions;
    } catch (error) {
        logger.warn(`Failed to fetch versions online: ${error}`);
        
        // Fallback to installed versions
        try {
            const standaloneCreator = new (require('./standalone-creator'))();
            const installedVersions = await standaloneCreator.getInstalledVersions();
            
            if (installedVersions.length > 0) {
                logger.info(`Using offline version list: ${installedVersions.join(', ')}`);
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
