const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');
const fetch = require('node-fetch');
const { promisify } = require('util');
const cliProgress = require('cli-progress');

// Constants
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // ms
const CONCURRENT_DOWNLOADS = 5;
const MINECRAFT_RESOURCES_URL = 'https://resources.download.minecraft.net';

/**
 * Fix missing Minecraft assets
 * @param {string} baseDir - The Minecraft base directory
 * @param {string} [targetVersion] - Optional specific version to fix
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.forceRefresh=false] - Force refresh of asset indexes
 * @param {boolean} [options.skipIcons=false] - Skip icon generation
 * @returns {Promise<boolean>} - True if successful
 */
async function fixAssets(baseDir, targetVersion = null, options = {}) {
  const { forceRefresh = false, skipIcons = false } = options;
  
  try {
    logger.info(`Starting asset repair${targetVersion ? ` for version ${targetVersion}` : ''}`);
    
    const versionsDir = path.join(baseDir, 'versions');
    const assetsDir = path.join(baseDir, 'assets');
    
    // Ensure directories exist
    await Promise.all([
      fs.ensureDir(assetsDir),
      fs.ensureDir(path.join(assetsDir, 'indexes')),
      fs.ensureDir(path.join(assetsDir, 'objects'))
    ]);
    
    // Get list of versions to process
    let versions = [];
    try {
      if (targetVersion) {
        versions = [targetVersion];
      } else {
        const allVersions = await fs.readdir(versionsDir);
        
        // Get only valid version directories with JSON files
        const versionPromises = allVersions.map(async (version) => {
          const versionDir = path.join(versionsDir, version);
          const versionJsonPath = path.join(versionDir, `${version}.json`);
          
          try {
            const stats = await fs.stat(versionDir);
            if (stats.isDirectory() && await fs.pathExists(versionJsonPath)) {
              return version;
            }
          } catch (error) {
            // Skip invalid versions
          }
          return null;
        });
        
        const validVersions = await Promise.all(versionPromises);
        versions = validVersions.filter(Boolean);
      }
      
      if (versions.length === 0) {
        logger.warn('No valid Minecraft versions found to process');
        return false;
      }
      
    } catch (error) {
      logger.error(`Failed to read versions directory: ${error.message}`);
      return false;
    }
    
    logger.info(`Found ${versions.length} version(s) to process`);
    
    // Process each version
    let success = true;
    for (const version of versions) {
      const versionDir = path.join(versionsDir, version);
      const versionJsonPath = path.join(versionDir, `${version}.json`);
      
      logger.info(`Processing version: ${version}`);
      
      try {
        const versionJson = await fs.readJson(versionJsonPath);
        
        // Fix asset index if needed
        if (versionJson.assetIndex) {
          const assetIndexId = versionJson.assetIndex.id;
          const assetIndexUrl = versionJson.assetIndex.url;
          const assetIndexPath = path.join(assetsDir, 'indexes', `${assetIndexId}.json`);
          
          if (forceRefresh || !await fs.pathExists(assetIndexPath)) {
            logger.info(`Downloading asset index for ${version}...`);
            try {
              const indexData = await fetchWithRetry(assetIndexUrl);
              await fs.writeJson(assetIndexPath, indexData, { spaces: 2 });
              logger.info(`Asset index for ${version} downloaded successfully`);
              
              // Now download the missing assets
              const assetResult = await downloadMissingAssets(assetsDir, indexData);
              if (!assetResult) {
                success = false;
              }
            } catch (error) {
              logger.error(`Failed to download asset index for ${version}: ${error.message}`);
              success = false;
            }
          } else {
            logger.info(`Asset index for ${version} already exists`);
            
            // Check if we should process existing index
            try {
              const indexData = await fs.readJson(assetIndexPath);
              const assetResult = await downloadMissingAssets(assetsDir, indexData);
              if (!assetResult) {
                success = false;
              }
            } catch (error) {
              logger.error(`Failed to process existing asset index for ${version}: ${error.message}`);
              success = false;
            }
          }
        } else {
          logger.warn(`Version ${version} has no asset index defined`);
        }
        
        // Fix icons if needed
        if (!skipIcons) {
          await ensureIcons(versionDir, version);
        }
        
      } catch (error) {
        logger.error(`Error processing version ${version}: ${error.message}`);
        success = false;
      }
    }
    
    logger.info(`Asset repair ${success ? 'completed successfully' : 'finished with errors'}`);
    return success;
  } catch (error) {
    logger.error(`Asset repair failed: ${error.message}`);
    return false;
  }
}

