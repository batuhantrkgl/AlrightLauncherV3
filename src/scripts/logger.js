const fs = require('fs-extra');
const path = require('path');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');
const fetch = require('node-fetch');

// ANSI color codes for terminal
const COLORS = {
    reset: '\x1b[0m',
    // Regular colors
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    // Bright colors
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    brightWhite: '\x1b[97m',
    // Background colors
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    // Text styles
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    // Composite styles for log levels
    debug: '\x1b[90m', // Dim gray
    info: '\x1b[36m',  // Cyan
    warn: '\x1b[33m\x1b[1m', // Yellow bold
    error: '\x1b[31m\x1b[1m', // Red bold
    critical: '\x1b[41m\x1b[97m\x1b[1m', // White bold on red background
    success: '\x1b[32m\x1b[1m', // Green bold
    timestamp: '\x1b[90m', // Dim gray
    label: '\x1b[1m', // Bold
};

// Plain ASCII symbols for terminals that don't support Unicode
const ASCII_SYMBOLS = {
    debug: '[DEBUG]',
    info: '[INFO]',
    warn: '[WARN]',
    error: '[ERROR]',
    critical: '[CRITICAL]',
    success: '[SUCCESS]'
};

// Log levels with numeric values for filtering
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    CRITICAL: 4,
    NONE: 999 // Used for disabling logging
};

class Logger {
    constructor(options = {}) {
        this.logs = [];
        this.listeners = new Set();
        this.baseDir = options.baseDir || path.join(process.env.APPDATA, '.alrightlauncher');
        this.logsDir = path.join(this.baseDir, 'logs');
        this.logFile = path.join(this.logsDir, 'launcher.log');
        
        // Configuration options with defaults
        this.config = {
            // Minimum log level to show (anything below this level won't be logged)
            minLogLevel: options.minLogLevel || LOG_LEVELS.INFO,
            // Maximum size of log file in bytes before rotation (default: 5MB)
            maxLogSize: options.maxLogSize || 5 * 1024 * 1024,
            // Maximum number of rotated log files to keep
            maxLogFiles: options.maxLogFiles || 5,
            // Whether to compress rotated logs
            compressLogs: options.compressLogs !== undefined ? options.compressLogs : true,
            // How many logs to keep in memory
            maxInMemoryLogs: options.maxInMemoryLogs || 1000,
            // Remote logging endpoint (if provided)
            remoteLoggingUrl: options.remoteLoggingUrl || null,
            // Remote logging batch size
            remoteLoggingBatchSize: options.remoteLoggingBatchSize || 10,
            // Remote logging interval in ms
            remoteLoggingInterval: options.remoteLoggingInterval || 5000,
            // Application info
            appName: options.appName || 'AlrightLauncher',
            appVersion: options.appVersion || '1.0.0',
            // Whether to log to console
            consoleOutput: options.consoleOutput !== undefined ? options.consoleOutput : true,
            // Whether to use colors in console
            useColors: options.useColors !== undefined ? options.useColors : true,
            // Whether to use unicode symbols (emojis) - turn off for incompatible terminals
            useUnicode: options.useUnicode !== undefined ? options.useUnicode : false,
            // Whether to use structured logging format
            structuredLogging: options.structuredLogging !== undefined ? options.structuredLogging : false,
            // Custom color theme
            colors: options.colors || COLORS
        };

        // Check if terminal supports colors
        this._detectTerminalCapabilities();

        // Queue for remote logging
        this.remoteLoggingQueue = [];
        
        // Initialize directories
        this._initializeDirectories();
        
        // Set up remote logging interval if URL is provided
        if (this.config.remoteLoggingUrl) {
            this.remoteLoggingIntervalId = setInterval(() => {
                this._sendRemoteLogs();
            }, this.config.remoteLoggingInterval);
        }
    }

    /**
     * Attempt to detect terminal capabilities
     * @private
     */
    _detectTerminalCapabilities() {
        // Check for NO_COLOR environment variable - standard for disabling colors
        if (process.env.NO_COLOR !== undefined) {
            this.config.useColors = false;
        }

        // Check for TERM environment variable to detect terminal type
        const term = process.env.TERM || '';
        if (term === 'dumb') {
            this.config.useColors = false;
            this.config.useUnicode = false;
        }

        // Check for Windows - more likely to have emoji rendering issues
        if (process.platform === 'win32' && !process.env.WT_SESSION) {
            // Default Windows terminal has issues with emojis
            this.config.useUnicode = false;
        }
    }

    _initializeDirectories() {
        try {
            fs.ensureDirSync(this.logsDir);
        } catch (error) {
            console.error('Failed to create log directory:', error);
        }
    }

