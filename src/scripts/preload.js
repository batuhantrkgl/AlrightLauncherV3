const { contextBridge, ipcRenderer } = require('electron');

// Debug function for IPC calls
function safeIpcInvoke(channel, ...args) {
    console.log(`Renderer calling IPC: ${channel}`, ...(args || []));
    return ipcRenderer.invoke(channel, ...args)
        .catch(error => {
            console.error(`Error in IPC ${channel}:`, error);
            throw error; // Rethrow to allow caller to handle
        });
}

// Create basic utilities without external modules
const safeUtils = {
    pathJoin: (...args) => args.join('/').replace(/\\/g, '/'),
    getAppData: () => process.env.APPDATA || '',
    existsSync: (path) => {
        try {
            require('fs').accessSync(path);
            return true;
        } catch {
            return false;
        }
    }
};

// Expose safe APIs to renderer
contextBridge.exposeInMainWorld('minecraft', {
    utils: safeUtils,
    logger: {
        info: (msg) => console.log('[Info]', msg),
        warn: (msg) => console.warn('[Warn]', msg),
        error: (msg) => console.error('[Error]', msg),
        addLogListener: (callback) => {
            if (typeof callback === 'function') {
                ipcRenderer.on('log-message', (_, data) => callback(data));
            }
        },
        clearLogs: () => ipcRenderer.send('clear-logs'),
        saveLogs: () => safeIpcInvoke('save-logs')
    },
    window: {
        toggleFullscreen: () => safeIpcInvoke('toggle-fullscreen'),
        isFullscreen: () => safeIpcInvoke('is-fullscreen'),
        onFullscreenChange: (callback) => {
            if (typeof callback === 'function') {
                ipcRenderer.on('fullscreen-change', (_, value) => callback(value));
            }
        }
    },
    // Fix installVersion and make sure it returns a proper Promise
    installVersion: (version) => {
        console.log(`Calling install-version for ${version}`);
        return safeIpcInvoke('install-version', version)
            .then(result => {
                console.log(`Install result for ${version}:`, result);
                return result;
            })
            .catch(error => {
                console.error(`Install error for ${version}:`, error);
                return false;
            });
    },
    // Fix launchGame to ensure consistency and better error handling
    launchGame: (version, username, options = {}) => {
        console.log(`Launching game: ${version} with username ${username}`, options);
        return safeIpcInvoke('launch-game', { version, username, ...options })
            .then(result => {
                console.log('Launch result:', result);
                return result;
            })
            .catch(error => {
                console.error('Launch error:', error);
                return { success: false, error: error.message || 'Unknown launch error' };
            });
    },
    checkJava: () => safeIpcInvoke('verify-java'),
    isJavaInstalled: () => safeIpcInvoke('verify-java'),
    getVersions: () => safeIpcInvoke('get-versions'),
    isGameRunning: (version) => safeIpcInvoke('is-game-running', version),
    verifyGameFiles: (version) => safeIpcInvoke('verify-game-files', version),
    auth: {
        login: () => safeIpcInvoke('authenticate'),
        logout: () => safeIpcInvoke('logout'),
        getProfile: () => safeIpcInvoke('get-profile'),
        onProfileUpdate: (callback) => {
            if (typeof callback === 'function') {
                ipcRenderer.on('profile-updated', (_, profile) => callback(profile));
            }
        }
    },
    ipc: {
        invoke: (channel, ...args) => {
            const validChannels = [
                'create-standalone',
                'download-java',
                'verify-game-files',
                'get-installed-versions',
                'hide-window',      // Add this channel
                'show-window',      // Add this channel
                'get-system-info'   // Add this channel to the list
            ];
            if (validChannels.includes(channel)) {
                return safeIpcInvoke(channel, ...args);
            }
            throw new Error(`Invalid IPC channel: ${channel}`);
        }
    },
    onGameCrash: (callback) => {
        if (typeof callback === 'function') {
            ipcRenderer.on('game-crashed', (_, data) => callback(data));
        }
    },
    onGameClose: (callback) => {
        if (typeof callback === 'function') {
            ipcRenderer.on('game-closed', (_, data) => callback(data));
        }
    },
    server: {
        create: (options) => safeIpcInvoke('create-server', options),
        start: (name, memory) => safeIpcInvoke('start-server', { name, memory }),
        stop: (name) => safeIpcInvoke('stop-server', name),
        list: () => safeIpcInvoke('get-servers'),
        onLog: (callback) => {
            if (typeof callback === 'function') {
                ipcRenderer.on('server-log', (_, data) => callback(data));
            }
        }
    },
    onInstallProgress: (callback) => {
        if (typeof callback === 'function') {
            ipcRenderer.on('install-progress', (_, data) => callback(data));
        }
    },
    // New APIs for offline mode using the safe invoke
    offline: {
        getInstalledVersions: () => safeIpcInvoke('get-installed-versions'),
        verifyFiles: (version) => safeIpcInvoke('verify-game-files', version),
        getFileStatus: (version) => safeIpcInvoke('get-file-status', version)
    },
    // Expose update functionality
    updates: {
        checkForUpdates: (channel) => safeIpcInvoke('check-for-updates', channel),
        downloadUpdate: (updateInfo) => safeIpcInvoke('download-update', updateInfo),
        installUpdate: (updateInfo) => safeIpcInvoke('install-update', updateInfo),
        onUpdateAvailable: (callback) => {
            if (typeof callback === 'function') {
                ipcRenderer.on('update-available', (_, data) => callback(data));
            }
        },
        onDownloadProgress: (callback) => {
            if (typeof callback === 'function') {
                ipcRenderer.on('update-download-progress', (_, data) => callback(data));
            }
        },
        // Add simulation controls
        toggleSimulation: (enable, options) => safeIpcInvoke('toggle-update-simulation', { enable, options }),
        getSimulationStatus: () => safeIpcInvoke('get-simulation-status')
    },
    soundRepair: {
        repairSounds: (version) => safeIpcInvoke('repair-sound-assets', version)
    },
    // Add profile management methods
    profiles: {
        get: () => ipcRenderer.invoke('get-profiles'),
        create: (profileData) => ipcRenderer.invoke('create-profile', profileData),
        update: (id, profileData) => ipcRenderer.invoke('update-profile', { id, profileData }),
        delete: (id) => ipcRenderer.invoke('delete-profile', id),
        setDefault: (id) => ipcRenderer.invoke('set-default-profile', id),
        ensureCreated: () => ipcRenderer.invoke('ensure-profiles-created'),
        importFromMinecraft: (customPath) => ipcRenderer.invoke('import-minecraft-profiles', customPath),
        selectMinecraftProfilesPath: () => ipcRenderer.invoke('select-minecraft-profiles-path'),
        createMissing: () => ipcRenderer.invoke('create-missing-profiles')
    },
    // Add modloader methods
    modloaders: {
        getForgeVersions: (minecraftVersion) => ipcRenderer.invoke('get-forge-versions', minecraftVersion),
        getFabricVersions: () => ipcRenderer.invoke('get-fabric-versions'),
        getFabricGameVersions: () => ipcRenderer.invoke('get-fabric-game-versions'),
        installFabric: (minecraftVersion, loaderVersion) => 
            ipcRenderer.invoke('install-fabric', { minecraftVersion, loaderVersion }),
        installForge: (minecraftVersion, forgeVersion) => 
            ipcRenderer.invoke('install-forge', { minecraftVersion, forgeVersion })
    },
    assets: {
        download: (version) => safeIpcInvoke('download-assets', version),
        setupIcons: (version) => safeIpcInvoke('setup-game-icons', version),
        onDownloadProgress: (callback) => {
            if (typeof callback === 'function') {
                ipcRenderer.on('asset-download-progress', (_, data) => callback(data));
            }
        }
    },
    // Ensure consistent installation status event handler
    onInstallationStatus: (callback) => {
        if (typeof callback === 'function') {
            // Remove any existing handler to avoid duplicates
            ipcRenderer.removeAllListeners('installation-status');
            ipcRenderer.on('installation-status', (_, data) => {
                console.log('Installation status received:', data);
                callback(data);
            });
        }
    },
    onAssetDownloadProgress: (callback) => {
        ipcRenderer.on('asset-download-progress', (event, data) => callback(data));
    },
    // Add system utilities
    system: {
        openExternal: (url) => ipcRenderer.invoke('open-external', url),
    }
});

contextBridge.exposeInMainWorld('api', {
    invoke: (channel, data) => {
        const validChannels = [
            'authenticate',
            'checkAuth',
            'logout'
        ];
        if (validChannels.includes(channel)) {
            return safeIpcInvoke(channel, data);
        }
        return Promise.reject(new Error(`Invalid channel: ${channel}`));
    }
});

console.log('[Preload] Script initialized');