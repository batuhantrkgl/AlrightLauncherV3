const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Utility script to simulate updates for testing the update mechanism
 * Usage: node simulate-update.js [version] [channel] [shouldFail]
 */

// Helper function to create a simulated update file
function createSimulatedUpdateFile(version, channel) {
  const simulatedDir = path.join(__dirname, '..', 'simulate-updates');
  fs.mkdirSync(simulatedDir, { recursive: true });
  
  const fileName = `AlrightLauncher-Setup-${version}.exe`;
  const filePath = path.join(simulatedDir, fileName);
  
  // Create a dummy file with some content
  const content = Buffer.from(`This is a simulated update file for version ${version} (${channel} channel)`);
  fs.writeFileSync(filePath, content);
  
  // Calculate sha256 hash
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  
  return {
    filePath,
    fileName,
    hash
  };
}

// Main function to simulate an update
function simulateUpdate(options = {}) {
  const {
    version = '9.9.9',
    channel = 'beta',
    shouldFail = false
  } = options;
  
  console.log(`Simulating ${channel} update to version ${version}${shouldFail ? ' (with failure)' : ''}`);
  
  // Read current updates.json
  const updatesPath = path.join(__dirname, '..', 'updates.json');
  const updates = JSON.parse(fs.readFileSync(updatesPath, 'utf8'));
  
  // Back up the current updates.json
  const backupPath = path.join(__dirname, '..', 'updates.json.bak');
  if (!fs.existsSync(backupPath)) {
    fs.copyFileSync(updatesPath, backupPath);
    console.log(`Original updates.json backed up to ${backupPath}`);
  }

  // Create simulated update file
  const simulatedFile = createSimulatedUpdateFile(version, channel);
  console.log(`Created simulated update file: ${simulatedFile.filePath}`);
  console.log(`File hash (SHA-256): ${simulatedFile.hash}`);
  
  // Create a download URL that points to the local file
  const downloadUrl = shouldFail 
    ? 'invalid://download.url/not-a-real-file.exe' 
    : `file://${simulatedFile.filePath.replace(/\\/g, '/')}`;
  
  // Update the specified channel
  updates[channel] = {
    version,
    releaseDate: new Date().toISOString().split('T')[0],
    downloadUrl,
    sha256: simulatedFile.hash,
    releaseNotes: `This is a simulated ${channel} update to version ${version}.\n\nSimulation enabled for testing.`,
    isSimulated: true
  };
  
  // Write the updated file
  fs.writeFileSync(updatesPath, JSON.stringify(updates, null, 2));
  console.log(`Updates.json modified to simulate ${channel} update to version ${version}`);
  console.log('To restore the original updates.json, run: node simulate-update.js --restore');
}

// Restore updates.json from backup
function restoreUpdatesJson() {
  const updatesPath = path.join(__dirname, '..', 'updates.json');
  const backupPath = path.join(__dirname, '..', 'updates.json.bak');
  
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, updatesPath);
    console.log('Original updates.json restored from backup');
  } else {
    console.error('No backup file found at', backupPath);
  }
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  
  // Check for restore flag
  if (args.includes('--restore')) {
    restoreUpdatesJson();
    return;
  }
  
  // Parse options
  const options = {};
  
  if (args[0] && !args[0].startsWith('--')) {
    options.version = args[0];
  }
  
  if (args[1] && !args[1].startsWith('--')) {
    options.channel = args[1];
  }
  
  options.shouldFail = args.includes('--fail');
  
  simulateUpdate(options);
}

// Run the script
parseArgs();

// Export functions for programmatic usage
module.exports = {
  simulateUpdate,
  restoreUpdatesJson
};