    /**
     * Core logging method
     * @param {string} level - Log level (debug, info, warn, error, critical)
     * @param {string} message - Log message
     * @param {object} data - Optional data to include
     * @param {object} metadata - Optional metadata like component, context, etc.
     */
    log(level, message, data = null, metadata = {}) {
        // Check if log level meets the minimum threshold
        const levelUpper = level.toUpperCase();
        if (LOG_LEVELS[levelUpper] < this.config.minLogLevel) {
            return;
        }

        const timestamp = new Date();
        
        // Create structured log entry
        const entry = {
            id: uuidv4(),
            timestamp: timestamp.toISOString(),
            level,
            message,
            data,
            metadata: {
                ...metadata,
                appName: this.config.appName,
                appVersion: this.config.appVersion
            }
        };

        // Add to in-memory logs with size limitation
        this.logs.push(entry);
        if (this.logs.length > this.config.maxInMemoryLogs) {
            this.logs.shift();
        }

        // Notify listeners
        this.notifyListeners(entry);
        
        // Check if file needs rotation
        this._checkRotation();
        
        // Write to file
        this._writeToFile(entry);
        
        // Add to remote logging queue if enabled
        if (this.config.remoteLoggingUrl) {
            this.remoteLoggingQueue.push(entry);
            
            // Send immediately if batch size reached
            if (this.remoteLoggingQueue.length >= this.config.remoteLoggingBatchSize) {
                this._sendRemoteLogs();
            }
        }
        
        // Console output if enabled
        if (this.config.consoleOutput) {
            this._consoleOutput(entry);
        }
    }

    /**
     * Format and color console output
     * @private
     */
    _consoleOutput(entry) {
        const formattedTime = new Date(entry.timestamp).toLocaleTimeString();
        const levelUpper = entry.level.toUpperCase();
        const levelLower = entry.level.toLowerCase();
        
        if (!this.config.useColors) {
            // Standard non-colored output
            const prefix = `[${formattedTime}] [${levelUpper}]`;
            
            switch (levelLower) {
                case 'debug':
                    console.debug(prefix, entry.message, entry.data || '');
                    break;
                case 'info':
                    console.info(prefix, entry.message, entry.data || '');
                    break;
                case 'warn':
                case 'warning':
                    console.warn(prefix, entry.message, entry.data || '');
                    break;
                case 'error':
                    console.error(prefix, entry.message, entry.data || '');
                    break;
                case 'critical':
                    console.error(prefix, entry.message, entry.data || '');
                    break;
                case 'success':
                    console.info(prefix, entry.message, entry.data || '');
                    break;
                default:
                    console.log(prefix, entry.message, entry.data || '');
            }
            return;
        }
        
        // Colored output
        const colors = this.config.colors;
        const reset = colors.reset;
        
        // Get color for current log level
        let levelColor = colors[levelLower] || colors.reset;
        let timeColor = colors.timestamp;
        
        // Format colored prefix
        const coloredTime = `${timeColor}[${formattedTime}]${reset}`;
        const coloredLevel = `${levelColor}[${levelUpper}]${reset}`;
        const prefix = `${coloredTime} ${coloredLevel}`;
        
        // Format message
        let message = entry.message;
        
        // Handle special case for errors with stack traces
        if (levelLower === 'error' && entry.data instanceof Error) {
            message = `${message}\n${entry.data.stack}`;
            entry.data = null; // Don't show the error object again
        }
        
        // Format data if present
        let dataStr = '';
        if (entry.data) {
            if (typeof entry.data === 'string') {
                dataStr = entry.data;
            } else {
                try {
                    dataStr = JSON.stringify(entry.data, null, 2);
                } catch (e) {
                    dataStr = `[Object: unable to stringify]`;
                }
            }
        }
        
        // Output to console with colors
        console.log(`${prefix} ${message}${reset}${dataStr ? ' ' + dataStr : ''}`);
    }

    /**
     * Check if log file needs rotation based on size
     * @private
     */
    _checkRotation() {
        try {
            if (!fs.existsSync(this.logFile)) {
                return;
            }
            
            const stats = fs.statSync(this.logFile);
            
            if (stats.size >= this.config.maxLogSize) {
                this._rotateLogFiles();
            }
        } catch (error) {
            console.error('Error checking log rotation:', error);
        }
    }

