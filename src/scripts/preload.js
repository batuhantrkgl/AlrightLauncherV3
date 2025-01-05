const { contextBridge, ipcRenderer } = require('electron');

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
        saveLogs: () => ipcRenderer.invoke('save-logs')
    },
    window: {
        toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
        isFullscreen: () => ipcRenderer.invoke('is-fullscreen'),
        onFullscreenChange: (callback) => {
            if (typeof callback === 'function') {
                ipcRenderer.on('fullscreen-change', (_, value) => callback(value));
            }
        }
    },
    installVersion: (version) => ipcRenderer.invoke('install-version', version),
    launchGame: (version, username) => ipcRenderer.invoke('launch-game', { version, username }),
    checkJava: () => ipcRenderer.invoke('verify-java'),
    isJavaInstalled: () => ipcRenderer.invoke('verify-java'),
    getVersions: () => ipcRenderer.invoke('get-versions'),
    isGameRunning: (version) => ipcRenderer.invoke('is-game-running', version),
    auth: {
        login: () => ipcRenderer.invoke('authenticate'),
        logout: () => ipcRenderer.invoke('logout'),
        getProfile: () => ipcRenderer.invoke('get-profile'),
        onProfileUpdate: (callback) => {
            if (typeof callback === 'function') {
                ipcRenderer.on('profile-update', (_, profile) => callback(profile));
            }
        }
    },
    ipc: {
        invoke: (channel, ...args) => {
            const validChannels = [
                'create-standalone'
            ];
            if (validChannels.includes(channel)) {
                return ipcRenderer.invoke(channel, ...args);
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
        create: (options) => ipcRenderer.invoke('create-server', options),
        start: (name, memory) => ipcRenderer.invoke('start-server', { name, memory }),
        stop: (name) => ipcRenderer.invoke('stop-server', name),
        list: () => ipcRenderer.invoke('get-servers'),
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
            return ipcRenderer.invoke(channel, data);
        }
        return Promise.reject(new Error(`Invalid channel: ${channel}`));
    }
});

console.log('[Preload] Script initialized');