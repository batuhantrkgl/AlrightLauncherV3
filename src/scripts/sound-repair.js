/**
 * Sound Asset Repair Utility
 * 
 * This utility helps download missing sound assets for Minecraft
 * and creates fallback sounds for those that don't exist officially.
 */

const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
const logger = require('./logger');

class SoundRepairUtility {
    constructor(minecraftDir) {
        this.baseDir = minecraftDir || path.join(process.env.APPDATA, '.alrightlauncher');
        this.assetsDir = path.join(this.baseDir, 'assets');
        
        // Sound files that are referenced in code but don't actually exist in vanilla Minecraft
        // These need fallback mappings to prevent warnings
        this.knownMissingSounds = {
            // Map missing sounds to existing ones that can be used as replacements
            'block.sculk_vein.fall': 'block.sculk.break1',
            'block.sculk_vein.hit': 'block.sculk.break2',
            'block.sculk_vein.place': 'block.sculk.place1',
            'block.sculk_vein.step': 'block.sculk.step1',
            
            'block.shroomlight.break': 'block.nether_wart.break1',
            'block.shroomlight.step': 'block.nether_wart.step1',
            'block.shroomlight.place': 'block.nether_wart.place',
            'block.shroomlight.hit': 'block.nether_wart.break2',
            'block.shroomlight.fall': 'block.nether_wart.break3',
            
            'entity.sheep.ambient': 'entity.cow.ambient1',
            'entity.sheep.death': 'entity.cow.death',
            'entity.sheep.hurt': 'entity.cow.hurt',
            'entity.sheep.shear': 'item.armor.equip_leather1',
            'entity.sheep.step': 'entity.cow.step',
            
            'item.shield.block': 'item.armor.equip_generic1',
            'item.shield.break': 'item.armor.break',
            
            // Many more missing sounds could be added here
        };
    }
    
    async initialize() {
        await fs.ensureDir(this.assetsDir);
        await fs.ensureDir(path.join(this.assetsDir, 'indexes'));
        await fs.ensureDir(path.join(this.assetsDir, 'objects'));
        await fs.ensureDir(path.join(this.assetsDir, 'virtual'));
    }
    