    /**
     * Rotate log files
     * @private
     */
    _rotateLogFiles() {
        try {
            // Check for existing rotated logs and remove oldest if necessary
            for (let i = this.config.maxLogFiles; i > 0; i--) {
                const oldPath = this.config.compressLogs
                    ? `${this.logFile}.${i}.gz`
                    : `${this.logFile}.${i}`;
                    
                if (fs.existsSync(oldPath)) {
                    if (i === this.config.maxLogFiles) {
                        fs.removeSync(oldPath);
                    } else {
                        const newPath = this.config.compressLogs
                            ? `${this.logFile}.${i + 1}.gz`
                            : `${this.logFile}.${i + 1}`;
                        fs.moveSync(oldPath, newPath);
                    }
                }
            }
            
            // Rotate current log to .1
            if (fs.existsSync(this.logFile)) {
                if (this.config.compressLogs) {
                    const gzipOutput = fs.createWriteStream(`${this.logFile}.1.gz`);
                    const gzip = zlib.createGzip();
                    const input = fs.createReadStream(this.logFile);
                    
                    input.pipe(gzip).pipe(gzipOutput);
                    
                    gzipOutput.on('finish', () => {
                        // Clear the current log file
                        fs.writeFileSync(this.logFile, '');
                        this.info('Log file rotated and compressed');
                    });
                } else {
                    fs.moveSync(this.logFile, `${this.logFile}.1`);
                    // Create new empty log file
                    fs.writeFileSync(this.logFile, '');
                    this.info('Log file rotated');
                }
            }
        } catch (error) {
            console.error('Error rotating logs:', error);
        }
    }

