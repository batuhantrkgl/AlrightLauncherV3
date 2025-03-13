const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Setup simple logger since we might not have access to the app's logger
const log = {
    info: (msg) => console.log(`[INFO] ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
};

async function createProfileFile() {
    try {
        const baseDir = path.join(process.env.APPDATA, '.alrightlauncher');
        const profilesPath = path.join(baseDir, 'profile.json');
        
        log.info(`Creating profile in ${baseDir}`);
        
        // Ensure the base directory exists
        await fs.ensureDir(baseDir);
        
        // Check if profiles file already exists
        const exists = await fs.pathExists(profilesPath);
        if (exists) {
            log.info(`Profiles file already exists at ${profilesPath}`);
            try {
                const contents = await fs.readJson(profilesPath);
                log.info(`Current profiles: ${JSON.stringify(contents, null, 2)}`);
            } catch (err) {
                log.error(`Failed to read existing profiles: ${err.message}`);
            }
            
            const backup = `${profilesPath}.backup-${Date.now()}`;
            await fs.copy(profilesPath, backup);
            log.info(`Created backup at ${backup}`);
        }
        
        // Create a default profile
        const profileId = `vanilla-default-${uuidv4().substring(0, 8)}`;
        const profileData = {
            profiles: {
                [profileId]: {
                    name: "Vanilla Latest Release",
                    type: "vanilla",
                    created: new Date().toISOString(),
                    lastUsed: new Date().toISOString(),
                    icon: "Grass",
                    gameDir: null,
                    lastVersionId: "latest-release",
                    javaArgs: "-Xmx2G -XX:+UnlockExperimentalVMOptions -XX:+UseG1GC",
                    resolution: {
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
        
        // Write the file
        await fs.writeJson(profilesPath, profileData, { spaces: 2 });
        log.info(`Profile created successfully at ${profilesPath}`);
        
        // Verify the file was created
        const confirmed = await fs.pathExists(profilesPath);
        if (confirmed) {
            log.info('Profile file verified. Creation successful!');
            return true;
        } else {
            throw new Error('File verification failed - file does not exist after save!');
        }
    } catch (error) {
        log.error(`Failed to create profile: ${error.message}`);
        log.error(error.stack);
        return false;
    }
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

module.exports = createProfileFile;
