const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

class ProfileManager {
    constructor(baseDir) {
        this.baseDir = baseDir || path.join(process.env.APPDATA, '.alrightlauncher');
        // Change from profile.json to launcher_profiles.json for better compatibility
        this.profilesPath = path.join(this.baseDir, 'launcher_profiles.json');
        this.profiles = {};
        this.settings = {
            enableSnapshots: false,
            enableBetas: false,
            showGameNews: true,
            defaultProfile: null,
            keepLauncherOpen: false,
            crashAssistance: true
        };
        this.initialized = false;
        
        // Don't initialize in constructor - this will be called explicitly
    }

    async initialize() {
        if (this.initialized) return;
        
        try {
            logger.info(`Initializing ProfileManager in ${this.baseDir}`);
            
            // Ensure the base directory exists with explicit error handling
            try {
                await fs.ensureDir(this.baseDir);
                logger.info(`Base directory created/verified: ${this.baseDir}`);
            } catch (dirError) {
                logger.error(`Failed to create base directory: ${dirError.message}`);
                throw dirError;
            }
            
            // Try to load existing profiles
            if (await fs.pathExists(this.profilesPath)) {
                try {
                    const data = await fs.readJson(this.profilesPath);
                    
                    // Handle both our format and official launcher format
                    if (data.profiles) {
                        this.profiles = data.profiles;
                        logger.info(`Loaded ${Object.keys(this.profiles).length} profiles from ${this.profilesPath}`);
                    }
                    
                    // Load settings
                    if (data.settings) {
                        this.settings = {
                            ...this.settings,
                            ...data.settings,
                            // Keep our custom settings that don't exist in the official launcher
                            defaultProfile: data.settings.defaultProfile || this.settings.defaultProfile
                        };
                    }
                    
                } catch (readError) {
                    logger.error(`Failed to parse launcher_profiles.json: ${readError.message}`);
                    // Continue and recreate profiles
                }
            } else {
                // Check for old format first
                const oldProfilesPath = path.join(this.baseDir, 'profile.json');
                if (await fs.pathExists(oldProfilesPath)) {
                    try {
                        logger.info(`Found old profile format at ${oldProfilesPath}, migrating...`);
                        const oldData = await fs.readJson(oldProfilesPath);
                        
                        if (oldData.profiles) {
                            this.profiles = oldData.profiles;
                        }
                        
                        if (oldData.settings) {
                            this.settings = {
                                ...this.settings,
                                ...oldData.settings
                            };
                        }
                        
                        // Save in new format
                        await this.saveProfiles();
                        
                        // Rename old file as backup
                        await fs.rename(oldProfilesPath, path.join(this.baseDir, 'profile.json.bak'));
                        logger.info('Migration from old profile format completed');
                    } catch (migrationError) {
                        logger.error(`Failed to migrate from old profile format: ${migrationError.message}`);
                    }
                } else {
                    // Create default profiles
                    logger.info(`No profiles found at ${this.profilesPath}, creating defaults`);
                    await this.createDefaultProfiles();
                    
                    // Verify the file was created
                    if (await fs.pathExists(this.profilesPath)) {
                        logger.info(`Successfully created launcher_profiles.json at ${this.profilesPath}`);
                    } else {
                        throw new Error(`Failed to create launcher_profiles.json at ${this.profilesPath}`);
                    }
                }
            }
            
            this.initialized = true;
        } catch (error) {
            logger.error(`Failed to initialize profiles: ${error.message}`);
            logger.error(error.stack);
            
            // Try to create default profiles even if there was an error
            try {
                await this.createDefaultProfiles(true); // Force recreation
                this.initialized = true;
                logger.info("Profiles initialized successfully after error recovery");
            } catch (fallbackError) {
                logger.error(`Fallback profile creation failed: ${fallbackError.message}`);
                throw fallbackError; // Re-throw to signal initialization failure
            }
        }
    }