    async repairSoundsForVersion(version) {
        logger.info(`Starting sound repair for Minecraft ${version}`);
        
        try {
            // Get version manifest
            const manifestResponse = await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
            const manifest = await manifestResponse.json();
            
            // Find version info
            const versionInfo = manifest.versions.find(v => v.id === version);
            if (!versionInfo) {
                throw new Error(`Version ${version} not found in manifest`);
            }
            
            // Get version details
            const versionResponse = await fetch(versionInfo.url);
            const versionData = await versionResponse.json();
            
            // Get asset index
            const assetIndexUrl = versionData.assetIndex.url;
            const assetIndexId = versionData.assetIndex.id;
            const assetIndexPath = path.join(this.assetsDir, 'indexes', `${assetIndexId}.json`);
            
            // Download asset index if needed
            if (!await fs.pathExists(assetIndexPath)) {
                logger.info(`Downloading asset index ${assetIndexId}...`);
                const indexResponse = await fetch(assetIndexUrl);
                const assetIndex = await indexResponse.json();
                await fs.writeFile(assetIndexPath, JSON.stringify(assetIndex, null, 2));
            }
            
            // Read asset index
            const assetIndexContent = await fs.readFile(assetIndexPath, 'utf8');
            const assetIndex = JSON.parse(assetIndexContent);
            
            // Find all sound assets
            const soundAssets = Object.entries(assetIndex.objects)
                .filter(([name]) => name.startsWith('minecraft/sounds/'));
            
            logger.info(`Found ${soundAssets.length} sound assets in index ${assetIndexId}`);
            
            // Check which sound assets are missing
            const missingAssets = [];
            for (const [name, asset] of soundAssets) {
                const hash = asset.hash;
                const prefix = hash.substring(0, 2);
                const assetObjectPath = path.join(this.assetsDir, 'objects', prefix, hash);
                const virtualPath = path.join(this.assetsDir, 'virtual', assetIndexId, name);
                
                if (!await fs.pathExists(assetObjectPath)) {
                    missingAssets.push({ name, asset, objectPath: assetObjectPath, virtualPath });
                } else if (!await fs.pathExists(virtualPath) && assetIndex.virtual === true) {
                    // Asset exists in objects but not in virtual
                    await fs.ensureDir(path.dirname(virtualPath));
                    try {
                        await fs.link(assetObjectPath, virtualPath);
                    } catch (err) {
                        await fs.copyFile(assetObjectPath, virtualPath);
                    }
                }
            }
            
            logger.info(`Found ${missingAssets.length} missing sound assets`);
            
            // Download missing assets
            if (missingAssets.length > 0) {
                let downloadedCount = 0;
                
                for (const { name, asset, objectPath, virtualPath } of missingAssets) {
                    const hash = asset.hash;
                    const prefix = hash.substring(0, 2);
                    const assetUrl = `https://resources.download.minecraft.net/${prefix}/${hash}`;
                    
                    try {
                        logger.info(`Downloading missing sound: ${name}`);
                        
                        await fs.ensureDir(path.dirname(objectPath));
                        const response = await fetch(assetUrl);
                        
                        if (!response.ok) {
                            throw new Error(`HTTP error! status: ${response.status}`);
                        }
                        
                        const buffer = await response.arrayBuffer();
                        await fs.writeFile(objectPath, Buffer.from(buffer));
                        
                        // Create virtual reference if needed
                        if (assetIndex.virtual === true) {
                            await fs.ensureDir(path.dirname(virtualPath));
                            try {
                                await fs.link(objectPath, virtualPath);
                            } catch {
                                await fs.copyFile(objectPath, virtualPath);
                            }
                        }
                        
                        downloadedCount++;
                        logger.info(`Downloaded ${downloadedCount}/${missingAssets.length} sound assets`);
                    } catch (error) {
                        logger.error(`Failed to download ${name}: ${error.message}`);
                    }
                }
                
                logger.info(`Sound repair complete. Downloaded ${downloadedCount}/${missingAssets.length} assets`);
                return { success: true, downloaded: downloadedCount, total: missingAssets.length };
            } else {
                logger.info('No missing sound assets found');
                return { success: true, downloaded: 0, total: 0 };
            }
        } catch (error) {
            logger.error(`Sound repair failed: ${error.message}`);
            return { success: false, error: error.message };
        }
    }

    async createFallbackSounds(version) {
        logger.info(`Creating fallback sounds for Minecraft ${version}`);
        
        try {
            const versionDir = path.join(this.baseDir, 'versions', version);
            const assetsIndexId = await this.getAssetIndexForVersion(version);
            if (!assetsIndexId) {
                throw new Error(`Could not determine asset index for ${version}`);
            }
            
            // Read the sounds.json file to create proper fallback mappings
            const soundsIndex = await this.readSoundsIndex(assetsIndexId);
            if (!soundsIndex) {
                logger.warn('Could not read sounds.json, will use hardcoded fallbacks');
            }
            
            // Create a directory to store virtual sound files
            const virtualSoundsDir = path.join(this.assetsDir, 'virtual', assetsIndexId, 'minecraft', 'sounds');
            await fs.ensureDir(virtualSoundsDir);
            
            // Create fallback sounds.json that includes mappings for missing sounds
            const fallbackSoundsJson = this.generateFallbackSoundsJson(soundsIndex);
            
            // Save the modified sounds.json
            const fallbackSoundsPath = path.join(virtualSoundsDir, '..', 'sounds_fallback.json');
            await fs.writeJson(fallbackSoundsPath, fallbackSoundsJson, { spaces: 2 });
            
            // Create symbolic links or copy existing sound files to use as fallbacks
            await this.createFallbackSoundFiles(assetsIndexId);
            
            logger.info(`Fallback sounds created for ${version}`);
            return true;
        } catch (error) {
            logger.error(`Failed to create fallback sounds: ${error.message}`);
            return false;
        }
    }
    