    /**
     * Send batched logs to remote endpoint
     * @private
     */
    async _sendRemoteLogs() {
        if (!this.remoteLoggingQueue.length || !this.config.remoteLoggingUrl) {
            return;
        }
        
        const logs = [...this.remoteLoggingQueue];
        this.remoteLoggingQueue = [];
        
        try {
            const response = await fetch(this.config.remoteLoggingUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    logs,
                    application: this.config.appName,
                    version: this.config.appVersion,
                    timestamp: new Date().toISOString()
                }),
            });
            
            if (!response.ok) {
                throw new Error(`Remote logging failed: ${response.statusText}`);
            }
        } catch (error) {
            // Add logs back to queue
            this.remoteLoggingQueue.unshift(...logs);
            // Trim if queue gets too large
            if (this.remoteLoggingQueue.length > 100) {
                this.remoteLoggingQueue = this.remoteLoggingQueue.slice(-100);
            }
            
            console.error('Failed to send logs to remote server:', error);
        }
    }

    /**
     * Write log entry to file
     * @private
     */
    _writeToFile(entry) {
        try {
            // Format the log entry for file output
            let line;
            if (this.config.structuredLogging) {
                // JSON format
                line = JSON.stringify(entry) + '\n';
            } else {
                // Plain text format
                line = `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}`;
                
                // Add metadata if present
                if (entry.metadata && Object.keys(entry.metadata).length > 0) {
                    const metadataStr = Object.entries(entry.metadata)
                        .filter(([key]) => !['appName', 'appVersion'].includes(key))
                        .map(([key, value]) => `${key}=${value}`)
                        .join(' ');
                    
                    if (metadataStr) {
                        line += ` (${metadataStr})`;
                    }
                }
                
                // Add data if present
                if (entry.data) {
                    line += ` ${JSON.stringify(entry.data)}`;
                }
                
                line += '\n';
            }
            
            fs.appendFile(this.logFile, line, err => {
                if (err) console.error('Failed to write to log file:', err);
            });
        } catch (error) {
            console.error('Error writing to log file:', error);
        }
    }

    /**
     * Debug level log - for detailed diagnostic information
     */
    debug(message, data = null, metadata = {}) {
        this.log('debug', message, data, metadata);
    }

    /**
     * Info level log - for general information
     */
    info(message, data = null, metadata = {}) {
        this.log('info', message, data, metadata);
    }

    /**
     * Warning level log - for potential issues
     */
    warn(message, data = null, metadata = {}) {
        this.log('warn', message, data, metadata);
    }

    /**
     * Error level log - for errors and exceptions
     */
    error(message, data = null, metadata = {}) {
        this.log('error', message, data, metadata);
    }

    /**
     * Critical level log - for critical errors that may cause application failure
     */
    critical(message, data = null, metadata = {}) {
        this.log('critical', message, data, metadata);
    }

    /**
     * Success level log - for successful operations
     */
    success(message, data = null, metadata = {}) {
        this.log('success', message, data, metadata);
    }

    /**
     * Add a listener for log events
     */
    addListener(callback) {
        console.log('[Logger] Adding listener');
        if (typeof callback === 'function') {
            this.listeners.add(callback);
            return true;
        }
        return false;
    }

    /**
     * Remove a listener
     */
    removeListener(callback) {
        console.log('[Logger] Removing listener');
        return this.listeners.delete(callback);
    }

    /**
     * Notify all listeners of a new log entry
     */
    notifyListeners(entry) {
        this.listeners.forEach(callback => {
            try {
                callback(entry);
            } catch (error) {
                console.error('Error in log listener:', error);
            }
        });
    }

    /**
     * Clear logs from memory and optionally from file
     */
    clear(clearFile = true) {
        this.logs = [];
        this.notifyListeners({ type: 'clear' });
        
        if (clearFile) {
            fs.writeFile(this.logFile, '', err => {
                if (err) console.error('Failed to clear log file:', err);
            });
        }
    }

    /**
     * Get all logs (with optional filtering)
     */
    getLogs(options = {}) {
        let filteredLogs = [...this.logs];
        
        // Filter by level
        if (options.level) {
            const minLevel = LOG_LEVELS[options.level.toUpperCase()];
            if (minLevel !== undefined) {
                filteredLogs = filteredLogs.filter(log => 
                    LOG_LEVELS[log.level.toUpperCase()] >= minLevel
                );
            }
        }
        
        // Filter by time range
        if (options.from) {
            const fromDate = new Date(options.from).getTime();
            filteredLogs = filteredLogs.filter(log => 
                new Date(log.timestamp).getTime() >= fromDate
            );
        }
        
        if (options.to) {
            const toDate = new Date(options.to).getTime();
            filteredLogs = filteredLogs.filter(log => 
                new Date(log.timestamp).getTime() <= toDate
            );
        }
        
        // Filter by search term
        if (options.search) {
            const searchTerm = options.search.toLowerCase();
            filteredLogs = filteredLogs.filter(log => 
                log.message.toLowerCase().includes(searchTerm) ||
                (log.data && JSON.stringify(log.data).toLowerCase().includes(searchTerm))
            );
        }
        
        // Filter by metadata
        if (options.metadata) {
            Object.entries(options.metadata).forEach(([key, value]) => {
                filteredLogs = filteredLogs.filter(log => 
                    log.metadata && 
                    log.metadata[key] !== undefined &&
                    log.metadata[key] === value
                );
            });
        }
        
        return filteredLogs;
    }

    /**
     * Export logs as formatted string
     */
    exportLogs(options = {}) {
        const logs = this.getLogs(options);
        
        if (options.format === 'json') {
            return JSON.stringify(logs, null, 2);
        }
        
        return logs.map(entry => 
            `[${entry.timestamp}] [${entry.level.toUpperCase()}] ${entry.message}${
                entry.data ? ' ' + JSON.stringify(entry.data) : ''
            }`
        ).join('\n');
    }

    /**
     * Read archived logs
     */
    async getArchivedLogs(index) {
        try {
            const logPath = this.config.compressLogs
                ? `${this.logFile}.${index}.gz`
                : `${this.logFile}.${index}`;
                
            if (!fs.existsSync(logPath)) {
                throw new Error(`Log file ${logPath} does not exist`);
            }
            
            if (this.config.compressLogs) {
                return new Promise((resolve, reject) => {
                    const chunks = [];
                    fs.createReadStream(logPath)
                        .pipe(zlib.createGunzip())
                        .on('data', chunk => chunks.push(chunk))
                        .on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
                        .on('error', err => reject(err));
                });
            } else {
                return fs.readFile(logPath, 'utf8');
            }
        } catch (error) {
            console.error(`Failed to read archived log: ${error.message}`);
            throw error;
        }
    }

    /**
     * Update logger configuration
     */
    updateConfig(newConfig) {
        this.config = {
            ...this.config,
            ...newConfig
        };
        
        this.info('Logger configuration updated', newConfig);
        
        // Handle remote logging changes
        if (newConfig.remoteLoggingUrl !== undefined) {
            if (this.remoteLoggingIntervalId) {
                clearInterval(this.remoteLoggingIntervalId);
                this.remoteLoggingIntervalId = null;
            }
            
            if (this.config.remoteLoggingUrl) {
                this.remoteLoggingIntervalId = setInterval(() => {
                    this._sendRemoteLogs();
                }, this.config.remoteLoggingInterval);
            }
        }
        
        return this.config;
    }

    /**
     * Set color theme
     */
    setColorTheme(theme) {
        if (!theme || typeof theme !== 'object') {
            return false;
        }
        
        this.config.colors = {
            ...this.config.colors,
            ...theme
        };
        
        return true;
    }

    /**
     * Toggle color output
     */
    toggleColors(enabled) {
        this.config.useColors = enabled !== undefined ? enabled : !this.config.useColors;
        return this.config.useColors;
    }

    /**
     * Toggle unicode symbols (emojis)
     */
    toggleUnicode(enabled) {
        this.config.useUnicode = enabled !== undefined ? enabled : !this.config.useUnicode;
        return this.config.useUnicode;
    }

    /**
     * Clean up resources when done
     */
    shutdown() {
        if (this.remoteLoggingIntervalId) {
            clearInterval(this.remoteLoggingIntervalId);
            this._sendRemoteLogs(); // Final attempt to send remaining logs
        }
        
        this.info('Logger shutting down');
    }
}

// Export a single instance
const logger = new Logger();
console.log('[Logger] Enhanced instance created');
module.exports = logger;