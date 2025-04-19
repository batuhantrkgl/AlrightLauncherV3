const { execSync, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs-extra');  // Using fs-extra instead of fs for enhanced features

// Constants
const PLATFORM = os.platform();
const IS_WINDOWS = PLATFORM === 'win32';
const PACKAGE_JSON_PATH = path.join(process.cwd(), 'package.json');

console.log('Checking build dependencies...');

/**
 * Checks if a command exists in the system PATH
 * @param {string} command - The command to check
 * @returns {boolean} - Whether the command exists
 */
function commandExists(command) {
  try {
    const result = spawnSync(command, ['--version'], { 
      stdio: 'ignore',
      shell: IS_WINDOWS 
    });
    return result.status === 0;
  } catch (error) {
    return false;
  }
}

/**
 * Checks for Visual Studio installation (Windows only)
 * @returns {boolean} - Whether Visual Studio is installed
 */
function checkVisualStudio() {
  if (!IS_WINDOWS) return true;
  
  console.log('Checking for Visual Studio installation...');
  
  // Try different potential VS installation paths
  const vsPathsToCheck = [
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio'),
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Microsoft Visual Studio')
  ];
  
  for (const basePath of vsPathsToCheck) {
    if (!fs.existsSync(basePath)) continue;
    
    try {
      const editions = fs.readdirSync(basePath);
      for (const edition of editions) {
        const versionPath = path.join(basePath, edition);
        if (fs.statSync(versionPath).isDirectory()) {
          console.log(`✓ Found Visual Studio in: ${versionPath}`);
          return true;
        }
      }
    } catch (err) {
      // Continue checking other paths
    }
  }
  
  // Check if VS Build Tools are installed separately
  const buildToolsPath = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 
    'Microsoft Visual Studio\\BuildTools');
  
  if (fs.existsSync(buildToolsPath)) {
    console.log(`✓ Found Visual Studio Build Tools in: ${buildToolsPath}`);
    return true;
  }
  
  console.log('❌ Visual Studio with C++ tools not found');
  return false;
}

/**
 * Checks for windows-build-tools NPM package
 * @returns {boolean} - Whether windows-build-tools is installed
 */
function checkWindowsBuildTools() {
  try {
    const npmRoot = execSync('npm root -g').toString().trim();
    const buildToolsPath = path.join(npmRoot, 'windows-build-tools');
    
    if (fs.existsSync(buildToolsPath)) {
      console.log('✓ Found windows-build-tools package');
      return true;
    }
  } catch (err) {
    // Ignore errors
  }
  
  return false;
}

/**
 * Updates package.json to prefer prebuilt modules
 * @returns {boolean} - Whether the update succeeded
 */
function updatePackageJsonForPrebuiltModules() {
  try {
    let packageJson;
    
    try {
      packageJson = fs.readJsonSync(PACKAGE_JSON_PATH);
    } catch (err) {
      console.error('❌ Failed to read package.json:', err.message);
      return false;
    }
    
    // Add npm config options
    packageJson.npm_config_prefer_offline = true;
    packageJson.npm_config_prefer_prebuilt = true;
    packageJson.npm_config_fallback_to_build = true;
    
    // Ensure dependencies object exists
    packageJson.dependencies = packageJson.dependencies || {};
    packageJson.devDependencies = packageJson.devDependencies || {};
    packageJson.scripts = packageJson.scripts || {};
    
    // Add necessary dependencies if not present
    if (!packageJson.dependencies['prebuild-install']) {
      packageJson.dependencies['prebuild-install'] = "^7.1.1";
    }
    
    if (!packageJson.dependencies['lzma-native'] && !packageJson.devDependencies['lzma-native']) {
      console.log('Adding lzma-native dependency to package.json with prebuilt binary preferences');
      packageJson.dependencies['lzma-native'] = "8.0.1";
    }
    
    // Update build scripts
    if (!packageJson.scripts.rebuild) {
      packageJson.scripts.rebuild = "cross-env npm_config_build_from_source=false npm rebuild";
    }
    
    const buildCommand = packageJson.scripts.build;
    if (buildCommand && !buildCommand.includes('npm_config_build_from_source=false')) {
      packageJson.scripts.build = "cross-env npm_config_build_from_source=false " + buildCommand;
    }
    
    // Write updated package.json with proper formatting
    fs.writeJsonSync(PACKAGE_JSON_PATH, packageJson, { spaces: 2 });
    console.log('✅ Updated package.json to prefer prebuilt binaries');
    return true;
  } catch (err) {
    console.error('❌ Failed to update package.json:', err.message);
    return false;
  }
}

