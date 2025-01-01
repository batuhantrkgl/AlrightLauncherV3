const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const { BrowserWindow } = require('electron');

class ServerManager {
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.serverDir = path.join(baseDir, 'servers');
        this.servers = new Map(); // Store running server instances
    }

    async initialize() {
        await fs.ensureDir(this.serverDir);
    }

    async downloadServerJar(version, jarPath) {
        try {
            // First, get the version manifest
            const manifestRes = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
            const manifest = await manifestRes.json();
            
            // Find the specific version
            const versionInfo = manifest.versions.find(v => v.id === version);
            if (!versionInfo) {
                throw new Error(`Version ${version} not found`);
            }

            // Get version-specific details
            const versionDetailsRes = await fetch(versionInfo.url);
            const versionDetails = await versionDetailsRes.json();
            
            if (!versionDetails.downloads?.server?.url) {
                throw new Error(`No server download available for ${version}`);
            }

            // Download the server jar
            return new Promise((resolve, reject) => {
                const file = fs.createWriteStream(jarPath);
                https.get(versionDetails.downloads.server.url, (response) => {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve(true);
                    });
                }).on('error', (err) => {
                    fs.unlink(jarPath);
                    reject(err);
                });
            });
        } catch (error) {
            console.error('Failed to download server jar:', error);
            throw error;
        }
    }

    async createServer(options) {
        const {
            name,
            version,
            port = 25565,
            memory = 2048,
            autostart = false
        } = options;

        const serverPath = path.join(this.serverDir, name);
        await fs.ensureDir(serverPath);

        // Download server jar
        const jarPath = path.join(serverPath, 'server.jar');
        if (!fs.existsSync(jarPath)) {
            console.log(`Downloading server jar for version ${version}...`);
            await this.downloadServerJar(version, jarPath);
            console.log('Server jar downloaded successfully');
        }

        // Update server.properties for better offline mode compatibility
        const properties = [
            'server-port=' + port,
            'online-mode=false',
            'motd=Alright Launcher Server',
            'difficulty=normal',
            'spawn-protection=16',
            'max-players=20',
            'view-distance=10',
            'spawn-monsters=true',
            'spawn-animals=true',
            'pvp=true',
            'allow-flight=false',
            'max-world-size=29999984',
            'enable-command-block=true',
            'enable-query=true',
            'enable-rcon=false',
            'network-compression-threshold=256',
            'prevent-proxy-connections=false',
            'use-native-transport=true',
            'enable-status=true',
            'broadcast-rcon-to-ops=true',
            'sync-chunk-writes=true',
            'allow-nether=true',
            'player-idle-timeout=0'
        ].join('\n');

        await fs.writeFile(path.join(serverPath, 'server.properties'), properties);
        await fs.writeFile(path.join(serverPath, 'eula.txt'), 'eula=true');

        // Create whitelist.json and ops.json
        await fs.writeFile(path.join(serverPath, 'whitelist.json'), '[]');
        await fs.writeFile(path.join(serverPath, 'ops.json'), '[]');

        // Create usercache.json for UUID tracking
        await fs.writeFile(path.join(serverPath, 'usercache.json'), '[]');

        // Create server configuration
        const config = {
            version,
            memory,
            port,
            autostart,
            created: new Date().toISOString()
        };
        await fs.writeFile(
            path.join(serverPath, 'server-config.json'),
            JSON.stringify(config, null, 2)
        );

        if (autostart) {
            await this.startServer(name);
        }

        return {
            name,
            path: serverPath,
            version,
            port,
            status: 'created'
        };
    }

    async startServer(name, memory = 2048) {
        const serverPath = path.join(this.serverDir, name);
        if (!fs.existsSync(serverPath)) {
            throw new Error('Server does not exist');
        }

        // Load server config if it exists
        let config = { memory: 2048 };
        try {
            const configPath = path.join(serverPath, 'server-config.json');
            if (fs.existsSync(configPath)) {
                config = JSON.parse(await fs.readFile(configPath, 'utf8'));
            }
        } catch (error) {
            console.warn('Failed to load server config:', error);
        }

        // Use provided memory or fall back to config/default
        const memoryMB = memory || config.memory || 2048;

        // First time server setup - accept EULA
        if (!fs.existsSync(path.join(serverPath, 'eula.txt'))) {
            await fs.writeFile(path.join(serverPath, 'eula.txt'), 'eula=true');
        }

        const server = spawn('java', [
            `-Xmx${memoryMB}M`,
            `-Xms${memoryMB}M`,
            '-jar',
            'server.jar',
            'nogui'
        ], {
            cwd: serverPath,
            stdio: ['pipe', 'pipe', 'pipe']  // Enable all stdio channels
        });

        this.servers.set(name, server);

        // Create log file
        const logStream = fs.createWriteStream(path.join(serverPath, 'latest.log'), { flags: 'a' });

        return new Promise((resolve, reject) => {
            let serverStarted = false;
            let startupBuffer = '';
            const startTimeout = 180000; // 3 minutes timeout
            let errorOutput = '';

            server.stdout.on('data', (data) => {
                const output = data.toString();
                startupBuffer += output;
                this.emitLog(name, 'info', output);
                logStream.write(output);

                // Check for various success indicators
                if (output.includes('Done') || 
                    output.includes('For help, type "help"') ||
                    output.includes('Starting Minecraft server')) {
                    serverStarted = true;
                    resolve({
                        status: 'running',
                        port: this.getServerPort(name)
                    });
                }
            });

            server.stderr.on('data', (data) => {
                const output = data.toString();
                errorOutput += output;
                this.emitLog(name, 'error', output);
                logStream.write(output);
            });

            server.on('error', (error) => {
                this.emitLog(name, 'error', `Server process error: ${error.message}`);
                reject(error);
            });

            server.on('exit', (code) => {
                this.emitLog(name, 'info', `Server stopped with code ${code}`);
                this.servers.delete(name);
                logStream.end();

                if (!serverStarted) {
                    reject(new Error(
                        `Server failed to start (exit code ${code})\n` +
                        `Last error output: ${errorOutput}\n` +
                        `Startup buffer: ${startupBuffer}`
                    ));
                }
            });

            // Progress checking interval
            const progressCheck = setInterval(() => {
                if (startupBuffer.includes('Loading properties') || 
                    startupBuffer.includes('Preparing level') ||
                    startupBuffer.includes('Starting minecraft server')) {
                    // Reset timeout if we see progress
                    clearTimeout(timeoutHandle);
                    timeoutHandle = setTimeout(onTimeout, startTimeout);
                }
            }, 5000);

            // Timeout handler
            const onTimeout = () => {
                clearInterval(progressCheck);
                if (!serverStarted) {
                    server.kill();
                    reject(new Error(
                        `Server start timeout after ${startTimeout}ms\n` +
                        `Last output: ${startupBuffer}`
                    ));
                }
            };

            let timeoutHandle = setTimeout(onTimeout, startTimeout);
        });
    }

    emitLog(serverName, level, message) {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach(window => {
            if (!window.isDestroyed()) {
                window.webContents.send('server-log', {
                    server: serverName,
                    level,
                    message: message.trim(),
                    timestamp: new Date().toISOString()
                });
            }
        });
    }

    stopServer(name) {
        const server = this.servers.get(name);
        if (!server) return false;

        server.stdin.write('stop\n');
        this.servers.delete(name);
        return true;
    }

    isServerRunning(name) {
        return this.servers.has(name);
    }

    getServerPort(name) {
        const propertiesPath = path.join(this.serverDir, name, 'server.properties');
        try {
            const content = fs.readFileSync(propertiesPath, 'utf8');
            const portMatch = content.match(/server-port=(\d+)/);
            return portMatch ? parseInt(portMatch[1]) : 25565;
        } catch {
            return 25565;
        }
    }

    async getServerList() {
        try {
            await fs.ensureDir(this.serverDir);
            const dirs = await fs.readdir(this.serverDir);
            
            return Promise.all(dirs.map(async (name) => {
                const serverPath = path.join(this.serverDir, name);
                const isDirectory = (await fs.stat(serverPath)).isDirectory();
                
                if (!isDirectory) return null;

                const isRunning = this.isServerRunning(name);
                const port = this.getServerPort(name);
                
                // Load server configuration
                let config = {};
                try {
                    const configPath = path.join(serverPath, 'server-config.json');
                    if (await fs.pathExists(configPath)) {
                        config = JSON.parse(await fs.readFile(configPath, 'utf8'));
                    }
                } catch (error) {
                    console.warn(`Failed to load config for server ${name}:`, error);
                }

                // Load server.properties
                let properties = {};
                try {
                    const propsPath = path.join(serverPath, 'server.properties');
                    if (await fs.pathExists(propsPath)) {
                        const propsContent = await fs.readFile(propsPath, 'utf8');
                        properties = this.parseProperties(propsContent);
                    }
                } catch (error) {
                    console.warn(`Failed to load properties for server ${name}:`, error);
                }

                return {
                    name,
                    path: serverPath,
                    status: isRunning ? 'running' : 'stopped',
                    port,
                    config,
                    properties,
                    version: config.version || 'unknown'
                };
            }));
        } catch (error) {
            console.error('Error getting server list:', error);
            return [];
        }
    }

    parseProperties(content) {
        const properties = {};
        content.split('\n').forEach(line => {
            line = line.trim();
            if (line && !line.startsWith('#')) {
                const [key, value] = line.split('=');
                if (key && value) {
                    properties[key.trim()] = value.trim();
                }
            }
        });
        return properties;
    }
}

module.exports = ServerManager;
