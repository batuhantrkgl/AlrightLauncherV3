/**
 * Profile creation utility for AlrightLauncher
 * Creates and manages the user's profile configuration
 */
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const os = require('os');

// Setup simple logger with levels
const log = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`),
    debug: (msg) => process.env.DEBUG && console.log(`[DEBUG] ${msg}`)
};

/**
 * Get the appropriate app data directory based on OS
 * @returns {string} Path to app data directory
 */
function getAppDataDir() {
    // Cross-platform support for different OS
    switch (os.platform()) {
        case 'win32':
            return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support');
        case 'linux':
            return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
        default:
            return os.homedir();
    }
}

/**
 * Get default Java arguments based on system memory
 * @returns {string} Optimized Java arguments
 */
function getDefaultJavaArgs() {
    const totalMem = Math.floor(os.totalmem() / (1024 * 1024 * 1024)); // Total RAM in GB
    const allocatedMem = Math.max(1, Math.min(Math.floor(totalMem / 4), 4)); // 1/4 of RAM, min 1GB, max 4GB
    
    return `-Xmx${allocatedMem}G -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC`;
}

/**
 * Creates a default profile file or backs up and updates an existing one
 * @param {Object} options - Configuration options
 * @param {string} [options.baseDir] - Override default app data directory
 * @param {string} [options.profileName] - Custom profile name
 * @param {Object} [options.resolution] - Custom resolution {width, height}
 * @returns {Promise<boolean>} Success status
 */
async function createProfileFile(options = {}) {
    const appDataDir = options.baseDir || path.join(getAppDataDir(), '.alrightlauncher');
    const profilesPath = path.join(appDataDir, 'profile.json');
    
    try {
        log.info(`Creating profile in ${appDataDir}`);
        
        // Ensure the base directory exists
        await fs.ensureDir(appDataDir);
        
        // Handle existing profiles file
        if (await handleExistingProfiles(profilesPath)) {
            log.info('Using existing profiles file');
            return true;
        }
        
        // Generate profile data
        const profileData = generateDefaultProfile(options);
        
        // Write the file
        await fs.writeJson(profilesPath, profileData, { spaces: 2 });
        log.info(`Profile created successfully at ${profilesPath}`);
        
        // Verify the file was created
        const confirmed = await fs.pathExists(profilesPath);
        if (!confirmed) {
            throw new Error('File verification failed - file does not exist after save!');
        }
        
        log.info('Profile file verified. Creation successful!');
        return true;
    } catch (error) {
        log.error(`Failed to create profile: ${error.message}`);
        log.error(error.stack);
        return false;
    }
}

/**
 * Handles existing profile file: backs up and logs
 * @param {string} profilesPath - Path to profile file
 * @returns {Promise<boolean>} True if file exists and should be kept
 */
async function handleExistingProfiles(profilesPath) {
    // Check if profiles file already exists
    const exists = await fs.pathExists(profilesPath);
    if (!exists) return false;
    
    log.info(`Profiles file already exists at ${profilesPath}`);
    
    try {
        // Try to read and validate the existing file
        const contents = await fs.readJson(profilesPath);
        
        if (contents?.profiles && Object.keys(contents.profiles).length > 0) {
            log.info(`Found ${Object.keys(contents.profiles).length} existing profiles`);
            log.debug(`Current profiles: ${JSON.stringify(contents, null, 2)}`);
            
            // Create a timestamped backup
            const backup = `${profilesPath}.backup-${Date.now()}`;
            await fs.copy(profilesPath, backup);
            log.info(`Created backup at ${backup}`);
            
            return true; // Indicate we're keeping the existing file
        }
    } catch (err) {
        log.error(`Failed to read existing profiles: ${err.message}`);
        log.info('Will create a new profile file');
    }
    
    return false;
}

/**
 * Generates a default profile configuration
 * @param {Object} options - Custom options
 * @returns {Object} Profile configuration object
 */
function generateDefaultProfile(options = {}) {
    const profileId = `vanilla-default-${uuidv4().substring(0, 8)}`;
    const timestamp = new Date().toISOString();
    
    return {
        profiles: {
            [profileId]: {
                name: options.profileName || "Vanilla Latest Release",
                type: "vanilla",
                created: timestamp,
                lastUsed: timestamp,
                icon: "Grass",
                gameDir: null,
                lastVersionId: "latest-release",
                javaArgs: getDefaultJavaArgs(),
                resolution: options.resolution || {
                    width: 854,
                    height: 480
                }
            }
        },
        settings: {
            enableSnapshots: false,
            enableBetas: false,
            showGameNews: true,
            defaultProfile: profileId
        }
    };
}

// Run the function if this script is executed directly
if (require.main === module) {
    createProfileFile()
        .then(result => {
            if (result) {
                console.log('Operation completed successfully');
                process.exit(0);
            } else {
                console.error('Operation failed');
                process.exit(1);
            }
        })
        .catch(err => {
            console.error('Unhandled error:', err);
            process.exit(1);
        });
}

module.exports = {
    createProfileFile,
    getAppDataDir, // Export additional functions for testing and reuse
    getDefaultJavaArgs
};