/**
 * Creates a script for safely rebuilding native modules
 */
function createSafeRebuildScript() {
  const scriptPath = path.join(process.cwd(), 'electron-rebuild-safe.js');
  const scriptContent = `
// This script performs a safe rebuild of native modules, focusing on essential ones
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🔧 Safe Electron rebuild starting...');
console.log('This will attempt to build only essential native modules.');

// Specify which modules must be built from source (if any)
const requiredNativeModules = []; // Example: ['sqlite3', 'canvas']

// Check for each module
for (const moduleName of requiredNativeModules) {
  try {
    require.resolve(moduleName);
    console.log(\`Module \${moduleName} is installed and resolved\`);
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') {
      console.warn(\`⚠️ Module \${moduleName} is not installed but required. Installing...\`);
      // Install this module specifically
      spawnSync('npm', ['install', moduleName], { stdio: 'inherit' });
    }
  }
}

// Get electron version
const electronVersion = process.env.npm_config_target || 
                        require('./package.json').devDependencies.electron.replace(/[^0-9.]/g, '');

console.log(\`Using Electron version: \${electronVersion}\`);

// Try using prebuild-install for all modules first
console.log('Attempting to download prebuilt binaries...');
spawnSync('npm', [
  'rebuild', 
  '--update-binary',
  \`--target=\${electronVersion}\`,
  '--runtime=electron'
], { stdio: 'inherit' });

console.log('✅ Safe rebuild complete!');
console.log('Note: If you encounter issues with native modules, you may need to install');
console.log('Visual Studio Build Tools with C++ development components.');
  `;
  
  fs.writeFileSync(scriptPath, scriptContent.trim());
  console.log('✅ Created safe rebuild script at electron-rebuild-safe.js');
  
  // Add it to package.json scripts
  try {
    const packageJson = fs.readJsonSync(PACKAGE_JSON_PATH);
    packageJson.scripts = packageJson.scripts || {};
    packageJson.scripts['rebuild-safe'] = 'node electron-rebuild-safe.js';
    fs.writeJsonSync(PACKAGE_JSON_PATH, packageJson, { spaces: 2 });
  } catch (err) {
    console.error('Failed to add rebuild-safe script to package.json:', err.message);
  }
}

/**
 * Main application process
 */
async function main() {
  // Check if npm is available
  if (!commandExists('npm')) {
    console.error('❌ npm is required but not found. Please install Node.js.');
    process.exit(1);
  }
  
  // Windows-specific checks
  if (IS_WINDOWS) {
    const vsInstalled = checkVisualStudio();
    const buildToolsInstalled = checkWindowsBuildTools();
    
    if (!vsInstalled && !buildToolsInstalled) {
      console.log('\n⚠️  Warning: Microsoft Visual Studio with C++ tools not detected!');
      console.log('   This is required to build native modules.');
      console.log('\n   You have three options:');
      console.log('   1. Install Visual Studio Community with "Desktop development with C++" workload');
      console.log('      https://visualstudio.microsoft.com/downloads/');
      console.log('   2. Install the Visual Studio Build Tools (smaller download)');
      console.log('      https://visualstudio.microsoft.com/visual-cpp-build-tools/');
      console.log('   3. Use prebuilt binaries where possible (recommended for faster builds)');
      console.log('\n   For option #3, we will update your package.json to prefer prebuilt modules.\n');
      
      updatePackageJsonForPrebuiltModules();
    }
  }

  console.log('\nInstalling essential dependencies...');
  
  // Install minimal dependencies to avoid native module builds
  try {
    execSync('npm install --no-optional --production=false', { 
      stdio: 'inherit',
      shell: IS_WINDOWS 
    });
    console.log('✅ Dependencies installed successfully');
  } catch (err) {
    console.error('❌ Failed to install dependencies:', err.message);
    process.exit(1);
  }
  
  // Create electron-rebuild-safe.js script for safely rebuilding
  createSafeRebuildScript();
  
  console.log('\n✅ Setup complete! Try building using: npm run build');
  if (IS_WINDOWS && (!checkVisualStudio() && !checkWindowsBuildTools())) {
    console.log('   If you encounter any issues, consider installing Visual Studio Build Tools.');
  }
}

// Run the main function with proper error handling
main().catch(err => {
  console.error('An error occurred:', err);
  process.exit(1);
});