    async getAssetIndexForVersion(version) {
        try {
            const versionJsonPath = path.join(this.baseDir, 'versions', version, `${version}.json`);
            if (await fs.pathExists(versionJsonPath)) {
                const versionData = await fs.readJson(versionJsonPath);
                return versionData.assetIndex?.id || null;
            }
            return null;
        } catch (error) {
            logger.error(`Error reading version JSON: ${error.message}`);
            return null;
        }
    }
    
    async readSoundsIndex(assetIndexId) {
        try {
            // First try to read from virtual path
            const virtualSoundsPath = path.join(this.assetsDir, 'virtual', assetIndexId, 'minecraft', 'sounds.json');
            if (await fs.pathExists(virtualSoundsPath)) {
                return await fs.readJson(virtualSoundsPath);
            }
            
            // If not found, try to read from asset index
            const assetIndexPath = path.join(this.assetsDir, 'indexes', `${assetIndexId}.json`);
            if (await fs.pathExists(assetIndexPath)) {
                const assetIndex = await fs.readJson(assetIndexPath);
                const soundsEntry = assetIndex.objects['minecraft/sounds.json'];
                if (soundsEntry) {
                    const hash = soundsEntry.hash;
                    const prefix = hash.substring(0, 2);
                    const soundsPath = path.join(this.assetsDir, 'objects', prefix, hash);
                    
                    if (await fs.pathExists(soundsPath)) {
                        return await fs.readJson(soundsPath);
                    }
                }
            }
            
            return null;
        } catch (error) {
            logger.error(`Error reading sounds index: ${error.message}`);
            return null;
        }
    }
    
    generateFallbackSoundsJson(existingSoundsJson) {
        // Start with the existing sounds.json if available, otherwise create a new one
        const soundsJson = existingSoundsJson || { "sounds": {} };
        
        // Add fallback entries for known missing sounds
        for (const [missingSoundId, fallbackSoundId] of Object.entries(this.knownMissingSounds)) {
            // Don't override existing entries
            if (!soundsJson[missingSoundId]) {
                // Find the fallback sound in the existing sounds
                if (soundsJson[fallbackSoundId]) {
                    soundsJson[missingSoundId] = { ...soundsJson[fallbackSoundId] };
                } else {
                    // If fallback doesn't exist either, create a basic entry
                    soundsJson[missingSoundId] = {
                        "category": this.determineSoundCategory(missingSoundId),
                        "sounds": [
                            { "name": fallbackSoundId.replace('minecraft:', '') }
                        ]
                    };
                }
            }
        }
        
        return soundsJson;
    }
    
    determineSoundCategory(soundId) {
        if (soundId.startsWith('block.')) return 'block';
        if (soundId.startsWith('entity.')) return 'entity';
        if (soundId.startsWith('item.')) return 'item';
        if (soundId.startsWith('ambient.')) return 'ambient';
        if (soundId.startsWith('music.')) return 'music';
        if (soundId.startsWith('record.')) return 'record';
        if (soundId.startsWith('weather.')) return 'weather';
        return 'neutral';
    }
    
