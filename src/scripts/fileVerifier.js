const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');
const { promisify } = require('util');
const { pipeline } = require('stream');
const pipelineAsync = promisify(pipeline);

/**
 * Handles file verification and checksum management for Minecraft files
 */
class FileVerifier {
    /**
     * Creates a new FileVerifier instance
     * @param {string} minecraftDir - Directory for Minecraft files
     */
    constructor(minecraftDir) {
        this.minecraftDir = minecraftDir || path.join(process.env.APPDATA, '.alrightlauncher', 'minecraft');
        this.checksumDir = path.join(this.minecraftDir, 'checksums');
        this.ensureDirectoryExists(this.checksumDir);
    }

    /**
     * Ensures a directory exists, creating it if necessary
     * @param {string} dir - Directory path to check/create
     */
    ensureDirectoryExists(dir) {
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirsSync(dir);
                logger.debug(`Created directory: ${dir}`);
            }
        } catch (error) {
            logger.error(`Failed to create directory ${dir}:`, error.message);
            throw new Error(`Failed to create directory: ${error.message}`);
        }
    }

    /**
     * Calculate SHA1 hash of a file using streams for memory efficiency
     * @param {string} filePath - Path to the file
     * @returns {Promise<string>} - SHA1 hash
     */
    async calculateHash(filePath) {
        try {
            const hash = crypto.createHash('sha1');
            const stream = fs.createReadStream(filePath);
            
            // Use pipeline for better stream error handling
            await pipelineAsync(stream, hash);
            return hash.digest('hex');
        } catch (error) {
            logger.error(`Failed to calculate hash for ${filePath}:`, error.message);
            throw error;
        }
    }

    /**
     * Save checksums for a version
     * @param {string} version - Minecraft version
     * @param {Object} checksums - Object with file paths as keys and hashes as values
     * @returns {Promise<boolean>} - Success status
     */
    async saveChecksums(version, checksums) {
        if (!version) {
            throw new Error('Version is required');
        }
        
        if (!checksums || Object.keys(checksums).length === 0) {
            throw new Error('Empty checksums object');
        }
        
        try {
            const checksumFile = path.join(this.checksumDir, `${version}.json`);
            await fs.writeJson(checksumFile, checksums, { spaces: 2 });
            logger.info(`Saved checksums for ${version}`);
            return true;
        } catch (error) {
            logger.error(`Failed to save checksums for ${version}:`, error.message);
            throw error;
        }
    }

    /**
     * Load checksums for a version
     * @param {string} version - Minecraft version
     * @returns {Promise<Object|null>} - Checksums object or null if not found
     */
    async loadChecksums(version) {
        if (!version) {
            throw new Error('Version is required');
        }
        
        try {
            const checksumFile = path.join(this.checksumDir, `${version}.json`);
            
            if (!fs.existsSync(checksumFile)) {
                logger.warn(`No checksum file found for ${version}`);
                return null;
            }
            
            return await fs.readJson(checksumFile);
        } catch (error) {
            logger.error(`Failed to load checksums for ${version}:`, error.message);
            throw error;
        }
    }

    /**
     * Generate checksums for a version's files
     * @param {string} version - Minecraft version
     * @returns {Promise<Object|null>} - Generated checksums or null on failure
     */
    async generateChecksums(version) {
        if (!version) {
            throw new Error('Version is required');
        }
        
        try {
            const versionDir = path.join(this.minecraftDir, 'versions', version);
            const checksums = {};
            
            // Check if version directory exists
            if (!fs.existsSync(versionDir)) {
                logger.error(`Version directory not found: ${versionDir}`);
                return null;
            }
            
            // Get version JSON file
            const versionJsonPath = path.join(versionDir, `${version}.json`);
            if (!fs.existsSync(versionJsonPath)) {
                logger.error(`Version JSON not found: ${versionJsonPath}`);
                return null;
            }
            
            // Calculate hash for version JSON
            checksums[versionJsonPath] = await this.calculateHash(versionJsonPath);
            logger.debug(`Added checksum for ${versionJsonPath}`);
            
            // Get version JAR file
            const versionJarPath = path.join(versionDir, `${version}.jar`);
            if (fs.existsSync(versionJarPath)) {
                checksums[versionJarPath] = await this.calculateHash(versionJarPath);
                logger.debug(`Added checksum for ${versionJarPath}`);
            }
            
            // Read version JSON to get libraries
            const versionData = await fs.readJson(versionJsonPath);
            
            // Process libraries in parallel for better performance
            if (versionData.libraries && Array.isArray(versionData.libraries)) {
                const libraryPromises = versionData.libraries
                    .filter(lib => lib.downloads && lib.downloads.artifact)
                    .map(async (library) => {
                        const relativePath = library.downloads.artifact.path;
                        const libraryPath = path.join(this.minecraftDir, 'libraries', relativePath);
                        
                        if (fs.existsSync(libraryPath)) {
                            try {
                                checksums[libraryPath] = await this.calculateHash(libraryPath);
                                return { success: true, path: libraryPath };
                            } catch (error) {
                                logger.warn(`Failed to hash library ${libraryPath}:`, error.message);
                                return { success: false, path: libraryPath };
                            }
                        }
                        return { success: false, path: libraryPath, missing: true };
                    });
                
                const results = await Promise.allSettled(libraryPromises);
                logger.debug(`Processed ${results.length} libraries`);
            }
            
            // Process assets
            if (versionData.assetIndex) {
                const assetIndexPath = path.join(
                    this.minecraftDir,
                    'assets',
                    'indexes',
                    `${versionData.assetIndex.id}.json`
                );
                
                if (fs.existsSync(assetIndexPath)) {
                    checksums[assetIndexPath] = await this.calculateHash(assetIndexPath);
                    logger.debug(`Added checksum for ${assetIndexPath}`);
                    
                    // Read asset index to get individual assets
                    const assetIndex = await fs.readJson(assetIndexPath);
                    
                    if (assetIndex.objects) {
                        // Process assets in batches to avoid overwhelming the system
                        const assetEntries = Object.entries(assetIndex.objects);
                        const batchSize = 100;
                        
                        for (let i = 0; i < assetEntries.length; i += batchSize) {
                            const batch = assetEntries.slice(i, i + batchSize);
                            
                            const batchPromises = batch.map(async ([assetKey, assetInfo]) => {
                                const hash = assetInfo.hash;
                                const prefix = hash.substring(0, 2);
                                const assetPath = path.join(
                                    this.minecraftDir,
                                    'assets',
                                    'objects',
                                    prefix,
                                    hash
                                );
                                
                                if (fs.existsSync(assetPath)) {
                                    // Use the provided hash for assets to avoid rehashing
                                    checksums[assetPath] = hash;
                                    return true;
                                }
                                return false;
                            });
                            
                            await Promise.all(batchPromises);
                            logger.debug(`Processed asset batch ${i/batchSize + 1}/${Math.ceil(assetEntries.length/batchSize)}`);
                        }
                    }
                }
            }
            
            // Save the generated checksums
            await this.saveChecksums(version, checksums);
            
            return checksums;
        } catch (error) {
            logger.error(`Failed to generate checksums for ${version}:`, error.message);
            return null;
        }
    }

    /**
     * Verify files against saved checksums
     * @param {string} version - Minecraft version
     * @param {Object} options - Verification options
     * @param {boolean} options.regenerate - Force checksum regeneration
     * @param {boolean} options.skipAssets - Skip verifying asset files
     * @returns {Promise<Object>} - Verification result
     */
    async verifyFiles(version, options = {}) {
        if (!version) {
            throw new Error('Version is required');
        }
        
        try {
            // Load or generate checksums
            let checksums = !options.regenerate ? await this.loadChecksums(version) : null;
            
            // If no checksums found or regeneration requested, generate them
            if (!checksums) {
                logger.info(`${options.regenerate ? 'Regenerating' : 'No'} checksums found for ${version}, generating...`);
                checksums = await this.generateChecksums(version);
                
                if (!checksums) {
                    return {
                        success: false,
                        error: 'Failed to generate checksums'
                    };
                }
            }
            
            const result = {
                success: true,
                total: Object.keys(checksums).length,
                verified: 0,
                missing: [],
                corrupted: []
            };
            
            // Filter out assets if skipAssets option is set
            const filesToVerify = options.skipAssets 
                ? Object.entries(checksums).filter(([path]) => !path.includes('/assets/objects/'))
                : Object.entries(checksums);
            
            result.total = filesToVerify.length;
            
            // Process files in batches to avoid overwhelming the system
            const batchSize = 50;
            for (let i = 0; i < filesToVerify.length; i += batchSize) {
                const batch = filesToVerify.slice(i, i + batchSize);
                
                const batchPromises = batch.map(async ([filePath, expectedHash]) => {
                    if (!fs.existsSync(filePath)) {
                        logger.warn(`Missing file: ${filePath}`);
                        return { path: filePath, status: 'missing' };
                    }
                    
                    try {
                        // For asset files, we can skip hashing as the filename is the hash
                        if (filePath.includes('/assets/objects/') && path.basename(filePath) === expectedHash) {
                            return { path: filePath, status: 'verified' };
                        }
                        
                        const actualHash = await this.calculateHash(filePath);
                        
                        if (actualHash !== expectedHash) {
                            logger.warn(`Corrupted file: ${filePath}`);
                            return { path: filePath, status: 'corrupted' };
                        }
                        
                        return { path: filePath, status: 'verified' };
                    } catch (error) {
                        logger.error(`Error verifying file ${filePath}:`, error.message);
                        return { path: filePath, status: 'error', error: error.message };
                    }
                });
                
                const batchResults = await Promise.all(batchPromises);
                
                // Process batch results
                for (const fileResult of batchResults) {
                    switch (fileResult.status) {
                        case 'verified':
                            result.verified++;
                            break;
                        case 'missing':
                            result.missing.push(fileResult.path);
                            break;
                        case 'corrupted':
                        case 'error':
                            result.corrupted.push(fileResult.path);
                            break;
                    }
                }
                
                logger.debug(`Verified batch ${i/batchSize + 1}/${Math.ceil(filesToVerify.length/batchSize)}`);
            }
            
            // Update success status
            result.success = result.missing.length === 0 && result.corrupted.length === 0;
            
            return result;
        } catch (error) {
            logger.error(`File verification error:`, error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get list of installed versions with checksum files
     * @returns {Promise<Array>} - List of installed versions
     */
    async getInstalledVersions() {
        try {
            const versionsDir = path.join(this.minecraftDir, 'versions');
            
            if (!fs.existsSync(versionsDir)) {
                return [];
            }
            
            const dirs = await fs.readdir(versionsDir);
            const versions = [];
            
            for (const dir of dirs) {
                const dirPath = path.join(versionsDir, dir);
                const stats = await fs.stat(dirPath);
                
                if (stats.isDirectory()) {
                    // Check if this is a valid Minecraft version directory
                    const hasJson = fs.existsSync(path.join(dirPath, `${dir}.json`));
                    const hasJar = fs.existsSync(path.join(dirPath, `${dir}.jar`));
                    const hasChecksums = fs.existsSync(path.join(this.checksumDir, `${dir}.json`));
                    
                    if (hasJson || hasJar) {
                        versions.push({
                            id: dir,
                            type: this.determineVersionType(dir),
                            hasChecksums,
                            complete: hasJson && hasJar
                        });
                    }
                }
            }
            
            return versions;
        } catch (error) {
            logger.error('Failed to get installed versions:', error.message);
            return [];
        }
    }

    /**
     * Determine the type of Minecraft version
     * @param {string} version - Version string
     * @returns {string} - Version type (release, snapshot, etc.)
     */
    determineVersionType(version) {
        if (version.includes('snapshot') || version.includes('pre') || version.includes('rc')) {
            return 'snapshot';
        }
        
        if (version.includes('fabric')) {
            return 'fabric';
        }
        
        if (version.includes('forge')) {
            return 'forge';
        }
        
        return 'release';
    }

    /**
     * Get status of files for a version
     * @param {string} version - Minecraft version
     * @returns {Promise<Object>} - File status
     */
    async getFileStatus(version) {
        if (!version) {
            throw new Error('Version is required');
        }
        
        try {
            const versionDir = path.join(this.minecraftDir, 'versions', version);
            const hasChecksums = fs.existsSync(path.join(this.checksumDir, `${version}.json`));
            const versionJsonPath = path.join(versionDir, `${version}.json`);
            const versionJarPath = path.join(versionDir, `${version}.jar`);
            
            const result = {
                installed: fs.existsSync(versionDir),
                hasChecksums,
                versionJsonExists: fs.existsSync(versionJsonPath),
                versionJarExists: fs.existsSync(versionJarPath)
            };
            
            // Add additional metadata if available
            if (result.versionJsonExists) {
                try {
                    const versionData = await fs.readJson(versionJsonPath);
                    result.metadata = {
                        releaseTime: versionData.releaseTime,
                        type: versionData.type || this.determineVersionType(version),
                        mainClass: versionData.mainClass,
                        hasAssetIndex: !!versionData.assetIndex
                    };
                } catch (error) {
                    logger.warn(`Failed to parse version JSON for ${version}:`, error.message);
                }
            }
            
            return result;
        } catch (error) {
            logger.error(`Failed to get file status for ${version}:`, error.message);
            return {
                installed: false,
                hasChecksums: false,
                versionJsonExists: false,
                versionJarExists: false,
                error: error.message
            };
        }
    }
    
    /**
     * Delete checksums for a specific version
     * @param {string} version - Minecraft version
     * @returns {Promise<boolean>} - Success status
     */
    async deleteChecksums(version) {
        if (!version) {
            throw new Error('Version is required');
        }
        
        try {
            const checksumFile = path.join(this.checksumDir, `${version}.json`);
            
            if (fs.existsSync(checksumFile)) {
                await fs.remove(checksumFile);
                logger.info(`Deleted checksums for ${version}`);
                return true;
            }
            
            logger.warn(`No checksums found to delete for ${version}`);
            return false;
        } catch (error) {
            logger.error(`Failed to delete checksums for ${version}:`, error.message);
            throw error;
        }
    }
}

module.exports = FileVerifier;