/**
 * Fetch with retry logic
 * @param {string} url - URL to fetch
 * @param {number} [retries=RETRY_ATTEMPTS] - Number of retry attempts
 * @returns {Promise<any>} - Parsed JSON response
 */
async function fetchWithRetry(url, retries = RETRY_ATTEMPTS) {
  let lastError;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        timeout: 10000, // 10 second timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 Minecraft Asset Repair Tool'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      return await response.json();
    } catch (error) {
      lastError = error;
      logger.debug(`Fetch attempt ${attempt}/${retries} failed for ${url}: ${error.message}`);
      
      if (attempt < retries) {
        // Exponential backoff
        const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Fetch binary data with retry logic
 * @param {string} url - URL to fetch
 * @param {number} [retries=RETRY_ATTEMPTS] - Number of retry attempts
 * @returns {Promise<Buffer>} - Response as buffer
 */
async function fetchBinaryWithRetry(url, retries = RETRY_ATTEMPTS) {
  let lastError;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        timeout: 10000, // 10 second timeout
        headers: {
          'User-Agent': 'Mozilla/5.0 Minecraft Asset Repair Tool'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      const buffer = await response.arrayBuffer();
      return Buffer.from(buffer);
    } catch (error) {
      lastError = error;
      
      if (attempt < retries) {
        // Exponential backoff
        const delay = RETRY_DELAY * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError;
}

/**
 * Process assets in batches to limit concurrency
 * @param {Array} items - Items to process
 * @param {Function} processor - Async function to process each item
 * @param {number} concurrency - Number of concurrent operations
 * @returns {Promise<Array>} - Results array
 */
async function processInBatches(items, processor, concurrency) {
  const results = [];
  
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(processor));
    results.push(...batchResults);
  }
  
  return results;
}

/**
 * Download missing assets referenced in the asset index
 * @param {string} assetsDir - Assets directory path
 * @param {Object} indexData - Asset index data
 * @returns {Promise<boolean>} - True if successful
 */
async function downloadMissingAssets(assetsDir, indexData) {
  if (!indexData.objects || Object.keys(indexData.objects).length === 0) {
    logger.warn('No objects found in asset index');
    return true;
  }
  
  const objects = indexData.objects;
  const total = Object.keys(objects).length;
  let downloaded = 0;
  let failed = 0;
  
  logger.info(`Checking ${total} assets...`);
  
  // Create a progress bar
  const progressBar = new cliProgress.SingleBar({
    format: 'Asset download progress |{bar}| {percentage}% | {value}/{total} | Downloaded: {downloaded}',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true
  });
  
  progressBar.start(total, 0, {
    downloaded: 0
  });
  
  // First quickly check what assets are missing
  const missingAssets = [];
  let processed = 0;
  
  for (const [name, asset] of Object.entries(objects)) {
    const hash = asset.hash;
    const prefix = hash.substring(0, 2);
    const assetPath = path.join(assetsDir, 'objects', prefix, hash);
    
    processed++;
    progressBar.update(processed, { downloaded });
    
    if (!await fs.pathExists(assetPath)) {
      missingAssets.push({ name, asset, prefix });
    }
  }
  
  // Prioritize sound assets (most commonly missing)
  missingAssets.sort((a, b) => {
    const aIsSoundAsset = a.name.startsWith('minecraft/sounds/') || a.name === 'minecraft/sounds.json';
    const bIsSoundAsset = b.name.startsWith('minecraft/sounds/') || b.name === 'minecraft/sounds.json';
    
    if (aIsSoundAsset && !bIsSoundAsset) return -1;
    if (!aIsSoundAsset && bIsSoundAsset) return 1;
    return 0;
  });
  
  logger.info(`Found ${missingAssets.length} missing assets to download`);
  
  // Process download in batches to limit concurrency
  const results = await processInBatches(missingAssets, async ({ name, asset, prefix }) => {
    const hash = asset.hash;
    const assetPath = path.join(assetsDir, 'objects', prefix, hash);
    
    // Create directory if it doesn't exist
    await fs.ensureDir(path.join(assetsDir, 'objects', prefix));
    
    try {
      const url = `${MINECRAFT_RESOURCES_URL}/${prefix}/${hash}`;
      const buffer = await fetchBinaryWithRetry(url);
      await fs.writeFile(assetPath, buffer);
      
      downloaded++;
      progressBar.update(processed, { downloaded });
      
      return { success: true, name };
    } catch (error) {
      failed++;
      logger.debug(`Failed to download asset ${name}: ${error.message}`);
      return { success: false, name, error };
    }
  }, CONCURRENT_DOWNLOADS);
  
  progressBar.stop();
  
  // Summarize results
  const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
  const failures = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success));
  
  logger.info(`Asset download completed. Processed ${total} assets`);
  logger.info(`- ${missingAssets.length} missing assets detected`);
  logger.info(`- ${successful} assets downloaded successfully`);
  logger.info(`- ${failures.length} assets failed to download`);
  
  if (failures.length > 0) {
    logger.warn('Some assets could not be downloaded. This might affect game functionality.');
    return false;
  }
  
  return true;
}

