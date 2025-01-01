const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function checkIcon() {
    const iconPaths = [
        path.join(app.getAppPath(), 'build', 'app.ico'),
        path.join(process.resourcesPath, 'build', 'app.ico'),
        path.join(__dirname, '..', '..', 'build', 'app.ico')
    ];

    console.log('Checking icon paths:');
    iconPaths.forEach(iconPath => {
        console.log(`Checking ${iconPath}: ${fs.existsSync(iconPath)}`);
    });
}

module.exports = { checkIcon };
