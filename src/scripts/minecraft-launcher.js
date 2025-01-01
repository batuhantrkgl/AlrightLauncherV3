const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra'); // Change this line to use fs-extra
const logger = require('./logger');
const MinecraftInstaller = require('./minecraft-installer');

class MinecraftLauncher {
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.javaPath = null;
        this.runningProcesses = new Map(); // Track running game processes
        logger.info('MinecraftLauncher initialized');
    }

    findJavaPath() {
        const possiblePaths = [
            // Program Files paths
            ...['', ' (x86)'].map(suffix => 
                path.join(process.env['ProgramFiles' + suffix] || '', 'Java')
            ),
            // Eclipse/AdoptOpenJDK paths
            path.join(process.env['ProgramFiles'] || '', 'Eclipse Adoptium'),
            path.join(process.env['ProgramFiles'] || '', 'AdoptOpenJDK'),
            // Microsoft JDK paths
            path.join(process.env['ProgramFiles'] || '', 'Microsoft', 'jdk-17.0.3.7-hotspot'),
            // Zulu paths
            path.join(process.env['ProgramFiles'] || '', 'Zulu', 'zulu-17'),
        ];

        // First check JAVA_HOME
        if (process.env.JAVA_HOME) {
            const javaExe = path.join(process.env.JAVA_HOME, 'bin', 'java.exe');
            if (fs.existsSync(javaExe)) return javaExe;
        }

        // Check all possible paths
        for (const basePath of possiblePaths) {
            if (fs.existsSync(basePath)) {
                const versions = fs.readdirSync(basePath);
                for (const version of versions) {
                    const javaExe = path.join(basePath, version, 'bin', 'java.exe');
                    if (fs.existsSync(javaExe)) return javaExe;
                }
            }
        }

        // Try system PATH
        return 'java';
    }

    async verifyJava() {
        return new Promise((resolve) => {
            logger.info('Checking Java installation...');
            const javaPath = this.findJavaPath();
            logger.info(`Found Java path: ${javaPath}`);

            const java = spawn(javaPath, ['-version']);
            
            java.stderr.on('data', (data) => {
                const version = data.toString();
                logger.info(`Java version found: ${version.trim()}`);
                resolve(true);
            });

            java.on('error', (err) => {
                logger.error(`Java verification error: ${err.message}`);
                resolve(false);
            });

            java.on('exit', (code) => {
                if (code !== 0) {
                    logger.warn(`Java verification exited with code: ${code}`);
                }
                resolve(code === 0);
            });
        });
    }

    getLibrariesClasspath(version) {
        const versionDir = path.join(this.baseDir, 'versions', version);
        const versionJson = require(path.join(versionDir, `${version}.json`));
        const librariesDir = path.join(this.baseDir, 'libraries');
        let classpath = [];

        // Add all required libraries
        for (const lib of versionJson.libraries) {
            if (this.isLibraryCompatible(lib)) {
                const libPath = this.getLibraryPath(lib, librariesDir);
                if (fs.existsSync(libPath)) {
                    classpath.push(libPath);
                }
            }
        }

        // Add the client jar
        const clientJar = path.join(versionDir, `${version}.jar`);
        if (fs.existsSync(clientJar)) {
            classpath.push(clientJar);
        }

        return classpath.join(path.delimiter);
    }

    isLibraryCompatible(library) {
        if (!library.rules) return true;
        
        let compatible = false;
        for (const rule of library.rules) {
            if (rule.os) {
                const osName = process.platform === 'win32' ? 'windows' : process.platform;
                if (rule.os.name === osName) {
                    compatible = rule.action === 'allow';
                }
            } else {
                compatible = rule.action === 'allow';
            }
        }
        return compatible;
    }

    getLibraryPath(library, librariesDir) {
        const parts = library.name.split(':');
        const [group, artifact, version] = parts;
        const path1 = group.replace(/\./g, '/');
        return path.join(librariesDir, path1, artifact, version, `${artifact}-${version}.jar`);
    }

    generateUUID() {
        // Generate RFC 4122 version 4 UUID
        const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
        return uuid;
    }

    uuidToIntArray(uuid) {
        // Convert UUID to int array format for NBT data
        const hex = uuid.replace(/-/g, '');
        const ints = [];
        for (let i = 0; i < 4; i++) {
            ints.push(parseInt(hex.slice(i * 8, (i + 1) * 8), 16));
        }
        return ints;
    }

    async launch(version, username, isTest = false) {
        try {
            // Create necessary directories using fs-extra
            const gameDir = path.join(this.baseDir);
            const crashReportsDir = path.join(gameDir, 'crash-reports');
            await fs.ensureDir(crashReportsDir);

            console.log(`Launching Minecraft ${version} for user ${username}`);
            const installer = new MinecraftInstaller();
            await installer.installVersion(version);

            const hasJava = await this.verifyJava();
            if (!hasJava) {
                throw new Error('Java is not installed. Please install Java 17 or newer.');
            }

            const versionDir = path.join(this.baseDir, 'versions', version);
            const versionJson = require(path.join(versionDir, `${version}.json`));
            const nativesDir = path.join(versionDir, 'natives');

            // Ensure natives directory exists
            await fs.ensureDir(nativesDir); // Use fs-extra's ensureDir

            const classpath = this.getLibrariesClasspath(version);
            const mainClass = versionJson.mainClass;

            const playerUUID = this.generateUUID();
            const accessToken = playerUUID.replace(/-/g, '');

            // Create launcher_profiles.json with offline mode settings
            await fs.writeFile(
                path.join(this.baseDir, 'launcher_profiles.json'),
                JSON.stringify({
                    authenticationDatabase: {
                        [playerUUID]: {
                            accessToken: accessToken,
                            username: username,
                            properties: [],
                            type: "msa"
                        }
                    },
                    clientToken: this.generateUUID(),
                    launcherVersion: {
                        format: 21,
                        name: "AlrightLauncher",
                        profiles: {
                            [playerUUID]: {
                                created: new Date().toISOString(),
                                icon: "Grass",
                                lastUsed: new Date().toISOString(),
                                name: username,
                                type: "latest-release",
                                lastVersionId: version
                            }
                        },
                        selectedProfile: playerUUID
                    }
                }, null, 2)
            );

            const args = [
                // JVM Arguments
                '-Xmx2G',
                '-XX:+UnlockExperimentalVMOptions',
                '-XX:+UseG1GC',
                '-XX:G1NewSizePercent=20',
                '-XX:G1ReservePercent=20',
                '-XX:MaxGCPauseMillis=50',
                '-XX:G1HeapRegionSize=32M',
                `-Djava.library.path=${nativesDir}`,
                // Add custom authentication server properties
                '-Dminecraft.api.auth.host=http://127.0.0.1:25566',
                '-Dminecraft.api.account.host=http://127.0.0.1:25566',
                '-Dminecraft.api.session.host=http://127.0.0.1:25566',
                '-Dminecraft.api.services.host=http://127.0.0.1:25566',
                '-Dauthlibinjector.yggdrasil.host=http://127.0.0.1:25566',
                '-Dminecraft.launcher.brand=alright-launcher',
                '-Dminecraft.launcher.version=3.0',
                
                // Class path
                '-cp',
                classpath,
                
                // Main class
                mainClass,
                
                // Game arguments
                '--username', username,
                '--version', version,
                '--gameDir', this.baseDir,
                '--assetsDir', path.join(this.baseDir, 'assets'),
                '--assetIndex', versionJson.assetIndex.id,
                '--uuid', playerUUID,
                '--accessToken', accessToken,
                '--clientId', '',
                '--xuid', this.generateXUID(),
                '--userType', 'msa',
                '--versionType', 'release'
            ];

            // Save UUID for future use
            await fs.writeFile(
                path.join(this.baseDir, 'player.json'),
                JSON.stringify({
                    username,
                    uuid: playerUUID,
                    uuidInts: this.uuidToIntArray(playerUUID)
                }, null, 2)
            );

            const javaPath = this.findJavaPath();
            logger.info(`Launching Minecraft with command: ${javaPath} ${args.join(' ')}`);

            const minecraft = spawn(javaPath, args, {
                cwd: this.baseDir,
                stdio: isTest ? 'ignore' : 'inherit',
                detached: !isTest
            });

            // Store the process ID and version
            const pid = minecraft.pid;
            this.runningProcesses.set(version, pid);

            // Monitor process termination
            minecraft.on('exit', () => {
                this.runningProcesses.delete(version);
            });

            if (!isTest) {
                minecraft.unref();
            }

            return isTest ? minecraft : { pid, process: minecraft };
        } catch (error) {
            console.error('Launch error:', error);
            throw error;
        }
    }

    generateXUID() {
        // Generate a valid XUID format (used for multiplayer)
        return '2535' + Math.floor(Math.random() * 1000000000000).toString();
    }

    isGameRunning(version) {
        try {
            const pid = this.runningProcesses.get(version);
            if (!pid) return false;

            // Check if process is still running
            process.kill(pid, 0);
            return true;
        } catch (error) {
            // Process not running
            this.runningProcesses.delete(version);
            return false;
        }
    }
}

module.exports = MinecraftLauncher;
