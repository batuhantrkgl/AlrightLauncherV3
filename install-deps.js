const { execSync, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

console.log('Checking build dependencies...');

// Function to check if a command exists
function commandExists(command) {
  try {
    const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch (error) {
    return false;
  }
}

// Check for Visual Studio installation more thoroughly (Windows only)
function checkVisualStudio() {
  if (os.platform() !== 'win32') return true;
  
  console.log('Checking for Visual Studio installation...');
  
  // Try different potential VS installation paths
  const vsPathsToCheck = [
    process.env['ProgramFiles(x86)'] + '\\Microsoft Visual Studio',
    process.env['ProgramFiles'] + '\\Microsoft Visual Studio',
    'C:\\Program Files (x86)\\Microsoft Visual Studio',
    'C:\\Program Files\\Microsoft Visual Studio'
  ];
  
  for (const basePath of vsPathsToCheck) {
    if (!fs.existsSync(basePath)) continue;
    
    // Look for folders like "2019", "2022", etc.
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
  const buildToolsPath = process.env['ProgramFiles(x86)'] + '\\Microsoft Visual Studio\\BuildTools';
  if (fs.existsSync(buildToolsPath)) {
    console.log(`✓ Found Visual Studio Build Tools in: ${buildToolsPath}`);
    return true;
  }
  
  console.log('❌ Visual Studio with C++ tools not found');
  return false;
}

// Try to find the windows-build-tools NPM package
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

// Main process
async function main() {
  // Check if npm is available
  if (!commandExists('npm')) {
    console.error('❌ npm is required but not found. Please install Node.js.');
    process.exit(1);
  }
  
  let vsInstalled = checkVisualStudio();
  let buildToolsInstalled = checkWindowsBuildTools();
  
  if (os.platform() === 'win32' && !vsInstalled && !buildToolsInstalled) {
    console.log('\n⚠️  Warning: Microsoft Visual Studio with C++ tools not detected!');
    console.log('   This is required to build native modules.');
    console.log('\n   You have three options:');
    console.log('   1. Install Visual Studio Community with "Desktop development with C++" workload');
    console.log('      https://visualstudio.microsoft.com/downloads/');
    console.log('   2. Install the Visual Studio Build Tools (smaller download)');
    console.log('      https://visualstudio.microsoft.com/visual-cpp-build-tools/');
    console.log('   3. Use prebuilt binaries where possible (recommended for faster builds)');
    console.log('\n   For option #3, we will update your package.json to prefer prebuilt modules.\n');
    
    // Modify package.json to use prebuilt modules when possible
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = require(packageJsonPath);
      
      // Add options to prefer prebuilt binaries
      packageJson.npm_config_prefer_offline = true;
      packageJson.npm_config_prefer_prebuilt = true;
      packageJson.npm_config_fallback_to_build = true;
      
      if (!packageJson.dependencies['lzma-native']) {
        console.log('Adding lzma-native dependency to package.json with prebuilt binary preferences');
        packageJson.dependencies['prebuild-install'] = "^7.1.1";
        packageJson.dependencies['lzma-native'] = "8.0.1";
      }
      
      // Update build script to use prebuild-install for native modules
      if (!packageJson.scripts.rebuild) {
        packageJson.scripts.rebuild = "cross-env npm_config_build_from_source=false npm rebuild";
      }
      
      const buildCommand = packageJson.scripts.build;
      if (buildCommand && !buildCommand.includes('npm_config_build_from_source=false')) {
        packageJson.scripts.build = "cross-env npm_config_build_from_source=false " + buildCommand;
      }
      
      // Write updated package.json
      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      console.log('✅ Updated package.json to prefer prebuilt binaries');
    } catch (err) {
      console.error('❌ Failed to update package.json:', err.message);
    }
  }

  console.log('\nInstalling essential dependencies...');
  
  // Install minimal dependencies to avoid native module builds
  try {
    execSync('npm install --no-optional --production=false', { stdio: 'inherit' });
    console.log('✅ Dependencies installed successfully');
  } catch (err) {
    console.error('❌ Failed to install dependencies:', err.message);
    process.exit(1);
  }
  
  // Create electron-rebuild-safe.js script for safely rebuilding
  createSafeRebuildScript();
  
  console.log('\n✅ Setup complete! Try building using: npm run build');
  if (!vsInstalled && !buildToolsInstalled) {
    console.log('   If you encounter any issues, consider installing Visual Studio Build Tools.');
  }
}

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
                        require('./package.json').devDependencies.electron.replace('^', '');

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
    const packageJsonPath = path.join(process.cwd(), 'package.json');
    const packageJson = require(packageJsonPath);
    packageJson.scripts['rebuild-safe'] = 'node electron-rebuild-safe.js';
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
  } catch (err) {
    console.error('Failed to add rebuild-safe script to package.json:', err.message);
  }
}

main().catch(err => {
  console.error('An error occurred:', err);
  process.exit(1);
});
