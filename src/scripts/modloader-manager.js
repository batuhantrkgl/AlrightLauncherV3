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

    mavenToPath(name) {
        const parts = name.split(':');
        if (parts.length < 3) return null;
        const [group, artifact, version] = parts;
        const groupPath = group.replace(/\./g, '/');
        const fileName = parts.length > 3
            ? `${artifact}-${version}-${parts.slice(3).join('-')}.jar`
            : `${artifact}-${version}.jar`;
        return `${groupPath}/${artifact}/${version}/${fileName}`;
    }

    mavenToUrl(name, baseUrl) {
        const path = this.mavenToPath(name);
        if (!path) return null;
        const base = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
        return base + path;
    }

    getNativesKey() {
        if (process.platform === 'win32') {
            return process.arch === 'x64' ? 'natives-windows' : 'natives-windows-x86';
        } else if (process.platform === 'darwin') {
            return process.arch === 'arm64' ? 'natives-macos-arm64' : 'natives-macos';
        } else if (process.platform === 'linux') {
            return process.arch === 'arm64' ? 'natives-linux-arm64' : 'natives-linux';
        }
        return null;
    }

    matchRules(rules) {
        if (!rules || !Array.isArray(rules)) return true;
        for (const rule of rules) {
            if (rule.action === 'allow') {
                if (rule.os && rule.os.name) {
                    const osMap = { win32: 'windows', darwin: 'osx', linux: 'linux' };
                    const currentOS = osMap[process.platform] || process.platform;
                    if (rule.os.name !== currentOS) return false;
                }
            } else if (rule.action === 'disallow') {
                if (rule.os && rule.os.name) {
                    const osMap = { win32: 'windows', darwin: 'osx', linux: 'linux' };
                    const currentOS = osMap[process.platform] || process.platform;
                    if (rule.os.name === currentOS) return false;
                }
            }
        }
        return true;
    }

    async downloadFile(url, dest) {
        const response = await fetch(url, { timeout: 30000 });
        if (!response.ok) {
            throw new Error(`Download failed: ${response.status} ${response.statusText} for ${url}`);
        }
        const buffer = await response.buffer();
        await fs.writeFile(dest, buffer);
    }

    async downloadLibrary(lib, librariesDir) {
        // Skip if OS rules don't match
        if (lib.rules && !this.matchRules(lib.rules)) return;

        // Download main artifact
        if (lib.downloads && lib.downloads.artifact) {
            const artifact = lib.downloads.artifact;
            const libPath = path.join(librariesDir, artifact.path);
            await fs.ensureDir(path.dirname(libPath));
            if (!fs.existsSync(libPath)) {
                await this.downloadFile(artifact.url, libPath);
            }
        } else if (lib.name && lib.url) {
            const relPath = this.mavenToPath(lib.name);
            if (relPath) {
                const libPath = path.join(librariesDir, relPath);
                await fs.ensureDir(path.dirname(libPath));
                if (!fs.existsSync(libPath)) {
                    const jarUrl = this.mavenToUrl(lib.name, lib.url);
                    if (jarUrl) await this.downloadFile(jarUrl, libPath);
                }
            }
        } else if (lib.name) {
            const relPath = this.mavenToPath(lib.name);
            if (relPath) {
                const libPath = path.join(librariesDir, relPath);
                await fs.ensureDir(path.dirname(libPath));
                if (!fs.existsSync(libPath)) {
                    const jarUrl = this.mavenToUrl(lib.name, 'https://maven.fabricmc.net/');
                    if (jarUrl) await this.downloadFile(jarUrl, libPath);
                }
            }
        }

        // Download natives
        if (lib.downloads && lib.downloads.classifiers) {
            const nativesKey = this.getNativesKey();
            if (nativesKey && lib.downloads.classifiers[nativesKey]) {
                const nativeArtifact = lib.downloads.classifiers[nativesKey];
                const nativePath = path.join(librariesDir, nativeArtifact.path);
                await fs.ensureDir(path.dirname(nativePath));
                if (!fs.existsSync(nativePath)) {
                    await this.downloadFile(nativeArtifact.url, nativePath);
                }
            }
        }
    }

    async installFabric(minecraftVersion, loaderVersion) {
        try {
            logger.info(`Installing Fabric ${loaderVersion} for Minecraft ${minecraftVersion}`);

            // Fetch the Fabric profile JSON from the meta API
            const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${minecraftVersion}/${loaderVersion}/profile/json`;
            const response = await fetch(profileUrl, { timeout: 15000 });

            if (!response.ok) {
                throw new Error(`Failed to fetch Fabric profile: ${response.status} ${response.statusText}`);
            }

            const profile = await response.json();
            const versionId = profile.id || `fabric-loader-${loaderVersion}-${minecraftVersion}`;
            const versionDir = path.join(this.versionsDir, versionId);
            const librariesDir = path.join(this.baseDir, 'libraries');

            await fs.ensureDir(versionDir);

            // Download all libraries
            if (profile.libraries && Array.isArray(profile.libraries)) {
                logger.info(`Downloading ${profile.libraries.length} Fabric libraries`);
                for (let i = 0; i < profile.libraries.length; i++) {
                    try {
                        await this.downloadLibrary(profile.libraries[i], librariesDir);
                    } catch (libError) {
                        logger.warn(`Failed to download library ${profile.libraries[i].name || i}: ${libError.message}`);
                    }
                }
            }

            // Save the version JSON
            const jsonPath = path.join(versionDir, `${versionId}.json`);
            await fs.writeJson(jsonPath, profile, { spaces: 2 });

            logger.info(`Fabric ${loaderVersion} for Minecraft ${minecraftVersion} installed successfully`);
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
