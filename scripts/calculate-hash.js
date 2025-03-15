const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

// Function to calculate file hash
async function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('error', err => reject(err));
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// Function to update the updates.json file
async function updateUpdatesJson(version, filePath, releaseNotes = null) {
  try {
    // Calculate file hash
    const sha256 = await calculateFileHash(filePath);
    console.log(`SHA-256: ${sha256}`);
    
    // Read current updates.json
    const updatesPath = path.join(__dirname, '..', 'updates.json');
    const updates = JSON.parse(fs.readFileSync(updatesPath, 'utf8'));
    
    // Update the stable channel
    updates.stable.version = version;
    updates.stable.releaseDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    updates.stable.downloadUrl = `https://github.com/batuhantrkgl/AlrightLauncher/releases/download/v${version}/AlrightLauncher-Setup-${version}.exe`;
    updates.stable.sha256 = sha256;
    
    if (releaseNotes) {
      updates.stable.releaseNotes = releaseNotes;
    }
    
    // Write back the file
    fs.writeFileSync(updatesPath, JSON.stringify(updates, null, 2));
    console.log(`Updated updates.json with version ${version}`);
    
  } catch (error) {
    console.error('Error updating updates.json:', error);
  }
}

// Get command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
  console.log('Usage: node calculate-hash.js <version> <file-path> [release-notes]');
  process.exit(1);
}

const version = args[0];
const filePath = args[1];
const releaseNotes = args[2] || null;

// Execute update
updateUpdatesJson(version, filePath, releaseNotes);