    async createDefaultProfiles(forceRecreate = false) {
        try {
            // Force delete the profiles file if it exists and we're forcing recreation
            if (forceRecreate && await fs.pathExists(this.profilesPath)) {
                logger.info(`Force removing existing profiles at ${this.profilesPath}`);
                await fs.remove(this.profilesPath);
            }
            
            // Create a default vanilla profile
            const timestamp = new Date().toISOString();
            const profileId = `vanilla-default-${uuidv4().substring(0, 8)}`;
            this.profiles[profileId] = {
                name: "Vanilla Latest Release",
                type: "latest-release",
                created: timestamp,
                lastUsed: timestamp,
                icon: "Grass",
                gameDir: null, // Use default game directory
                lastVersionId: "latest-release",
                javaArgs: "-Xmx2G -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC",
                resolution: {
                    width: 854,
                    height: 480
                }
            };

            this.settings.defaultProfile = profileId;
            
            // Explicitly create the directory structure
            const dirPath = path.dirname(this.profilesPath);
            await fs.ensureDir(dirPath);
            logger.info(`Ensuring directory exists: ${dirPath}`);
            
            // Save the created profiles with direct file writing
            logger.info(`Writing profiles to ${this.profilesPath}`);
            
            // Format in official launcher style
            const profileData = JSON.stringify({
                profiles: this.profiles,
                settings: this.settings,
                version: 3 // Current launcher format version
            }, null, 2);
            
            // Write file synchronously to ensure it completes
            fs.writeFileSync(this.profilesPath, profileData, 'utf8');
            
            logger.info(`Profile file written successfully: ${this.profilesPath}`);
            
            // Double check file exists
            const exists = await fs.pathExists(this.profilesPath);
            logger.info(`Verified launcher_profiles.json exists: ${exists}`);
            
            if (!exists) {
                throw new Error(`Failed to create launcher_profiles.json - file doesn't exist after save`);
            }
            
            return true;
        } catch (error) {
            logger.error(`Failed to create default profiles: ${error.message}`);
            logger.error(error.stack);
            throw error; // Re-throw to signal failure
        }
    }

    async saveProfiles() {
        try {
            // Ensure directory exists before saving
            await fs.ensureDir(path.dirname(this.profilesPath));
            
            // Write the file with pretty formatting in official format
            await fs.writeJson(this.profilesPath, {
                profiles: this.profiles,
                settings: this.settings,
                version: 3 // Current launcher format version
            }, { spaces: 2 });
            
            logger.info(`Profiles saved successfully to ${this.profilesPath}`);
            return true;
        } catch (error) {
            logger.error(`Failed to save profiles: ${error.message}`);
            logger.error(error.stack);
            return false;
        }
    }

    getProfiles() {
        return this.profiles;
    }

    getProfile(id) {
        return this.profiles[id] || null;
    }

    getDefaultProfile() {
        if (this.settings.defaultProfile && this.profiles[this.settings.defaultProfile]) {
            return {
                id: this.settings.defaultProfile,
                ...this.profiles[this.settings.defaultProfile]
            };
        }

        // If default profile doesn't exist, return the first profile
        const profileIds = Object.keys(this.profiles);
        if (profileIds.length > 0) {
            return {
                id: profileIds[0],
                ...this.profiles[profileIds[0]]
            };
        }

        return null;
    }

