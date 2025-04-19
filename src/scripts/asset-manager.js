const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
const crypto = require('crypto');
const logger = require('./logger');

class AssetManager {
    constructor(baseDir) {
        this.baseDir = baseDir || path.join(process.env.APPDATA, '.alrightlauncher');
        this.assetsDir = path.join(this.baseDir, 'assets');
        this.indexesDir = path.join(this.assetsDir, 'indexes');
        this.objectsDir = path.join(this.assetsDir, 'objects');
        this.iconsDir = path.join(this.baseDir, 'icons');
        
        // Configuration values that can be adjusted
        this.config = {
            downloadBatchSize: 50,
            downloadRetries: 3,
            downloadTimeout: 30000, // 30 seconds
            downloadConcurrency: 10, // Controls parallel downloads
            validateHashes: true
        };
    }

    /**
     * Initialize all required asset directories
     */
    async initialize() {
        try {
            await Promise.all([
                fs.ensureDir(this.assetsDir),
                fs.ensureDir(this.indexesDir),
                fs.ensureDir(this.objectsDir),
                fs.ensureDir(this.iconsDir)
            ]);
            logger.info(`Asset directories initialized at ${this.assetsDir}`);
            return true;
        } catch (error) {
            logger.error(`Failed to initialize asset directories: ${error.message}`, error);
            throw new Error(`Asset directory initialization failed: ${error.message}`);
        }
    }

    /**
     * Download the asset index for a specific Minecraft version
     * @param {string} version - Minecraft version
     * @returns {string} - The asset index ID
     */
    async downloadAssetIndex(version) {
        if (!version) {
            throw new Error('Version parameter is required');
        }

        logger.info(`Downloading asset index for ${version}`);
        
        try {
            // Get path to version JSON
            const versionJsonPath = path.join(this.baseDir, 'versions', version, `${version}.json`);
            
            if (!await fs.pathExists(versionJsonPath)) {
                throw new Error(`Version JSON not found at ${versionJsonPath}`);
            }
            
            // Read and parse the version JSON
            const versionData = await fs.readJson(versionJsonPath);
            const assetIndex = versionData.assetIndex;
            
            if (!assetIndex || !assetIndex.url) {
                throw new Error('Asset index information missing from version JSON');
            }
            
            const indexId = assetIndex.id;
            logger.info(`Asset index ID: ${indexId}`);
            
            const indexPath = path.join(this.indexesDir, `${indexId}.json`);
            
            // Check if we already have the asset index
            if (await fs.pathExists(indexPath)) {
                logger.info(`Asset index ${indexId}.json already exists, validating...`);
                
                // Validate the SHA1 if provided
                if (assetIndex.sha1 && this.config.validateHashes) {
                    const currentFile = await fs.readFile(indexPath);
                    const currentHash = crypto.createHash('sha1').update(currentFile).digest('hex');
                    
                    if (currentHash !== assetIndex.sha1) {
                        logger.warn(`Asset index SHA1 mismatch, redownloading`);
                        await this._downloadFile(assetIndex.url, indexPath);
                    } else {
                        logger.info(`Asset index SHA1 validated successfully`);
                    }
                }
            } else {
                // Download the asset index
                await this._downloadFile(assetIndex.url, indexPath);
            }
            
            // Return the index ID for reference
            return indexId;
            
        } catch (error) {
            logger.error(`Failed to download asset index: ${error.message}`, error);
            throw error;
        }
    }

