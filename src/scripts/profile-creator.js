const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs-extra');
const logger = require('./logger');

/**
 * Utility class to automatically create profiles for installed Minecraft versions
 */
class ProfileCreator {
    /**
     * Initialize the profile creator
     * @param {string} minecraftPath Base directory for Minecraft files
     */
    constructor(minecraftPath) {
        this.minecraftPath = minecraftPath;
        this.versionsPath = path.join(minecraftPath, 'versions');
    }

    /**
     * Get a list of all installed versions from the versions directory
     * @returns {Promise<string[]>} Array of installed version names
     */
    async getInstalledVersions() {
        try {
            if (!await fs.pathExists(this.versionsPath)) {
                return [];
            }

            const versionDirs = await fs.readdir(this.versionsPath);
            const installedVersions = [];
            
            for (const versionDir of versionDirs) {
                const versionJsonPath = path.join(this.versionsPath, versionDir, `${versionDir}.json`);
                const versionJarPath = path.join(this.versionsPath, versionDir, `${versionDir}.jar`);
                
                // Only consider versions that have both the JSON and JAR files
                if (await fs.pathExists(versionJsonPath) && await fs.pathExists(versionJarPath)) {
                    installedVersions.push(versionDir);
                }
            }
            
            return installedVersions;
        } catch (error) {
            logger.error(`Failed to get installed versions: ${error.message}`);
            return [];
        }
    }

    /**
     * Check if a profile exists for the given version ID
     * @param {Object} profiles Object containing all profiles
     * @param {string} versionId The Minecraft version ID to check
     * @returns {string|null} Profile ID if found, null otherwise
     */
    findProfileForVersion(profiles, versionId) {
        if (!profiles) return null;
        
        for (const [profileId, profile] of Object.entries(profiles)) {
            if (profile.lastVersionId === versionId) {
                return profileId;
            }
        }
        
        return null;
    }

    /**
     * Determine profile type based on version string
     * @param {string} versionId The Minecraft version ID
     * @returns {string} Profile type (vanilla, fabric, forge, etc.)
     */
    determineProfileType(versionId) {
        if (versionId.includes('fabric')) return 'fabric';
        if (versionId.includes('forge')) return 'forge';
        if (versionId.includes('quilt')) return 'quilt';
        return 'vanilla';
    }

    /**
     * Get appropriate icon for profile type
     * @param {string} type Profile type
     * @returns {string} Icon name
     */
    getIconForType(type) {
        switch (type) {
            case 'fabric': return 'Loom';
            case 'forge': return 'Anvil';
            case 'quilt': return 'Loom';
            default: return 'Grass';
        }
    }

    /**
     * Create a name for a profile based on version ID
     * @param {string} versionId The Minecraft version ID
     * @returns {string} Profile name
     */
    createProfileName(versionId) {
        const type = this.determineProfileType(versionId);
        
        // Don't add redundant prefix if version ID already starts with the type
        if (type === 'vanilla') {
            return `Minecraft ${versionId}`;
        } else if (versionId.toLowerCase().startsWith(type.toLowerCase())) {
            // Version already includes prefix like "fabric-" or "forge-", don't duplicate
            return `${type.charAt(0).toUpperCase() + type.slice(1)} ${versionId}`;
        } else {
            // Add type prefix for clarity
            return `${type.charAt(0).toUpperCase() + type.slice(1)} ${versionId}`;
        }
    }

