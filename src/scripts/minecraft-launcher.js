const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra'); // Change this line to use fs-extra
const logger = require('./logger');
const MinecraftInstaller = require('./minecraft-installer');
const extract = require('extract-zip'); // Add this import

class MinecraftLauncher {
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.versionsDir = path.join(baseDir, 'versions');
        this.librariesDir = path.join(baseDir, 'libraries'); // Add this line
        this.assetsDir = path.join(baseDir, 'assets');
        this.javaPath = null;
        this.runningProcesses = new Map(); // Track running game processes
        logger.info('MinecraftLauncher initialized');
        this.javaVersions = {
            legacy: {
                minVersion: 6,
                maxVersion: 8,
                path: null
            },
            modern: {
                minVersion: 17,
                maxVersion: 21,
                path: null
            }
        };

        // Ensure all required directories exist
        fs.ensureDirSync(this.baseDir);
        fs.ensureDirSync(this.versionsDir);
        fs.ensureDirSync(this.librariesDir);
        fs.ensureDirSync(this.assetsDir);
        
        logger.info(`MinecraftLauncher initialized with base directory: ${this.baseDir}`);
    }

    getRequiredJavaVersion(minecraftVersion) {
        // Convert version string to number for comparison
        const versionNum = parseFloat(minecraftVersion);
        
        // Updated version checks:
        if (versionNum <= 1.12) {
            return 'legacy'; // Java 8 required for versions 1.12 and older
        } else if (versionNum <= 1.16) {
            return 'legacy'; // Java 8 still good for 1.13 - 1.16
        }
        return 'modern'; // Java 17+ for versions 1.17 and newer
    }

    findJavaPath(requiredVersion = 'modern') {
        if (this.javaVersions[requiredVersion].path) {
            return this.javaVersions[requiredVersion].path;
        }

        // First check Adoptium directory for numeric versioned paths
        const adoptiumDir = path.join(process.env['ProgramFiles'], 'Eclipse Adoptium');
        if (fs.existsSync(adoptiumDir)) {
            try {
                const entries = fs.readdirSync(adoptiumDir);
                const javaEntries = entries.filter(entry => {
                    // Match patterns like jre-8.x.x, jdk-8.x.x
                    const match = entry.match(/^(jre|jdk)-(\d+)/);
                    if (!match) return false;
                    
                    const majorVersion = parseInt(match[2]);
                    const config = this.javaVersions[requiredVersion];
                    return majorVersion >= config.minVersion && majorVersion <= config.maxVersion;
                });

                for (const entry of javaEntries) {
                    const javaExe = path.join(adoptiumDir, entry, 'bin', 'java.exe');
                    if (fs.existsSync(javaExe)) {
                        logger.info(`Found ${requiredVersion} Java at: ${javaExe}`);
                        this.javaVersions[requiredVersion].path = javaExe;
                        return javaExe;
                    }
                }
            } catch (error) {
                logger.error(`Error searching Adoptium directory: ${error.message}`);
            }
        }

        // Define Java paths with explicit version checks
        const adoptiumPaths = {
            legacy: [
                // Eclipse Adoptium paths
                path.join(process.env['ProgramFiles'], 'Eclipse Adoptium', 'jre-8'),
                path.join(process.env['ProgramFiles'], 'Eclipse Adoptium', 'jdk-8'),
                path.join(process.env['ProgramFiles(x86)'], 'Eclipse Adoptium', 'jre-8'),
                // Oracle Java 8 paths
                path.join(process.env['ProgramFiles'], 'Java', 'jre1.8.0_301'),
                path.join(process.env['ProgramFiles'], 'Java', 'jdk1.8.0_301'),
                path.join(process.env['ProgramFiles(x86)'], 'Java', 'jre1.8.0_301'),
                // Zulu Java 8 paths
                path.join(process.env['ProgramFiles'], 'Zulu', 'zulu-8'),
                // AdoptOpenJDK paths
                path.join(process.env['ProgramFiles'], 'AdoptOpenJDK', 'jre-8'),
                path.join(process.env['ProgramFiles'], 'AdoptOpenJDK', 'jdk-8')
            ],
            modern: [
                path.join(process.env['ProgramFiles'], 'Eclipse Adoptium', 'jre-17'),
                path.join(process.env['ProgramFiles'], 'Eclipse Adoptium', 'jre-21'),
                path.join(process.env['ProgramFiles'], 'Eclipse Adoptium', 'jdk-17'),
                path.join(process.env['ProgramFiles'], 'Eclipse Adoptium', 'jdk-21')
            ]
        };

        // Try specific paths first
        for (const basePath of adoptiumPaths[requiredVersion]) {
            if (fs.existsSync(basePath)) {
                const javaExe = path.join(basePath, 'bin', 'java.exe');
                if (fs.existsSync(javaExe)) {
                    // Verify Java version before using
                    try {
                        const output = require('child_process').execSync(`"${javaExe}" -version 2>&1`).toString();
                        const versionMatch = output.match(/version "([^"]+)"/);
                        if (versionMatch) {
                            const javaVersion = parseInt(versionMatch[1].split('.')[0]);
                            const config = this.javaVersions[requiredVersion];
                            if (javaVersion >= config.minVersion && javaVersion <= config.maxVersion) {
                                this.javaVersions[requiredVersion].path = javaExe;
                                logger.info(`Found ${requiredVersion} Java at: ${javaExe}`);
                                return javaExe;
                            }
                        }
                    } catch (error) {
                        logger.error(`Failed to verify Java at ${javaExe}: ${error.message}`);
                    }
                }
            }
        }

        // Search Program Files recursively for Java installations
        const searchDirs = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean);
        for (const searchDir of searchDirs) {
            try {
                const foundJava = this.findJavaInDirectory(searchDir, requiredVersion);
                if (foundJava) return foundJava;
            } catch (error) {
                logger.error(`Error searching in ${searchDir}: ${error.message}`);
            }
        }

        throw new Error(`Could not find ${requiredVersion} Java installation. Please install Java ${requiredVersion === 'legacy' ? '8' : '17+'}`);
    }

    findJavaInDirectory(dir, requiredVersion) {
        try {
            if (!fs.existsSync(dir)) return null;
            
            // Skip known problematic directories
            const skipDirs = ['WindowsApps', '$Recycle.Bin', 'System Volume Information'];
            if (skipDirs.some(skip => dir.includes(skip))) {
                logger.debug?.(`Skipping restricted directory: ${dir}`);
                return null;
            }

            const files = fs.readdirSync(dir, { withFileTypes: true });
            for (const file of files) {
                try {
                    const fullPath = path.join(dir, file.name);
                    
                    // Skip if we can't access the directory
                    if (!this.canAccessDirectory(fullPath)) {
                        continue;
                    }

                    if (file.isDirectory()) {
                        // Check if this directory contains java.exe
                        const javaExe = path.join(fullPath, 'bin', 'java.exe');
                        if (fs.existsSync(javaExe)) {
                            try {
                                const output = require('child_process').execSync(`"${javaExe}" -version 2>&1`).toString();
                                const versionMatch = output.match(/version "([^"]+)"/);
                                if (versionMatch) {
                                    const javaVersion = parseInt(versionMatch[1].split('.')[0]);
                                    const config = this.javaVersions[requiredVersion];
                                    if (javaVersion >= config.minVersion && javaVersion <= config.maxVersion) {
                                        this.javaVersions[requiredVersion].path = javaExe;
                                        logger.info(`Found ${requiredVersion} Java at: ${javaExe}`);
                                        return javaExe;
                                    }
                                }
                            } catch (error) {
                                logger.debug?.(`Invalid Java at ${javaExe}: ${error.message}`);
                            }
                        }
                        
                        // Recursively search subdirectories
                        const found = this.findJavaInDirectory(fullPath, requiredVersion);
                        if (found) return found;
                    }
                } catch (error) {
                    // Skip files/directories we can't access
                    logger.debug?.(`Skipping inaccessible path: ${file.name}`);
                    continue;
                }
            }
        } catch (error) {
            logger.debug?.(`Error searching directory ${dir}: ${error.message}`);
        }
        return null;
    }

    canAccessDirectory(dir) {
        try {
            fs.accessSync(dir, fs.constants.R_OK);
            return true;
        } catch {
            return false;
        }
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

    async extractLegacyNatives(version, versionJson, nativesDir) {
        logger.info(`Setting up natives for ${version} in ${nativesDir}...`);
        
        try {
            // Ensure natives directory exists and is empty
            await fs.ensureDir(nativesDir);
            await fs.emptyDir(nativesDir);

            for (const lib of versionJson.libraries) {
                if (!this.isLibraryCompatible(lib)) continue;
                if (!lib.natives) continue;

                const nativeKey = lib.natives.windows || lib.natives['windows-64'];
                if (!nativeKey) continue;

                // Handle both new and old version JSON formats
                let nativePath;
                if (lib.downloads?.classifiers?.[nativeKey]) {
                    // New format
                    nativePath = path.join(
                        this.baseDir,
                        'libraries',
                        lib.downloads.classifiers[nativeKey].path
                    );
                } else if (lib.url && lib.name) {
                    // Old format
                    const parts = lib.name.split(':');
                    const nativeSuffix = nativeKey.replace('${arch}', '64');
                    nativePath = path.join(
                        this.baseDir,
                        'libraries',
                        parts[0].replace(/\./g, '/'),
                        parts[1],
                        parts[2],
                        `${parts[1]}-${parts[2]}-${nativeSuffix}.jar`
                    );
                }

                if (nativePath && await fs.pathExists(nativePath)) {
                    logger.info(`Extracting native: ${nativePath}`);
                    try {
                        await extract(nativePath, {
                            dir: nativesDir,
                            onEntry: (entry) => {
                                // Skip META-INF and directories
                                const skip = entry.fileName.startsWith('META-INF/') ||
                                           entry.fileName.endsWith('/');
                                return !skip;
                            }
                        });
                    } catch (err) {
                        logger.error(`Failed to extract ${nativePath}: ${err.message}`);
                    }
                } else {
                    logger.warn(`Missing native: ${nativePath}`);
                }
            }

            // Verify natives were extracted
            const files = await fs.readdir(nativesDir);
            if (files.length === 0) {
                throw new Error('No natives were extracted');
            }

            logger.info(`Successfully extracted ${files.length} native files`);
            
            // Set permissions for all extracted files
            for (const file of files) {
                const filePath = path.join(nativesDir, file);
                await fs.chmod(filePath, 0o755);
            }
        } catch (error) {
            logger.error(`Failed to set up natives: ${error.message}`);
            throw error;
        }
    }

    async extractNativesForVersion(version, versionJson, nativesDir) {
        logger.info(`Extracting natives for ${version}...`);
        await fs.ensureDir(nativesDir);
        
        const natives = [
            {
                name: 'LWJGL',
                path: 'org/lwjgl/lwjgl/lwjgl-platform/2.9.4-nightly-20150209/lwjgl-platform-2.9.4-nightly-20150209-natives-windows.jar'
            },
            {
                name: 'Jinput',
                path: 'net/java/jinput/jinput-platform/2.0.5/jinput-platform-2.0.5-natives-windows.jar'
            }
        ];

        for (const native of natives) {
            const nativePath = path.join(this.baseDir, 'libraries', native.path);
            if (await fs.pathExists(nativePath)) {
                logger.info(`Extracting ${native.name} natives from ${nativePath}`);
                await extract(nativePath, {
                    dir: nativesDir,
                    onEntry: (entry) => {
                        // Only extract DLL files and skip META-INF
                        const valid = entry.fileName.endsWith('.dll') && !entry.fileName.includes('META-INF');
                        if (valid) {
                            logger.info(`Extracting native: ${entry.fileName}`);
                        }
                        return valid;
                    }
                });
            } else {
                logger.error(`Missing native library: ${nativePath}`);
            }
        }

        // Set permissions on extracted files
        const files = await fs.readdir(nativesDir);
        for (const file of files) {
            await fs.chmod(path.join(nativesDir, file), 0o755);
            logger.info(`Set permissions for ${file}`);
        }

        logger.info(`Natives extracted: ${files.join(', ')}`);
        return files.length > 0;
    }

    async launch(version, username, isTest = false) {
        try {
            const gamePath = this.baseDir;
            const versionPath = path.join(gamePath, 'versions', version);
            
            // Create necessary directories using fs-extra
            const gameDir = path.join(this.baseDir);
            const crashReportsDir = path.join(gameDir, 'crash-reports');
            await fs.ensureDir(crashReportsDir);

            logger.info(`Launching Minecraft ${version} for user ${username}`);
            const installer = new MinecraftInstaller();
            await installer.installVersion(version);

            const hasJava = await this.verifyJava();
            if (!hasJava) {
                throw new Error('Java is not installed. Please install Java 17 or newer.');
            }

            const versionDir = path.join(this.baseDir, 'versions', version);
            const versionJsonPath = path.join(versionDir, `${version}.json`);
            
            // Verify version json exists
            if (!await fs.pathExists(versionJsonPath)) {
                throw new Error(`Version ${version} is not installed properly`);
            }

            const versionJson = require(versionJsonPath);
            const nativesDir = path.join(versionDir, 'natives');

            // Extract natives before launch
            await this.extractNativesForVersion(version, versionJson, nativesDir);

            // Verify natives were extracted
            const nativeFiles = await fs.readdir(nativesDir);
            if (!nativeFiles.includes('lwjgl64.dll')) {
                throw new Error('Critical native files are missing. Cannot launch game.');
            }

            // Verify client jar exists
            const clientJar = path.join(versionDir, `${version}.jar`);
            if (!await fs.pathExists(clientJar)) {
                throw new Error('Game files are missing or corrupted');
            }

            const classpath = this.getLibrariesClasspath(version);
            const mainClass = versionJson.mainClass;

            const requiredJavaVersion = this.getRequiredJavaVersion(version);
            logger.info(`Required Java version for Minecraft ${version}: ${requiredJavaVersion}`);
            
            // Ensure we get the correct Java version
            const javaPath = this.findJavaPath(requiredJavaVersion);
            if (!javaPath) {
                throw new Error(`Required Java version (${requiredJavaVersion}) not found. Please install Java ${requiredJavaVersion === 'legacy' ? '8' : '17+'}`);
            }

            // Log Java version being used
            try {
                const { execSync } = require('child_process');
                const javaVersion = execSync(`"${javaPath}" -version 2>&1`).toString();
                logger.info(`Using Java for Minecraft ${version}:\n${javaVersion.trim()}`);
            } catch (error) {
                logger.warn(`Could not verify Java version: ${error.message}`);
            }

            const maxMemory = process.env.MAX_MEMORY || '2G';

            // Extract natives for old versions
            if (parseFloat(version) <= 1.16) {
                await this.extractLegacyNatives(version, versionJson, nativesDir);
            }

            // Updated legacy version detection for 1.16.5
            const isLegacy = parseFloat(version) < 1.13;
            const gameArgs = [];

            // Handle game arguments based on version
            if (versionJson.arguments?.game) {
                // Modern versions (1.13+)
                const processedArgs = new Set(); // Track which arguments we've already added
                
                // First add arguments from versionJson
                for (const arg of versionJson.arguments.game) {
                    if (typeof arg === 'string') {
                        const processedArg = arg
                            .replace('${auth_player_name}', username)
                            .replace('${version_name}', version)
                            .replace('${game_directory}', this.baseDir)
                            .replace('${assets_root}', path.join(this.baseDir, 'assets'))
                            .replace('${assets_index_name}', versionJson.assetIndex.id)
                            .replace('${user_type}', 'msa')
                            .replace('${version_type}', 'release');
                        
                        // Check if this is an argument flag (starts with --)
                        if (processedArg.startsWith('--')) {
                            const argKey = processedArg.split(' ')[0];
                            if (!processedArgs.has(argKey)) {
                                gameArgs.push(processedArg);
                                processedArgs.add(argKey);
                            }
                        } else {
                            gameArgs.push(processedArg);
                        }
                    }
                }

                // Add required arguments only if they haven't been added yet
                const requiredArgs = [
                    ['--username', username],
                    ['--version', version],
                    ['--gameDir', this.baseDir],
                    ['--assetsDir', path.join(this.baseDir, 'assets')],
                    ['--assetIndex', versionJson.assetIndex.id],
                    ['--accessToken', '0'],
                    ['--userProperties', '{}'],
                    ['--userType', 'msa'],
                    ['--versionType', 'release'],
                    ['--uuid', this.generateUUID().replace(/-/g, '')]
                ];

                for (const [key, value] of requiredArgs) {
                    if (!processedArgs.has(key)) {
                        gameArgs.push(key, value);
                        processedArgs.add(key);
                    }
                }
            } else if (versionJson.minecraftArguments) {
                // Legacy versions with minecraftArguments
                const args = versionJson.minecraftArguments
                    .replace('${auth_player_name}', username)
                    .replace('${version_name}', version)
                    .replace('${game_directory}', this.baseDir)
                    .replace('${assets_root}', path.join(this.baseDir, 'assets'))
                    .replace('${assets_index_name}', versionJson.assetIndex.id)
                    .replace('${auth_uuid}', this.generateUUID().replace(/-/g, ''))
                    .replace('${auth_access_token}', '0')
                    .replace('${user_properties}', '{}')
                    .replace('${user_type}', 'msa')
                    .replace('${version_type}', 'release')
                    .split(' ');
                gameArgs.push(...args);
            } else {
                // Very old versions or missing arguments
                throw new Error('Invalid version data: missing game arguments');
            }

            const args = [
                `-Xmx${maxMemory}`,
                '-XX:+UnlockExperimentalVMOptions',
                '-XX:+UseG1GC',
                '-XX:G1NewSizePercent=20',
                '-XX:G1ReservePercent=20',
                '-XX:MaxGCPauseMillis=50',
                '-XX:G1HeapRegionSize=32M',
                // Add native path explicitly
                `-Djava.library.path=${nativesDir}`,
                `-Dorg.lwjgl.librarypath=${nativesDir}`,
                `-Dnet.java.games.input.librarypath=${nativesDir}`,
                '-Dminecraft.launcher.brand=alright-launcher',
                '-Dminecraft.launcher.version=3.0',
                '-cp',
                classpath,
                mainClass,
                ...gameArgs
            ];

            // Log the complete command for debugging
            logger.info(`Launch command: ${javaPath} ${args.join(' ')}`);

            const minecraft = spawn(javaPath, args, {
                cwd: this.baseDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: !isTest
            });

            // Capture output for debugging
            minecraft.stdout.on('data', (data) => {
                logger.info(`Game output: ${data}`);
            });

            minecraft.stderr.on('data', (data) => {
                logger.error(`Game error: ${data}`);
            });

            // Monitor process
            const pid = minecraft.pid;
            this.runningProcesses.set(version, pid);

            minecraft.on('exit', (code, signal) => {
                this.runningProcesses.delete(version);
                logger.info(`Game process exited with code ${code} and signal ${signal}`);
            });

            if (!isTest) {
                minecraft.unref();
            }

            return { success: true, pid, process: minecraft };
        } catch (error) {
            logger.error(`Launch error: ${error.stack}`);
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
