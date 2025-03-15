// This script helps build the project with Bun, avoiding native module issues
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const packageJson = require('./package.json');

console.log('🚀 Bun-specific build script starting...');

// Check if npm is available (needed for native modules)
function commandExists(command) {
  try {
    const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch (error) {
    return false;
  }
}

// Make sure npm is available
if (!commandExists('npm')) {
  console.error('❌ npm is required for rebuilding native modules. Please install Node.js.');
  process.exit(1);
}

// Modify scripts in package.json to use npm instead of bun for build
console.log('ℹ️ Preparing package.json for npm-based build...');
const tempPackageJson = { ...packageJson };
tempPackageJson.scripts.build = tempPackageJson.scripts.build.replace(/^bun/g, 'npm');
tempPackageJson.scripts.dist = tempPackageJson.scripts.dist.replace(/^bun/g, 'npm');

// Write temporary package.json
const tempPackageJsonPath = path.join(__dirname, 'package.json.temp');
fs.writeFileSync(tempPackageJsonPath, JSON.stringify(tempPackageJson, null, 2));

// Move original package.json to backup
const originalPackageJsonPath = path.join(__dirname, 'package.json');
const backupPackageJsonPath = path.join(__dirname, 'package.json.bak');
fs.renameSync(originalPackageJsonPath, backupPackageJsonPath);

// Move temp package.json to real package.json
fs.renameSync(tempPackageJsonPath, originalPackageJsonPath);

try {
  // Run npm install to ensure dependencies use prebuilt binaries
  console.log('📦 Installing dependencies with npm...');
  spawnSync('npm', ['install', '--no-optional', '--no-package-lock'], { 
    stdio: 'inherit',
    env: {
      ...process.env,
      npm_config_build_from_source: 'false',
      npm_config_prefer_offline: 'true'
    } 
  });
  
  // Run the electron-builder command
  console.log('🏗️ Building application with electron-builder...');
  const buildResult = spawnSync('npm', ['run', 'dist'], { 
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_TLS_REJECT_UNAUTHORIZED: '0'
    }
  });
  
  if (buildResult.status !== 0) {
    console.error('❌ Build failed with electron-builder');
    process.exit(1);
  }
  
  console.log('✅ Build completed successfully!');
} catch (error) {
  console.error('❌ Error during build process:', error);
  process.exit(1);
} finally {
  // Restore original package.json
  fs.renameSync(backupPackageJsonPath, originalPackageJsonPath);
  console.log('ℹ️ Restored original package.json');
}
