const fs = require('fs');
const path = require('path');

class Logger {
    constructor() {
        this.logs = [];
        this.listeners = new Set();
        this.logFile = path.join(process.env.APPDATA, '.alrightlauncher', 'launcher.log');
    }

    log(level, message, data = null) {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            data
        };

        this.logs.push(entry);
        this.notifyListeners(entry);
        this.writeToFile(entry);
    }

    info(message, data = null) {
        this.log('info', message, data);
    }

    warn(message, data = null) {
        this.log('warn', message, data);
    }

    error(message, data = null) {
        this.log('error', message, data);
    }

    addListener(callback) {
        console.log('[Logger] Adding listener');
        if (typeof callback === 'function') {
            this.listeners.add(callback);
        }
    }

    removeListener(callback) {
        console.log('[Logger] Removing listener');
        this.listeners.delete(callback);
    }

    notifyListeners(entry) {
        this.listeners.forEach(callback => callback(entry));
    }

    writeToFile(entry) {
        const line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}\n`;
        fs.appendFile(this.logFile, line, err => {
            if (err) console.error('Failed to write to log file:', err);
        });
    }

    clear() {
        this.logs = [];
        this.notifyListeners({ type: 'clear' });
    }

    getLogs() {
        return this.logs;
    }

    exportLogs() {
        return this.logs.map(entry => 
            `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`
        ).join('\n');
    }
}

// Export a single instance
const logger = new Logger();
console.log('[Logger] Instance created');
module.exports = logger;
