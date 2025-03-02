const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const logger = require('./logger');

class FileVerifier {
    constructor(minecraftDir) {
        this.minecraftDir = minecraftDir || path.join(process.env.APPDATA, '.alrightlauncher', 'minecraft');
        this.checksumDir = path.join(this.minecraftDir, 'checksums');
        this.ensureDirectoryExists(this.checksumDir);
    }

    ensureDirectoryExists(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdirsSync(dir);
        }
    }

    /**
     * Calculate SHA1 hash of a file
     * @param {string} filePath - Path to the file
     * @returns {Promise<string>} - SHA1 hash
     */
    async calculateHash(filePath) {
        return new Promise((resolve, reject) => {
            try {
                const hash = crypto.createHash('sha1');
                const stream = fs.createReadStream(filePath);
                
                stream.on('error', err => reject(err));
                stream.on('data', chunk => hash.update(chunk));
                stream.on('end', () => resolve(hash.digest('hex')));
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Save checksums for a version
     * @param {string} version - Minecraft version
     * @param {Object} checksums - Object with file paths as keys and hashes as values
     */
    async saveChecksums(version, checksums) {
        try {
            const checksumFile = path.join(this.checksumDir, `${version}.json`);
            await fs.writeJson(checksumFile, checksums, { spaces: 2 });
            logger.info(`Saved checksums for ${version}`);
            return true;
        } catch (error) {
            logger.error(`Failed to save checksums for ${version}:`, error.message);
            return false;
        }
    }

    /**
     * Load checksums for a version
     * @param {string} version - Minecraft version
     * @returns {Promise<Object>} - Checksums object
     */
    async loadChecksums(version) {
        try {
            const checksumFile = path.join(this.checksumDir, `${version}.json`);
            
            if (!fs.existsSync(checksumFile)) {
                logger.warn(`No checksum file for ${version}`);
                return null;
            }
            
            return await fs.readJson(checksumFile);
        } catch (error) {
            logger.error(`Failed to load checksums for ${version}:`, error.message);
            return null;
        }
    }

    /**
     * Generate checksums for a version's files
     * @param {string} version - Minecraft version
     * @returns {Promise<Object>} - Generated checksums
     */
    async generateChecksums(version) {
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
            
            // Get version JAR file
            const versionJarPath = path.join(versionDir, `${version}.jar`);
            if (fs.existsSync(versionJarPath)) {
                checksums[versionJarPath] = await this.calculateHash(versionJarPath);
            }
            
            // Read version JSON to get libraries
            const versionData = await fs.readJson(versionJsonPath);
            
            // Process libraries
            if (versionData.libraries && Array.isArray(versionData.libraries)) {
                for (const library of versionData.libraries) {
                    if (library.downloads && library.downloads.artifact) {
                        const relativePath = library.downloads.artifact.path;
                        const libraryPath = path.join(this.minecraftDir, 'libraries', relativePath);
                        
                        if (fs.existsSync(libraryPath)) {
                            checksums[libraryPath] = await this.calculateHash(libraryPath);
                        }
                    }
                }
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
                    
                    // Read asset index to get individual assets
                    const assetIndex = await fs.readJson(assetIndexPath);
                    
                    if (assetIndex.objects) {
                        for (const [assetKey, assetInfo] of Object.entries(assetIndex.objects)) {
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
                                checksums[assetPath] = hash;
                            }
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
     * @returns {Promise<Object>} - Verification result
     */
    async verifyFiles(version) {
        try {
            // Load checksums
            let checksums = await this.loadChecksums(version);
            
            // If no checksums found, generate them
            if (!checksums) {
                logger.info(`No checksums found for ${version}, generating...`);
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
            
            // Verify each file
            for (const [filePath, expectedHash] of Object.entries(checksums)) {
                if (!fs.existsSync(filePath)) {
                    logger.warn(`Missing file: ${filePath}`);
                    result.missing.push(filePath);
                    continue;
                }
                
                try {
                    const actualHash = await this.calculateHash(filePath);
                    
                    if (actualHash !== expectedHash) {
                        logger.warn(`Corrupted file: ${filePath}`);
                        result.corrupted.push(filePath);
                    } else {
                        result.verified++;
                    }
                } catch (error) {
                    logger.error(`Error verifying file ${filePath}:`, error.message);
                    result.corrupted.push(filePath);
                }
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
            
            const dirs = fs.readdirSync(versionsDir).filter(dir => {
                const stats = fs.statSync(path.join(versionsDir, dir));
                return stats.isDirectory();
            });
            
            return dirs.map(id => ({
                id,
                type: 'release',
                hasChecksums: fs.existsSync(path.join(this.checksumDir, `${id}.json`))
            }));
        } catch (error) {
            logger.error('Failed to get installed versions:', error.message);
            return [];
        }
    }

    /**
     * Get status of files for a version
     * @param {string} version - Minecraft version
     * @returns {Promise<Object>} - File status
     */
    async getFileStatus(version) {
        try {
            const versionDir = path.join(this.minecraftDir, 'versions', version);
            const hasChecksums = fs.existsSync(path.join(this.checksumDir, `${version}.json`));
            
            return {
                installed: fs.existsSync(versionDir),
                hasChecksums,
                versionJsonExists: fs.existsSync(path.join(versionDir, `${version}.json`)),
                versionJarExists: fs.existsSync(path.join(versionDir, `${version}.jar`))
            };
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
}

module.exports = FileVerifier;
