const fs = require('fs-extra');
const path = require('path');
const fetch = require('node-fetch');
const logger = require('./logger');

class ModLoaderManager {
    constructor(baseDir) {
        this.baseDir = baseDir || path.join(process.env.APPDATA, '.alrightlauncher');
        this.versionsDir = path.join(this.baseDir, 'versions');
    }

    async getForgeVersions(minecraftVersion) {
        try {
            logger.info(`Fetching Forge versions for Minecraft ${minecraftVersion}`);
            const response = await fetch(
                `https://files.minecraftforge.net/net/minecraftforge/forge/index_${minecraftVersion}.html`,
                { timeout: 10000 }
            );
            
            if (!response.ok) {
                throw new Error(`Failed to fetch Forge versions: ${response.statusText}`);
            }
            
            const html = await response.text();
            
            // Parse the version numbers using regex
            const regex = /forge-([0-9.]+(?:-[0-9.]+)?)-installer\.jar/g;
            const versions = new Set();
            let match;
            
            while ((match = regex.exec(html)) !== null) {
                versions.add(match[1]);
            }
            
            const result = Array.from(versions);
            logger.info(`Found ${result.length} Forge versions for Minecraft ${minecraftVersion}`);
            return result;
        } catch (error) {
            logger.error(`Error fetching Forge versions: ${error.message}`);
            return [];
        }
    }

    async getFabricVersions() {
        try {
            logger.info('Fetching Fabric loader versions');
            const response = await fetch(
                'https://meta.fabricmc.net/v2/versions/loader',
                { timeout: 10000 }
            );
            
            if (!response.ok) {
                throw new Error(`Failed to fetch Fabric versions: ${response.statusText}`);
            }
            
            const data = await response.json();
            logger.info(`Found ${data.length} Fabric loader versions`);
            return data.map(version => ({
                version: version.version,
                stable: version.stable
            }));
        } catch (error) {
            logger.error(`Error fetching Fabric versions: ${error.message}`);
            return [];
        }
    }

    async getFabricGameVersions() {
        try {
            logger.info('Fetching Fabric game versions');
            const response = await fetch(
                'https://meta.fabricmc.net/v2/versions/game',
                { timeout: 10000 }
            );
            
            if (!response.ok) {
                throw new Error(`Failed to fetch Fabric game versions: ${response.statusText}`);
            }
            
            const data = await response.json();
            const filteredVersions = data.filter(version => version.stable);
            logger.info(`Found ${filteredVersions.length} stable Fabric game versions`);
            return filteredVersions.map(version => ({
                version: version.version,
                stable: version.stable
            }));
        } catch (error) {
            logger.error(`Error fetching Fabric game versions: ${error.message}`);
            return [];
        }
    }

    async installFabric(minecraftVersion, loaderVersion) {
        try {
            logger.info(`Installing Fabric ${loaderVersion} for Minecraft ${minecraftVersion}`);
            
            // Create version JSON
            const fabricJson = {
                id: `fabric-loader-${loaderVersion}-${minecraftVersion}`,
                inheritsFrom: minecraftVersion,
                releaseTime: new Date().toISOString(),
                time: new Date().toISOString(),
                type: "release",
                mainClass: "net.fabricmc.loader.impl.launch.knot.KnotClient",
                arguments: {
                    game: []
                },
                libraries: [
                    // This is just a starter, actual libraries would be fetched from Fabric API
                    {
                        name: `net.fabricmc:fabric-loader:${loaderVersion}`,
                        url: "https://maven.fabricmc.net/"
                    }
                ]
            };
            
            // In a real implementation, we would:
            // 1. Download the fabric installer
            // 2. Run it or extract needed libraries
            // 3. Create the version JSON file properly
            
            // Create directory for the fabric version
            const versionDir = path.join(this.versionsDir, fabricJson.id);
            await fs.ensureDir(versionDir);
            
            // Save the version JSON
            await fs.writeJson(
                path.join(versionDir, `${fabricJson.id}.json`),
                fabricJson,
                { spaces: 2 }
            );
            
            logger.info(`Fabric installation for ${minecraftVersion} created successfully`);
            return true;
        } catch (error) {
            logger.error(`Failed to install Fabric: ${error.message}`);
            return false;
        }
    }

    async installForge(minecraftVersion, forgeVersion) {
        try {
            logger.info(`Installing Forge ${forgeVersion} for Minecraft ${minecraftVersion}`);
            
            // Create version JSON
            const forgeJson = {
                id: `${minecraftVersion}-forge-${forgeVersion}`,
                inheritsFrom: minecraftVersion,
                releaseTime: new Date().toISOString(),
                time: new Date().toISOString(),
                type: "release",
                mainClass: "net.minecraft.launchwrapper.Launch",
                arguments: {
                    game: []
                },
                libraries: [
                    // This is just a starter, actual libraries would come from the forge installer
                    {
                        name: `net.minecraftforge:forge:${minecraftVersion}-${forgeVersion}`,
                        url: "https://maven.minecraftforge.net/"
                    }
                ]
            };
            
            // In a real implementation, we would:
            // 1. Download the forge installer
            // 2. Run it or extract needed libraries 
            // 3. Create the version JSON file properly
            
            // Create directory for the forge version
            const versionDir = path.join(this.versionsDir, forgeJson.id);
            await fs.ensureDir(versionDir);
            
            // Save the version JSON
            await fs.writeJson(
                path.join(versionDir, `${forgeJson.id}.json`),
                forgeJson,
                { spaces: 2 }
            );
            
            logger.info(`Forge installation for ${minecraftVersion} created successfully`);
            return true;
        } catch (error) {
            logger.error(`Failed to install Forge: ${error.message}`);
            return false;
        }
    }
}

module.exports = ModLoaderManager;