    /**
     * Ensure a profile exists for the given version, creating one if needed
     * @param {string} versionId The Minecraft version ID
     * @returns {Promise<{success: boolean, id?: string, created: boolean, error?: string}>} Result of the operation
     */
    async ensureProfileExists(versionId) {
        try {
            // Clean version ID if it has a duplicated prefix
            let cleanVersionId = versionId;
            
            // Check for common prefix duplication patterns
            if (cleanVersionId.startsWith('Fabricfabric-')) {
                cleanVersionId = cleanVersionId.replace('Fabricfabric-', 'fabric-');
                logger.info(`Fixed duplicated Fabric prefix in version: ${cleanVersionId}`);
            } else if (cleanVersionId.startsWith('Forgeforge-')) {
                cleanVersionId = cleanVersionId.replace('Forgeforge-', 'forge-');
                logger.info(`Fixed duplicated Forge prefix in version: ${cleanVersionId}`);
            } else if (cleanVersionId.startsWith('Quiltquilt-')) {
                cleanVersionId = cleanVersionId.replace('Quiltquilt-', 'quilt-');
                logger.info(`Fixed duplicated Quilt prefix in version: ${cleanVersionId}`);
            }
            
            // Load the ProfileManager class
            const ProfileManager = require('./profile-manager');
            const profileManager = new ProfileManager(this.minecraftPath);
            
            // Initialize the profile manager
            await profileManager.initialize();
            
            // Get all profiles
            const profiles = profileManager.getProfiles();
            
            // Check if a profile already exists for this version (using clean version)
            const existingProfileId = this.findProfileForVersion(profiles, cleanVersionId);
            if (existingProfileId) {
                logger.info(`Profile already exists for version ${cleanVersionId}: ${existingProfileId}`);
                return { 
                    success: true, 
                    id: existingProfileId,
                    created: false 
                };
            }
            
            // No profile exists, so create one
            const type = this.determineProfileType(cleanVersionId);
            const timestamp = new Date().toISOString();
            
            // Create the profile data - make sure it's compatible with launcher_profiles.json format
            const profileData = {
                name: this.createProfileName(cleanVersionId),
                type: type === 'vanilla' ? 'custom' : type, // Use 'custom' for vanilla profiles
                created: timestamp,
                lastUsed: timestamp,
                icon: this.getIconForType(type),
                gameDir: null, // Use default game directory
                lastVersionId: cleanVersionId,  // Use the clean version ID
                javaArgs: "-Xmx2G -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC",
                resolution: {
                    width: 854,
                    height: 480
                }
            };
            
            // Create the profile
            logger.info(`Creating new profile for version ${cleanVersionId} of type ${type}`);
            const result = await profileManager.createProfile(profileData);
            
            if (result.success) {
                logger.info(`Successfully created profile for ${cleanVersionId}: ${result.id}`);
                return { 
                    success: true, 
                    id: result.id,
                    created: true 
                };
            } else {
                throw new Error(result.error || 'Unknown error creating profile');
            }
        } catch (error) {
            logger.error(`Failed to ensure profile exists for ${versionId}: ${error.message}`);
            return { 
                success: false, 
                error: error.message,
                created: false 
            };
        }
    }

    /**
     * Create profiles for all installed versions that don't have one
     * @returns {Promise<{success: boolean, created: number, existing: number, errors: number}>}
     */
    async createMissingProfiles() {
        try {
            logger.info('Checking for missing profiles for installed versions...');
            
            // Get all installed versions
            const installedVersions = await this.getInstalledVersions();
            
            if (installedVersions.length === 0) {
                logger.warn('No installed versions found');
                return { success: true, created: 0, existing: 0, errors: 0 };
            }
            
            logger.info(`Found ${installedVersions.length} installed versions`);
            
            // Load the ProfileManager class
            const ProfileManager = require('./profile-manager');
            const profileManager = new ProfileManager(this.minecraftPath);
            
            // Initialize the profile manager
            await profileManager.initialize();
            
            // Get all profiles
            const profiles = profileManager.getProfiles();
            
            // Track statistics
            let created = 0;
            let existing = 0;
            let errors = 0;
            
            // Create profiles for versions that don't have one
            for (const versionId of installedVersions) {
                try {
                    const existingProfileId = this.findProfileForVersion(profiles, versionId);
                    
                    if (existingProfileId) {
                        logger.info(`Profile already exists for version ${versionId}: ${existingProfileId}`);
                        existing++;
                        continue;
                    }
                    
                    // Create a profile for this version
                    const result = await this.ensureProfileExists(versionId);
                    
                    if (result.success) {
                        created++;
                    } else {
                        errors++;
                    }
                } catch (error) {
                    logger.error(`Error processing version ${versionId}: ${error.message}`);
                    errors++;
                }
            }
            
            logger.info(`Profile creation complete: ${created} created, ${existing} already existed, ${errors} errors`);
            
            return {
                success: true,
                created,
                existing,
                errors
            };
        } catch (error) {
            logger.error(`Failed to create missing profiles: ${error.message}`);
            return { 
                success: false, 
                created: 0, 
                existing: 0, 
                errors: 1,
                error: error.message 
            };
        }
    }
}

module.exports = ProfileCreator;