    /**
     * Downloads a file with retry logic
     * @param {string} url - URL to download from
     * @param {string} destination - Where to save the file
     * @returns {Promise<boolean>} - Whether download was successful
     * @private
     */
    async _downloadFile(url, destination) {
        let attempts = 0;
        
        while (attempts < this.config.downloadRetries) {
            attempts++;
            try {
                logger.info(`Downloading from ${url} (attempt ${attempts}/${this.config.downloadRetries})`);
                
                const response = await fetch(url, {
                    timeout: this.config.downloadTimeout
                });
                
                if (!response.ok) {
                    throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
                }
                
                const buffer = await response.buffer();
                await fs.writeFile(destination, buffer);
                logger.info(`Successfully downloaded to ${destination}`);
                return true;
            } catch (error) {
                logger.warn(`Download attempt ${attempts} failed: ${error.message}`);
                
                if (attempts >= this.config.downloadRetries) {
                    logger.error(`All download attempts failed for ${url}`);
                    throw new Error(`Failed to download ${url} after ${this.config.downloadRetries} attempts: ${error.message}`);
                }
                
                // Wait before retry (exponential backoff)
                const delay = Math.min(1000 * Math.pow(2, attempts - 1), 10000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
        
        return false;
    }

    /**
     * Validates a file against its expected hash
     * @param {string} filePath - Path to the file
     * @param {string} expectedHash - Expected SHA1 hash
     * @returns {Promise<boolean>} - Whether validation passed
     * @private
     */
    async _validateFileHash(filePath, expectedHash) {
        try {
            const fileBuffer = await fs.readFile(filePath);
            const actualHash = crypto.createHash('sha1').update(fileBuffer).digest('hex');
            return actualHash === expectedHash;
        } catch (error) {
            logger.error(`Hash validation failed: ${error.message}`);
            return false;
        }
    }

    /**
     * Download game assets for a specific Minecraft version
     * @param {string} version - Minecraft version
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Object>} - Download results
     */
    async downloadAssets(version, onProgress = null) {
        if (!version) {
            throw new Error('Version parameter is required');
        }

        try {
            // First get or download the asset index
            const indexId = await this.downloadAssetIndex(version);
            const indexPath = path.join(this.indexesDir, `${indexId}.json`);
            
            if (!await fs.pathExists(indexPath)) {
                throw new Error(`Asset index ${indexId}.json not found`);
            }
            
            // Parse the asset index
            const indexData = await fs.readJson(indexPath);
            const objects = indexData.objects || {};
            const objectList = Object.entries(objects);
            const totalAssets = objectList.length;
            
            logger.info(`Found ${totalAssets} assets to process`);
            
            if (totalAssets === 0) {
                return { success: true, downloaded: 0, total: 0 };
            }
            
            // Tracking variables
            let downloadedCount = 0;
            let skippedCount = 0;
            let failedCount = 0;
            let lastProgressUpdate = Date.now();
            
            // Process assets in batches
            const batchSize = this.config.downloadBatchSize;
            
            for (let i = 0; i < objectList.length; i += batchSize) {
                const batch = objectList.slice(i, i + batchSize);
                
                // Run a limited number of concurrent downloads to avoid overwhelming the network
                const results = await this._processAssetBatch(batch, this.config.downloadConcurrency);
                
                // Update counters
                downloadedCount += results.downloaded;
                skippedCount += results.skipped;
                failedCount += results.failed;
                
                // Report progress (but limit frequency of updates to avoid UI lag)
                const now = Date.now();
                if (onProgress && (now - lastProgressUpdate > 200 || i + batchSize >= objectList.length)) {
                    onProgress({
                        downloaded: downloadedCount,
                        skipped: skippedCount,
                        failed: failedCount,
                        total: totalAssets,
                        progress: Math.round(((downloadedCount + skippedCount + failedCount) / totalAssets) * 100)
                    });
                    lastProgressUpdate = now;
                }
            }
            
            logger.info(`Asset download complete: ${downloadedCount} downloaded, ${skippedCount} skipped, ${failedCount} failed`);
            
            // Report final progress
            if (onProgress) {
                onProgress({
                    downloaded: downloadedCount,
                    skipped: skippedCount,
                    failed: failedCount,
                    total: totalAssets,
                    progress: 100
                });
            }
            
            return { 
                success: failedCount === 0, 
                downloaded: downloadedCount,
                skipped: skippedCount,
                failed: failedCount,
                total: totalAssets
            };
            
        } catch (error) {
            logger.error(`Failed to download assets: ${error.message}`, error);
            
            if (onProgress) {
                onProgress({
                    error: error.message,
                    progress: 0
                });
            }
            
            return { 
                success: false, 
                error: error.message
            };
        }
    }

    /**
     * Process a batch of assets with limited concurrency
     * @param {Array} batch - Array of asset entries to process
     * @param {number} concurrency - Maximum number of parallel operations
     * @returns {Promise<Object>} - Batch results
     * @private
     */
    async _processAssetBatch(batch, concurrency) {
        const results = {
            downloaded: 0,
            skipped: 0,
            failed: 0
        };
        
        // Use a simple semaphore pattern to limit concurrency
        const semaphore = {
            count: 0,
            queue: [],
            async acquire() {
                if (this.count < concurrency) {
                    this.count++;
                    return Promise.resolve();
                }
                
                return new Promise(resolve => {
                    this.queue.push(resolve);
                });
            },
            release() {
                this.count--;
                if (this.queue.length > 0) {
                    const next = this.queue.shift();
                    this.count++;
                    next();
                }
            }
        };
        
        // Process the batch with controlled concurrency
        await Promise.all(batch.map(async ([assetPath, asset]) => {
            await semaphore.acquire();
            
            try {
                const result = await this._processAsset(assetPath, asset);
                
                if (result === 'downloaded') {
                    results.downloaded++;
                } else if (result === 'skipped') {
                    results.skipped++;
                } else {
                    results.failed++;
                }
            } catch (error) {
                logger.error(`Asset processing error: ${error.message}`);
                results.failed++;
            } finally {
                semaphore.release();
            }
        }));
        
        return results;
    }

    /**
     * Process a single asset
     * @param {string} assetPath - Asset path in the index
     * @param {Object} asset - Asset metadata
     * @returns {Promise<string>} - 'downloaded', 'skipped', or 'failed'
     * @private
     */
    async _processAsset(assetPath, asset) {
        try {
            // The first two characters of the hash are the subdirectory
            const hash = asset.hash;
            const subdir = hash.substring(0, 2);
            const subDirectory = path.join(this.objectsDir, subdir);
            const assetFilePath = path.join(subDirectory, hash);
            
            // Create the subdirectory if it doesn't exist
            await fs.ensureDir(subDirectory);
            
            // Check if the file already exists and validate it
            if (await fs.pathExists(assetFilePath)) {
                // Only validate hash if requested in config
                if (this.config.validateHashes) {
                    const isValid = await this._validateFileHash(assetFilePath, hash);
                    if (isValid) {
                        return 'skipped';
                    }
                    // If hash validation fails, re-download the file
                    logger.warn(`Asset ${hash} failed hash validation, redownloading`);
                } else {
                    // Skip validation, assume file is good
                    const stats = await fs.stat(assetFilePath);
                    // If file size matches expected size, assume it's good
                    if (stats.size === asset.size) {
                        return 'skipped';
                    }
                    logger.warn(`Asset ${hash} has incorrect size, redownloading`);
                }
            }
            
            // Download the asset
            const url = `https://resources.download.minecraft.net/${subdir}/${hash}`;
            
            // Try to download the file with retries
            let attempts = 0;
            while (attempts < this.config.downloadRetries) {
                attempts++;
                try {
                    const response = await fetch(url, {
                        timeout: this.config.downloadTimeout
                    });
                    
                    if (!response.ok) {
                        throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
                    }
                    
                    const buffer = await response.buffer();
                    await fs.writeFile(assetFilePath, buffer);
                    
                    // Validate downloaded file if requested
                    if (this.config.validateHashes) {
                        const isValid = await this._validateFileHash(assetFilePath, hash);
                        if (!isValid) {
                            throw new Error('Downloaded file failed hash validation');
                        }
                    }
                    
                    // Special logging for sound assets
                    if (assetPath.startsWith('minecraft/sounds/')) {
                        logger.debug(`Downloaded sound asset: ${assetPath}`);
                    }
                    
                    return 'downloaded';
                    
                } catch (error) {
                    logger.warn(`Download attempt ${attempts} failed for ${hash}: ${error.message}`);
                    
                    if (attempts >= this.config.downloadRetries) {
                        logger.error(`All download attempts failed for asset ${hash}`);
                        return 'failed';
                    }
                    
                    // Wait before retry with exponential backoff
                    const delay = Math.min(1000 * Math.pow(2, attempts - 1), 10000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            return 'failed';
            
        } catch (error) {
            logger.error(`Failed to process asset ${assetPath}: ${error.message}`);
            return 'failed';
        }
    }

    /**
     * Setup game icons for a specific version
     * @param {string} version - Minecraft version
     * @returns {Promise<boolean>} - Success status
     */
    async setupGameIcons(version) {
        if (!version) {
            throw new Error('Version parameter is required');
        }

        try {
            logger.info(`Setting up game icons for ${version}`);
            
            // Create the icons directory for the version
            const versionIconsDir = path.join(this.baseDir, 'versions', version, 'icons');
            await fs.ensureDir(versionIconsDir);
            
            // Define icons to copy
            const icons = [
                { size: '16x16', filename: 'icon_16x16.png' },
                { size: '32x32', filename: 'icon_32x32.png' },
                { size: '64x64', filename: 'icon_64x64.png' },
                { size: '128x128', filename: 'icon_128x128.png' }
            ];
            
            // Define possible source directories
            const possibleSourceDirs = [
                path.join(process.resourcesPath, 'build'), // Packaged app resources
                path.join(process.cwd(), 'build'),         // Development environment
                this.iconsDir                              // Launcher's icon directory
            ];
            
            let successCount = 0;
            
            for (const icon of icons) {
                const destPath = path.join(versionIconsDir, icon.filename);
                
                // Skip if the icon already exists
                if (await fs.pathExists(destPath)) {
                    logger.info(`Icon ${icon.filename} already exists, skipping`);
                    successCount++;
                    continue;
                }
                
                // Try to find the icon in different locations
                let sourcePath = null;
                
                for (const dir of possibleSourceDirs) {
                    const testPath = path.join(dir, icon.filename);
                    if (await fs.pathExists(testPath)) {
                        sourcePath = testPath;
                        break;
                    }
                }
                
                if (sourcePath) {
                    // Copy the icon
                    await fs.copy(sourcePath, destPath);
                    logger.info(`Copied icon from ${sourcePath} to ${destPath}`);
                    successCount++;
                } else {
                    // Create a placeholder if we can't find the real icon
                    logger.warn(`Icon ${icon.filename} not found in any source directory, creating placeholder`);
                    await this.createPlaceholderIcon(destPath, parseInt(icon.size.split('x')[0]));
                    successCount++;
                }
            }
            
            return successCount === icons.length;
            
        } catch (error) {
            logger.error(`Failed to set up game icons: ${error.message}`, error);
            return false;
        }
    }

    /**
     * Create a placeholder icon of the specified size
     * @param {string} destPath - Destination file path
     * @param {number} size - Icon size (width/height in pixels)
     * @returns {Promise<void>}
     */
    async createPlaceholderIcon(destPath, size) {
        // In a real implementation, we'd generate a simple PNG
        // For now, just create a buffer of the right size
        await fs.writeFile(destPath, Buffer.alloc(size * size * 4));
        logger.info(`Created placeholder icon at ${destPath}`);
    }

    /**
     * Update the asset manager configuration
     * @param {Object} newConfig - New configuration values
     * @returns {Object} - Updated configuration
     */
    updateConfig(newConfig) {
        this.config = {
            ...this.config,
            ...newConfig
        };
        return this.config;
    }
}

module.exports = AssetManager;