    async createFallbackSoundFiles(assetIndexId) {
        try {
            // For each missing sound, create a symbolic link to the fallback sound
            for (const [missingSoundId, fallbackSoundId] of Object.entries(this.knownMissingSounds)) {
                // Convert IDs to file paths
                const missingSoundPath = missingSoundId.replace(/\./g, '/');
                const fallbackSoundPath = fallbackSoundId.replace(/\./g, '/');
                
                // Create directories as needed
                const virtualMissingDir = path.join(
                    this.assetsDir, 
                    'virtual', 
                    assetIndexId,
                    'minecraft',
                    'sounds',
                    path.dirname(missingSoundPath)
                );
                await fs.ensureDir(virtualMissingDir);
                
                // Try to find the fallback sound file
                const fallbackFiles = await this.findSoundFiles(assetIndexId, fallbackSoundPath);
                
                if (fallbackFiles.length > 0) {
                    // Create hard links to the first fallback file
                    const targetFile = path.join(
                        virtualMissingDir,
                        path.basename(missingSoundPath) + '.ogg'
                    );
                    
                    try {
                        // Copy the fallback file to the missing sound location
                        await fs.copyFile(fallbackFiles[0], targetFile);
                        logger.info(`Created fallback from ${fallbackSoundId} to ${missingSoundId}`);
                    } catch (err) {
                        logger.error(`Failed to create fallback for ${missingSoundId}: ${err.message}`);
                    }
                } else {
                    logger.warn(`Could not find fallback sound file for ${fallbackSoundId}`);
                }
            }
        } catch (error) {
            logger.error(`Error creating fallback files: ${error.message}`);
        }
    }
    
    async findSoundFiles(assetIndexId, soundPath) {
        try {
            const virtualDir = path.join(
                this.assetsDir,
                'virtual', 
                assetIndexId, 
                'minecraft',
                'sounds',
                soundPath
            );
            
            // Check if the directory exists and look for OGG files
            if (await fs.pathExists(virtualDir)) {
                const files = await fs.readdir(virtualDir);
                return files
                    .filter(file => file.endsWith('.ogg'))
                    .map(file => path.join(virtualDir, file));
            }
            
            // If not found in virtual dir, try to find in the objects directory
            const assetIndexPath = path.join(this.assetsDir, 'indexes', `${assetIndexId}.json`);
            if (await fs.pathExists(assetIndexPath)) {
                const assetIndex = await fs.readJson(assetIndexPath);
                
                // Look for any file matching the pattern
                const matchingAssets = Object.entries(assetIndex.objects)
                    .filter(([name, _]) => name.startsWith(`minecraft/sounds/${soundPath}`) && name.endsWith('.ogg'))
                    .map(([name, asset]) => {
                        const hash = asset.hash;
                        const prefix = hash.substring(0, 2);
                        return path.join(this.assetsDir, 'objects', prefix, hash);
                    })
                    .filter(async filepath => await fs.pathExists(filepath));
                
                return await Promise.all(matchingAssets);
            }
            
            return [];
        } catch (error) {
            logger.error(`Error finding sound files: ${error.message}`);
            return [];
        }
    }
    
    async addSuppressWarningsArguments(launchOptions, version) {
        // Add JVM arguments to suppress resource warnings
        if (!launchOptions.jvmArgs) {
            launchOptions.jvmArgs = [];
        }
        
        // These arguments will help suppress the missing resource warnings
        launchOptions.jvmArgs.push('-Dfml.ignoreMissingModels=true');
        launchOptions.jvmArgs.push('-Dfml.ignoreInvalidMinecraftCertificates=true');
        launchOptions.jvmArgs.push('-Dfml.noGrab=true');
        launchOptions.jvmArgs.push('-Dorg.lwjgl.util.NoChecks=true');
        
        // For newer versions
        if (this.isVersionNewerOrEqual(version, '1.16')) {
            launchOptions.jvmArgs.push('-Dmojang.logging.level=WARN');
        }
        
        return launchOptions;
    }
    
    isVersionNewerOrEqual(version1, version2) {
        // Helper to compare version strings
        const v1Parts = version1.split('.').map(p => parseInt(p, 10) || 0);
        const v2Parts = version2.split('.').map(p => parseInt(p, 10) || 0);
        
        for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
            const v1Part = v1Parts[i] || 0;
            const v2Part = v2Parts[i] || 0;
            
            if (v1Part > v2Part) return true;
            if (v1Part < v2Part) return false;
        }
        
        return true; // Versions are equal
    }
}

module.exports = SoundRepairUtility;