/**
 * Ensure icon files are present
 * @param {string} versionDir - Version directory path
 * @param {string} version - Version name
 * @returns {Promise<boolean>} - True if successful
 */
async function ensureIcons(versionDir, version) {
  const iconsDir = path.join(versionDir, 'icons');
  await fs.ensureDir(iconsDir);
  
  const iconFiles = ['icon_16x16.png', 'icon_32x32.png'];
  const missingIcons = [];
  
  // Check which icons are missing
  for (const iconFile of iconFiles) {
    const iconPath = path.join(iconsDir, iconFile);
    if (!await fs.pathExists(iconPath)) {
      missingIcons.push(iconFile);
    }
  }
  
  if (missingIcons.length === 0) {
    logger.debug(`Icons for ${version} already exist`);
    return true;
  }
  
  logger.info(`Creating placeholder icons for ${version}`);
  
  // Basic transparent PNG for 16x16 icon
  const png16x16 = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0xf3, 0xff, 0x61, 0x00, 0x00, 0x00,
    0x01, 0x73, 0x52, 0x47, 0x42, 0x00, 0xae, 0xce, 0x1c, 0xe9, 0x00, 0x00,
    0x00, 0x04, 0x67, 0x41, 0x4d, 0x41, 0x00, 0x00, 0xb1, 0x8f, 0x0b, 0xfc,
    0x61, 0x05, 0x00, 0x00, 0x00, 0x09, 0x70, 0x48, 0x59, 0x73, 0x00, 0x00,
    0x0e, 0xc3, 0x00, 0x00, 0x0e, 0xc3, 0x01, 0xc7, 0x6f, 0xa8, 0x64, 0x00,
    0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x38, 0x4f, 0x63, 0x60, 0x18,
    0x05, 0xa3, 0x60, 0x14, 0x8c, 0x02, 0x00, 0x08, 0x00, 0x01, 0x00, 0x01,
    0x78, 0x69, 0x47, 0xf3, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82
  ]);
  
  // Basic transparent PNG for 32x32 icon
  const png32x32 = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x20,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x73, 0x7a, 0x7a, 0xf4, 0x00, 0x00, 0x00,
    0x01, 0x73, 0x52, 0x47, 0x42, 0x00, 0xae, 0xce, 0x1c, 0xe9, 0x00, 0x00,
    0x00, 0x04, 0x67, 0x41, 0x4d, 0x41, 0x00, 0x00, 0xb1, 0x8f, 0x0b, 0xfc,
    0x61, 0x05, 0x00, 0x00, 0x00, 0x09, 0x70, 0x48, 0x59, 0x73, 0x00, 0x00,
    0x0e, 0xc3, 0x00, 0x00, 0x0e, 0xc3, 0x01, 0xc7, 0x6f, 0xa8, 0x64, 0x00,
    0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, 0x54, 0x58, 0x85, 0xed, 0xc1, 0x01,
    0x01, 0x00, 0x00, 0x00, 0xc3, 0xa0, 0xf9, 0x53, 0xdf, 0xe0, 0x07, 0x0c,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xbe, 0x03, 0x4f, 0x00,
    0x01, 0x01, 0x47, 0x17, 0x58, 0xdf, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82
  ]);
  
  try {
    // Save the placeholder icons
    const writePromises = [];
    
    if (missingIcons.includes('icon_16x16.png')) {
      writePromises.push(fs.writeFile(path.join(iconsDir, 'icon_16x16.png'), png16x16));
    }
    
    if (missingIcons.includes('icon_32x32.png')) {
      writePromises.push(fs.writeFile(path.join(iconsDir, 'icon_32x32.png'), png32x32));
    }
    
    await Promise.all(writePromises);
    logger.info(`Created ${missingIcons.length} placeholder icon(s) for ${version}`);
    return true;
  } catch (error) {
    logger.error(`Failed to create icons for ${version}: ${error.message}`);
    return false;
  }
}

module.exports = fixAssets;