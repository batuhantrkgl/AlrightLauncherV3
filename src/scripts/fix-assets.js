const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');
const fetch = require('node-fetch');

/**
 * Fix missing Minecraft assets
 * @param {string} baseDir - The Minecraft base directory
 * @param {string} [targetVersion] - Optional specific version to fix
 * @returns {Promise<boolean>} - True if successful
 */
async function fixAssets(baseDir, targetVersion = null) {
  try {
    logger.info(`Starting asset repair${targetVersion ? ` for version ${targetVersion}` : ''}`);
    
    const versionsDir = path.join(baseDir, 'versions');
    const assetsDir = path.join(baseDir, 'assets');
    
    // Ensure assets directory exists
    await fs.ensureDir(assetsDir);
    await fs.ensureDir(path.join(assetsDir, 'indexes'));
    await fs.ensureDir(path.join(assetsDir, 'objects'));
    
    // Get list of versions to process
    let versions;
    if (targetVersion) {
      versions = [targetVersion];
    } else {
      try {
        versions = await fs.readdir(versionsDir);
      } catch (error) {
        logger.error(`Failed to read versions directory: ${error.message}`);
        return false;
      }
    }
    
    // Process each version
    let success = true;
    for (const version of versions) {
      const versionDir = path.join(versionsDir, version);
      
      // Check if it's a directory
      try {
        const stats = await fs.stat(versionDir);
        if (!stats.isDirectory()) continue;
      } catch (error) {
        logger.debug(`Skipping ${version}: ${error.message}`);
        continue;
      }
      
      // Look for version JSON
      const versionJsonPath = path.join(versionDir, `${version}.json`);
      if (!await fs.pathExists(versionJsonPath)) {
        logger.debug(`Skipping ${version}: No version JSON found`);
        continue;
      }
      
      logger.info(`Processing version: ${version}`);
      
      try {
        const versionJson = await fs.readJson(versionJsonPath);
        
        // Fix asset index if needed
        if (versionJson.assetIndex) {
          const assetIndexId = versionJson.assetIndex.id;
          const assetIndexUrl = versionJson.assetIndex.url;
          const assetIndexPath = path.join(assetsDir, 'indexes', `${assetIndexId}.json`);
          
          if (!await fs.pathExists(assetIndexPath)) {
            logger.info(`Downloading asset index for ${version}...`);
            try {
              const response = await fetch(assetIndexUrl);
              if (!response.ok) {
                throw new Error(`HTTP error ${response.status}`);
              }
              const indexData = await response.json();
              await fs.writeJson(assetIndexPath, indexData, { spaces: 2 });
              logger.info(`Asset index for ${version} downloaded`);
              
              // Now download the missing assets
              await downloadMissingAssets(assetsDir, indexData);
            } catch (error) {
              logger.error(`Failed to download asset index for ${version}: ${error.message}`);
              success = false;
            }
          }
        }
        
        // Fix icons if needed
        await ensureIcons(versionDir, version);
        
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
 * Download missing assets referenced in the asset index
 */
async function downloadMissingAssets(assetsDir, indexData) {
  if (!indexData.objects) {
    logger.warn('No objects found in asset index');
    return;
  }
  
  const objects = indexData.objects;
  let total = Object.keys(objects).length;
  let processed = 0;
  let downloaded = 0;
  
  logger.info(`Checking ${total} assets...`);
  
  // Focus on sound assets first (the most common missing files)
  const soundAssets = Object.entries(objects)
    .filter(([name]) => name.startsWith('minecraft/sounds/') || name === 'minecraft/sounds.json');
    
  logger.info(`Found ${soundAssets.length} sound assets to check`);
  
  for (const [name, asset] of soundAssets) {
    processed++;
    
    // Log progress occasionally
    if (processed % 50 === 0) {
      logger.info(`Processed ${processed}/${total} assets, downloaded ${downloaded}`);
    }
    
    const hash = asset.hash;
    const prefix = hash.substring(0, 2);
    const assetPath = path.join(assetsDir, 'objects', prefix, hash);
    
    // Skip if asset already exists
    if (await fs.pathExists(assetPath)) {
      continue;
    }
    
    // Create directory if it doesn't exist
    await fs.ensureDir(path.join(assetsDir, 'objects', prefix));
    
    try {
      const url = `https://resources.download.minecraft.net/${prefix}/${hash}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
      }
      
      const buffer = await response.arrayBuffer();
      await fs.writeFile(assetPath, Buffer.from(buffer));
      downloaded++;
      
      logger.debug(`Downloaded: ${name} (${downloaded} total)`);
    } catch (error) {
      logger.warn(`Failed to download asset ${name}: ${error.message}`);
    }
  }
  
  logger.info(`Asset download completed. Processed ${processed}/${total}, downloaded ${downloaded}`);
}

/**
 * Ensure icon files are present
 */
async function ensureIcons(versionDir, version) {
  const iconsDir = path.join(versionDir, 'icons');
  await fs.ensureDir(iconsDir);
  
  const iconFiles = ['icon_16x16.png', 'icon_32x32.png'];
  let hasAllIcons = true;
  
  for (const iconFile of iconFiles) {
    const iconPath = path.join(iconsDir, iconFile);
    if (!await fs.pathExists(iconPath)) {
      hasAllIcons = false;
      break;
    }
  }
  
  if (!hasAllIcons) {
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
      await fs.writeFile(path.join(iconsDir, 'icon_16x16.png'), png16x16);
      await fs.writeFile(path.join(iconsDir, 'icon_32x32.png'), png32x32);
      logger.info(`Created placeholder icons for ${version}`);
    } catch (error) {
      logger.error(`Failed to create icons for ${version}: ${error.message}`);
    }
  }
}

module.exports = fixAssets;
