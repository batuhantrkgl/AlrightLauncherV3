const fs = require('fs-extra'); // Updated to fs-extra
const path = require('path');
const fetch = require('node-fetch');
const logger = require('./logger');
const extract = require('extract-zip');
const cliProgress = require('cli-progress'); // Not currently used
const AdmZip = require('adm-zip'); // Add this import
const EventEmitter = require('events'); // Add this import
const os = require('os'); // Add this for os.tmpdir()
const discordRPC = require('./discord-rpc'); // Import Discord RPC

class MinecraftInstaller extends EventEmitter { // Extend EventEmitter
    constructor() {
        super(); // Initialize EventEmitter
        
        this.baseDir = path.join(process.env.APPDATA, '.alrightlauncher');
        this.versionsDir = path.join(this.baseDir, 'versions');
        this.assetsDir = path.join(this.baseDir, 'assets');
        this.librariesDir = path.join(this.baseDir, 'libraries');
        this.createDirectories();
        
        // Get a fresh reference to the main window
        this.mainWindow = null;
        try {
            const { BrowserWindow } = require('electron');
            this.mainWindow = BrowserWindow.getAllWindows()[0];
        } catch (error) {
            console.error('Failed to get main window reference:', error);
        }
        
        this.downloadQueue = [];
        this.isDownloading = false;
        this.downloadDelay = 100; // 100ms delay between downloads
        this.downloadChunkSize = 64 * 1024; // 64KB chunks
    }