    async createProfile(profileData) {
        try {
            const id = profileData.id || `${profileData.type}-${profileData.lastVersionId}-${uuidv4().substring(0, 8)}`;
            
            const timestamp = new Date().toISOString();
            
            this.profiles[id] = {
                name: profileData.name || `${profileData.type} ${profileData.lastVersionId}`,
                type: profileData.type || 'vanilla',
                created: timestamp,
                lastUsed: timestamp,
                icon: profileData.icon || 'Grass',
                gameDir: profileData.gameDir || null,
                lastVersionId: profileData.lastVersionId || 'latest-release',
                javaArgs: profileData.javaArgs || "-Xmx2G -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC",
                resolution: profileData.resolution || {
                    width: 854,
                    height: 480
                },
                // Store additional modloader-specific data
                modLoaderData: profileData.modLoaderData || {}
            };
            
            await this.saveProfiles();
            return { success: true, id };
        } catch (error) {
            logger.error(`Failed to create profile: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async updateProfile(id, profileData) {
        try {
            if (!this.profiles[id]) {
                throw new Error(`Profile ${id} not found`);
            }
            
            // Update only provided fields
            this.profiles[id] = {
                ...this.profiles[id],
                ...profileData,
                lastUsed: new Date().toISOString()
            };
            
            await this.saveProfiles();
            return { success: true };
        } catch (error) {
            logger.error(`Failed to update profile ${id}: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async deleteProfile(id) {
        try {
            if (!this.profiles[id]) {
                throw new Error(`Profile ${id} not found`);
            }
            
            delete this.profiles[id];
            
            // If this was the default profile, set a new default
            if (this.settings.defaultProfile === id) {
                const profileIds = Object.keys(this.profiles);
                if (profileIds.length > 0) {
                    this.settings.defaultProfile = profileIds[0];
                } else {
                    this.settings.defaultProfile = null;
                }
            }
            
            await this.saveProfiles();
            return { success: true };
        } catch (error) {
            logger.error(`Failed to delete profile ${id}: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async setDefaultProfile(id) {
        try {
            if (!this.profiles[id]) {
                throw new Error(`Profile ${id} not found`);
            }
            
            this.settings.defaultProfile = id;
            await this.saveProfiles();
            return { success: true };
        } catch (error) {
            logger.error(`Failed to set default profile: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async updateSettings(settings) {
        try {
            this.settings = {
                ...this.settings,
                ...settings
            };
            
            await this.saveProfiles();
            return { success: true };
        } catch (error) {
            logger.error(`Failed to update settings: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    // Helper method to create forge profile
    async createForgeProfile(minecraftVersion, forgeVersion) {
        const timestamp = new Date().toISOString();
        const versionId = `${minecraftVersion}-forge-${forgeVersion}`;
        
        return await this.createProfile({
            name: `Forge ${minecraftVersion}`,
            type: 'forge',
            lastVersionId: versionId,
            gameDir: path.join(this.baseDir, 'forge', versionId),
            icon: 'Anvil',
            modLoaderData: {
                forgeVersion,
                minecraftVersion
            }
        });
    }

    // Helper method to create fabric profile
    async createFabricProfile(minecraftVersion, fabricVersion) {
        const timestamp = new Date().toISOString();
        const versionId = `fabric-loader-${fabricVersion}-${minecraftVersion}`;
        
        return await this.createProfile({
            name: `Fabric ${minecraftVersion}`,
            type: 'fabric',
            lastVersionId: versionId,
            gameDir: path.join(this.baseDir, 'fabric', versionId),
            icon: 'Loom',
            modLoaderData: {
                fabricVersion,
                minecraftVersion
            }
        });
    }
    
    // New methods for importing from Minecraft launcher profiles
    
    /**
     * Import profiles from the official Minecraft launcher
     * @param {string} customPath Optional custom path to launcher_profiles.json
     * @returns {Promise<{success: boolean, imported: number, error?: string}>}
     */
    async importMinecraftProfiles(customPath = null) {
        try {
            // Default path for the official launcher profiles
            const defaultPath = path.join(process.env.APPDATA, '.minecraft', 'launcher_profiles.json');
            const profilesPath = customPath || defaultPath;
            
            logger.info(`Attempting to import profiles from ${profilesPath}`);
            
            if (!await fs.pathExists(profilesPath)) {
                logger.warn(`Minecraft profiles not found at ${profilesPath}`);
                return { success: false, imported: 0, error: 'Minecraft profiles not found' };
            }
            
            // Read the profiles
            const data = await fs.readJson(profilesPath);
            
            if (!data.profiles || typeof data.profiles !== 'object') {
                logger.warn('Invalid profile format');
                return { success: false, imported: 0, error: 'Invalid profile format' };
            }
            
            // Initialize our profile manager if needed
            if (!this.initialized) {
                await this.initialize();
            }
            
            // Track imported profiles
            const importedProfiles = [];
            
            // Convert and import each profile
            for (const [id, profile] of Object.entries(data.profiles)) {
                try {
                    // Skip profiles without valid version ID
                    if (!profile.lastVersionId) continue;
                    
                    const convertedProfile = this.convertMinecraftProfile(profile);
                    const result = await this.createProfile(convertedProfile);
                    
                    if (result.success) {
                        importedProfiles.push(result.id);
                        logger.info(`Imported profile: ${profile.name || 'unnamed'} (${profile.lastVersionId})`);
                    }
                } catch (error) {
                    logger.warn(`Failed to import profile ${profile.name || id}: ${error.message}`);
                }
            }
            
            logger.info(`Successfully imported ${importedProfiles.length} profiles from Minecraft launcher`);
            
            return {
                success: true,
                imported: importedProfiles.length,
                profiles: importedProfiles
            };
        } catch (error) {
            logger.error(`Profile import error: ${error.message}`);
            logger.error(error.stack);
            return { success: false, imported: 0, error: error.message };
        }
    }
    
    /**
     * Convert a Minecraft launcher profile to our format
     * @param {Object} mcProfile Profile from Minecraft launcher
     * @returns {Object} Our profile format
     */
    convertMinecraftProfile(mcProfile) {
        // Map type
        let type = 'vanilla';
        if (mcProfile.lastVersionId.includes('forge')) {
            type = 'forge';
        } else if (mcProfile.lastVersionId.includes('fabric')) {
            type = 'fabric';
        } else if (mcProfile.lastVersionId.includes('quilt')) {
            type = 'quilt';
        }
        
        // Determine icon
        let icon = 'Grass';
        if (mcProfile.icon === 'Dirt') icon = 'Dirt';
        if (mcProfile.icon === 'TNT') icon = 'TNT';
        
        // Extract resolution
        let resolution = { width: 854, height: 480 };
        if (mcProfile.resolution) {
            resolution = {
                width: parseInt(mcProfile.resolution.width) || 854,
                height: parseInt(mcProfile.resolution.height) || 480
            };
        }
        
        // Convert Java args
        const javaArgs = mcProfile.javaArgs || "-Xmx2G -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC";
        
        // Create our profile format
        return {
            name: mcProfile.name || `${type} ${mcProfile.lastVersionId}`,
            type: type,
            icon: icon,
            gameDir: mcProfile.gameDir || null,
            lastVersionId: mcProfile.lastVersionId,
            javaArgs: javaArgs,
            resolution: resolution,
            created: mcProfile.created || new Date().toISOString(),
            lastUsed: mcProfile.lastUsed || new Date().toISOString()
        };
    }
}

module.exports = ProfileManager;
