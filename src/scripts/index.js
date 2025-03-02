const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const VersionManager = require('./versionManager');
const logger = require('./logger');
const { spawn } = require('child_process');

let mainWindow;
let versionManager;

// Clear any existing handlers to avoid duplicates
function clearExistingHandlers() {
    // List of all handlers we need to manage
    const handlerNames = [
        'get-versions',
        'get-installed-versions', 
        'verify-game-files',
        'get-file-status',
        'verify-java',
        'launch-game'
    ];
    
    // Remove any existing handlers
    for (const handler of handlerNames) {
        try {
            // Check if handler exists by seeing if _events has the property
            if (ipcMain._events && ipcMain._events[`handle-${handler}`]) {
                console.log(`Removing existing handler: ${handler}`);
                ipcMain.removeHandler(handler);
            }
        } catch (err) {
            console.error(`Error removing handler ${handler}:`, err);
        }
    }
}

// Register IPC handlers - using direct approach without any fancy patterns
function registerIpcHandlers() {
    // First clear existing handlers
    clearExistingHandlers();
    
    console.log('Starting IPC handler registration...');
    
    // Make sure versionManager is initialized
    if (!versionManager) {
        console.error('VersionManager not initialized before registering handlers');
        return;
    }

    // Direct registration using the ipcMain.handle API
    ipcMain.handle('get-versions', async () => {
        console.log('Handler called: get-versions');
        try {
            return await versionManager.getInstalledVersions();
        } catch (error) {
            console.error('Error in get-versions handler:', error);
            return [];
        }
    });

    ipcMain.handle('get-installed-versions', async () => {
        console.log('Handler called: get-installed-versions');
        try {
            return await versionManager.getInstalledVersions();
        } catch (error) {
            console.error('Error in get-installed-versions handler:', error);
            return [];
        }
    });

    ipcMain.handle('verify-game-files', async (_, version) => {
        console.log(`Handler called: verify-game-files for ${version}`);
        try {
            return await versionManager.verifyGameFiles(version);
        } catch (error) {
            console.error(`Error in verify-game-files handler:`, error);
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('get-file-status', async (_, version) => {
        console.log(`Handler called: get-file-status for ${version}`);
        try {
            return await versionManager.getFileStatus(version);
        } catch (error) {
            console.error(`Error in get-file-status handler:`, error);
            return { error: error.message };
        }
    });

    ipcMain.handle('verify-java', async () => {
        console.log('Handler called: verify-java');
        try {
            // Perform an actual Java check
            const result = await checkJavaInstallation();
            return result;
        } catch (error) {
            console.error('Error in verify-java handler:', error);
            return { installed: false, error: error.message };
        }
    });
    
    ipcMain.handle('launch-game', async (_, options) => {
        console.log(`Handler called: launch-game with options:`, options);
        return { success: true };
    });

    // Debug logging of available handlers
    const availableHandlers = Object.keys(ipcMain._events || {})
        .filter(key => key.startsWith('handle-'))
        .map(key => key.replace('handle-', ''));
    
    console.log(`Registered IPC handlers: ${availableHandlers.join(', ')}`);
}

// Function to check Java installation
async function checkJavaInstallation() {
    return new Promise((resolve, reject) => {
        console.log('Checking Java installation...');
        const java = spawn('java', ['-version']);
        let output = '';
        let error = '';

        java.stdout.on('data', (data) => {
            output += data.toString();
        });

        java.stderr.on('data', (data) => {
            // Java outputs version info to stderr for historical reasons
            error += data.toString();
        });

        java.on('error', (err) => {
            console.error('Java not found:', err);
            resolve({ installed: false, error: err.message });
        });

        java.on('close', (code) => {
            console.log(`Java verification process closed with code: ${code}`);
            if (code === 0) {
                console.log('Java version output:', error.trim());
                resolve({ installed: true, version: error.trim() });
            } else {
                console.error('Java check failed with code:', code);
                resolve({ installed: false, error: 'Java check failed' });
            }
        });
    });
}

// Initialize application directories
function initializeDirectories() {
    const minecraftDir = path.join(process.env.APPDATA || app.getPath('userData'), '.alrightlauncher');
    
    // Ensure main directory exists
    fs.ensureDirSync(minecraftDir);
    console.log(`Using Minecraft directory: ${minecraftDir}`);
    
    return minecraftDir;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 600,
        resizable: true,
        fullscreenable: true,
        backgroundColor: '#FFFFFF',
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
            enableRemoteModule: false,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    // Set up icon paths
    const iconPaths = [
        path.join(__dirname, '..', '..', 'build', 'app.ico'),
        path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'resources', 'build', 'app.ico')
    ];
    
    console.log('Checking icon paths:');
    for (const iconPath of iconPaths) {
        console.log(`Checking ${iconPath}: ${fs.existsSync(iconPath)}`);
        if (fs.existsSync(iconPath)) {
            mainWindow.setIcon(iconPath);
            console.log(`Using icon path: ${iconPath}`);
            break;
        }
    }

    // Load the HTML file
    mainWindow.loadFile(path.join(__dirname, '..', 'pages', 'index.html'));
    
    // For debugging
    mainWindow.webContents.openDevTools();
    
    // Debug events
    mainWindow.webContents.on('did-finish-load', () => {
        console.log('[Main] Window content loaded');
        
        // Log available handlers after window loads
        const availableHandlers = Object.keys(ipcMain._events || {})
            .filter(key => key.startsWith('handle-'))
            .map(key => key.replace('handle-', ''));
        
        console.log('[Main] Available IPC handlers:', availableHandlers);
    });
    
    // Debug window state changes
    mainWindow.on('maximize', () => {
        console.log('[Main] Window maximized');
    });
    
    mainWindow.on('unmaximize', () => {
        console.log('[Main] Window unmaximized');
    });
    
    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    console.log('Window created, available IPC handlers:', 
        Object.keys(ipcMain._events || {})
            .filter(key => key.startsWith('handle-'))
            .map(key => key.replace('handle-', ''))
    );
}

// This ensures app initialization is synchronous and in the correct order
app.whenReady().then(async () => {
    try {
        // 1. Initialize directories
        const minecraftDir = initializeDirectories();
        
        // 2. Create version manager with the correct directory
        versionManager = new VersionManager(minecraftDir);
        
        // 3. Register IPC handlers before window creation
        registerIpcHandlers();
        
        // 4. Create window after handlers are registered
        createWindow();
        
        console.log('Application started successfully');
    } catch (error) {
        console.error('Failed to initialize application:', error);
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            // Re-register handlers and create window
            registerIpcHandlers();
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
});

