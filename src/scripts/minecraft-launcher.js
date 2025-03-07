const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra'); // Change this line to use fs-extra
const logger = require('./logger');
const MinecraftInstaller = require('./minecraft-installer');
const extract = require('extract-zip'); // Add this import
const AdmZip = require('adm-zip'); // Add this import

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

    getRequiredJavaVersion(versionJson) {
        // First check if version JSON specifies Java version
        if (versionJson.javaVersion) {
            if (versionJson.javaVersion.component === 'jre-legacy' || 
                versionJson.javaVersion.majorVersion === 8) {
                return 'legacy';
            }
        }

        // Fallback to version number check
        const versionNum = parseFloat(versionJson.id);
        
        if (versionNum <= 1.16) {
            return 'legacy'; // Java 8 required for versions 1.16 and older
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
        await fs.emptyDir(nativesDir); // Clear existing natives

        // Handle LWJGL 3.x natives (1.17+)
        const isLWJGL3 = parseFloat(version) >= 1.17;
        
        for (const lib of versionJson.libraries) {
            if (!this.isLibraryCompatible(lib)) continue;
            
            // For LWJGL 3.x, check for natives in downloads.classifiers
            if (isLWJGL3 && lib.downloads?.classifiers) {
                const nativeKey = 'natives-windows';
                const nativeData = lib.downloads.classifiers[nativeKey];
                
                if (nativeData) {
                    const nativePath = path.join(this.baseDir, 'libraries', nativeData.path);
                    if (await fs.pathExists(nativePath)) {
                        logger.info(`Extracting native: ${nativePath}`);
                        try {
                            await extract(nativePath, {
                                dir: nativesDir,
                                onEntry: (entry) => {
                                    // Only extract DLL files and skip META-INF
                                    const valid = entry.fileName.endsWith('.dll') && 
                                                !entry.fileName.includes('META-INF');
                                    if (valid) {
                                        logger.info(`Extracting native: ${entry.fileName}`);
                                    }
                                    return valid;
                                }
                            });
                        } catch (err) {
                            logger.error(`Failed to extract ${nativePath}: ${err.message}`);
                        }
                    }
                }
                continue;
            }

            // Handle legacy natives
            if (lib.natives) {
                const nativeKey = lib.natives.windows || lib.natives['windows-64'];
                if (!nativeKey) continue;

                let nativePath;
                if (lib.downloads?.classifiers?.[nativeKey]) {
                    nativePath = path.join(
                        this.baseDir,
                        'libraries',
                        lib.downloads.classifiers[nativeKey].path
                    );
                } else if (lib.url && lib.name) {
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
                    logger.info(`Extracting legacy native: ${nativePath}`);
                    try {
                        await extract(nativePath, {
                            dir: nativesDir,
                            onEntry: (entry) => {
                                const valid = entry.fileName.endsWith('.dll') && 
                                            !entry.fileName.includes('META-INF');
                                if (valid) {
                                    logger.info(`Extracting native: ${entry.fileName}`);
                                }
                                return valid;
                            }
                        });
                    } catch (err) {
                        logger.error(`Failed to extract ${nativePath}: ${err.message}`);
                    }
                }
            }
        }

        // Set permissions on extracted files
        const files = await fs.readdir(nativesDir);
        for (const file of files) {
            await fs.chmod(path.join(nativesDir, file), 0o755);
            logger.info(`Set permissions for ${file}`);
        }

        if (files.length === 0) {
            throw new Error('No natives were extracted');
        }

        logger.info(`Natives extracted: ${files.join(', ')}`);
        return true;
    }

    isVersion119OrNewer(version) {
        return this.isVersionNewerOrEqual(version, '1.19');
    }

    async extractModernNatives(version, versionJson, nativesDir) {
        logger.info(`Setting up modern natives for ${version} in ${nativesDir}...`);
        
        try {
            // Ensure natives directory exists and is empty
            await fs.ensureDir(nativesDir);
            await fs.emptyDir(nativesDir);

            // Track extracted natives to avoid duplicates
            const extractedFiles = new Set();
            const nativesMap = new Map();

            for (const lib of versionJson.libraries) {
                if (!this.isLibraryCompatible(lib)) continue;

                // Get native keys for Windows
                const possibleNativeKeys = [
                    'natives-windows',
                    'natives-windows-64',
                    lib.natives?.windows?.replace('${arch}', '64')
                ].filter(Boolean);

                for (const nativeKey of possibleNativeKeys) {
                    let nativePath = null;
                    let nativeData = null;

                    // Try both download formats
                    if (lib.downloads?.classifiers?.[nativeKey]) {
                        nativeData = lib.downloads.classifiers[nativeKey];
                        nativePath = path.join(this.librariesDir, nativeData.path);
                    } else if (lib.name) {
                        // Fallback to constructing path from name
                        const [group, artifact, version] = lib.name.split(':');
                        const nativeSuffix = nativeKey.replace('${arch}', '64');
                        nativePath = path.join(
                            this.librariesDir,
                            group.replace(/\./g, '/'),
                            artifact,
                            version,
                            `${artifact}-${version}-${nativeSuffix}.jar`
                        );
                    }

                    if (nativePath && fs.existsSync(nativePath)) {
                        logger.info(`Found native: ${nativePath}`);
                        nativesMap.set(lib.name, nativePath);
                    }
                }
            }

            // Extract all found natives
            for (const [libName, nativePath] of nativesMap.entries()) {
                logger.info(`Extracting native library: ${libName}`);
                await extract(nativePath, {
                    dir: nativesDir,
                    onEntry: (entry) => {
                        const fileName = path.basename(entry.fileName).toLowerCase();
                        // Extract all DLL files and track them
                        if (fileName.endsWith('.dll') && !extractedFiles.has(fileName)) {
                            logger.info(`Extracting: ${fileName}`);
                            extractedFiles.add(fileName);
                            return true;
                        }
                        return false;
                    }
                });
            }

            // Log what was extracted
            logger.info(`Extracted natives: ${Array.from(extractedFiles).join(', ')}`);

            // Verify critical natives were extracted
            const requiredPrefixes = [
                'lwjgl',
                'glfw',
                'openal',
                'jemalloc'
            ];

            const missingNatives = requiredPrefixes.filter(prefix => 
                !Array.from(extractedFiles).some(file => 
                    file.toLowerCase().startsWith(prefix.toLowerCase())
                )
            );

            if (missingNatives.length > 0) {
                throw new Error(`Missing required natives: ${missingNatives.join(', ')}`);
            }

            // Set proper permissions
            const files = await fs.readdir(nativesDir);
            for (const file of files) {
                await fs.chmod(path.join(nativesDir, file), 0o755);
                logger.info(`Set permissions for ${file}`);
            }

            logger.info(`Successfully extracted ${files.length} native files for modern Minecraft`);
            return true;

        } catch (error) {
            logger.error(`Failed to extract modern natives: ${error.stack}`);
            throw error;
        }
    }

    async downloadNativeJar(nativeData, nativePath) {
        try {
            await fs.ensureDir(path.dirname(nativePath));
            const response = await fetch(nativeData.url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            const buffer = await response.buffer();
            await fs.writeFile(nativePath, buffer);
            logger.info(`Downloaded native: ${nativePath}`);
            return true;
        } catch (error) {
            logger.error(`Failed to download native ${nativePath}: ${error.message}`);
            return false;
        }
    }

    async extract120Natives(version, nativesDir) {
        logger.info(`Extracting natives for ${version} to ${nativesDir}`);
        const versionJson = await fs.readJson(path.join(this.baseDir, 'versions', version, `${version}.json`));
        
        // Ensure natives directory exists and is empty
        await fs.ensureDir(nativesDir);
        await fs.emptyDir(nativesDir);

        const extractedFiles = [];
        const osName = this.getOSName();
        
        // These are the specific libraries we need to extract for 1.20/1.21
        const nativeLibraries = [
            'lwjgl', 'lwjgl-jemalloc', 'lwjgl-openal', 'lwjgl-opengl', 'lwjgl-glfw', 
            'lwjgl-stb', 'lwjgl-tinyfd'
        ];
        
        let nativeCount = 0;
        let extractedCount = 0;
        
        logger.info(`Current OS: ${osName}`);
        
        // First pass - find all native libraries for the current OS
        for (const library of versionJson.libraries) {
            // Skip libraries without name or downloads
            if (!library.name || !library.downloads) continue;
            
            // Parse the library name to get the artifact name
            const nameParts = library.name.split(':');
            if (nameParts.length < 2) continue;
            
            const artifactName = nameParts[1];
            
            // Check if this is a native library we're interested in
            const isNativeLibrary = nativeLibraries.includes(artifactName);
            const hasClassifiers = library.downloads?.classifiers;
            
            if (!isNativeLibrary || !hasClassifiers) continue;
            
            logger.info(`Found LWJGL library: ${library.name}`);
            
            // Windows native keys to check in order of preference
            const nativeKeys = [
                `natives-${osName}`,
                `natives-${osName}-x86_64`,
                `natives-${osName}-arm64`,
                `natives-${osName}-x86` 
            ];
            
            // Find the appropriate native classifier
            let nativeArtifact = null;
            let usedKey = null;
            
            for (const key of nativeKeys) {
                if (library.downloads.classifiers[key]) {
                    nativeArtifact = library.downloads.classifiers[key];
                    usedKey = key;
                    break;
                }
            }
            
            if (!nativeArtifact) continue;
            
            nativeCount++;
            
            // Download or extract the native library
            try {
                const libraryPath = path.join(this.baseDir, 'libraries', nativeArtifact.path);
                
                // Download the library if it doesn't exist
                if (!await fs.pathExists(libraryPath)) {
                    logger.info(`Downloading native library: ${nativeArtifact.url}`);
                    await fs.ensureDir(path.dirname(libraryPath));
                    
                    try {
                        const response = await fetch(nativeArtifact.url);
                        if (!response.ok) {
                            throw new Error(`Failed to download: HTTP ${response.status}`);
                        }
                        
                        const buffer = await response.arrayBuffer();
                        await fs.writeFile(libraryPath, Buffer.from(buffer));
                        logger.info(`Downloaded native library to ${libraryPath}`);
                    } catch (downloadError) {
                        logger.error(`Download failed for ${nativeArtifact.url}: ${downloadError.message}`);
                        continue;
                    }
                }
                
                // Extract the DLL files
                logger.info(`Processing native: ${library.name} (${usedKey})`);
                
                try {
                    const zip = new AdmZip(libraryPath);
                    const entries = zip.getEntries();
                    
                    // Find and extract all DLL files
                    const dllEntries = entries.filter(entry => 
                        entry.entryName.endsWith('.dll') && 
                        !entry.entryName.includes('META-INF/')
                    );
                    
                    for (const entry of dllEntries) {
                        const fileName = path.basename(entry.entryName);
                        logger.info(`Extracting: ${fileName}`);
                        zip.extractEntryTo(entry, nativesDir, false, true);
                        extractedFiles.push(fileName);
                        extractedCount++;
                    }
                } catch (extractError) {
                    logger.error(`Failed to extract from ${libraryPath}: ${extractError.message}`);
                }
            } catch (error) {
                logger.error(`Error processing ${library.name}: ${error.message}`);
            }
        }
        
        logger.info(`Found ${nativeCount} native libraries and ${extractedCount} DLL files`);
        logger.info(`Extracted files: ${extractedFiles.join(', ')}`);
        
        // If no files were extracted, try the fallback method
        if (extractedFiles.length === 0) {
            logger.warn('No natives extracted, attempting fallback method');
            
            // Implementation of fallback method as in original extract120Natives
            // ...existing fallback code...
            
            // Fallback extraction method - try extracting all JAR files with "native" in the name
            const libDir = path.join(this.baseDir, 'libraries');
            
            try {
                // Directly search for Windows native JARs
                const windowsNativePattern = `-natives-${osName}`;
                const nativeJars = [];
                
                // Search for org/lwjgl directory
                const lwjglBaseDirs = [
                    path.join(libDir, 'org', 'lwjgl'),
                    path.join(libDir, 'org', 'lwjgl3')
                ];
                
                for (const lwjglDir of lwjglBaseDirs) {
                    if (!await fs.pathExists(lwjglDir)) continue;
                    
                    const lwjglSubdirs = await fs.readdir(lwjglDir);
                    
                    for (const subdir of lwjglSubdirs) {
                        const fullSubdir = path.join(lwjglDir, subdir);
                        if (!(await fs.stat(fullSubdir)).isDirectory()) continue;
                        
                        // Process version dirs
                        const versionDirs = await fs.readdir(fullSubdir);
                        for (const versionDir of versionDirs) {
                            const fullVersionDir = path.join(fullSubdir, versionDir);
                            if (!(await fs.stat(fullVersionDir)).isDirectory()) continue;
                            
                            // Search for native JARs
                            const files = await fs.readdir(fullVersionDir);
                            const nativeJarFiles = files.filter(f => 
                                f.includes(windowsNativePattern) && f.endsWith('.jar'));
                            
                            for (const jar of nativeJarFiles) {
                                nativeJars.push(path.join(fullVersionDir, jar));
                            }
                        }
                    }
                }
                
                logger.info(`Found ${nativeJars.length} native JARs in fallback search`);
                
                // Extract from found native JARs
                for (const jarPath of nativeJars) {
                    try {
                        logger.info(`Fallback extracting from: ${jarPath}`);
                        const zip = new AdmZip(jarPath);
                        const entries = zip.getEntries();
                        
                        for (const entry of entries) {
                            if (entry.entryName.endsWith('.dll') && 
                                !entry.entryName.includes('META-INF/')) {
                                const fileName = path.basename(entry.entryName);
                                zip.extractEntryTo(entry, nativesDir, false, true);
                                extractedFiles.push(fileName);
                            }
                        }
                    } catch (error) {
                        logger.error(`Fallback extraction failed for ${jarPath}: ${error.message}`);
                    }
                }
            } catch (fallbackError) {
                logger.error(`Fallback extraction failed: ${fallbackError.message}`);
            }
        }
        
        // Check if we extracted any natives
        if (extractedFiles.length === 0) {
            throw new Error('No natives were extracted');
        }
        
        // Set permissions for the extracted files
        const files = await fs.readdir(nativesDir);
        for (const file of files) {
            await fs.chmod(path.join(nativesDir, file), 0o755);
        }
        
        logger.info(`Native extraction completed successfully with ${files.length} files`);
        return extractedFiles;
    }

    getOSName() {
        switch(process.platform) {
            case 'win32': return 'windows';
            case 'darwin': return 'macos';
            case 'linux': return 'linux';
            default: throw new Error(`Unsupported platform: ${process.platform}`);
        }
    }

    async launch(version, username, isTest = false) {
        try {
            const versionDir = path.join(this.baseDir, 'versions', version);
            const versionJsonPath = path.join(versionDir, `${version}.json`);
            
            // Check if version is installed
            if (!fs.existsSync(versionJsonPath)) {
                logger.info(`Version ${version} not installed, installing now...`);
                const installer = new MinecraftInstaller();
                await installer.installVersion(version);
                
                // Verify installation
                if (!fs.existsSync(versionJsonPath)) {
                    throw new Error(`Failed to install version ${version}`);
                }
            }

            const versionJson = require(versionJsonPath);
            
            // Get required Java version first
            const requiredJavaVersion = this.getRequiredJavaVersion(versionJson);
            logger.info(`Required Java version for Minecraft ${version}: ${requiredJavaVersion}`);
            
            // Find appropriate Java installation
            const javaPath = this.findJavaPath(requiredJavaVersion);
            if (!javaPath) {
                throw new Error(`Required Java version (${requiredJavaVersion}) not found`);
            }

            // Determine if this is an old version (pre-1.8) that needs special handling
            const isOldVersion = this.isOldMinecraftVersion(version);
            
            // Set up basic arguments map
            const argMap = {
                auth_player_name: username,
                version_name: version,
                game_directory: this.baseDir,
                assets_root: path.join(this.baseDir, 'assets'),
                assets_index_name: versionJson.assetIndex?.id || "legacy",
                auth_uuid: this.generateUUID(),
                auth_access_token: '0',
                user_type: 'msa',
                version_type: versionJson.type || 'release',
                natives_directory: path.join(versionDir, 'natives'),
                launcher_name: 'alright-launcher',
                launcher_version: '3.0',
                classpath: this.getLibrariesClasspath(version),
                // For older versions, use empty JSON object for user properties
                user_properties: isOldVersion ? '{}' : '[]'
            };

            // Default JVM arguments
            const defaultJvmArgs = [
                `-Xmx${process.env.MAX_MEMORY || '2G'}`,
                '-XX:+UnlockExperimentalVMOptions',
                '-XX:+UseG1GC',
                '-XX:G1NewSizePercent=20',
                '-XX:G1ReservePercent=20',
                '-XX:MaxGCPauseMillis=50',
                '-XX:G1HeapRegionSize=32M',
                `-Djava.library.path=${argMap.natives_directory}`,
                `-Dorg.lwjgl.librarypath=${argMap.natives_directory}`,
                `-Dminecraft.launcher.brand=${argMap.launcher_name}`,
                `-Dminecraft.launcher.version=${argMap.launcher_version}`
            ];

            let args = [...defaultJvmArgs];

            // Handle modern versions with arguments structure
            if (versionJson.arguments) {
                // Add JVM arguments if present
                if (versionJson.arguments.jvm) {
                    for (const arg of versionJson.arguments.jvm) {
                        if (typeof arg === 'string') {
                            args.push(this.processArgument(arg, argMap));
                        } else if (arg.rules && this.checkRules(arg.rules)) {
                            const value = Array.isArray(arg.value) ? arg.value : [arg.value];
                            args.push(...value.map(v => this.processArgument(v, argMap)));
                        }
                    }
                }

                // Add classpath if not already added by JVM args
                if (!args.some(arg => arg.startsWith('-cp') || arg.startsWith('-classpath'))) {
                    args.push('-cp', argMap.classpath);
                }

                // Add main class
                args.push(versionJson.mainClass);

                // Add game arguments
                for (const arg of versionJson.arguments.game) {
                    if (typeof arg === 'string') {
                        args.push(this.processArgument(arg, argMap));
                    } else if (arg.rules && this.checkRules(arg.rules)) {
                        const value = Array.isArray(arg.value) ? arg.value : [arg.value];
                        args.push(...value.map(v => this.processArgument(v, argMap)));
                    }
                }
            } else {
                // Legacy version handling
                args.push('-cp', argMap.classpath);
                args.push(versionJson.mainClass);
                
                if (versionJson.minecraftArguments) {
                    const gameArgs = versionJson.minecraftArguments.split(' ').map(arg => 
                        this.processArgument(arg, argMap)
                    );
                    args.push(...gameArgs);
                }
            }

            // Determine native extraction method based on exact version string match
            // to prevent 1.2.1 being treated like 1.20
            if (version === '1.20' || version === '1.21') {
                await this.extract120Natives(version, argMap.natives_directory);
            } else if (this.isVersionNewerOrEqual(version, '1.19')) {
                await this.extractModernNatives(version, versionJson, argMap.natives_directory);
            } else {
                await this.extractLegacyNatives(version, versionJson, argMap.natives_directory);
            }

            logger.info(`Launch command: ${javaPath} ${args.join(' ')}`);

            const minecraft = spawn(javaPath, args, {
                cwd: this.baseDir,
                stdio: ['pipe', 'pipe', 'pipe'],
                detached: !isTest
            });

            // Monitor process output
            minecraft.stdout.on('data', (data) => {
                logger.info(`Game output: ${data}`);
            });

            minecraft.stderr.on('data', (data) => {
                logger.error(`Game error: ${data}`);
            });

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

    // Add helper method to detect old Minecraft versions
    isOldMinecraftVersion(version) {
        // Convert version to numeric for comparison
        if (version.startsWith('1.')) {
            const minorVersion = parseInt(version.split('.')[1], 10);
            // Versions before 1.8 need special handling
            return minorVersion < 8;
        }
        return false;
    }

    processArgument(arg, values) {
        return arg.replace(/\${([^}]+)}/g, (match, key) => {
            // Return the value if it exists, otherwise keep the original placeholder
            return values[key] !== undefined ? values[key] : match;
        });
    }

    checkRules(rules) {
        for (const rule of rules) {
            if (rule.os) {
                // Check operating system rules
                const osName = process.platform === 'win32' ? 'windows' : process.platform;
                if (rule.os.name && rule.os.name !== osName) {
                    return rule.action !== 'allow';
                }
                
                // Check OS version if specified
                if (rule.os.version) {
                    const osVersion = require('os').release();
                    const versionRegex = new RegExp(rule.os.version);
                    if (!versionRegex.test(osVersion)) {
                        return rule.action !== 'allow';
                    }
                }
            }
            
            // Handle features if present
            if (rule.features) {
                // Currently we don't support any special features
                return false;
            }
        }
        return true;
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

    // Add a proper version comparison function
    isVersionNewerOrEqual(version1, version2) {
        // Split versions into components
        const v1Parts = version1.split('.').map(part => {
            const num = parseInt(part, 10);
            return isNaN(num) ? 0 : num;
        });
        
        const v2Parts = version2.split('.').map(part => {
            const num = parseInt(part, 10);
            return isNaN(num) ? 0 : num;
        });
        
        // Compare each component
        for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
            const v1Part = v1Parts[i] || 0;
            const v2Part = v2Parts[i] || 0;
            
            if (v1Part > v2Part) {
                return true;
            } 
            if (v1Part < v2Part) {
                return false;
            }
        }
        
        // Versions are equal
        return true;
    }
}

module.exports = MinecraftLauncher;