    createDirectories() {
        [this.baseDir, this.versionsDir, this.assetsDir, this.librariesDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    async sendProgress(percent, phase, detail) {
        try {
            // Ensure main window is available and not destroyed
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('installation-status', {
                    status: 'progress',
                    progress: percent,
                    phase,
                    detail
                });
                
                // Also emit the older progress event format for backwards compatibility
                this.mainWindow.webContents.send('install-progress', {
                    percent,
                    phase,
                    detail
                });
            }
        } catch (error) {
            console.error('Error sending progress update:', error);
        }
    }

    async downloadFile(url, destination, description, maxRetries = 3) {
        // Queue the download and wait for completion
        return new Promise((resolve, reject) => {
            this.downloadQueue.push({
                url,
                destination,
                description,
                maxRetries,
                resolve,
                reject
            });
            
            if (!this.isDownloading) {
                this.processDownloadQueue();
            }
        });
    }

    async processDownloadQueue() {
        if (this.isDownloading || this.downloadQueue.length === 0) return;
        
        this.isDownloading = true;
        const download = this.downloadQueue.shift();

        for (let attempt = 1; attempt <= download.maxRetries; attempt++) {
            try {
                const response = await fetch(download.url);
                if (!response.ok) throw new Error(`Failed to download: ${response.statusText}`);
                
                const totalSize = parseInt(response.headers.get('content-length'), 10);
                let downloadedSize = 0;

                // Ensure the directory exists and is writable
                await fs.ensureDir(path.dirname(download.destination), { mode: 0o755 });
                
                // Create write stream with explicit permissions
                const fileStream = fs.createWriteStream(download.destination, {
                    flags: 'w',
                    mode: 0o644
                });

                await new Promise((resolve, reject) => {
                    response.body.on('data', chunk => {
                        downloadedSize += chunk.length;
                        const percent = (downloadedSize / totalSize) * 100;
                        
                        this.sendProgress(
                            percent,
                            'Downloading',
                            `${download.description} (${(downloadedSize / 1024 / 1024).toFixed(2)}/${(totalSize / 1024 / 1024).toFixed(2)} MB)`
                        );

                        fileStream.write(chunk);
                    });

                    response.body.on('end', () => {
                        fileStream.end();
                    });

                    response.body.on('error', reject);
                    fileStream.on('finish', resolve);
                    fileStream.on('error', reject);
                });

                // Verify the downloaded file
                const stats = await fs.stat(download.destination);
                if (stats.size === 0 || stats.size !== totalSize) {
                    throw new Error(`File verification failed - expected ${totalSize} bytes but got ${stats.size}`);
                }

                // Set file permissions
                await fs.chmod(download.destination, 0o644);

                // Add delay between files
                await new Promise(r => setTimeout(r, this.downloadDelay));
                download.resolve(true);
                break;

            } catch (error) {
                logger.error(`Download attempt ${attempt} failed for ${download.description}: ${error.message}`);
                
                // Clean up failed download
                try {
                    if (await fs.pathExists(download.destination)) {
                        await fs.remove(download.destination);
                    }
                } catch (removeError) {
                    logger.error(`Failed to remove incomplete file: ${removeError.message}`);
                }

                if (attempt === download.maxRetries) {
                    download.reject(new Error(`Failed to download ${download.description} after ${download.maxRetries} attempts: ${error.message}`));
                    break;
                }
                
                // Exponential backoff between retries
                await new Promise(r => setTimeout(r, attempt * 2000));
            }
        }

        this.isDownloading = false;
        this.processDownloadQueue();
    }

    async getVersionManifest() {
        const response = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', {
            headers: {
                'Accept': 'application/json'
            }
        });
        if (!response.ok) {
            throw new Error(`Failed to fetch manifest: ${response.statusText}`);
        }
        return response.json();
    }

    async downloadAssets(versionData) {
        logger.info('Downloading asset index and resources...');
        const assetIndexUrl = versionData.assetIndex.url;
        const assetIndexId = versionData.assetIndex.id;
        const assetIndexPath = path.join(this.assetsDir, 'indexes', `${assetIndexId}.json`);
        
        // Create assets directories
        await fs.ensureDir(path.join(this.assetsDir, 'indexes'));
        await fs.ensureDir(path.join(this.assetsDir, 'objects'));
        await fs.ensureDir(path.join(this.assetsDir, 'virtual', assetIndexId));
        
        // Download asset index if needed
        if (!await fs.pathExists(assetIndexPath) || !(await this.verifyFile(assetIndexPath, versionData.assetIndex.sha1))) {
            logger.info(`Downloading asset index ${assetIndexId}...`);
            const indexResponse = await fetch(assetIndexUrl);
            if (!indexResponse.ok) {
                throw new Error(`Failed to download asset index: ${indexResponse.statusText}`);
            }
            const assetIndex = await indexResponse.json();
            await fs.writeFile(assetIndexPath, JSON.stringify(assetIndex, null, 2));
        }

        // Read the asset index
        const assetIndexContent = await fs.readFile(assetIndexPath, 'utf8');
        const assetIndex = JSON.parse(assetIndexContent);
        
        // Track missing sound assets for targeted downloads
        const missingSounds = new Set();
        
        // Check if this is a "virtual" asset index (used in newer MC versions)
        const isVirtual = assetIndex.virtual === true;
        
        // Process and download all assets
        const assets = Object.entries(assetIndex.objects);
        const totalAssets = assets.length;
        let processedAssets = 0;
        let missingAssets = 0;

        // First pass: count sound assets for reporting
        const soundAssets = assets.filter(([name]) => name.startsWith('minecraft/sounds/'));
        logger.info(`Found ${soundAssets.length} sound assets in index ${assetIndexId}`);
        
        // Download or verify assets with progress tracking
        for (const [name, asset] of assets) {
            processedAssets++;
            const progress = Math.floor((processedAssets / totalAssets) * 100);
            
            if (processedAssets % 20 === 0 || processedAssets === totalAssets) {
                await this.sendProgress(
                    60 + (progress * 0.35),
                    'Processing Assets', 
                    `${processedAssets}/${totalAssets} (${progress}%)`
                );
            }

            const hash = asset.hash;
            const prefix = hash.substring(0, 2);
            const assetObjectPath = path.join(this.assetsDir, 'objects', prefix, hash);
            
            // Create directory for this asset if needed
            await fs.ensureDir(path.dirname(assetObjectPath));
            
            // Also prepare virtual directory path if needed
            let virtualPath = null;
            if (isVirtual && name.startsWith('minecraft/')) {
                virtualPath = path.join(this.assetsDir, 'virtual', assetIndexId, name);
                await fs.ensureDir(path.dirname(virtualPath));
            }
            
            // Check if we need to download this asset
            const needsDownload = !await fs.pathExists(assetObjectPath) || 
                                  !(await this.verifyAssetFile(assetObjectPath, hash));
            
            if (needsDownload) {
                // Track missing sound assets
                if (name.startsWith('minecraft/sounds/')) {
                    missingSounds.add(name);
                }
                
                // Construct the download URL
                const assetUrl = `https://resources.download.minecraft.net/${prefix}/${hash}`;
                
                try {
                    // Download the asset
                    await this.downloadFile(
                        assetUrl,
                        assetObjectPath,
                        `Asset: ${name.split('/').pop()}`
                    );
                    
                    // Link/copy to virtual directory if needed
                    if (virtualPath) {
                        try {
                            // First ensure the parent directory exists
                            await fs.ensureDir(path.dirname(virtualPath));
                            
                            // Try to create a hard link to save space
                            try {
                                await fs.link(assetObjectPath, virtualPath);
                            } catch (linkError) {
                                // If linking fails (e.g., different file systems), copy the file
                                await fs.copyFile(assetObjectPath, virtualPath);
                            }
                        } catch (virtualError) {
                            logger.warn(`Failed to create virtual asset at ${virtualPath}: ${virtualError.message}`);
                        }
                    }
                } catch (downloadError) {
                    missingAssets++;
                    logger.warn(`Failed to download asset ${name}: ${downloadError.message}`);
                }
            } else if (virtualPath && !await fs.pathExists(virtualPath)) {
                // Asset exists in objects but not in virtual - create the virtual reference
                try {
                    // Ensure the parent directory exists
                    await fs.ensureDir(path.dirname(virtualPath));
                    
                    // Try to create a hard link to save space
                    try {
                        await fs.link(assetObjectPath, virtualPath);
                    } catch (linkError) {
                        // If linking fails, copy the file
                        await fs.copyFile(assetObjectPath, virtualPath);
                    }
                } catch (virtualError) {
                    logger.warn(`Failed to create virtual asset at ${virtualPath}: ${virtualError.message}`);
                }
            }
        }
        
        // Log summary of asset processing
        logger.info(`Asset processing complete: ${totalAssets - missingAssets}/${totalAssets} assets verified`);
        if (missingAssets > 0) {
            logger.warn(`${missingAssets} assets could not be downloaded`);
        }
        
        // If missing sound assets were detected, attempt targeted repairs
        if (missingSounds.size > 0) {
            logger.info(`Attempting targeted repair for ${missingSounds.size} missing sound assets`);
            await this.repairMissingSoundAssets(Array.from(missingSounds), assetIndex, assetIndexId);
        }
        
        return { totalAssets, missingAssets };
    }

    async verifyAssetFile(filePath, expectedHash) {
        try {
            if (!await fs.pathExists(filePath)) return false;
            
            const fileBuffer = await fs.readFile(filePath);
            const crypto = require('crypto');
            const fileHash = crypto.createHash('sha1').update(fileBuffer).digest('hex');
            
            return fileHash === expectedHash;
        } catch (error) {
            logger.warn(`Error verifying asset file ${filePath}: ${error.message}`);
            return false;
        }
    }

    // New method to handle missing sound assets specifically
    async repairMissingSoundAssets(missingSounds, assetIndex, assetIndexId) {
        if (missingSounds.length === 0) return;
        
        // Sort sounds by category for better logging
        const soundsByCategory = {};
        missingSounds.forEach(sound => {
            // Extract category from paths like "minecraft/sounds/mob/sheep/say1.ogg"
            const parts = sound.split('/');
            if (parts.length >= 4) {
                const category = parts[2]; // e.g., "mob"
                if (!soundsByCategory[category]) {
                    soundsByCategory[category] = [];
                }
                soundsByCategory[category].push(sound);
            }
        });
        
        // Log summary of missing sounds by category
        logger.info('Missing sounds by category:');
        for (const [category, sounds] of Object.entries(soundsByCategory)) {
            logger.info(`${category}: ${sounds.length} sounds`);
        }
        
        // Try alternative download sources if needed
        const altServers = [
            'https://resources.download.minecraft.net',
            'https://launchermeta.mojang.com/mc/assets'
        ];
        
        // For each missing sound file
        for (const soundPath of missingSounds) {
            const asset = assetIndex.objects[soundPath];
            if (!asset) {
                logger.warn(`Asset info not found for ${soundPath}`);
                continue;
            }
            
            const hash = asset.hash;
            const prefix = hash.substring(0, 2);
            const assetObjectPath = path.join(this.assetsDir, 'objects', prefix, hash);
            const virtualPath = path.join(this.assetsDir, 'virtual', assetIndexId, soundPath);
            
            // Try each download server
            let downloaded = false;
            for (const server of altServers) {
                if (downloaded) break;
                
                try {
                    const assetUrl = `${server}/${prefix}/${hash}`;
                    logger.info(`Trying alternative source for ${soundPath}: ${assetUrl}`);
                    
                    const response = await fetch(assetUrl, { timeout: 5000 });
                    if (response.ok) {
                        // Download succeeded
                        const buffer = await response.arrayBuffer();
                        await fs.writeFile(assetObjectPath, Buffer.from(buffer));
                        
                        // Create virtual path reference if needed
                        await fs.ensureDir(path.dirname(virtualPath));
                        try {
                            await fs.link(assetObjectPath, virtualPath);
                        } catch {
                            await fs.copyFile(assetObjectPath, virtualPath);
                        }
                        
                        downloaded = true;
                        logger.info(`Successfully downloaded missing sound: ${soundPath}`);
                    }
                } catch (error) {
                    logger.warn(`Failed to download from alternate source: ${error.message}`);
                }
            }
            
            if (!downloaded) {
                logger.warn(`Could not download sound asset: ${soundPath}`);
            }
        }
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

    async verifyAndGetNativePath(lib, nativeKey) {
        if (!lib.downloads?.classifiers?.[nativeKey]) return null;
        
        const nativeArtifact = lib.downloads.classifiers[nativeKey];
        const nativePath = path.join(this.librariesDir, nativeArtifact.path);
        
        // Check if file exists and matches SHA1
        if (await fs.pathExists(nativePath)) {
            const isValid = await this.verifyFile(nativePath, nativeArtifact.sha1);
            if (isValid) {
                return nativePath;
            }
            // If SHA1 doesn't match, delete the file
            await fs.remove(nativePath);
        }
        
        // Download if missing or invalid
        await fs.ensureDir(path.dirname(nativePath));
        await this.downloadFile(
            nativeArtifact.url,
            nativePath,
            `Native: ${lib.name}`
        );
        
        return nativePath;
    }

    async downloadLibraries(versionData) {
        logger.info('Downloading libraries...');
        const nativesDir = path.join(this.versionsDir, versionData.id, 'natives');
        await fs.ensureDir(nativesDir);
        await fs.emptyDir(nativesDir);

        // Handle specific modern Minecraft versions (1.20, 1.21)
        if (versionData.id === '1.20' || versionData.id === '1.21') {
            logger.info(`Detected modern Minecraft ${versionData.id} using specialized native extraction`);
            try {
                // Use the launcher's specialized extraction method for 1.20/1.21
                const launcher = new (require('./minecraft-launcher'))(this.baseDir);
                const extractedFiles = await launcher.extract120Natives(versionData.id, nativesDir);
                
                if (extractedFiles.length === 0) {
                    throw new Error('No natives were extracted');
                }
                
                logger.info(`Successfully extracted modern natives for ${versionData.id}: ${extractedFiles.join(', ')}`);
                return true;
            } catch (error) {
                logger.error(`Failed to extract modern natives: ${error.message}`);
                throw error;
            }
        }

        // Use version-specific native requirements
        let requiredNatives = [];

        // Determine required natives based on version
        if (versionData.id.startsWith('1.19') || versionData.id === '1.19') {
            // For Minecraft 1.19.x with LWJGL 3.3.1
            requiredNatives = [
                'lwjgl.dll',
                'lwjgl32.dll',
                'lwjgl_openal.dll',
                'lwjgl_stb.dll',
                'lwjgl_tinyfd.dll'
            ];
            logger.info(`Using 1.19.x native requirements for ${versionData.id}`);
        } else {
            // Default natives list for older versions
            requiredNatives = [
                'lwjgl.dll',
                'lwjgl32.dll', 
                'lwjgl64.dll',
                'OpenAL.dll',
                'OpenAL32.dll',
                'glfw.dll',
                'glfw32.dll',
                'jemalloc.dll',
                'jemalloc32.dll'
            ];
        }

        const extractedNatives = new Map();
        const processedNatives = new Set();

        // Process all libraries to extract needed natives
        for (const lib of versionData.libraries) {
            if (!this.isLibraryCompatible(lib)) continue;

            // Process libraries with native components
            if (lib.natives) {
                const nativeKey = lib.natives.windows?.replace('${arch}', '64') || 
                                lib.natives['windows'];
                
                if (!nativeKey) continue;

                const nativeId = `${lib.name}-${nativeKey}`;
                if (processedNatives.has(nativeId)) continue;
                processedNatives.add(nativeId);

                const nativePath = await this.verifyAndGetNativePath(lib, nativeKey);
                if (!nativePath) continue;

                // Extract and verify natives
                try {
                    await extract(nativePath, {
                        dir: nativesDir,
                        onEntry: (entry) => {
                            // Improved extraction logic for LWJGL 3.3.1 (Minecraft 1.19.x)
                            if (versionData.id.startsWith('1.19') || versionData.id === '1.19') {
                                // For 1.19.x: Extract all .dll files
                                const isValidNative = entry.fileName.endsWith('.dll') && 
                                                    !entry.fileName.includes('META-INF/');
                                
                                if (isValidNative) {
                                    logger.info(`Extracting 1.19.x native: ${entry.fileName}`);
                                    extractedNatives.set(entry.fileName.toLowerCase(), entry);
                                    return true;
                                }
                            } else {
                                // For other versions: Use the original filtering
                                const isValidNative = (
                                    entry.fileName.endsWith('.dll') && 
                                    !entry.fileName.includes('META-INF/') &&
                                    (
                                        requiredNatives.some(name => 
                                            entry.fileName.toLowerCase() === name.toLowerCase()
                                        ) ||
                                        entry.fileName.includes('SAPIWrapper')
                                    )
                                );
                                
                                if (isValidNative) {
                                    logger.info(`Extracting verified native: ${entry.fileName}`);
                                    extractedNatives.set(entry.fileName.toLowerCase(), entry);
                                    return true;
                                }
                            }

                            // Also extract .git and .sha1 files for completeness
                            if (entry.fileName.endsWith('.git') || entry.fileName.endsWith('.sha1')) {
                                return true;
                            }

                            return false;
                        }
                    });
                } catch (err) {
                    logger.error(`Failed to extract native ${nativePath}: ${err.message}`);
                }
            }
        }

        // For 1.19.x, make a second pass to check if we have any of the known LWJGL DLLs
        if ((versionData.id.startsWith('1.19') || versionData.id === '1.19') && extractedNatives.size === 0) {
            logger.info('No natives extracted on first pass for 1.19.x, attempting special extraction');
            
            // Enhanced LWJGL library detection for 1.19.x
            // First look for libraries with "lwjgl" in their name
            const lwjglLibs = versionData.libraries.filter(lib => 
                (lib.name.startsWith('org.lwjgl:lwjgl') || lib.name.includes('lwjgl')) && 
                lib.downloads?.classifiers
            );
            
            // Log all available LWJGL libraries
            logger.info(`Found ${lwjglLibs.length} LWJGL libraries for manual extraction`);
            for (const lib of lwjglLibs) {
                logger.info(`LWJGL lib: ${lib.name}`);
            }

            // Try all possible native classifier keys
            const possibleNativeKeys = [
                'natives-windows',
                'natives-windows-x86_64',
                'natives-windows-amd64',
                'natives-windows-arm64',
                'natives-windows-x86'
            ];
            
            let extractedAny = false;
            
            // Process each LWJGL library
            for (const lib of lwjglLibs) {
                for (const nativeKey of possibleNativeKeys) {
                    if (lib.downloads?.classifiers?.[nativeKey]) {
                        const nativeArtifact = lib.downloads.classifiers[nativeKey];
                        const nativePath = path.join(this.librariesDir, nativeArtifact.path);
                        
                        // Download if missing
                        if (!await fs.pathExists(nativePath)) {
                            logger.info(`Downloading missing 1.19.1 native: ${nativeArtifact.url}`);
                            try {
                                await fs.ensureDir(path.dirname(nativePath));
                                const response = await fetch(nativeArtifact.url);
                                if (!response.ok) {
                                    logger.warn(`Failed to download native: ${response.statusText}`);
                                    continue;
                                }
                                const buffer = await response.buffer();
                                await fs.writeFile(nativePath, buffer);
                                logger.info(`Successfully downloaded native: ${nativePath}`);
                            } catch (err) {
                                logger.error(`Download failed: ${err.message}`);
                                continue;
                            }
                        }
                        
                        // Extract native
                        if (await fs.pathExists(nativePath)) {
                            try {
                                logger.info(`Extracting special LWJGL native from: ${nativePath}`);
                                
                                // Use AdmZip for more reliable extraction
                                const zip = new AdmZip(nativePath);
                                const entries = zip.getEntries();
                                
                                // Count DLLs before extraction
                                const dllEntries = entries.filter(entry => 
                                    entry.entryName.endsWith('.dll') && 
                                    !entry.entryName.includes('META-INF/')
                                );
                                
                                logger.info(`Found ${dllEntries.length} DLLs in ${nativePath}`);
                                
                                // Extract all DLL files
                                for (const entry of dllEntries) {
                                    const fileName = path.basename(entry.entryName);
                                    logger.info(`Extracting: ${fileName}`);
                                    zip.extractEntryTo(entry.entryName, nativesDir, false, true);
                                    extractedNatives.set(fileName.toLowerCase(), entry);
                                    extractedAny = true;
                                }
                            } catch (err) {
                                logger.error(`Extract error: ${err.message}`);
                            }
                        }
                    }
                }
            }
            
            // If still no extraction succeeded, try searching for files directly
            if (!extractedAny) {
                logger.info('Special extraction failed, trying direct path search for LWJGL natives');
                
                // Directly search for LWJGL native JARs in the libraries directory
                const lwjglDirPaths = [
                    path.join(this.librariesDir, 'org', 'lwjgl'),
                    path.join(this.librariesDir, 'org', 'lwjgl3')
                ];
                
                for (const lwjglDir of lwjglDirPaths) {
                    if (await fs.pathExists(lwjglDir)) {
                        try {
                            const lwjglSubdirs = await fs.readdir(lwjglDir);
                            
                            for (const subdir of lwjglSubdirs) {
                                const subdirPath = path.join(lwjglDir, subdir);
                                if ((await fs.stat(subdirPath)).isDirectory()) {
                                    const versionDirs = await fs.readdir(subdirPath);
                                    
                                    for (const versionDir of versionDirs) {
                                        const versionPath = path.join(subdirPath, versionDir);
                                        if (!(await fs.stat(versionPath)).isDirectory()) continue;
                                        
                                        // Look for native JAR files
                                        const files = await fs.readdir(versionPath);
                                        const nativeJars = files.filter(file => 
                                            file.endsWith('.jar') && 
                                            file.includes('natives-windows')
                                        );
                                        
                                        if (nativeJars.length > 0) {
                                            logger.info(`Found ${nativeJars.length} native JARs in ${versionPath}`);
                                            
                                            // Extract natives from each JAR
                                            for (const jarFile of nativeJars) {
                                                const jarPath = path.join(versionPath, jarFile);
                                                try {
                                                    logger.info(`Attempting extraction from: ${jarFile}`);
                                                    const zip = new AdmZip(jarPath);
                                                    
                                                    // Extract all DLL files
                                                    for (const entry of zip.getEntries()) {
                                                        if (entry.entryName.endsWith('.dll') && !entry.entryName.includes('META-INF/')) {
                                                            const fileName = path.basename(entry.entryName);
                                                            zip.extractEntryTo(entry.entryName, nativesDir, false, true);
                                                            logger.info(`Extracted direct: ${fileName}`);
                                                            extractedNatives.set(fileName.toLowerCase(), {fileName: entry.entryName});
                                                            extractedAny = true;
                                                        }
                                                    }
                                                } catch (err) {
                                                    logger.error(`Extraction error for ${jarFile}: ${err.message}`);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        } catch (err) {
                            logger.error(`Error searching LWJGL directory: ${err.message}`);
                        }
                    }
                }
            }
            
            // As a last resort, copy prepackaged natives
            if (!extractedAny) {
                logger.info('All extraction attempts failed for 1.19.x natives');
                
                // Try using extract-zip as a fallback
                const foundNativeJars = await this.findAllLwjglNatives();
                for (const jarPath of foundNativeJars) {
                    try {
                        logger.info(`Fallback: Trying extract-zip for ${path.basename(jarPath)}`);
                        await extract(jarPath, {
                            dir: nativesDir,
                            onEntry: (entry) => {
                                if (entry.fileName.endsWith('.dll') && !entry.fileName.includes('META-INF/')) {
                                    const fileName = path.basename(entry.fileName);
                                    logger.info(`Fallback extracted: ${fileName}`);
                                    extractedNatives.set(fileName.toLowerCase(), entry);
                                    return true;
                                }
                                return false;
                            }
                        });
                    } catch (err) {
                        logger.error(`Fallback extraction failed: ${err.message}`);
                    }
                }
            }
        }

        // For 1.19.x versions, don't enforce specific native files - just check if we extracted any DLLs
        const extractedNativesList = [...extractedNatives.keys()];
        logger.info(`Extracted natives: ${extractedNativesList.join(', ')}`);

        if (versionData.id.startsWith('1.19') || versionData.id === '1.19') {
            // For 1.19.x, just check if we extracted some DLLs
            if (extractedNativesList.length === 0) {
                logger.error('No native DLLs were extracted for 1.19.x');
                throw new Error('Failed to extract any native DLLs');
            }
        } else {
            // For other versions, check for specific essential natives
            const essentialNatives = [
                'lwjgl.dll',
                'OpenAL.dll',
                'OpenAL32.dll'
            ];

            const missingEssentials = essentialNatives.filter(native => 
                !extractedNatives.has(native.toLowerCase()) &&
                !extractedNatives.has(native.replace('.dll', '32.dll').toLowerCase()) &&
                !extractedNatives.has(native.replace('.dll', '64.dll').toLowerCase())
            );

            if (missingEssentials.length > 0) {
                logger.error(`Missing essential natives: ${missingEssentials.join(', ')}`);
                throw new Error(`Missing essential natives: ${missingEssentials.join(', ')}`);
            }
        }

        // Set permissions for extracted files
        for (const file of await fs.readdir(nativesDir)) {
            await fs.chmod(path.join(nativesDir, file), 0o755);
        }

        logger.info(`Successfully extracted natives: ${[...extractedNatives.keys()].join(', ')}`);
        return true;
    }

    async verifyNatives(nativesDir) {
        const requiredFiles = ['lwjgl.dll', 'lwjgl64.dll', 'OpenAL.dll', 'OpenAL64.dll'];
        const missingFiles = [];

        for (const file of requiredFiles) {
            const filePath = path.join(nativesDir, file);
            if (!await fs.pathExists(filePath)) {
                missingFiles.push(file);
            }
        }

        if (missingFiles.length > 0) {
            logger.error(`Missing native files: ${missingFiles.join(', ')}`);
            throw new Error(`Missing required native files: ${missingFiles.join(', ')}`);
        }

        // Set proper permissions for all native files
        const files = await fs.readdir(nativesDir);
        for (const file of files) {
            await fs.chmod(path.join(nativesDir, file), 0o755);
        }

        logger.info('All native libraries verified successfully');
    }

    getOSName() {
        switch (process.platform) {
            case 'win32': return 'windows';
            case 'darwin': return 'osx';
            case 'linux': return 'linux';
            default: return process.platform;
        }
    }

    async extractNative(sourcePath, targetDir, extractRules, isLWJGL = false) {
        try {
            await extract(sourcePath, { 
                dir: targetDir,
                onEntry: (entry) => {
                    // Always extract .dll files for LWJGL
                    if (isLWJGL && entry.fileName.endsWith('.dll')) {
                        return true;
                    }
                    
                    // Follow normal extraction rules for other files
                    if (extractRules?.exclude?.some(pattern => 
                        entry.fileName.match(pattern)
                    )) {
                        return false;
                    }
                    return true;
                }
            });
            
            // Set proper permissions for extracted files
            const files = await fs.readdir(targetDir);
            for (const file of files) {
                await fs.chmod(path.join(targetDir, file), 0o755);
            }
        } catch (error) {
            throw new Error(`Native extraction failed: ${error.message}`);
        }
    }

    async extractZip(zipPath, targetPath) {
        try {
            await extract(zipPath, { dir: targetPath });
            return true;
        } catch (error) {
            console.error('Extraction error:', error);
            return false;
        }
    }

    async verifyFile(filePath, expectedHash) {
        try {
            if (!await fs.pathExists(filePath)) return false;
            
            const crypto = require('crypto');
            const hash = crypto.createHash('sha1');
            const fileStream = fs.createReadStream(filePath);
            
            await new Promise((resolve, reject) => {
                fileStream.on('data', (data) => hash.update(data));
                fileStream.on('end', resolve);
                fileStream.on('error', reject);
            });
            
            const fileHash = hash.digest('hex');
            return fileHash === expectedHash;
        } catch (error) {
            logger.error(`File verification failed: ${error.message}`);
            return false;
        }
    }

    async installVersion(version) {
        try {
            console.log(`Starting installation of version: ${version}`);
            
            // Update Discord RPC status
            discordRPC.setInstallingActivity(version);
            
            // Get a fresh reference to the main window
            try {
                const { BrowserWindow } = require('electron');
                this.mainWindow = BrowserWindow.getAllWindows()[0];
            } catch (error) {
                console.error('Failed to refresh main window reference:', error);
            }
            
            // Set installation flag
            this.isInstalling = true;
            
            // Notify installation started
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('installation-status', {
                    version, 
                    status: 'started',
                    progress: 0
                });
            }
            
            // Get version manifest
            await this.sendProgress(0, 'Starting Installation', `Preparing to install Minecraft ${version}`);
            
            // Get version manifest
            await this.sendProgress(5, 'Fetching Version Data', 'Getting version manifest...');
            const manifest = await this.getVersionManifest();
            
            const versionInfo = manifest.versions.find(v => v.id === version);
            if (!versionInfo) throw new Error(`Version ${version} not found`);

            // Download version JSON
            await this.sendProgress(10, 'Downloading Version JSON', `Getting ${version} metadata...`);
            const versionResponse = await fetch(versionInfo.url);
            const versionData = await versionResponse.json();

            // Validate the version data has required fields
            if (!versionData.libraries) {
                logger.error(`Invalid version data: missing libraries array for ${version}`);
                throw new Error(`Invalid version data for ${version}: missing libraries array`);
            }
            
            // Filter out invalid library entries
            const validLibraries = versionData.libraries.filter(lib => {
                if (!lib) {
                    logger.warn(`Found undefined library entry in ${version}, skipping`);
                    return false;
                }
                return true;
            });
            
            // Log the number of invalid entries if any were filtered
            if (validLibraries.length !== versionData.libraries.length) {
                logger.warn(`Filtered out ${versionData.libraries.length - validLibraries.length} invalid library entries`);
                versionData.libraries = validLibraries;
            }

            // Create directories
            const versionDir = path.join(this.versionsDir, version);
            await fs.ensureDir(versionDir);
            await fs.ensureDir(this.librariesDir);
            await fs.ensureDir(path.join(this.assetsDir, 'indexes'));
            await fs.ensureDir(path.join(this.assetsDir, 'objects'));

            // Download libraries
            const totalLibraries = versionData.libraries.length;
            for (let i = 0; i < totalLibraries; i++) {
                const lib = versionData.libraries[i];
                
                // Skip undefined or incomplete library entries
                if (!lib || !lib.downloads) {
                    logger.warn(`Skipping invalid library entry at index ${i}`);
                    continue;
                }
                
                // Skip libraries without artifact information
                if (!lib.downloads.artifact) {
                    logger.info(`Library entry ${i} (${lib.name || 'unnamed'}) has no artifact, skipping`);
                    continue;
                }

                const progress = 10 + (40 * (i / totalLibraries));
                
                // Add safeguard for path
                if (!lib.downloads.artifact.path) {
                    logger.warn(`Library ${lib.name || `entry #${i}`} has no path defined, skipping`);
                    continue;
                }
                
                const libPath = path.join(this.librariesDir, lib.downloads.artifact.path);
                await fs.ensureDir(path.dirname(libPath));

                if (!fs.existsSync(libPath)) {
                    await this.downloadFile(
                        lib.downloads.artifact.url, 
                        libPath,
                        `Library: ${lib.name || `#${i}`}`
                    );
                } else {
                    await this.sendProgress(progress, 'Checking Libraries', `Verified: ${lib.name || `#${i}`}`);
                }
            }

            // Download client jar only if needed
            await this.sendProgress(50, 'Checking Game Files', 'Verifying main game file...');
            const clientJar = path.join(versionDir, `${version}.jar`);
            const expectedHash = versionData.downloads.client.sha1;
            
            if (!await this.verifyFile(clientJar, expectedHash)) {
                await this.sendProgress(50, 'Downloading Game', 'Fetching main game file...');
                await this.downloadFile(
                    versionData.downloads.client.url,
                    clientJar,
                    'Main Game JAR'
                );
            } else {
                logger.info('Client JAR verified, skipping download');
                await this.sendProgress(50, 'Checking Game Files', 'Main game file verified');
            }

            // Download assets
            await this.sendProgress(60, 'Fetching Assets', 'Downloading game resources...');
            const assetIndexUrl = versionData.assetIndex.url;
            const assetIndexPath = path.join(this.assetsDir, 'indexes', `${versionData.assetIndex.id}.json`);
            
            await fs.ensureDir(path.join(this.assetsDir, 'indexes'));
            await fs.ensureDir(path.join(this.assetsDir, 'objects'));

            const indexResponse = await fetch(assetIndexUrl);
            const assetIndex = await indexResponse.json();

            const assets = Object.entries(assetIndex.objects);
            const totalAssets = assets.length;

            for (let i = 0; i < totalAssets; i++) {
                const [name, asset] = assets[i];
                const progress = 60 + (35 * (i / totalAssets));
                const hash = asset.hash;
                const prefix = hash.substring(0, 2);
                const assetPath = path.join(this.assetsDir, 'objects', prefix, hash);

                if (!fs.existsSync(assetPath)) {
                    await this.downloadFile(
                        `https://resources.download.minecraft.net/${prefix}/${hash}`,
                        assetPath,
                        `Asset: ${name}`
                    );
                } else {
                    await this.sendProgress(progress, 'Verifying Assets', `Checked: ${name}`);
                }
            }

            // Save version JSON
            await this.sendProgress(95, 'Finalizing', 'Saving version data...');
            await fs.writeFile(
                path.join(this.versionsDir, version, `${version}.json`),
                JSON.stringify(versionData, null, 2)
            );

            // Download and extract natives - provide better error context
            await this.sendProgress(97, 'Downloading Natives', 'Downloading and extracting native libraries...');
            try {
                // Use the modified downloadLibraries that handles undefined paths
                await this.downloadLibraries(versionData.libraries, version);
            } catch (error) {
                logger.warn(`Native extraction encountered issues: ${error.message}`);
                logger.info('Continuing installation process despite native issues');
                // We continue the installation, since some natives might be optional
            }

            await this.sendProgress(100, 'Complete', `Successfully installed Minecraft ${version}`);
            
            // When installation completes
            this.isInstalling = false;
            
            // Reset Discord RPC status
            discordRPC.setDefaultActivity();
            
            // Notify installation complete
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('installation-status', {
                    version, 
                    status: 'completed',
                    progress: 100
                });
            }
            
            return true;
        } catch (error) {
            logger.error(`Installation failed: ${error.message}`);
            await this.sendProgress(100, 'Error', error.message);
            
            // Reset status
            this.isInstalling = false;
            discordRPC.setDefaultActivity();
            
            // Notify installation failed
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('installation-status', {
                    version, 
                    status: 'error',
                    error: error.message
                });
            }
            
            throw error;
        }
    }

    async downloadNatives(version) {
        const versionJson = await fs.readJson(path.join(this.baseDir, 'versions', version, `${version}.json`));
        const osName = this.getOSName();

        for (const library of versionJson.libraries) {
            if (!library.downloads?.classifiers) continue;

            const nativeKey = `natives-${osName}`;
            const nativeArtifact = library.downloads.classifiers[nativeKey];

            if (!nativeArtifact) continue;

            const libraryPath = path.join(this.baseDir, 'libraries', nativeArtifact.path);
            
            // Skip if already downloaded and valid
            if (await this.validateFile(libraryPath, nativeArtifact.sha1)) {
                continue;
            }

            // Download native library
            await this.downloadFile(nativeArtifact.url, libraryPath);
        }
    }

    async validateFile(filePath, expectedSha1 = null) {
        try {
            const exists = await fs.pathExists(filePath);
            if (!exists) return false;
            
            // TODO: Add SHA1 validation if expectedSha1 is provided
            return true;
        } catch (err) {
            return false;
        }
    }

    async downloadFile(url, destination) {
        await fs.ensureDir(path.dirname(destination));
        const response = await fetch(url);
        const buffer = await response.buffer();
        await fs.writeFile(destination, buffer);
    }

    getOSName() {
        switch(process.platform) {
            case 'win32': return 'windows';
            case 'darwin': return 'macos';
            case 'linux': return 'linux';
            default: throw new Error(`Unsupported platform: ${process.platform}`);
        }
    }

    async downloadNativesFor120(version) {
        const versionJson = await fs.readJson(path.join(this.baseDir, 'versions', version, `${version}.json`));
        const osName = this.getOSName();
        let downloadCount = 0;

        for (const library of versionJson.libraries) {
            if (!library.downloads?.classifiers) continue;

            const nativeKey = `natives-${osName}`;
            const nativeArtifact = library.downloads.classifiers[nativeKey];

            if (!nativeArtifact) continue;

            const libraryPath = path.join(this.baseDir, 'libraries', nativeArtifact.path);
            
            // Skip if already downloaded and valid
            if (await this.validateFile(libraryPath, nativeArtifact.sha1)) {
                continue;
            }

            // Ensure directory exists
            await fs.ensureDir(path.dirname(libraryPath));

            // Download native library
            await this.downloadFile(
                nativeArtifact.url,
                libraryPath,
                `Native: ${path.basename(libraryPath)}`
            );
            downloadCount++;
        }

        return downloadCount;
    }

    // Add helper method to find all LWJGL native JARs
    async findAllLwjglNatives() {
        const nativeJars = [];
        const searchDir = this.librariesDir;

        try {
            // Look for org/lwjgl directory
            const lwjglPath = path.join(searchDir, 'org', 'lwjgl');
            
            if (!await fs.pathExists(lwjglPath)) {
                return nativeJars;
            }
            
            const lwjglSubdirs = await fs.readdir(lwjglPath);
            
            for (const lwjglLib of lwjglSubdirs) {
                const libPath = path.join(lwjglPath, lwjglLib);
                if (!await fs.pathExists(libPath) || !(await fs.stat(libPath)).isDirectory()) {
                    continue;
                }
                
                // Check each version directory
                const versionDirs = await fs.readdir(libPath);
                for (const version of versionDirs) {
                    const versionPath = path.join(libPath, version);
                    if (!await fs.pathExists(versionPath) || !(await fs.stat(versionPath)).isDirectory()) {
                        continue;
                    }
                    
                    // Look for native JARs
                    const files = await fs.readdir(versionPath);
                    for (const file of files) {
                        if (file.includes('natives-windows') && file.endsWith('.jar')) {
                            nativeJars.push(path.join(versionPath, file));
                        }
                    }
                }
            }
        } catch (err) {
            logger.error(`Error searching for native JARs: ${err.message}`);
        }
        
        return nativeJars;
    }

    async downloadLibraries(libraries, version) {
        try {
            // Make sure we have valid inputs
            if (!libraries || !Array.isArray(libraries)) {
                throw new Error('Invalid libraries array provided');
            }
            
            if (!version || typeof version !== 'string') {
                throw new Error('Invalid version string provided');
            }
            
            const nativesDir = path.join(this.baseDir, 'versions', version, 'natives');
            await fs.ensureDir(nativesDir);

            // Updated essential natives list to include opengl.dll
            const essentialNatives = [
                'lwjgl.dll', 
                'OpenAL.dll', 
                'OpenAL32.dll', 
                'glfw.dll', 
                'jemalloc.dll', 
                'stb.dll', 
                'opengl.dll',          
                'lwjgl_opengl.dll'     
            ];
            const extractedNatives = new Set();
            
            this.emit('progress', { phase: 'Downloading libraries', percent: 0 });
            
            // Filter out invalid library entries before processing
            const validLibraries = libraries.filter(lib => !!lib);
            if (validLibraries.length !== libraries.length) {
                logger.warn(`Filtered ${libraries.length - validLibraries.length} invalid library entries`);
            }
            
            // Keep track of total libraries and processed count
            const totalLibraries = validLibraries.length;
            let processedCount = 0;
            
            for (const library of validLibraries) {
                processedCount++;
                const progressPercent = (processedCount / totalLibraries) * 100;
                this.emit('progress', { 
                    phase: 'Downloading libraries', 
                    percent: progressPercent, 
                    detail: `${processedCount}/${totalLibraries}`
                });
                
                try {
                    // Skip if this is a natives library that doesn't match our OS
                    if (library.rules && !this.matchRules(library.rules)) {
                        continue;
                    }
                    
                    // Process the main library artifact
                    if (library.downloads && library.downloads.artifact) {
                        const artifact = library.downloads.artifact;
                        
                        // Ensure all path components are defined
                        if (!artifact.path) {
                            logger.warn(`Library ${library.name || 'unknown'} has no path defined, skipping`);
                            continue;
                        }
                        
                        const libPath = path.join(this.baseDir, 'libraries', artifact.path);
                        
                        await fs.ensureDir(path.dirname(libPath));
                        
                        if (!await this.isValidFile(libPath, artifact.sha1)) {
                            await this.downloadFile(artifact.url, libPath, `Library: ${library.name || 'unknown'}`);
                        }
                    }
                    
                    // Process natives if available
                    if (library.downloads && library.downloads.classifiers) {
                        let nativesKey = null;
                        
                        // Determine which native key to use based on OS
                        if (process.platform === 'win32') {
                            if (process.arch === 'x64') {
                                nativesKey = 'natives-windows';
                            } else if (process.arch === 'ia32') {
                                nativesKey = 'natives-windows-x86';
                            } else if (process.arch === 'arm64') {
                                nativesKey = 'natives-windows-arm64';
                            }
                        } else if (process.platform === 'darwin') {
                            nativesKey = process.arch === 'arm64' ? 'natives-macos-arm64' : 'natives-macos';
                        } else if (process.platform === 'linux') {
                            nativesKey = process.arch === 'arm64' ? 'natives-linux-arm64' : 'natives-linux';
                        }
                        
                        // Only try to process if we found a valid native key
                        if (nativesKey && library.downloads.classifiers[nativesKey]) {
                            const nativeArtifact = library.downloads.classifiers[nativesKey];
                            
                            // Skip if path is not defined
                            if (!nativeArtifact.path) {
                                logger.warn(`Native library ${library.name || 'unknown'} (${nativesKey}) has no path defined, skipping`);
                                continue;
                            }
                            
                            const nativeLibPath = path.join(this.baseDir, 'libraries', nativeArtifact.path);
                            
                            await fs.ensureDir(path.dirname(nativeLibPath));
                            
                            if (!await this.isValidFile(nativeLibPath, nativeArtifact.sha1)) {
                                await this.downloadFile(nativeArtifact.url, nativeLibPath, `Native: ${library.name || 'unknown'}`);
                            }
                            
                            // Extract the native library
                            await this.extractNative(nativeLibPath, nativesDir, extractedNatives);
                        }
                    }
                    
                    // Handle special case for legacy natives format
                    if (library.natives) {
                        const osName = this.getOSName();
                        const nativeKey = library.natives[osName];
                        
                        if (nativeKey) {
                            // For LWJGL libraries that have a special native format
                            if (library.name && library.name.startsWith("org.lwjgl")) {
                                try {
                                    // Parse library info from the name
                                    const nameParts = library.name.split(':');
                                    if (nameParts.length < 3) {
                                        logger.warn(`Invalid library name format: ${library.name}, skipping`);
                                        continue;
                                    }
                                    
                                    const [group, artifact, version] = nameParts;
                                    const classifier = nativeKey.replace("${arch}", this.getArchName());
                                    
                                    // Construct the download path and URL for the native
                                    const nativePath = `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}-${classifier}.jar`;
                                    const nativeUrl = `https://libraries.minecraft.net/${nativePath}`;
                                    const nativeLibPath = path.join(this.baseDir, 'libraries', nativePath);
                                    
                                    await fs.ensureDir(path.dirname(nativeLibPath));
                                    
                                    // Download if doesn't exist or is invalid
                                    if (!fs.existsSync(nativeLibPath)) {
                                        try {
                                            await this.downloadFile(nativeUrl, nativeLibPath);
                                            // Extract the native library
                                            await this.extractNative(nativeLibPath, nativesDir, extractedNatives);
                                        } catch (err) {
                                            logger.warn(`Warning: Failed to download native ${nativePath}: ${err.message}`);
                                        }
                                    } else {
                                        // Just extract if already exists
                                        await this.extractNative(nativeLibPath, nativesDir, extractedNatives);
                                    }
                                } catch (err) {
                                    logger.warn(`Failed to process LWJGL native ${library.name}: ${err.message}`);
                                }
                            }
                        }
                    }
                } catch (error) {
                    logger.warn(`Warning: Failed to process library ${library.name || 'unknown'}: ${error.message}`);
                }
            }
            
            // Verify if all essential natives were extracted
            const missingNatives = essentialNatives.filter(native => !extractedNatives.has(native.toLowerCase()));
            
            logger.info(`Extracted natives: ${Array.from(extractedNatives).join(', ')}`);
            
            if (missingNatives.length > 0) {
                // Try to manually download essential natives if missing
                await this.downloadMissingNatives(missingNatives, nativesDir);
                
                // Check again after manual download attempt
                const stillMissing = missingNatives.filter(native => 
                    !fs.existsSync(path.join(nativesDir, native.toLowerCase())) && 
                    !fs.existsSync(path.join(nativesDir, native))
                );
                
                if (stillMissing.length > 0) {
                    logger.warn(`Still missing essential natives: ${stillMissing.join(', ')}`);
                    // Just warn but don't throw - we'll try to run anyway
                }
            }
            
            return nativesDir;
        } catch (error) {
            logger.error(`Failed to download libraries: ${error.message}`);
            throw error;
        }
    }

    async extractNative(jarPath, destDir, extractedSet) {
        try {
            // Check if paths are valid
            if (!jarPath || typeof jarPath !== 'string') {
                logger.warn(`Invalid jar path for extraction: ${jarPath}`);
                return;
            }
            
            if (!destDir || typeof destDir !== 'string') {
                logger.warn(`Invalid destination directory for extraction: ${destDir}`);
                return;
            }
            
            if (!extractedSet) {
                extractedSet = new Set();
            }
            
            // Check if file exists before attempting to use AdmZip
            if (!fs.existsSync(jarPath)) {
                logger.warn(`Native jar file does not exist: ${jarPath}`);
                return;
            }
            
            const zip = new AdmZip(jarPath);
            const entries = zip.getEntries();
            
            // Define native file mappings - maps source names to target names
            const nativeMappings = {
                'openal.dll': ['openal32.dll'],
                'openal32.dll': ['openal.dll'],
                'lwjgl_stb.dll': ['stb.dll'],
                'lwjgl_opengl.dll': ['opengl.dll'],
                'lwjgl_openal.dll': ['openal.dll', 'openal32.dll'],
                'lwjgl_tinyfd.dll': ['tinyfd.dll'],
                'lwjgl_jemalloc.dll': ['jemalloc.dll'],
                'lwjgl_glfw.dll': ['glfw.dll']
            };
            
            for (const entry of entries) {
                // Skip directories and META-INF
                if (entry.isDirectory || entry.entryName.startsWith('META-INF/')) {
                    continue;
                }
                
                // Skip non-native files (not .dll, .so, .dylib, etc.)
                const fileExtension = path.extname(entry.entryName).toLowerCase();
                if (!['.dll', '.so', '.dylib', '.jnilib'].includes(fileExtension)) {
                    continue;
                }
                
                const fileName = path.basename(entry.entryName).toLowerCase();
                const destPath = path.join(destDir, fileName);
                
                // Extract the original file
                zip.extractEntryTo(entry, destDir, false, true);
                extractedSet.add(fileName);
                
                logger.info(`Extracted native: ${fileName}`);
                
                // Create aliased versions for LWJGL libraries
                for (const [sourceName, targetNames] of Object.entries(nativeMappings)) {
                    if (fileName === sourceName.toLowerCase()) {
                        for (const targetName of targetNames) {
                            if (!extractedSet.has(targetName.toLowerCase())) {
                                const targetPath = path.join(destDir, targetName);
                                await fs.copyFile(destPath, targetPath);
                                extractedSet.add(targetName.toLowerCase());
                                logger.info(`Created ${targetName} from ${fileName}`);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            logger.warn(`Failed to extract native from ${jarPath}: ${error.message}`);
        }
    }

    async downloadMissingNatives(missingNatives, nativesDir) {
        // Fallback URLs for essential natives
        const fallbackUrls = {
            'lwjgl.dll': 'https://libraries.minecraft.net/org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar',
            'openal.dll': 'https://libraries.minecraft.net/org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1-natives-windows.jar',
            'openal32.dll': 'https://libraries.minecraft.net/org/lwjgl/lwjgl-openal/3.3.1/lwjgl-openal-3.3.1-natives-windows.jar',
            'glfw.dll': 'https://libraries.minecraft.net/org/lwjgl/lwjgl-glfw/3.3.1/lwjgl-glfw-3.3.1-natives-windows.jar',
            'jemalloc.dll': 'https://libraries.minecraft.net/org/lwjgl/lwjgl-jemalloc/3.3.1/lwjgl-jemalloc-3.3.1-natives-windows.jar',
            'stb.dll': 'https://libraries.minecraft.net/org/lwjgl/lwjgl-stb/3.3.1/lwjgl-stb-3.3.1-natives-windows.jar',
            'tinyfd.dll': 'https://libraries.minecraft.net/org/lwjgl/lwjgl-tinyfd/3.3.1/lwjgl-tinyfd-3.3.1-natives-windows.jar',
            'opengl.dll': 'https://libraries.minecraft.net/org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1-natives-windows.jar', // Add OpenGL URL
            'lwjgl_opengl.dll': 'https://libraries.minecraft.net/org/lwjgl/lwjgl-opengl/3.3.1/lwjgl-opengl-3.3.1-natives-windows.jar' // Add LWJGL OpenGL URL
        };
        
        // Define native file mapping for alternatives (used when exact matches aren't found)
        const nativeAlternatives = {
            'openal32.dll': ['openal.dll', 'lwjgl_openal.dll'],
            'openal.dll': ['openal32.dll', 'lwjgl_openal.dll'],
            'stb.dll': ['lwjgl_stb.dll'],
            'jemalloc.dll': ['lwjgl_jemalloc.dll'],
            'glfw.dll': ['lwjgl_glfw.dll'],
            'tinyfd.dll': ['lwjgl_tinyfd.dll'],
            'opengl.dll': ['lwjgl_opengl.dll'], // Add OpenGL alternative
            'lwjgl_opengl.dll': ['opengl.dll']  // Add two-way mapping
        };
        
        for (const native of missingNatives) {
            const nativeLower = native.toLowerCase();
            const fallbackUrl = fallbackUrls[nativeLower];
            
            if (fallbackUrl) {
                try {
                    logger.info(`Attempting to download missing native: ${native}`);
                    const tempJarPath = path.join(os.tmpdir(), `native-${Date.now()}.jar`);
                    
                    await this.downloadFile(fallbackUrl, tempJarPath, `Downloading ${native} library`);
                    
                    const extractedSet = new Set();
                    await this.extractNative(tempJarPath, nativesDir, extractedSet);
                    
                    // Clean up temporary file
                    fs.unlinkSync(tempJarPath);
                    
                    // Check if we extracted the exact file we needed
                    const exactMatch = extractedSet.has(nativeLower);
                    
                    if (exactMatch) {
                        logger.info(`Successfully recovered missing native: ${native}`);
                    } else {
                        // Check if we can use an alternative file
                        const alternativeFiles = nativeAlternatives[nativeLower] || [];
                        let foundAlternative = false;
                        
                        for (const altFile of alternativeFiles) {
                            if (extractedSet.has(altFile)) {
                                // We found an alternative, copy it with the required name
                                const sourcePath = path.join(nativesDir, altFile);
                                const destPath = path.join(nativesDir, native);
                                
                                logger.info(`Using ${altFile} as substitute for ${native}`);
                                await fs.copyFile(sourcePath, destPath);
                                foundAlternative = true;
                                break;
                            }
                        }
                        
                        if (foundAlternative) {
                            logger.info(`Successfully created substitute for ${native}`);
                        } else {
                            // Check for case-insensitive matches in the directory
                            const existingFiles = await fs.readdir(nativesDir);
                            const matchingFile = existingFiles.find(file => 
                                file.toLowerCase() === nativeLower
                            );
                            
                            if (matchingFile) {
                                logger.info(`Found case-variant of ${native}: ${matchingFile}`);
                                // If needed, create a copy with the exact name
                                if (matchingFile !== native) {
                                    await fs.copyFile(
                                        path.join(nativesDir, matchingFile),
                                        path.join(nativesDir, native)
                                    );
                                    logger.info(`Created exact name copy for ${native}`);
                                }
                            } else {
                                logger.warn(`Could not find ${native} in downloaded package`);
                            }
                        }
                    }
                } catch (error) {
                    logger.error(`Failed to download fallback for ${native}: ${error.message}`);
                }
            }
        }

        // Final verification step - check if all required natives exist now
        for (const native of missingNatives) {
            const nativePath = path.join(nativesDir, native);
            if (!await fs.pathExists(nativePath)) {
                // Check case-insensitive variants as a last resort
                const existingFiles = await fs.readdir(nativesDir);
                
                // First look for exact matches with different casing
                let matchingFile = existingFiles.find(file => 
                    file.toLowerCase() === native.toLowerCase()
                );
                
                // If no exact match, look for alternative variants
                if (!matchingFile) {
                    const alternativeFiles = nativeAlternatives[native.toLowerCase()] || [];
                    for (const altFile of alternativeFiles) {
                        const altMatch = existingFiles.find(file => 
                            file.toLowerCase() === altFile.toLowerCase()
                        );
                        if (altMatch) {
                            matchingFile = altMatch;
                            logger.info(`Found alternative ${matchingFile} for ${native}`);
                            break;
                        }
                    }
                }
                
                if (matchingFile) {
                    // Create a copy with the exact expected name
                    await fs.copyFile(
                        path.join(nativesDir, matchingFile),
                        nativePath
                    );
                    logger.info(`Final step: Created exact copy of ${matchingFile} as ${native}`);
                }
            }
        }
    }

    getArchName() {
        if (process.platform === 'win32') {
            return process.arch === 'x64' ? '64' : '32';
        }
        return process.arch === 'arm64' ? 'arm64' : 'x86_64';
    }

    matchRules(rules) {
        const osName = this.getOSName();
        
        for (const rule of rules) {
            let action = rule.action === 'allow';
            
            if (rule.os) {
                const osMatches = rule.os.name === osName;
                
                if (rule.os.arch) {
                    const archMatches = rule.os.arch === this.getArchName();
                    if (!archMatches) continue;
                }
                
                if (action === true && !osMatches) action = false;
                if (action === false && !osMatches) action = true;
            }
            
            if (!action) return false;
        }
        
        return true;
    }

    async isValidFile(filePath, expectedSha1) {
        try {
            if (!filePath || typeof filePath !== 'string') {
                logger.warn(`Invalid file path provided for validation: ${filePath}`);
                return false;
            }
            
            if (!fs.existsSync(filePath)) return false;
            
            if (expectedSha1) {
                try {
                    const crypto = require('crypto');
                    const fileData = await fs.readFile(filePath);
                    const hash = crypto.createHash('sha1').update(fileData).digest('hex');
                    return hash === expectedSha1;
                } catch (err) {
                    logger.warn(`SHA1 validation failed for ${filePath}: ${err.message}`);
                    return false;
                }
            }
            
            return true;
        } catch (error) {
            logger.warn(`Error validating file ${filePath}: ${error.message}`);
            return false;
        }
    }
}

module.exports = MinecraftInstaller;
