// This script helps build the project with Bun, avoiding native module issues
const { spawnSync } = require('child_process');
const fs = require('fs-extra'); // Using fs-extra for better file operations
const path = require('path');

console.log('🚀 Bun-specific build script starting...');

// Check if a command exists (needed for npm)
function commandExists(command) {
  try {
    const result = spawnSync(command, ['--version'], { 
      stdio: 'ignore',
      shell: process.platform === 'win32' // Better Windows support
    });
    return result.status === 0;
  } catch (error) {
    return false;
  }
}

// Execute a command and handle errors
function executeCommand(command, args, options = {}) {
  console.log(`Executing: ${command} ${args.join(' ')}`);
  
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32', // Better Windows support
    ...options
  });
  
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
  
  return result;
}

async function main() {
  try {
    // Validate npm is available
    if (!commandExists('npm')) {
      console.error('❌ npm is required for rebuilding native modules. Please install Node.js.');
      process.exit(1);
    }

    // Load package.json
    const packageJsonPath = path.join(__dirname, 'package.json');
    const backupPath = path.join(__dirname, 'package.json.bak');
    
    // Ensure we have package.json
    if (!fs.existsSync(packageJsonPath)) {
      console.error('❌ package.json not found in the current directory');
      process.exit(1);
    }
    
    // Read and parse package.json
    const packageJson = require(packageJsonPath);
    
    // Backup original package.json
    console.log('📑 Creating backup of package.json...');
    await fs.copy(packageJsonPath, backupPath);
    
    // Modify scripts in package.json
    console.log('ℹ️ Preparing package.json for npm-based build...');
    const tempPackageJson = { ...packageJson };
    
    // Only modify if scripts exist
    if (tempPackageJson.scripts) {
      if (tempPackageJson.scripts.build) {
        tempPackageJson.scripts.build = tempPackageJson.scripts.build.replace(/^bun/g, 'npm');
      }
      
      if (tempPackageJson.scripts.dist) {
        tempPackageJson.scripts.dist = tempPackageJson.scripts.dist.replace(/^bun/g, 'npm');
      }
    } else {
      console.error('❌ No scripts found in package.json');
      process.exit(1);
    }
    
    // Write modified package.json
    await fs.writeFile(packageJsonPath, JSON.stringify(tempPackageJson, null, 2));
    
    try {
      // Run npm install with prebuilt binaries preference
      console.log('📦 Installing dependencies with npm...');
      executeCommand('npm', ['install', '--no-optional', '--no-package-lock'], { 
        env: {
          ...process.env,
          npm_config_build_from_source: 'false',
          npm_config_prefer_offline: 'true'
        } 
      });
      
      // Run the electron-builder command
      console.log('🏗️ Building application with electron-builder...');
      executeCommand('npm', ['run', 'dist'], { 
        env: {
          ...process.env,
          NODE_TLS_REJECT_UNAUTHORIZED: '0'
        }
      });
      
      console.log('✅ Build completed successfully!');
    } finally {
      // Always restore original package.json
      console.log('ℹ️ Restoring original package.json...');
      await fs.copy(backupPath, packageJsonPath);
      await fs.remove(backupPath);
    }
  } catch (error) {
    console.error('❌ Error during build process:', error.message);
    process.exit(1);
  }
}

// Run the main function
main();