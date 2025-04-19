const path = require('path');
const fs = require('fs/promises');
const { app } = require('electron');

/**
 * Checks for the existence of app icon files at expected locations
 * and logs the results.
 * @returns {Promise<string|null>} Path to the first found icon or null if none found
 */
async function checkIcon() {
    const iconPaths = [
        path.join(app.getAppPath(), 'build', 'app.ico'),
        path.join(process.resourcesPath, 'build', 'app.ico'),
        path.join(__dirname, '..', '..', 'build', 'app.ico')
    ];

    console.log('Checking icon paths:');
    
    try {
        for (const iconPath of iconPaths) {
            try {
                await fs.access(iconPath);
                console.log(`✅ Found icon at: ${iconPath}`);
                return iconPath; // Return the first found icon path
            } catch (error) {
                console.log(`❌ Not found: ${iconPath}`);
            }
        }
        console.log('No icon files found at any of the expected locations.');
        return null;
    } catch (error) {
        console.error('Error while checking icon files:', error.message);
        return null;
    }
}

module.exports = { checkIcon };