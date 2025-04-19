// This script performs a safe rebuild of native modules, focusing on essential ones
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs-extra');
const cliProgress = require('cli-progress');

// Create a progress bar for better visual feedback
const progressBar = new cliProgress.SingleBar({
  format: '{bar} {percentage}% | {value}/{total} | {status}',
  barCompleteChar: '\u2588',
  barIncompleteChar: '\u2591',
}, cliProgress.Presets.shades_classic);

console.log('🔧 Safe Electron rebuild starting...');

// Specify which modules must be built from source (if any)
const requiredNativeModules = []; // Add any must-have native modules here if needed

// Get electron version with better fallback mechanism
let electronVersion;
try {
  // First try to get from package.json
  const packageJson = require('./package.json');
  electronVersion = packageJson.devDependencies?.electron?.replace(/[\^~]/, '') || 
                    packageJson.dependencies?.electron?.replace(/[\^~]/, '');
  
  // If not found in package.json, try environment variable
  if (!electronVersion) {
    electronVersion = process.env.npm_config_target;
  }
  
  // Last resort - check node_modules/electron/package.json
  if (!electronVersion && fs.existsSync('./node_modules/electron/package.json')) {
    electronVersion = require('./node_modules/electron/package.json').version;
  }
  
  if (!electronVersion) {
    throw new Error('Could not determine Electron version');
  }
} catch (error) {
  console.error('❌ Error determining Electron version:', error.message);
  process.exit(1);
}

console.log(`Using Electron version: ${electronVersion}`);

// Check for each required module and install if needed
if (requiredNativeModules.length > 0) {
  console.log('Checking required native modules...');
  progressBar.start(requiredNativeModules.length, 0, { status: 'Checking modules' });
  
  for (let i = 0; i < requiredNativeModules.length; i++) {
    const moduleName = requiredNativeModules[i];
    progressBar.update(i, { status: `Checking ${moduleName}` });
    
    try {
      require.resolve(moduleName);
      // Module exists
    } catch (e) {
      if (e.code === 'MODULE_NOT_FOUND') {
        progressBar.stop();
        console.warn(`⚠️ Module ${moduleName} is not installed but required. Installing...`);
        
        // Install this module specifically
        const installResult = spawnSync('npm', ['install', moduleName], { 
          stdio: 'inherit',
          encoding: 'utf8'
        });
        
        if (installResult.status !== 0) {
          console.error(`❌ Failed to install ${moduleName}`);
          process.exit(1);
        }
        
        progressBar.start(requiredNativeModules.length, i, { status: 'Continuing checks' });
      }
    }
  }
  progressBar.update(requiredNativeModules.length, { status: 'All modules checked' });
  progressBar.stop();
}

// Function to execute a command with proper error handling
function executeCommand(command, args, options = {}) {
  console.log(`Executing: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { 
    stdio: 'inherit',
    encoding: 'utf8',
    ...options
  });
  
  if (result.status !== 0) {
    console.error(`❌ Command failed: ${command} ${args.join(' ')}`);
    console.error(result.stderr || '');
    return false;
  }
  return true;
}

// Try using prebuild-install for all modules first
console.log('Attempting to download prebuilt binaries...');
const rebuildSuccess = executeCommand('npm', [
  'rebuild', 
  '--update-binary',
  `--target=${electronVersion}`,
  '--runtime=electron',
  '--dist-url=https://electronjs.org/headers'
]);

if (!rebuildSuccess) {
  console.warn('⚠️ Prebuild attempt had issues. Falling back to @electron/rebuild...');
  try {
    // Try to use @electron/rebuild as fallback
    const { rebuild } = require('@electron/rebuild');
    
    console.log('Running @electron/rebuild...');
    rebuild({
      buildPath: process.cwd(),
      electronVersion,
      force: true
    }).then(() => {
      console.log('✅ @electron/rebuild completed successfully!');
    }).catch(error => {
      console.error('❌ @electron/rebuild failed:', error.message);
      process.exit(1);
    });
  } catch (e) {
    console.error('❌ Could not use @electron/rebuild. Please install it with:');
    console.error('   npm install --save-dev @electron/rebuild');
    process.exit(1);
  }
} else {
  console.log('✅ Safe rebuild completed successfully!');
}

// Check if we're on Windows to provide specific advice
if (process.platform === 'win32') {
  console.log('\nNote: If you encounter issues with native modules on Windows, you may need to install:');
  console.log('1. Visual Studio Build Tools with C++ development components');
  console.log('2. Python (which may be required by some native modules)');
} else if (process.platform === 'darwin') {
  console.log('\nNote: If you encounter issues with native modules on macOS, you may need:');
  console.log('1. Xcode Command Line Tools (run: xcode-select --install)');
} else {
  console.log('\nNote: If you encounter issues with native modules on Linux, you may need:');
  console.log('1. Build essentials (sudo apt-get install build-essential on Debian/Ubuntu)');
  console.log('2. Python');
}