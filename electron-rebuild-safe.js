// This script performs a safe rebuild of native modules, focusing on essential ones
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🔧 Safe Electron rebuild starting...');
console.log('This will attempt to build only essential native modules.');

// Specify which modules must be built from source (if any)
const requiredNativeModules = []; // Add any must-have native modules here if needed

// Check for each module
for (const moduleName of requiredNativeModules) {
  try {
    require.resolve(moduleName);
    console.log(`Module ${moduleName} is installed and resolved`);
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.warn(`⚠️ Module ${moduleName} is not installed but required. Installing...`);
      // Install this module specifically
      spawnSync('npm', ['install', moduleName], { stdio: 'inherit' });
    }
  }
}

// Get electron version
const electronVersion = process.env.npm_config_target || 
                       require('./package.json').devDependencies.electron.replace('^', '');

console.log(`Using Electron version: ${electronVersion}`);

// Try using prebuild-install for all modules first
console.log('Attempting to download prebuilt binaries...');
spawnSync('npm', [
  'rebuild', 
  '--update-binary',
  `--target=${electronVersion}`,
  '--runtime=electron'
], { stdio: 'inherit' });

console.log('✅ Safe rebuild complete!');
console.log('Note: If you encounter issues with native modules, you may need to install');
console.log('Visual Studio Build Tools with C++ development components.');
