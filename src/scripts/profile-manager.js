const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

class ProfileManager {
    constructor(baseDir) {
        this.baseDir = baseDir || path.join(process.env.APPDATA, '.alrightlauncher');
        this.profilesPath = path.join(this.baseDir, 'profile.json');
        this.profiles = {};
        this.settings = {
            enableSnapshots: false,
            enableBetas: false,
            showGameNews: true,
            defaultProfile: null
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
                    this.profiles = data.profiles || {};
                    this.settings = data.settings || this.settings;
                    logger.info(`Loaded ${Object.keys(this.profiles).length} profiles from ${this.profilesPath}`);
                } catch (readError) {
                    logger.error(`Failed to parse profile.json: ${readError.message}`);
                    // Continue and recreate profiles
                }
            } else {
                // Create a default profiles file
                logger.info(`No profiles found at ${this.profilesPath}, creating defaults`);
                await this.createDefaultProfiles();
                
                // Verify the file was created
                if (await fs.pathExists(this.profilesPath)) {
                    logger.info(`Successfully created profile.json at ${this.profilesPath}`);
                } else {
                    throw new Error(`Failed to create profile.json at ${this.profilesPath}`);
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
            const profileId = `vanilla-default-${uuidv4().substring(0, 8)}`;
            this.profiles[profileId] = {
                name: "Vanilla Latest Release",
                type: "vanilla",
                created: new Date().toISOString(),
                lastUsed: new Date().toISOString(),
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
            
            // Try using direct file writing if fs-extra's methods fail
            const profileData = JSON.stringify({
                profiles: this.profiles,
                settings: this.settings
            }, null, 2);
            
            // Write file synchronously to ensure it completes
            fs.writeFileSync(this.profilesPath, profileData, 'utf8');
            
            logger.info(`Profile file written successfully: ${this.profilesPath}`);
            
            // Double check file exists
            const exists = await fs.pathExists(this.profilesPath);
            logger.info(`Verified profile.json exists: ${exists}`);
            
            if (!exists) {
                throw new Error(`Failed to create profile.json - file doesn't exist after save`);
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
            
            // Write the file with pretty formatting
            await fs.writeJson(this.profilesPath, {
                profiles: this.profiles,
                settings: this.settings
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
}

module.exports = ProfileManager;
