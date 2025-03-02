const fs = require('fs-extra'); // Updated to fs-extra
const path = require('path');
const fetch = require('node-fetch');
const logger = require('./logger');
const extract = require('extract-zip');
const cliProgress = require('cli-progress');

class MinecraftInstaller {
    constructor() {
        this.baseDir = path.join(process.env.APPDATA, '.alrightlauncher');
        this.versionsDir = path.join(this.baseDir, 'versions');
        this.assetsDir = path.join(this.baseDir, 'assets');
        this.librariesDir = path.join(this.baseDir, 'libraries');
        this.createDirectories();
        this.mainWindow = require('electron').BrowserWindow.getAllWindows()[0];
        this.downloadQueue = [];
        this.isDownloading = false;
        this.downloadDelay = 100; // 500ms delay between downloads
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
        this.mainWindow.webContents.send('install-progress', {
            percent,
            phase,
            detail
        });
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
        const assetIndexUrl = versionData.assetIndex.url;
        const assetIndexPath = path.join(this.assetsDir, 'indexes', `${versionData.assetIndex.id}.json`);
        
        // Create assets directories
        fs.mkdirSync(path.join(this.assetsDir, 'indexes'), { recursive: true });
        fs.mkdirSync(path.join(this.assetsDir, 'objects'), { recursive: true });

        // Download asset index
        logger.info('Downloading asset index...');
        const indexResponse = await fetch(assetIndexUrl);
        const assetIndex = await indexResponse.json();
        fs.writeFileSync(assetIndexPath, JSON.stringify(assetIndex, null, 2));

        // Download assets
        logger.info('Downloading game assets...');
        const assets = assetIndex.objects;
        for (const [name, asset] of Object.entries(assets)) {
            const hash = asset.hash;
            const prefix = hash.substring(0, 2);
            const assetDir = path.join(this.assetsDir, 'objects', prefix);
            const assetPath = path.join(assetDir, hash);

            // Ensure the directory exists
            fs.mkdirSync(assetDir, { recursive: true });

            if (!fs.existsSync(assetPath)) {
                const assetUrl = `https://resources.download.minecraft.net/${prefix}/${hash}`;
                await this.downloadFile(assetUrl, assetPath, `Asset: ${name}`);
                logger.info(`Downloaded asset: ${name}`);
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

        // Updated natives list to match 1.16.5's structure
        const requiredNatives = [
            'lwjgl.dll',
            'lwjgl32.dll',
            'lwjgl64.dll',
            'lwjgl_opengl.dll',
            'lwjgl_opengl32.dll',
            'lwjgl_stb.dll',
            'lwjgl_stb32.dll',
            'lwjgl_tinyfd.dll',
            'lwjgl_tinyfd32.dll',
            'OpenAL.dll',
            'OpenAL32.dll',
            'glfw.dll',
            'glfw32.dll',
            'jemalloc.dll',
            'jemalloc32.dll'
        ];

        const extractedNatives = new Map();
        const processedNatives = new Set(); // Add this line to define processedNatives

        for (const lib of versionData.libraries) {
            if (!this.isLibraryCompatible(lib)) continue;

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
                            // Updated extraction logic
                            const isValidNative = (
                                entry.fileName.endsWith('.dll') && 
                                !entry.fileName.includes('META-INF/') &&
                                (
                                    requiredNatives.some(name => 
                                        entry.fileName.toLowerCase() === name.toLowerCase()
                                    ) ||
                                    entry.fileName.includes('SAPIWrapper')  // Include SAPI wrappers
                                )
                            );
                            
                            if (isValidNative) {
                                logger.info(`Extracting verified native: ${entry.fileName}`);
                                extractedNatives.set(entry.fileName.toLowerCase(), entry);
                                return true;
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

        // Verify essential natives were extracted
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
                if (!lib.downloads?.artifact) continue;

                const progress = 10 + (40 * (i / totalLibraries));
                const libPath = path.join(this.librariesDir, lib.downloads.artifact.path);
                await fs.ensureDir(path.dirname(libPath));

                if (!fs.existsSync(libPath)) {
                    await this.downloadFile(
                        lib.downloads.artifact.url, 
                        libPath,
                        `Library: ${lib.name}`
                    );
                } else {
                    await this.sendProgress(progress, 'Checking Libraries', `Verified: ${lib.name}`);
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
                path.join(versionDir, `${version}.json`),
                JSON.stringify(versionData, null, 2)
            );

            // Download and extract natives
            await this.sendProgress(97, 'Downloading Natives', 'Downloading and extracting native libraries...');
            await this.downloadLibraries(versionData);

            await this.sendProgress(100, 'Complete', `Successfully installed Minecraft ${version}`);
            return true;
        } catch (error) {
            logger.error(`Installation failed: ${error.message}`);
            await this.sendProgress(100, 'Error', error.message);
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

    async validateFile(filePath, expectedSha1) {
        try {
            const exists = await fs.pathExists(filePath);
            if (!exists) return false;
            
            // TODO: Add SHA1 validation
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
}

module.exports = MinecraftInstaller;
