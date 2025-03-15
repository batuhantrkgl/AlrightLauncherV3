/**
 * Script to regenerate package-lock.json file
 * Run with: node update-lock.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Updating package-lock.json to match package.json...');

// Delete existing package-lock.json
const lockPath = path.join(__dirname, 'package-lock.json');
if (fs.existsSync(lockPath)) {
  console.log('Removing existing package-lock.json');
  fs.unlinkSync(lockPath);
}

// Run npm install to regenerate the lock file
console.log('Running npm install to regenerate package-lock.json...');
const result = spawnSync('npm', ['install', '--package-lock-only'], { 
  stdio: 'inherit',
  shell: true
});

if (result.status === 0) {
  console.log('✅ Successfully updated package-lock.json');
} else {
  console.error('❌ Failed to update package-lock.json');
  process.exit(1);
}
