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
    }

    createDirectories() {
        [this.baseDir, this.versionsDir, this.assetsDir, this.librariesDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
    }

    async downloadFile(url, destination) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download: ${response.statusText}`);
        }
        const totalSize = parseInt(response.headers.get('content-length'), 10);
        let downloadedSize = 0;

        const progressBar = new cliProgress.SingleBar({
            format: 'Downloading |{bar}| {percentage}% | {value}/{total} bytes',
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591'
        });
        
        progressBar.start(totalSize, 0);

        const fileStream = fs.createWriteStream(destination);
        return new Promise((resolve, reject) => {
            response.body.on('data', (chunk) => {
                downloadedSize += chunk.length;
                progressBar.update(downloadedSize);
            });
            response.body.pipe(fileStream);
            response.body.on('error', (error) => {
                progressBar.stop();
                reject(error);
            });
            fileStream.on('finish', () => {
                progressBar.stop();
                resolve();
            });
        });
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
                await this.downloadFile(assetUrl, assetPath);
                logger.info(`Downloaded asset: ${name}`);
            }
        }
    }

    async downloadLibraries(versionData) {
        logger.info('Downloading libraries...');
        for (const lib of versionData.libraries) {
            if (!lib.downloads?.artifact) continue;

            const libPath = path.join(this.librariesDir, lib.downloads.artifact.path);
            fs.mkdirSync(path.dirname(libPath), { recursive: true });
            
            if (!fs.existsSync(libPath)) {
                await this.downloadFile(lib.downloads.artifact.url, libPath);
                logger.info(`Downloaded library: ${lib.name}`);
            }

            // Download natives if present
            if (lib.natives && lib.downloads.classifiers) {
                const nativeKey = lib.natives[process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux'];
                const nativeArtifact = lib.downloads.classifiers[nativeKey];
                
                if (nativeArtifact) {
                    const nativePath = path.join(this.librariesDir, nativeArtifact.path);
                    fs.mkdirSync(path.dirname(nativePath), { recursive: true });
                    
                    if (!fs.existsSync(nativePath)) {
                        await this.downloadFile(nativeArtifact.url, nativePath);
                        logger.info(`Downloaded native library: ${lib.name}`);
                    }

                    // Extract native libraries to the natives folder
                    const nativesDir = path.join(this.versionsDir, versionData.id, 'natives');
                    await this.extractZip(nativePath, nativesDir);
                    logger.info(`Extracted native library: ${lib.name}`);
                }
            }
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

    async installVersion(version) {
        try {
            logger.info(`Starting installation of Minecraft ${version}`);
            
            const manifest = await this.getVersionManifest();
            logger.info('Got version manifest');
            
            const versionInfo = manifest.versions.find(v => v.id === version);
            if (!versionInfo) {
                logger.error(`Version ${version} not found in manifest`);
                throw new Error(`Version ${version} not found`);
            }

            logger.info(`Downloading version ${version} data`);
            const versionResponse = await fetch(versionInfo.url, {
                headers: { 'Accept': 'application/json' }
            });

            if (!versionResponse.ok) {
                logger.error(`Failed to fetch version data: ${versionResponse.statusText}`);
                throw new Error(`Failed to fetch version data: ${versionResponse.statusText}`);
            }

            const versionData = await versionResponse.json();
            logger.info(`Got version data for ${version}`);

            const versionDir = path.join(this.versionsDir, version);
            if (!fs.existsSync(versionDir)) {
                fs.mkdirSync(versionDir, { recursive: true });
                logger.info(`Created version directory: ${versionDir}`);
            }

            // Download libraries first
            await this.downloadLibraries(versionData);
            logger.info('Libraries downloaded successfully');

            // Download client jar
            logger.info('Downloading client jar...');
            const clientJar = path.join(versionDir, `${version}.jar`);
            await this.downloadFile(versionData.downloads.client.url, clientJar);
            logger.info('Client jar downloaded successfully');

            // Download assets
            await this.downloadAssets(versionData);
            logger.info('Assets downloaded successfully');

            // Save version json
            fs.writeFileSync(
                path.join(versionDir, `${version}.json`),
                JSON.stringify(versionData, null, 2)
            );

            logger.info(`Successfully installed Minecraft ${version}`);
            return true;
        } catch (error) {
            logger.error(`Installation error: ${error.message}`);
            return false;
        }
    }
}

module.exports = MinecraftInstaller;
