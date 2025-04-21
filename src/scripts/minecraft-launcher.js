const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs-extra"); // Change this line to use fs-extra
const logger = require("./logger");
const MinecraftInstaller = require("./minecraft-installer");
const extract = require("extract-zip"); // Add this import
const AdmZip = require("adm-zip"); // Add this import
const glob = require("glob"); // Add glob package import
const { promisify } = require("util"); // Add promisify import
const globPromise = promisify(glob.glob); // Create promisified version of glob.glob function
const fixAssets = require("./fix-assets"); // Import asset fixing utility
const os = require("os"); // For temp directory operations

class MinecraftLauncher {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.versionsDir = path.join(baseDir, "versions");
    this.librariesDir = path.join(baseDir, "libraries"); // Add this line
    this.assetsDir = path.join(baseDir, "assets");
    this.javaPath = null;
    this.runningProcesses = new Map(); // Track running game processes
    this.authServer = null; // Initialize authServer property
    logger.info("MinecraftLauncher initialized");
    this.javaVersions = {
      legacy: {
        minVersion: 6,
        maxVersion: 8,
        path: null,
      },
      modern: {
        minVersion: 17,
        maxVersion: 21,
        path: null,
      },
    };

    // Ensure all required directories exist
    fs.ensureDirSync(this.baseDir);
    fs.ensureDirSync(this.versionsDir);
    fs.ensureDirSync(this.librariesDir);
    fs.ensureDirSync(this.assetsDir);

    logger.info(
      `MinecraftLauncher initialized with base directory: ${this.baseDir}`
    );
  }

  getRequiredJavaVersion(versionJson) {
    // First check if version JSON specifies Java version
    if (versionJson.javaVersion) {
      if (
        versionJson.javaVersion.component === "jre-legacy" ||
        versionJson.javaVersion.majorVersion === 8
      ) {
        return "legacy";
      }
    }

    // Fallback to version number check
    const versionNum = parseFloat(versionJson.id);

    if (versionNum <= 1.16) {
      return "legacy"; // Java 8 required for versions 1.16 and older
    }
    return "modern"; // Java 17+ for versions 1.17 and newer
  }

  findJavaPath(requiredVersion = "modern") {
    if (this.javaVersions[requiredVersion].path) {
      return this.javaVersions[requiredVersion].path;
    }

    // First check Adoptium directory for numeric versioned paths
    const adoptiumDir = path.join(
      process.env["ProgramFiles"],
      "Eclipse Adoptium"
    );
    if (fs.existsSync(adoptiumDir)) {
      try {
        const entries = fs.readdirSync(adoptiumDir);
        const javaEntries = entries.filter((entry) => {
          // Match patterns like jre-8.x.x, jdk-8.x.x
          const match = entry.match(/^(jre|jdk)-(\d+)/);
          if (!match) return false;

          const majorVersion = parseInt(match[2]);
          const config = this.javaVersions[requiredVersion];
          return (
            majorVersion >= config.minVersion &&
            majorVersion <= config.maxVersion
          );
        });

        for (const entry of javaEntries) {
          const javaExe = path.join(adoptiumDir, entry, "bin", "java.exe");
          if (fs.existsSync(javaExe)) {
            logger.info(`Found ${requiredVersion} Java at: ${javaExe}`);
            this.javaVersions[requiredVersion].path = javaExe;
            return javaExe;
          }
        }
      } catch (error) {
        logger.error(`Error searching Adoptium directory: ${error.message}`);
      }
    }

    // Define Java paths with explicit version checks
    const adoptiumPaths = {
      legacy: [
        // Eclipse Adoptium paths
        path.join(process.env["ProgramFiles"], "Eclipse Adoptium", "jre-8"),
        path.join(process.env["ProgramFiles"], "Eclipse Adoptium", "jdk-8"),
        path.join(
          process.env["ProgramFiles(x86)"],
          "Eclipse Adoptium",
          "jre-8"
        ),
        // Oracle Java 8 paths
        path.join(process.env["ProgramFiles"], "Java", "jre1.8.0_301"),
        path.join(process.env["ProgramFiles"], "Java", "jdk1.8.0_301"),
        path.join(process.env["ProgramFiles(x86)"], "Java", "jre1.8.0_301"),
        // Zulu Java 8 paths
        path.join(process.env["ProgramFiles"], "Zulu", "zulu-8"),
        // AdoptOpenJDK paths
        path.join(process.env["ProgramFiles"], "AdoptOpenJDK", "jre-8"),
        path.join(process.env["ProgramFiles"], "AdoptOpenJDK", "jdk-8"),
      ],
      modern: [
        path.join(process.env["ProgramFiles"], "Eclipse Adoptium", "jre-17"),
        path.join(process.env["ProgramFiles"], "Eclipse Adoptium", "jre-21"),
        path.join(process.env["ProgramFiles"], "Eclipse Adoptium", "jdk-17"),
        path.join(process.env["ProgramFiles"], "Eclipse Adoptium", "jdk-21"),
      ],
    };

    // Try specific paths first
    for (const basePath of adoptiumPaths[requiredVersion]) {
      if (fs.existsSync(basePath)) {
        const javaExe = path.join(basePath, "bin", "java.exe");
        if (fs.existsSync(javaExe)) {
          // Verify Java version before using
          try {
            const output = require("child_process")
              .execSync(`"${javaExe}" -version 2>&1`)
              .toString();
            const versionMatch = output.match(/version "([^"]+)"/);
            if (versionMatch) {
              const javaVersion = parseInt(versionMatch[1].split(".")[0]);
              const config = this.javaVersions[requiredVersion];
              if (
                javaVersion >= config.minVersion &&
                javaVersion <= config.maxVersion
              ) {
                this.javaVersions[requiredVersion].path = javaExe;
                logger.info(`Found ${requiredVersion} Java at: ${javaExe}`);
                return javaExe;
              }
            }
          } catch (error) {
            logger.error(
              `Failed to verify Java at ${javaExe}: ${error.message}`
            );
          }
        }
      }
    }

    // Search Program Files recursively for Java installations
    const searchDirs = [
      process.env["ProgramFiles"],
      process.env["ProgramFiles(x86)"],
    ].filter(Boolean);
    for (const searchDir of searchDirs) {
      try {
        const foundJava = this.findJavaInDirectory(searchDir, requiredVersion);
        if (foundJava) return foundJava;
      } catch (error) {
        logger.error(`Error searching in ${searchDir}: ${error.message}`);
      }
    }

    throw new Error(
      `Could not find ${requiredVersion} Java installation. Please install Java ${
        requiredVersion === "legacy" ? "8" : "17+"
      }`
    );
  }

  findJavaInDirectory(dir, requiredVersion) {
    try {
      if (!fs.existsSync(dir)) return null;

      // Skip known problematic directories
      const skipDirs = [
        "WindowsApps",
        "$Recycle.Bin",
        "System Volume Information",
      ];
      if (skipDirs.some((skip) => dir.includes(skip))) {
        logger.debug?.(`Skipping restricted directory: ${dir}`);
        return null;
      }

      const files = fs.readdirSync(dir, { withFileTypes: true });
      for (const file of files) {
        try {
          const fullPath = path.join(dir, file.name);

          // Skip if we can't access the directory
          if (!this.canAccessDirectory(fullPath)) {
            continue;
          }

          if (file.isDirectory()) {
            // Check if this directory contains java.exe
            const javaExe = path.join(fullPath, "bin", "java.exe");
            if (fs.existsSync(javaExe)) {
              try {
                const output = require("child_process")
                  .execSync(`"${javaExe}" -version 2>&1`)
                  .toString();
                const versionMatch = output.match(/version "([^"]+)"/);
                if (versionMatch) {
                  const javaVersion = parseInt(versionMatch[1].split(".")[0]);
                  const config = this.javaVersions[requiredVersion];
                  if (
                    javaVersion >= config.minVersion &&
                    javaVersion <= config.maxVersion
                  ) {
                    this.javaVersions[requiredVersion].path = javaExe;
                    logger.info(`Found ${requiredVersion} Java at: ${javaExe}`);
                    return javaExe;
                  }
                }
              } catch (error) {
                logger.debug?.(`Invalid Java at ${javaExe}: ${error.message}`);
              }
            }

            // Recursively search subdirectories
            const found = this.findJavaInDirectory(fullPath, requiredVersion);
            if (found) return found;
          }
        } catch (error) {
          // Skip files/directories we can't access
          logger.debug?.(`Skipping inaccessible path: ${file.name}`);
          continue;
        }
      }
    } catch (error) {
      logger.debug?.(`Error searching directory ${dir}: ${error.message}`);
    }
    return null;
  }

  canAccessDirectory(dir) {
    try {
      fs.accessSync(dir, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  async verifyJava() {
    return new Promise((resolve) => {
      logger.info("Checking Java installation...");
      const javaPath = this.findJavaPath();
      logger.info(`Found Java path: ${javaPath}`);

      const java = spawn(javaPath, ["-version"]);

      java.stderr.on("data", (data) => {
        const version = data.toString();
        logger.info(`Java version found: ${version.trim()}`);
        resolve(true);
      });

      java.on("error", (err) => {
        logger.error(`Java verification error: ${err.message}`);
        resolve(false);
      });

      java.on("exit", (code) => {
        if (code !== 0) {
          logger.warn(`Java verification exited with code: ${code}`);
        }
        resolve(code === 0);
      });
    });
  }

  async verifyAndFixAssets(version, versionData) {
    try {
      logger.info(`Verifying assets for ${version}`);
      
      // Define versionDir explicitly
      const versionDir = path.join(this.baseDir, "versions", version);
      
      // If we have version data passed in, use it, otherwise load it
      let versionJson = versionData;
      if (!versionJson) {
        const versionJsonPath = path.join(versionDir, `${version}.json`);
        
        if (!await fs.pathExists(versionJsonPath)) {
          logger.error(`Version JSON not found for ${version}`);
          return false;
        }
        
        versionJson = await fs.readJson(versionJsonPath);
      }
      
      // Check for asset index in this version or parent version
      if (!versionJson.assetIndex && versionJson.inheritsFrom) {
        // Try to get the asset index from the parent version
        const parentVersion = versionJson.inheritsFrom;
        logger.info(`Version ${version} has no asset index, checking parent ${parentVersion}`);
        
        const parentDir = path.join(this.baseDir, "versions", parentVersion);
        const parentJsonPath = path.join(parentDir, `${parentVersion}.json`);
        
        if (await fs.pathExists(parentJsonPath)) {
          const parentJson = await fs.readJson(parentJsonPath);
          
          // If parent has asset index, use it
          if (parentJson.assetIndex) {
            versionJson.assetIndex = parentJson.assetIndex;
            logger.info(`Using asset index from parent: ${parentJson.assetIndex.id}`);
          }
        }
      }
      
      // Initialize needsRepair flag
      let needsRepair = false;
      
      // Check for asset index
      if (!versionJson.assetIndex) {
        logger.error(`Asset index not defined for ${version}`);
        return false;
      }
      
      const assetIndexId = versionJson.assetIndex.id;
      const assetIndexPath = path.join(this.assetsDir, 'indexes', `${assetIndexId}.json`);
      
      // Check if asset index file exists
      if (!await fs.pathExists(assetIndexPath)) {
        logger.warn(`Missing asset index for ${version}, needs repair`);
        needsRepair = true;
      } else {
        // Check for sound assets
        const soundsVerified = await this.verifySoundResources(version, versionJson);
        if (!soundsVerified) {
          logger.warn(`Sound assets are incomplete for ${version}, needs repair`);
          needsRepair = true;
        }
        
        // Check for icons
        const iconsDir = path.join(versionDir, 'icons');
        if (!await fs.pathExists(iconsDir)) {
          logger.warn(`Missing icons directory for ${version}, needs repair`);
          needsRepair = true;
        } else {
          try {
            const iconFiles = await fs.readdir(iconsDir);
            if (iconFiles.length < 2) { // We should have at least 16x16 and 32x32 icons
              logger.warn(`Incomplete icon set for ${version}, needs repair`);
              needsRepair = true;
            }
          } catch (err) {
            logger.warn(`Error checking icons: ${err.message}`);
            needsRepair = true;
          }
        }
      }
      
      if (needsRepair) {
        logger.info(`Repairing assets for ${version}`);
        
        try {
          // Call the fix assets script to repair this specific version
          await fixAssets(this.baseDir, version);
          
          // Recheck sound resources after repair
          const soundsFixed = await this.verifySoundResources(version, versionJson);
          
          if (!soundsFixed) {
            logger.warn(`Sound resources could not be fully repaired for ${version}`);
          }
          
          return true; // Continue even if some assets couldn't be fixed
        } catch (repairError) {
          logger.error(`Failed to repair assets: ${repairError.message}`);
          return false;
        }
      }
      
      logger.info(`Assets for ${version} are complete`);
      return true;
    } catch (error) {
      logger.error(`Error verifying assets: ${error.message}`);
      return false;
    }
  }

  getLibrariesClasspath(version) {
    const versionDir = path.join(this.baseDir, "versions", version);
    const versionJson = require(path.join(versionDir, `${version}.json`));
    const librariesDir = path.join(this.baseDir, "libraries");
    let classpath = [];

    // Add all required libraries
    for (const lib of versionJson.libraries) {
      if (this.isLibraryCompatible(lib)) {
        const libPath = this.getLibraryPath(lib, librariesDir);
        if (fs.existsSync(libPath)) {
          classpath.push(libPath);
        }
      }
    }

    // Add the client jar
    const clientJar = path.join(versionDir, `${version}.jar`);
    if (fs.existsSync(clientJar)) {
      classpath.push(clientJar);
    }

    return classpath.join(path.delimiter);
  }

  // Add the missing buildClasspath method
  async buildClasspath(versionJson, version) {
    try {
      const versionDir = path.join(this.baseDir, "versions", version);
      const libraries = [];
      // Track libraries by their full name including version
      const handledLibraries = new Map();
      
      // Track libraries by their base name (group:artifact) to avoid duplicates
      const libraryVersions = new Map();
      
      const fabricOverrides = new Set([
        "org.ow2.asm:asm",
        "org.ow2.asm:asm-commons",
        "org.ow2.asm:asm-tree",
        "org.ow2.asm:asm-util",
        "org.ow2.asm:asm-analysis"
      ]);
      
      // First check if this is a Fabric/inherited version
      const isFabric = version.includes('fabric') || (versionJson.mainClass && versionJson.mainClass.includes('fabric'));
      
      // Get parent JAR path if applicable
      if (versionJson.inheritsFrom) {
        const parentVersion = versionJson.inheritsFrom;
        const parentVersionDir = path.join(this.baseDir, "versions", parentVersion);
        const parentJar = path.join(parentVersionDir, `${parentVersion}.jar`);
        
        if (await fs.pathExists(parentJar)) {
          logger.info(`Adding parent jar to classpath: ${parentJar}`);
          libraries.push(parentJar);
        } else {
          // ...existing parent jar handling code...
        }
      }
      
      // Process libraries - first pass to collect all available versions
      for (const lib of versionJson.libraries) {
        if (!this.isLibraryCompatible(lib)) continue;
        
        // Extract library info
        const parts = lib.name.split(':');
        if (parts.length < 3) continue;
        
        const [group, artifact, version] = parts;
        const libId = `${group}:${artifact}`;
        const libVersion = version;
        
        // Record the version of this library
        if (!libraryVersions.has(libId) || this.isNewerVersion(libVersion, libraryVersions.get(libId).version)) {
          libraryVersions.set(libId, { 
            version: libVersion, 
            lib: lib,
            isFabric: lib.name.includes('fabric') || fabricOverrides.has(libId)
          });
        }
      }
      
      // Add the version JAR
      const clientJar = path.join(versionDir, `${version}.jar`);
      if (await fs.pathExists(clientJar)) {
        logger.info(`Adding version jar to classpath: ${clientJar}`);
        libraries.push(clientJar);
      }
      
      // For Fabric, prioritize specific libraries
      if (isFabric) {
        // Second pass - add libraries in correct order, giving priority to Fabric components
        // First add Fabric's core libraries
        for (const [libId, libInfo] of libraryVersions.entries()) {
          if (libInfo.isFabric) {
            const libPath = this.getLibraryPath(libInfo.lib, this.librariesDir);
            if (await fs.pathExists(libPath)) {
              libraries.push(libPath);
              handledLibraries.set(libId, libInfo.version);
              logger.info(`Using Fabric's library: ${libInfo.lib.name}`);
            } else {
              logger.warn(`Missing Fabric library: ${libInfo.lib.name} at ${libPath}`);
            }
          }
        }
      }
      
      // Now add remaining libraries
      for (const [libId, libInfo] of libraryVersions.entries()) {
        if (!handledLibraries.has(libId)) {
          const libPath = this.getLibraryPath(libInfo.lib, this.librariesDir);
          if (await fs.pathExists(libPath)) {
            libraries.push(libPath);
            handledLibraries.set(libId, libInfo.version);
          } else {
            logger.warn(`Missing library: ${libInfo.lib.name} at ${libPath}`);
          }
        }
      }
      
      // Log the final classpath for debugging
      logger.info(`Classpath contains ${libraries.length} entries`);
      return libraries.join(path.delimiter);
    } catch (error) {
      logger.error(`Error building classpath: ${error.message}`);
      throw error;
    }
  }

  // Add methods to build JVM and game arguments
  buildJvmArgs(versionJson, options) {
    const { classpath, nativesDir, gameDir, assetsDir, version } = options;
    const args = [];

    // Add memory settings
    args.push("-Xmx2G"); // Default to 2GB max memory
    args.push("-XX:+UnlockExperimentalVMOptions");
    args.push("-XX:+UseG1GC");
    args.push("-XX:G1NewSizePercent=20");
    args.push("-XX:G1ReservePercent=20");
    args.push("-XX:MaxGCPauseMillis=50");
    args.push("-XX:G1HeapRegionSize=32M");

    // Add system properties for natives and other settings
    args.push(`-Djava.library.path=${nativesDir}`);
    args.push(`-Dminecraft.launcher.brand=AlrightLauncher`);
    args.push(`-Dminecraft.launcher.version=3.0`);
    args.push("-Dlog4j2.formatMsgNoLookups=true"); // Log4j vulnerability mitigation

    // Add classpath
    args.push("-cp");
    args.push(classpath);

    return args;
  }

  buildGameArgs(versionJson, options) {
    const { username, version, gameDir, assetsDir, authData } = options;
    const args = [];

    // Use real auth data if available, otherwise fallback to offline mode
    const useRealAuth = authData && authData.profile && authData.accessToken;
    
    // Basic game arguments present in all versions
    args.push("--username", username);
    args.push("--version", version);
    args.push("--gameDir", gameDir);
    args.push("--assetsDir", assetsDir);
    args.push("--assetIndex", versionJson.assetIndex.id);
    
    // Add userProperties argument for Minecraft 1.7.2 through 1.8
    // This is required for these specific versions
    const versionNumber = parseFloat(version.replace(/^(\d+\.\d+).*$/, '$1')); // Extract major.minor version
    if (versionNumber >= 1.7 && versionNumber <= 1.8) {
        args.push("--userProperties", "{}");
    }
    
    if (useRealAuth) {
        // Use real Microsoft authentication data
        logger.info(`Using Microsoft authentication for ${username}`);
        args.push("--uuid", authData.profile.id);
        args.push("--accessToken", authData.accessToken);
        args.push("--userType", "msa");  // Microsoft Account
    } else {
        // Fallback to offline mode
        logger.info(`Using offline mode for ${username}`);
        const uuid = this.generateUUID();
        args.push("--uuid", uuid);
        args.push("--accessToken", "offline");
        args.push("--userType", "mojang");
    }
    
    args.push("--versionType", "release");

    return args;
  }

  isLibraryCompatible(library) {
    if (!library.rules) return true;

    let compatible = false;
    for (const rule of library.rules) {
      if (rule.os) {
        const osName =
          process.platform === "win32" ? "windows" : process.platform;
        if (rule.os.name === osName) {
          compatible = rule.action === "allow";
        }
      } else {
        compatible = rule.action === "allow";
      }
    }
    return compatible;
  }

  getLibraryPath(library, librariesDir) {
    const parts = library.name.split(":");
    const [group, artifact, version] = parts;
    const path1 = group.replace(/\./g, "/");
    return path.join(
      librariesDir,
      path1,
      artifact,
      version,
      `${artifact}-${version}.jar`
    );
  }

  generateUUID() {
    // Generate RFC 4122 version 4 UUID
    const uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
    return uuid;
  }

  uuidToIntArray(uuid) {
    // Convert UUID to int array format for NBT data
    const hex = uuid.replace(/-/g, "");
    const ints = [];
    for (let i = 0; i < 4; i++) {
      ints.push(parseInt(hex.slice(i * 8, (i + 1) * 8), 16));
    }
    return ints;
  }

  async extractLegacyNatives(version, versionJson, nativesDir) {
    logger.info(`Setting up natives for ${version} in ${nativesDir}...`);

    try {
      // Ensure natives directory exists and is empty
      await fs.ensureDir(nativesDir);
      await fs.emptyDir(nativesDir);

      // Track extracted natives for logging
      let extractedCount = 0;

      for (const lib of versionJson.libraries) {
        if (!this.isLibraryCompatible(lib)) continue;
        if (!lib.natives) continue;

        const nativeKey = lib.natives.windows || lib.natives["windows-64"];
        if (!nativeKey) continue;

        // Handle both new and old version JSON formats
        let nativePath;
        if (lib.downloads?.classifiers?.[nativeKey]) {
          // New format
          nativePath = path.join(
            this.baseDir,
            "libraries",
            lib.downloads.classifiers[nativeKey].path
          );
        } else if (lib.url && lib.name) {
          // Old format
          const parts = lib.name.split(":");
          const nativeSuffix = nativeKey.replace("${arch}", "64");
          nativePath = path.join(
            this.baseDir,
            "libraries",
            parts[0].replace(/\./g, "/"),
            parts[1],
            parts[2],
            `${parts[1]}-${parts[2]}-${nativeSuffix}.jar`
          );
        } else if (lib.name) {
          // Legacy format without URL - construct path from name
          const parts = lib.name.split(":");
          if (parts.length >= 3) {
            const groupId = parts[0];
            const artifactId = parts[1];
            const version = parts[2];
            const nativeSuffix = nativeKey.replace("${arch}", "64");
            
            nativePath = path.join(
                this.baseDir,
                "libraries",
                groupId.replace(/\./g, "/"),
                artifactId,
                version,
                `${artifactId}-${version}-${nativeSuffix}.jar`
            );
          }
        }

        if (nativePath && (await fs.pathExists(nativePath))) {
          logger.info(`Extracting native: ${nativePath}`);
          try {
            await extract(nativePath, {
              dir: nativesDir,
              onEntry: (entry) => {
                // Skip META-INF and directories
                const skip =
                  entry.fileName.startsWith("META-INF/") ||
                  entry.fileName.endsWith("/") ||
                  !entry.fileName.endsWith(".dll");
                
                if (!skip) {
                  extractedCount++;
                  logger.info(`Extracted: ${entry.fileName}`);
                }
                
                return !skip;
              },
            });
          } catch (err) {
            logger.error(`Failed to extract ${nativePath}: ${err.message}`);
          }
        } else {
          logger.warn(`Missing native: ${nativePath}`);
        }
      }

      // If no natives extracted and version inherits from a parent, try parent's natives
      if (extractedCount === 0 && versionJson.inheritsFrom) {
        const parentVersion = versionJson.inheritsFrom;
        logger.info(`No natives extracted, trying parent version ${parentVersion}`);
        
        // Get LWJGL libraries from the parent version
        const parentLibs = await this.getLWJGLLibrariesFromParent(parentVersion);
        
        if (parentLibs.length > 0) {
          logger.info(`Found ${parentLibs.length} parent LWJGL libraries to extract`);
          
          for (const libPath of parentLibs) {
            try {
              logger.info(`Extracting parent native: ${libPath}`);
              await extract(libPath, {
                dir: nativesDir,
                onEntry: (entry) => {
                  const valid = 
                    entry.fileName.endsWith(".dll") && 
                    !entry.fileName.startsWith("META-INF/");
                  
                  if (valid) {
                    extractedCount++;
                    logger.info(`Extracted parent native: ${entry.fileName}`);
                  }
                  return valid;
                }
              });
            } catch (err) {
              logger.error(`Failed to extract parent native ${libPath}: ${err.message}`);
            }
          }
        }
      }

      // Verify natives were extracted
      const files = await fs.readdir(nativesDir);
      if (files.length === 0) {
        throw new Error("No natives were extracted");
      }

      logger.info(`Successfully extracted ${files.length} native files`);

      // Set permissions for all extracted files
      for (const file of files) {
        const filePath = path.join(nativesDir, file);
        await fs.chmod(filePath, 0o755);
      }
      
      return true;
    } catch (error) {
      logger.error(`Failed to set up natives: ${error.message}`);
      throw error;
    }
  }

  async extractNativesForVersion(version, versionJson, nativesDir) {
    logger.info(`Extracting natives for ${version}...`);
    await fs.ensureDir(nativesDir);
    await fs.emptyDir(nativesDir); // Clear existing natives

    // Handle LWJGL 3.x natives (1.17+)
    const isLWJGL3 = parseFloat(version) >= 1.17;

    for (const lib of versionJson.libraries) {
      if (!this.isLibraryCompatible(lib)) continue;

      // For LWJGL 3.x, check for natives in downloads.classifiers
      if (isLWJGL3 && lib.downloads?.classifiers) {
        const nativeKey = "natives-windows";
        const nativeData = lib.downloads.classifiers[nativeKey];

        if (nativeData) {
          const nativePath = path.join(
            this.baseDir,
            "libraries",
            nativeData.path
          );
          if (await fs.pathExists(nativePath)) {
            logger.info(`Extracting native: ${nativePath}`);
            try {
              await extract(nativePath, {
                dir: nativesDir,
                onEntry: (entry) => {
                  // Only extract DLL files and skip META-INF
                  const valid =
                    entry.fileName.endsWith(".dll") &&
                    !entry.fileName.includes("META-INF");
                  if (valid) {
                    logger.info(`Extracting native: ${entry.fileName}`);
                  }
                  return valid;
                },
              });
            } catch (err) {
              logger.error(`Failed to extract ${nativePath}: ${err.message}`);
            }
          }
        }
        continue;
      }

      // Handle legacy natives
      if (lib.natives) {
        const nativeKey = lib.natives.windows || lib.natives["windows-64"];
        if (!nativeKey) continue;

        let nativePath;
        if (lib.downloads?.classifiers?.[nativeKey]) {
          nativePath = path.join(
            this.baseDir,
            "libraries",
            lib.downloads.classifiers[nativeKey].path
          );
        } else if (lib.url && lib.name) {
          const parts = lib.name.split(":");
          const nativeSuffix = nativeKey.replace("${arch}", "64");
          nativePath = path.join(
            this.baseDir,
            "libraries",
            parts[0].replace(/\./g, "/"),
            parts[1],
            parts[2],
            `${parts[1]}-${parts[2]}-${nativeSuffix}.jar`
          );
        }

        if (nativePath && (await fs.pathExists(nativePath))) {
          logger.info(`Extracting legacy native: ${nativePath}`);
          try {
            await extract(nativePath, {
              dir: nativesDir,
              onEntry: (entry) => {
                const valid =
                  entry.fileName.endsWith(".dll") &&
                  !entry.fileName.includes("META-INF");
                if (valid) {
                  logger.info(`Extracting native: ${entry.fileName}`);
                }
                return valid;
              },
            });
          } catch (err) {
            logger.error(`Failed to extract ${nativePath}: ${err.message}`);
          }
        }
      }
    }

    // Set permissions on extracted files
    const files = await fs.readdir(nativesDir);
    for (const file of files) {
      await fs.chmod(path.join(nativesDir, file), 0o755);
      logger.info(`Set permissions for ${file}`);
    }

    if (files.length === 0) {
      throw new Error("No natives were extracted");
    }

    logger.info(`Natives extracted: ${files.join(", ")}`);
    return true;
  }

  isVersion119OrNewer(version) {
    return this.isVersionNewerOrEqual(version, "1.19");
  }

  async extractModernNatives(
    version,
    versionJson,
    nativesDir,
    lwjglVersion = null
  ) {
    logger.info(`Setting up modern natives for ${version} in ${nativesDir}`);

    try {
      // Ensure natives directory exists and is empty
      await fs.ensureDir(nativesDir);
      await fs.emptyDir(nativesDir);

      // If no specific LWJGL version was provided, detect it
      if (!lwjglVersion) {
        lwjglVersion = this.detectLwjglVersion(versionJson);
      }

      logger.info(`Using LWJGL version ${lwjglVersion} for natives extraction`);

      // Track extracted natives and their sources
      const extractedFiles = new Set();
      const nativesMap = new Map();

      // First pass - collect all native libraries
      for (const lib of versionJson.libraries) {
        if (!this.isLibraryCompatible(lib)) continue;

        // Only include libraries with potential native components
        if (!lib.downloads?.classifiers && !lib.natives) continue;

        // Get native keys for Windows with arch variants
        const possibleNativeKeys = [
          "natives-windows",
          "natives-windows-x86_64",
          "natives-windows-64",
          "natives-windows-arm64",
          lib.natives?.windows?.replace(
            "${arch}",
            process.arch === "x64" ? "64" : "32"
          ),
        ].filter(Boolean);

        for (const nativeKey of possibleNativeKeys) {
          let nativePath = null;

          // Try the standard format first
          if (lib.downloads?.classifiers?.[nativeKey]) {
            const nativeArtifact = lib.downloads.classifiers[nativeKey];
            nativePath = path.join(this.librariesDir, nativeArtifact.path);

            if (fs.existsSync(nativePath)) {
              logger.info(`Found native: ${lib.name} at ${nativePath}`);

              // For LWJGL libraries, only use matching version
              if (lib.name.startsWith("org.lwjgl")) {
                // For libraries with versions in the name
                const nameParts = lib.name.split(":");
                if (nameParts.length >= 3 && nameParts[2] === lwjglVersion) {
                  nativesMap.set(lib.name, nativePath);
                  break;
                }
                // Skip if version doesn't match
                logger.info(`Skipping non-matching LWJGL version: ${lib.name}`);
              } else {
                // For non-LWJGL libs, just include them
                nativesMap.set(lib.name, nativePath);
                break;
              }
            }
          }
          // Try legacy format as fallback
          else if (lib.name) {
            const [group, artifact, version] = lib.name.split(":");
            if (!group || !artifact || !version) continue;

            const nativeSuffix = nativeKey.replace(
              "${arch}",
              process.arch === "x64" ? "64" : "32"
            );
            nativePath = path.join(
              this.librariesDir,
              group.replace(/\./g, "/"),
              artifact,
              version,
              `${artifact}-${version}-${nativeSuffix}.jar`
            );

            if (fs.existsSync(nativePath)) {
              // Only include matching LWJGL versions
              if (
                lib.name.startsWith("org.lwjgl") &&
                version !== lwjglVersion
              ) {
                logger.info(
                  `Skipping mismatched LWJGL library ${lib.name} (${version} ≠ ${lwjglVersion})`
                );
                continue;
              }

              logger.info(`Found legacy native: ${lib.name} at ${nativePath}`);
              nativesMap.set(lib.name, nativePath);
              break;
            }
          }
        }
      }

      // Handle special case for 1.20.5
      if (version === "1.20.5") {
        await this.ensureLwjgl333Natives(
          nativesDir,
          nativesMap,
          extractedFiles
        );
      }

      // Extract all found natives
      logger.info(
        `Found ${nativesMap.size} native libraries for Minecraft ${version}`
      );

      // If no natives were found, try harder to find them
      if (nativesMap.size === 0) {
        await this.findAndDownloadMissingNatives(
          lwjglVersion,
          nativesDir,
          extractedFiles
        );
      }

      let successfulExtracts = 0;
      for (const [libName, nativePath] of nativesMap.entries()) {
        logger.info(`Extracting native library: ${libName} from ${nativePath}`);
        try {
          // Use AdmZip for more reliable extraction
          const zip = new AdmZip(nativePath);
          const entries = zip.getEntries();

          // Find all DLL files
          const dllEntries = entries.filter(
            (entry) =>
              entry.entryName.endsWith(".dll") &&
              !entry.entryName.includes("META-INF/")
          );

          if (dllEntries.length > 0) {
            logger.info(`Found ${dllEntries.length} DLLs in ${libName}`);

            // Extract each DLL
            for (const entry of dllEntries) {
              const fileName = path.basename(entry.entryName);
              logger.info(`Extracting DLL: ${fileName}`);
              zip.extractEntryTo(entry.entryName, nativesDir, false, true);
              extractedFiles.add(fileName.toLowerCase());
              successfulExtracts++;
            }
          } else {
            logger.warn(`No DLLs found in ${libName}`);
          }
        } catch (error) {
          logger.error(`Error extracting ${libName}: ${error.message}`);
          // Try fallback with extract-zip if AdmZip fails
          try {
            await extract(nativePath, {
              dir: nativesDir,
              onEntry: (entry) => {
                const fileName = path.basename(entry.fileName).toLowerCase();
                if (
                  fileName.endsWith(".dll") &&
                  !extractedFiles.has(fileName)
                ) {
                  logger.info(`Fallback extracting: ${fileName}`);
                  extractedFiles.add(fileName);
                  successfulExtracts++;
                  return true;
                }
                return false;
              },
            });
          } catch (fallbackError) {
            logger.error(
              `Fallback extraction also failed: ${fallbackError.message}`
            );
          }
        }
      }

      // Log what was extracted
      const extractedList = Array.from(extractedFiles);
      logger.info(
        `Extracted natives (${extractedList.length}): ${extractedList.join(
          ", "
        )}`
      );

      // Verify extraction success
      if (extractedFiles.size === 0) {
        throw new Error(
          `No native libraries were extracted for Minecraft ${version}`
        );
      }

      // Set proper permissions
      const files = await fs.readdir(nativesDir);
      for (const file of files) {
        await fs.chmod(path.join(nativesDir, file), 0o755);
      }

      logger.info(
        `Successfully extracted ${files.length} native files for Minecraft ${version}`
      );
      return true;
    } catch (error) {
      logger.error(`Failed to extract natives: ${error.message}`);
      throw error;
    }
  }

  async extract120Natives(version, nativesDir) {
    logger.info(`Extracting natives for ${version} to ${nativesDir}`);
    const versionJson = await fs.readJson(
      path.join(this.baseDir, "versions", version, `${version}.json`)
    );

    // Ensure natives directory exists and is empty
    await fs.ensureDir(nativesDir);
    await fs.emptyDir(nativesDir);

    const extractedFiles = [];
    const osName = this.getOSName();

    // These are the specific libraries we need to extract for 1.20/1.21
    const nativeLibraries = [
      "lwjgl",
      "lwjgl-jemalloc",
      "lwjgl-openal",
      "lwjgl-opengl",
      "lwjgl-glfw",
      "lwjgl-stb",
      "lwjgl-tinyfd",
    ];

    let nativeCount = 0;
    let extractedCount = 0;

    logger.info(`Current OS: ${osName}`);

    // First pass - find all native libraries for the current OS
    for (const library of versionJson.libraries) {
      // Skip libraries without name or downloads
      if (!library.name || !library.downloads) continue;

      // Parse the library name to get the artifact name
      const nameParts = library.name.split(":");
      if (nameParts.length < 2) continue;

      const artifactName = nameParts[1];

      // Check if this is a native library we're interested in
      const isNativeLibrary = nativeLibraries.includes(artifactName);
      const hasClassifiers = library.downloads?.classifiers;

      if (!isNativeLibrary || !hasClassifiers) continue;

      logger.info(`Found LWJGL library: ${library.name}`);

      // Windows native keys to check in order of preference
      const nativeKeys = [
        `natives-${osName}`,
        `natives-${osName}-x86_64`,
        `natives-${osName}-arm64`,
        `natives-${osName}-x86`,
      ];

      // Find the appropriate native classifier
      let nativeArtifact = null;
      let usedKey = null;

      for (const key of nativeKeys) {
        if (library.downloads.classifiers[key]) {
          nativeArtifact = library.downloads.classifiers[key];
          usedKey = key;
          break;
        }
      }

      if (!nativeArtifact) continue;

      nativeCount++;

      // Download or extract the native library
      try {
        const libraryPath = path.join(
          this.baseDir,
          "libraries",
          nativeArtifact.path
        );

        // Download the library if it doesn't exist
        if (!(await fs.pathExists(libraryPath))) {
          logger.info(`Downloading native library: ${nativeArtifact.url}`);
          await fs.ensureDir(path.dirname(libraryPath));

          try {
            const response = await fetch(nativeArtifact.url);
            if (!response.ok) {
              throw new Error(`Failed to download: HTTP ${response.status}`);
            }

            const buffer = await response.arrayBuffer();
            await fs.writeFile(libraryPath, Buffer.from(buffer));
            logger.info(`Downloaded native library to ${libraryPath}`);
          } catch (downloadError) {
            logger.error(
              `Download failed for ${nativeArtifact.url}: ${downloadError.message}`
            );
            continue;
          }
        }

        // Extract the DLL files
        logger.info(`Processing native: ${library.name} (${usedKey})`);

        try {
          const zip = new AdmZip(libraryPath);
          const entries = zip.getEntries();

          // Find and extract all DLL files
          const dllEntries = entries.filter(
            (entry) =>
              entry.entryName.endsWith(".dll") &&
              !entry.entryName.includes("META-INF/")
          );

          for (const entry of dllEntries) {
            const fileName = path.basename(entry.entryName);
            logger.info(`Extracting: ${fileName}`);
            zip.extractEntryTo(entry, nativesDir, false, true);
            extractedFiles.push(fileName);
            extractedCount++;
          }
        } catch (extractError) {
          logger.error(
            `Failed to extract from ${libraryPath}: ${extractError.message}`
          );
        }
      } catch (error) {
        logger.error(`Error processing ${library.name}: ${error.message}`);
      }
    }

    logger.info(
      `Found ${nativeCount} native libraries and ${extractedCount} DLL files`
    );
    logger.info(`Extracted files: ${extractedFiles.join(", ")}`);

    // If no files were extracted, try the fallback method
    if (extractedFiles.length === 0) {
      logger.warn("No natives extracted, attempting fallback method");

      // Implementation of fallback method as in original extract120Natives
      // ...existing fallback code...

      // Fallback extraction method - try extracting all JAR files with "native" in the name
      const libDir = path.join(this.baseDir, "libraries");

      try {
        // Directly search for Windows native JARs
        const windowsNativePattern = `-natives-${osName}`;
        const nativeJars = [];

        // Search for org/lwjgl directory
        const lwjglBaseDirs = [
          path.join(libDir, "org", "lwjgl"),
          path.join(libDir, "org", "lwjgl3"),
        ];

        for (const lwjglDir of lwjglBaseDirs) {
          if (!(await fs.pathExists(lwjglDir))) continue;

          const lwjglSubdirs = await fs.readdir(lwjglDir);

          for (const subdir of lwjglSubdirs) {
            const fullSubdir = path.join(lwjglDir, subdir);
            if (!(await fs.stat(fullSubdir)).isDirectory()) continue;

            // Process version dirs
            const versionDirs = await fs.readdir(fullSubdir);
            for (const versionDir of versionDirs) {
              const fullVersionDir = path.join(fullSubdir, versionDir);
              if (!(await fs.stat(fullVersionDir)).isDirectory()) continue;

              // Search for native JARs
              const files = await fs.readdir(fullVersionDir);
              const nativeJarFiles = files.filter(
                (f) => f.includes(windowsNativePattern) && f.endsWith(".jar")
              );

              for (const jar of nativeJarFiles) {
                nativeJars.push(path.join(fullVersionDir, jar));
              }
            }
          }
        }

        logger.info(
          `Found ${nativeJars.length} native JARs in fallback search`
        );

        // Extract from found native JARs
        for (const jarPath of nativeJars) {
          try {
            logger.info(`Fallback extracting from: ${jarPath}`);
            const zip = new AdmZip(jarPath);
            const entries = zip.getEntries();

            for (const entry of entries) {
              if (
                entry.entryName.endsWith(".dll") &&
                !entry.entryName.includes("META-INF/")
              ) {
                const fileName = path.basename(entry.entryName);
                zip.extractEntryTo(entry, nativesDir, false, true);
                extractedFiles.push(fileName);
              }
            }
          } catch (error) {
            logger.error(
              `Fallback extraction failed for ${jarPath}: ${error.message}`
            );
          }
        }
      } catch (fallbackError) {
        logger.error(`Fallback extraction failed: ${fallbackError.message}`);
      }
    }

    // Check if we extracted any natives
    if (extractedFiles.length === 0) {
      throw new Error("No natives were extracted");
    }

    // Set permissions for the extracted files
    const files = await fs.readdir(nativesDir);
    for (const file of files) {
      await fs.chmod(path.join(nativesDir, file), 0o755);
    }

    logger.info(
      `Native extraction completed successfully with ${files.length} files`
    );
    return extractedFiles;
  }

  getOSName() {
    switch (process.platform) {
      case "win32":
        return "windows";
      case "darwin":
        return "macos";
      case "linux":
        return "linux";
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
  }

  async launch(version, username, options = {}) {
    try {
      logger.info(`Launching Minecraft ${version} for user ${username}`);
      
      // Make sure we have access to the auth server
      if (!this.authServer && global.authServer) {
        this.authServer = global.authServer;
        logger.info("Using global auth server reference");
      }
      
      // Check if auth data was provided or if we need to request it
      let authData = options.authData;
      let offlineMode = options.offline !== false; // Default to offline mode unless explicitly set to false
      
      // If online mode is requested but no auth data provided, try to get it from the global auth service
      if (!offlineMode && !authData && global.authService) {
        try {
          logger.info('Online mode requested, retrieving auth data from AuthService');
          authData = await global.authService.getGameAuthData();
          if (authData) {
            logger.info(`Retrieved auth data for ${authData.profile.name}`);
            options.authData = authData;
            offlineMode = false; // We have valid auth data, set offline mode to false
          } else {
            logger.warn('Failed to get auth data, falling back to offline mode');
            offlineMode = true;
          }
        } catch (error) {
          logger.error(`Error retrieving auth data: ${error.message}`);
          logger.warn('Falling back to offline mode due to auth error');
          offlineMode = true;
        }
      }
      
      const usingMicrosoftAuth = !!(authData && authData.profile && authData.accessToken);
      
      // Update offline mode based on whether we have valid auth data
      if (usingMicrosoftAuth) {
        offlineMode = false;
        logger.info(`Using Microsoft authentication for ${username} (${authData.profile.name})`);
      } else {
        offlineMode = true;
        logger.info(`Using offline mode for ${username}`);
      }

      const versionDir = path.join(this.baseDir, "versions", version);
      const versionJsonPath = path.join(versionDir, `${version}.json`);

      if (!fs.existsSync(versionJsonPath)) {
        logger.info(`Version ${version} not installed, installing now...`);
        const installer = new MinecraftInstaller(this.baseDir);

        // Add event listener for installation progress
        installer.on("progress", (data) => {
          // Forward progress events to the renderer
          const mainWindow =
            require("electron").BrowserWindow.getAllWindows()[0];
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("install-progress", data);
          }
        });

        await installer.installVersion(version);

        // Verify installation again
        if (!fs.existsSync(versionJsonPath)) {
          throw new Error(`Failed to install ${version}`);
        }
      }

      // Read version info
      let versionInfo;
      try {
        const versionData = await fs.readFile(versionJsonPath, "utf8");
        versionInfo = JSON.parse(versionData);
        
        // Check for inheritsFrom and merge with parent version data
        if (versionInfo.inheritsFrom) {
          logger.info(`Version ${version} inherits from ${versionInfo.inheritsFrom}`);
          const parentVersion = versionInfo.inheritsFrom;
          
          // Ensure parent version is installed
          await this.ensureParentVersionInstalled(parentVersion);
          
          const parentVersionDir = path.join(this.baseDir, "versions", parentVersion);
          const parentVersionJsonPath = path.join(parentVersionDir, `${parentVersion}.json`);
          
          // Read and merge with parent version data
          const parentVersionData = await fs.readFile(parentVersionJsonPath, "utf8");
          const parentVersionInfo = JSON.parse(parentVersionData);
          
          // Merge parent version into child with child taking precedence
          versionInfo = this.mergeVersionData(parentVersionInfo, versionInfo);
          logger.info(`Successfully merged version data with parent ${parentVersion}`);
        }
      } catch (error) {
        logger.error(`Error reading version JSON file: ${error.message}`);
        throw new Error(
          `Failed to read version data for ${version}: ${error.message}`
        );
      }

      // Inside launch method, before extracting natives:
      // Verify and fix assets before launching
      if (!options.skipAssetCheck) {
        logger.info(`Checking assets for ${version}`);
        const assetsValid = await this.verifyAndFixAssets(version, versionInfo);

        if (!assetsValid && !options.ignoreAssetErrors) {
          logger.warn(
            `Asset verification failed for ${version}, but proceeding as requested`
          );
        }
      }

      // Special handling for newer versions that need specific LWJGL natives
      const nativesDir = path.join(versionDir, "natives");
      await fs.ensureDir(nativesDir);

      // Always clear the natives directory before extraction to avoid conflicts
      logger.info(`Clearing natives directory for ${version}`);
      await fs.emptyDir(nativesDir);

      // Extract version-specific natives based on LWJGL version
      const lwjglVersion = this.detectLwjglVersion(versionInfo);
      logger.info(
        `Detected LWJGL version: ${lwjglVersion} for Minecraft ${version}`
      );

      // Extract natives based on Minecraft version
      try {
        if (version === "1.20.5" || this.isVersionNewerOrEqual(versionInfo.id || version, "1.20.5")) {
          logger.info(`Using special natives extraction for Minecraft ${version}`);
          await this.extractModernNatives(version, versionInfo, nativesDir, lwjglVersion);
        } else if (this.isVersionNewerOrEqual(versionInfo.id || version, "1.19")) {
          logger.info(`Using 1.19+ natives extraction for Minecraft ${version}`);
          await this.extractModernNatives(version, versionInfo, nativesDir);
        } else {
          // Use legacy extraction for older versions
          logger.info(`Using legacy natives extraction for Minecraft ${version}`);
          await this.extractLegacyNatives(version, versionInfo, nativesDir);
        }
      } catch (error) {
        // If native extraction fails with the mod version, try with the parent version
        if (versionInfo.inheritsFrom) {
          logger.warn(`Failed to extract natives for ${version}, trying with parent version ${versionInfo.inheritsFrom}`);
          // Try extracting natives from parent version
          const parentVersion = versionInfo.inheritsFrom;
          if (parentVersion === "1.20.5" || this.isVersionNewerOrEqual(parentVersion, "1.20.5")) {
            await this.extractModernNatives(parentVersion, versionInfo, nativesDir, lwjglVersion);
          } else if (this.isVersionNewerOrEqual(parentVersion, "1.19")) {
            await this.extractModernNatives(parentVersion, versionInfo, nativesDir);
          } else {
            await this.extractLegacyNatives(parentVersion, versionInfo, nativesDir);
          }
        } else {
          // If there's no parent or parent extraction also fails, throw the error
          throw error;
        }
      }

      // Extract icon resources before launching
      await this.extractIconResources(version, versionDir);

      // Add a sound resource verification step
      const soundsVerified = await this.verifySoundResources(
        version,
        versionInfo
      );
      if (!soundsVerified) {
        logger.warn(
          "Some sound resources may be missing - game might show sound warnings"
        );
      }

      // Build classpath with error handling
      let classpath;
      try {
        classpath = await this.buildClasspath(versionInfo, version);
        if (!classpath) {
          throw new Error("Failed to build classpath - empty result");
        }
      } catch (error) {
        logger.error(`Error building classpath: ${error.message}`);
        throw new Error(`Failed to build classpath: ${error.message}`);
      }

      // Build launch arguments with error handling
      let jvmArgs, gameArgs;
      try {
        const gameDir = path.join(this.baseDir);
        const assetsDir = path.join(this.baseDir, "assets");

        jvmArgs = this.buildJvmArgs(versionInfo, {
          classpath,
          nativesDir,
          gameDir,
          assetsDir,
          version,
        });

        // Use the actual Microsoft profile name if authenticated
        const gameUsername = usingMicrosoftAuth ? authData.profile.name : username;
        
        gameArgs = this.buildGameArgs(versionInfo, {
          username: gameUsername,
          version,
          gameDir,
          assetsDir,
          authData
        });
        
        // Add special JVM arguments for offline mode ONLY
        // This is crucial - we should NOT set these for authenticated sessions
        if (offlineMode) {
          // Only add mock auth server URLs for offline mode
          logger.info('Using offline mode with mock authentication');
          
          // Get the global authServer reference if this.authServer is not set
          if (!this.authServer && global.authServer) {
            this.authServer = global.authServer;
          }
          
          let authPort = null;
          try {
            if (this.authServer) {
              authPort = await this.authServer.getPort();
            }
          } catch (err) {
            logger.warn(`Error getting auth server port: ${err.message}`);
          }
          
          const authPortFallback = "25566";
          const portToUse = authPort || authPortFallback;
          
          logger.info(`Using auth server on port: ${portToUse}`);
          
          jvmArgs.push(`-Dminecraft.api.auth.host=http://127.0.0.1:${portToUse}`);
          jvmArgs.push(`-Dminecraft.api.account.host=http://127.0.0.1:${portToUse}`);
          jvmArgs.push(`-Dminecraft.api.session.host=http://127.0.0.1:${portToUse}`);
          jvmArgs.push(`-Dminecraft.api.services.host=http://127.0.0.1:${portToUse}`);
        } else {
          logger.info('Using real Minecraft authentication - no mock servers');
        }
      } catch (error) {
        logger.error(`Error building launch arguments: ${error.message}`);
        throw new Error(`Failed to build launch arguments: ${error.message}`);
      }

      // Add a null check before accessing getPort()
      const authServerPort = this.authServer ? await this.authServer.getPort() : null;
      
      // If auth server port is null, provide a fallback or handle the error
      if (!authServerPort) {
        logger.warn("Auth server not available, using offline mode without server");
        // Use a default port if needed for offline mode
        if (offlineMode) {
          jvmArgs.push("-Dminecraft.api.auth.host=http://127.0.0.1:25566");
          jvmArgs.push("-Dminecraft.api.account.host=http://127.0.0.1:25566");
          jvmArgs.push("-Dminecraft.api.session.host=http://127.0.0.1:25566");
          jvmArgs.push("-Dminecraft.api.services.host=http://127.0.0.1:25566");
        }
      }

      // Find Java path with error handling
      let javaPath;
      try {
        const requiredJavaVersion = this.getRequiredJavaVersion(versionInfo);
        javaPath = await this.findJavaPath(requiredJavaVersion);
        if (!javaPath) {
          throw new Error(
            `Could not find Java for ${requiredJavaVersion} version`
          );
        }
      } catch (error) {
        logger.error(`Error finding Java: ${error.message}`);
        throw new Error(
          `Failed to find suitable Java installation: ${error.message}`
        );
      }

      // Combine all arguments
      const args = [...jvmArgs, versionInfo.mainClass, ...gameArgs];

      // Launch the game process
      logger.info(`Launching with Java: ${javaPath}`);
      logger.info(`Command line: ${javaPath} ${args.join(" ")}`);

      let gameProcess;
      try {
        // Add JVM argument to suppress resource warnings if needed
        if (options.suppressResourceWarnings !== false) {
          jvmArgs.push("-Dorg.lwjgl.util.NoChecks=true");

          // Only add this for 1.20+ versions as it might not be supported in older versions
          if (this.isVersionNewerOrEqual(version, "1.19")) {
            jvmArgs.push("-Dfml.ignoreInvalidMinecraftCertificates=true");
            jvmArgs.push("-Dfml.ignorePatchDiscrepancies=true");
          }
        }

        gameProcess = spawn(javaPath, args, {
          cwd: path.join(this.baseDir),
          detached: false, // Changed to false to maintain control
          stdio: "pipe", // Changed to pipe to capture output for debugging
          env: {
            ...process.env,
            // Add environment variable to reduce warning verbosity
            LWJGL_DEBUG: "false",
            LWJGL_DEBUG_LEVEL: "none",
          },
        });

        // Store PID for tracking
        this.runningProcesses.set(version, gameProcess.pid);

        // Log stdout and stderr for debugging
        gameProcess.stdout.on("data", (data) => {
          logger.info(`Game stdout: ${data.toString().trim()}`);
        });

        gameProcess.stderr.on("data", (data) => {
          logger.warn(`Game stderr: ${data.toString().trim()}`);
        });

        // Handle process errors
        gameProcess.on("error", (err) => {
          logger.error(`Game process error: ${err.message}`);
        });

        return {
          success: true,
          pid: gameProcess.pid,
          process: gameProcess,
        };
      } catch (error) {
        logger.error(`Error spawning game process: ${error.message}`);
        throw new Error(`Failed to start game process: ${error.message}`);
      }
    } catch (error) {
      logger.error(`Launch error: ${error.message}`);
      logger.error(error.stack);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  // Add new method to merge version data
  mergeVersionData(parent, child) {
    // Create a deep copy of the parent
    const merged = JSON.parse(JSON.stringify(parent));
    
    // Override properties from child version, but keep parent properties if not present in child
    Object.keys(child).forEach(key => {
        // Special handling for libraries - we want to merge them
        if (key === 'libraries' && merged.libraries) {
            // Add libraries from child, maintaining parent libraries
            merged.libraries = [...merged.libraries, ...child.libraries];
        }
        // Special handling for arguments - merge them
        else if (key === 'arguments' && merged.arguments) {
            if (child.arguments.game) {
                merged.arguments.game = merged.arguments.game || [];
                merged.arguments.game.push(...child.arguments.game);
            }
            if (child.arguments.jvm) {
                merged.arguments.jvm = merged.arguments.jvm || [];
                merged.arguments.jvm.push(...child.arguments.jvm);
            }
        }
        // For everything else, child overrides parent
        else {
            merged[key] = child[key];
        }
    });
    
    return merged;
  }

  // Add new method to extract icon resources
  async extractIconResources(version, versionDir) {
    try {
      logger.info(`Extracting icon resources for ${version}`);
      const clientJarPath = path.join(versionDir, `${version}.jar`);

      if (!(await fs.pathExists(clientJarPath))) {
        throw new Error(`Client JAR not found: ${clientJarPath}`);
      }

      // Create icons directory if it doesn't exist
      const iconsDir = path.join(versionDir, "icons");
      await fs.ensureDir(iconsDir);

      // Extract icon files from the client JAR
      try {
        const zip = new AdmZip(clientJarPath);

        // Define icon paths to extract
        const iconFiles = [
          "assets/minecraft/icons/icon_16x16.png",
          "assets/minecraft/icons/icon_32x32.png",
          "assets/minecraft/textures/gui/icons/icon_16x16.png", // Alternate location
          "assets/minecraft/textures/gui/icons/icon_32x32.png", // Alternate location
          "icons/icon_16x16.png", // Direct path
          "icons/icon_32x32.png", // Direct path
        ];

        // Try to extract each icon file
        let foundAny = false;

        for (const iconPath of iconFiles) {
          try {
            const entry = zip.getEntry(iconPath);
            if (entry) {
              const fileName = path.basename(iconPath);
              const targetPath = path.join(iconsDir, fileName);

              logger.info(`Extracting icon: ${fileName}`);
              zip.extractEntryTo(entry, iconsDir, false, true);
              foundAny = true;
            }
          } catch (error) {
            logger.debug?.(`Couldn't extract ${iconPath}: ${error.message}`);
          }
        }

        if (!foundAny) {
          // Attempt to create basic icon files if none were found
          await this.createPlaceholderIcons(iconsDir);
        }
      } catch (error) {
        logger.warn(`Error extracting icons from client JAR: ${error.message}`);
        // Create placeholder icons as fallback
        await this.createPlaceholderIcons(iconsDir);
      }

      // Now copy to the root directory to ensure icons are found
      const rootIconsDir = path.join(versionDir, "icons");
      await fs.ensureDir(rootIconsDir);

      // Copy icons if they exist (hard links to save space)
      const iconFiles = await fs.readdir(iconsDir);
      for (const icon of iconFiles) {
        const source = path.join(iconsDir, icon);
        const target = path.join(rootIconsDir, icon);

        try {
          await fs.copyFile(source, target);
          logger.info(`Copied icon to: ${target}`);
        } catch (error) {
          logger.warn(`Failed to copy icon ${icon}: ${error.message}`);
        }
      }
    } catch (error) {
      logger.warn(`Failed to extract icons: ${error.message}`);
    }
  }

  // Create placeholder icons if extraction fails
  async createPlaceholderIcons(iconsDir) {
    logger.info("Creating placeholder icon files");

    // Basic transparent PNG for 16x16 icon (minimal 1x1 pixel PNG)
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
      0xae, 0x42, 0x60, 0x82,
    ]);

    // Basic transparent PNG for 32x32 icon (minimal 1x1 pixel PNG)
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
      0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);

    try {
      // Save the placeholder icons
      await fs.writeFile(path.join(iconsDir, "icon_16x16.png"), png16x16);
      await fs.writeFile(path.join(iconsDir, "icon_32x32.png"), png32x32);
      logger.info("Created placeholder icon files");
      return true;
    } catch (error) {
      logger.error(`Failed to create placeholder icons: ${error.message}`);
      return false;
    }
  }

  // Add helper method to detect old Minecraft versions
  isOldMinecraftVersion(version) {
    // Convert version to numeric for comparison
    if (version.startsWith("1.")) {
      const minorVersion = parseInt(version.split(".")[1], 10);
      // Versions before 1.8 need special handling
      return minorVersion < 8;
    }
    return false;
  }

  processArgument(arg, values) {
    return arg.replace(/\${([^}]+)}/g, (match, key) => {
      // Return the value if it exists, otherwise keep the original placeholder
      return values[key] !== undefined ? values[key] : match;
    });
  }

  checkRules(rules) {
    for (const rule of rules) {
      if (rule.os) {
        // Check operating system rules
        const osName =
          process.platform === "win32" ? "windows" : process.platform;
        if (rule.os.name && rule.os.name !== osName) {
          return rule.action !== "allow";
        }

        // Check OS version if specified
        if (rule.os.version) {
          const osVersion = require("os").release();
          const versionRegex = new RegExp(rule.os.version);
          if (!versionRegex.test(osVersion)) {
            return rule.action !== "allow";
          }
        }
      }

      // Handle features if present
      if (rule.features) {
        // Currently we don't support any special features
        return false;
      }
    }
    return true;
  }

  generateXUID() {
    // Generate a valid XUID format (used for multiplayer)
    return "2535" + Math.floor(Math.random() * 1000000000000).toString();
  }

  isGameRunning(version) {
    try {
      const pid = this.runningProcesses.get(version);
      if (!pid) return false;

      // Check if process is still running
      process.kill(pid, 0);
      return true;
    } catch (error) {
      // Process not running
      this.runningProcesses.delete(version);
      return false;
    }
  }

  // Add a proper version comparison function
  isVersionNewerOrEqual(version1, version2) {
    // Split versions into components
    const v1Parts = version1.split(".").map((part) => {
      const num = parseInt(part, 10);
      return isNaN(num) ? 0 : num;
    });

    const v2Parts = version2.split(".").map((part) => {
      const num = parseInt(part, 10);
      return isNaN(num) ? 0 : num;
    });

    // Compare each component
    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const v1Part = v1Parts[i] || 0;
      const v2Part = v2Parts[i] || 0;

      if (v1Part > v2Part) {
        return true;
      }
      if (v1Part < v2Part) {
        return false;
      }
    }

    // Versions are equal
    return true;
  }

  // Add new method to detect LWJGL version from libraries
  detectLwjglVersion(versionJson) {
    // Default to 3.2.2 if we can't detect
    let detectedVersion = "3.2.2";

    try {
      // Look for LWJGL in the libraries list
      const lwjglLib = versionJson.libraries.find(
        (lib) => lib.name && lib.name.startsWith("org.lwjgl:lwjgl:")
      );

      if (lwjglLib) {
        // Extract version from name format org.lwjgl:lwjgl:VERSION
        const parts = lwjglLib.name.split(":");
        if (parts.length >= 3) {
          detectedVersion = parts[2];
          logger.info(`Found LWJGL version ${detectedVersion}`);
        }
      } else {
        // Fallback: try to determine by Minecraft version
        if (versionJson.id.startsWith("1.20")) {
          // Most 1.20.x versions use LWJGL 3.3.1 or higher
          detectedVersion = "3.3.3";
        } else if (versionJson.id.startsWith("1.19")) {
          detectedVersion = "3.3.1";
        } else if (
          versionJson.id.startsWith("1.18") ||
          versionJson.id.startsWith("1.17")
        ) {
          detectedVersion = "3.2.2";
        } else if (versionJson.id.startsWith("1.16")) {
          detectedVersion = "3.2.1";
        } else {
          // Older versions use LWJGL 2.x
          detectedVersion = "2.9.4";
        }

        logger.info(
          `Estimated LWJGL version ${detectedVersion} based on Minecraft version ${versionJson.id}`
        );
      }
    } catch (error) {
      logger.warn(`Failed to detect LWJGL version: ${error.message}`);
    }

    return detectedVersion;
  }

  // Add new method to specifically handle LWJGL 3.3.3 natives for Minecraft 1.20.5
  async ensureLwjgl333Natives(nativesDir, nativesMap, extractedFiles) {
    const lwjglVersion = "3.3.3";
    logger.info(`Ensuring LWJGL ${lwjglVersion} natives are available`);

    // Essential LWJGL components needed
    const essentialComponents = [
      "lwjgl",
      "lwjgl-opengl",
      "lwjgl-openal",
      "lwjgl-jemalloc",
      "lwjgl-glfw",
      "lwjgl-stb",
      "lwjgl-tinyfd",
    ];

    // Check which components we already have
    const missingComponents = essentialComponents.filter((component) => {
      const key = `org.lwjgl:${component}:${lwjglVersion}`;
      return !nativesMap.has(key);
    });

    // Download missing components from Maven Central
    if (missingComponents.length > 0) {
      logger.info(
        `Need to download ${missingComponents.length} missing LWJGL components`
      );

      for (const component of missingComponents) {
        const nativeUrl = `https://repo1.maven.org/maven2/org/lwjgl/${component}/${lwjglVersion}/${component}-${lwjglVersion}-natives-windows.jar`;
        const nativePath = path.join(
          this.librariesDir,
          "org",
          "lwjgl",
          component,
          lwjglVersion,
          `${component}-${lwjglVersion}-natives-windows.jar`
        );

        // Create directory if needed
        await fs.ensureDir(path.dirname(nativePath));

        try {
          logger.info(`Downloading ${component} native from ${nativeUrl}`);
          const response = await fetch(nativeUrl);

          if (!response.ok) {
            logger.error(
              `Failed to download ${component}: ${response.statusText}`
            );
            continue;
          }

          const arrayBuffer = await response.arrayBuffer();
          await fs.writeFile(nativePath, Buffer.from(arrayBuffer));

          logger.info(`Successfully downloaded ${component} native`);
          nativesMap.set(`org.lwjgl:${component}:${lwjglVersion}`, nativePath);
        } catch (error) {
          logger.error(
            `Error downloading ${component} native: ${error.message}`
          );
        }
      }
    }
  }

  // Add method to find and download missing natives as needed
  async findAndDownloadMissingNatives(
    lwjglVersion,
    nativesDir,
    extractedFiles
  ) {
    logger.info(
      `Searching for LWJGL ${lwjglVersion} natives in alternative locations...`
    );

    // List of essential components to check
    const components = [
      "lwjgl",
      "lwjgl-opengl",
      "lwjgl-openal",
      "lwjgl-jemalloc",
      "lwjgl-glfw",
      "lwjgl-stb",
      "lwjgl-tinyfd",
    ];

    // Find any LWJGL native JARs in the library directory
    const lwjglPaths = [
      path.join(this.librariesDir, "org", "lwjgl"),
      path.join(this.librariesDir, "org", "lwjgl3"),
    ];

    for (const basePath of lwjglPaths) {
      if (!(await fs.pathExists(basePath))) continue;

      // Check each component
      for (const component of components) {
        const componentPath = path.join(basePath, component);
        if (!(await fs.pathExists(componentPath))) continue;

        // Look for version directory
        const versionPath = path.join(componentPath, lwjglVersion);
        if (await fs.pathExists(versionPath)) {
          // Find native JAR files
          const files = (await fs.readdir(versionPath)).filter(
            (f) => f.includes("natives-windows") && f.endsWith(".jar")
          );

          if (files.length > 0) {
            for (const file of files) {
              const jarPath = path.join(versionPath, file);
              logger.info(`Found native JAR: ${jarPath}`);

              try {
                // Extract native DLLs
                const zip = new AdmZip(jarPath);

                // Extract DLL files
                for (const entry of zip.getEntries()) {
                  if (
                    entry.entryName.endsWith(".dll") &&
                    !entry.entryName.includes("META-INF")
                  ) {
                    const fileName = path.basename(entry.entryName);
                    zip.extractEntryTo(entry, nativesDir, false, true);
                    extractedFiles.add(fileName.toLowerCase());
                    logger.info(`Extracted: ${fileName}`);
                  }
                }
              } catch (err) {
                logger.error(`Failed to extract from ${file}: ${err.message}`);
              }
            }
          } else {
            logger.info(
              `No native JARs found for ${component} ${lwjglVersion}`
            );
          }
        } else {
          logger.info(`Version ${lwjglVersion} not found for ${component}`);
        }
      }
    }

    // If still missing natives, try downloading from Maven
    if (extractedFiles.size === 0) {
      logger.info(`No natives found locally, downloading from Maven`);

      for (const component of components) {
        const nativeUrl = `https://repo1.maven.org/maven2/org/lwjgl/${component}/${lwjglVersion}/${component}-${lwjglVersion}-natives-windows.jar`;
        const tempPath = path.join(
          os.tmpdir(),
          `lwjgl-${component}-${lwjglVersion}-natives.jar`
        );

        try {
          logger.info(`Downloading ${component} from Maven: ${nativeUrl}`);
          const response = await fetch(nativeUrl);

          if (!response.ok) {
            logger.error(
              `Failed to download ${component}: ${response.statusText}`
            );
            continue;
          }

          const arrayBuffer = await response.arrayBuffer();
          await fs.writeFile(tempPath, Buffer.from(arrayBuffer));

          // Extract from downloaded JAR
          const zip = new AdmZip(tempPath);
          for (const entry of zip.getEntries()) {
            if (
              entry.entryName.endsWith(".dll") &&
              !entry.entryName.includes("META-INF")
            ) {
              const fileName = path.basename(entry.entryName);
              zip.extractEntryTo(entry, nativesDir, false, true);
              extractedFiles.add(fileName.toLowerCase());
              logger.info(`Extracted from Maven: ${fileName}`);
            }
          }

          // Clean up temp file
          await fs.unlink(tempPath);
        } catch (error) {
          logger.error(
            `Failed to download ${component} from Maven: ${error.message}`
          );
        }
      }
    }
  }

  // New method to verify sound resources before launch
  async verifySoundResources(version, versionInfo) {
    try {
      const assetIndexId = versionInfo.assetIndex?.id;
      if (!assetIndexId) {
        logger.warn(`No asset index found for version ${version}`);
        return false;
      }

      // Check if the asset index file exists
      const assetIndexPath = path.join(
        this.assetsDir,
        "indexes",
        `${assetIndexId}.json`
      );
      if (!(await fs.pathExists(assetIndexPath))) {
        logger.warn(`Asset index file not found: ${assetIndexPath}`);
        return false;
      }

      // Read the asset index
      const assetIndexContent = await fs.readFile(assetIndexPath, "utf8");
      const assetIndex = JSON.parse(assetIndexContent);

      // Count sound-related assets
      const soundAssets = Object.entries(assetIndex.objects).filter(([name]) =>
        name.startsWith("minecraft/sounds/")
      );

      logger.info(
        `Found ${soundAssets.length} sound assets in asset index ${assetIndexId}`
      );

      // Check for existence of sound index
      const soundIndexName = "minecraft/sounds.json";
      const soundIndex = assetIndex.objects[soundIndexName];

      if (!soundIndex) {
        logger.warn(`Sound index (sounds.json) not found in assets`);
        return false;
      }

      // Verify sound index exists on disk
      const hash = soundIndex.hash;
      const prefix = hash.substring(0, 2);
      const soundIndexPath = path.join(this.assetsDir, "objects", prefix, hash);

      if (!(await fs.pathExists(soundIndexPath))) {
        logger.warn(`Sound index file missing: ${soundIndexPath}`);
        return false;
      }

      logger.info("Sound resources verified");
      return true;
    } catch (error) {
      logger.warn(`Error verifying sound resources: ${error.message}`);
      return false;
    }
  }

  // New method to ensure parent version is installed
  async ensureParentVersionInstalled(parentVersion) {
    try {
      const parentVersionDir = path.join(this.baseDir, "versions", parentVersion);
      const parentJarPath = path.join(parentVersionDir, `${parentVersion}.jar`);
      const parentJsonPath = path.join(parentVersionDir, `${parentVersion}.json`);
      
      if (!(await fs.pathExists(parentJarPath)) || !(await fs.pathExists(parentJsonPath))) {
        logger.info(`Parent version ${parentVersion} not fully installed, installing now...`);
        const installer = new MinecraftInstaller(this.baseDir);
        await installer.installVersion(parentVersion);
        
        // Verify installation succeeded
        if (!(await fs.pathExists(parentJarPath))) {
          throw new Error(`Failed to install parent version ${parentVersion}`);
        }
        logger.info(`Successfully installed parent version: ${parentVersion}`);
      }
      return true;
    } catch (error) {
      logger.error(`Error ensuring parent version: ${error.message}`);
      throw error;
    }
  }

  // Add this helper method to parse and compare version strings
  parseVersion(versionString) {
    if (!versionString) return [0];
    return versionString.split('.').map(part => {
      // Handle versions with non-numeric parts like "0.15.4+mixin.0.8.7"
      const numPart = parseInt(part.split('+')[0], 10);
      return isNaN(numPart) ? 0 : numPart;
    });
  }

  isNewerVersion(v1, v2) {
    const parts1 = this.parseVersion(v1);
    const parts2 = this.parseVersion(v2);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return true;
      if (p1 < p2) return false;
    }
    return false; // Equal versions
  }

  // Add this missing method that was referenced in extractLegacyNatives
  async getLWJGLLibrariesFromParent(parentVersion) {
    logger.info(`Finding LWJGL native JARs in parent version ${parentVersion}`);
    const nativeJars = [];
    
    try {
      const parentVersionDir = path.join(this.baseDir, "versions", parentVersion);
      const parentJsonPath = path.join(parentVersionDir, `${parentVersion}.json`);
      
      if (!await fs.pathExists(parentJsonPath)) {
        logger.warn(`Parent version JSON not found: ${parentJsonPath}`);
        return nativeJars;
      }
      
      const parentData = await fs.readJson(parentJsonPath);
      
      // Find native libraries in parent version
      for (const lib of parentData.libraries || []) {
        if (!this.isLibraryCompatible(lib)) continue;
        
        // Check for natives
        if (!lib.natives) continue;
        
        // Get Windows native key
        const nativeKey = lib.natives.windows || lib.natives["windows-64"];
        if (!nativeKey) continue;
        
        // Try to get the path to the native JAR
        let nativePath;
        if (lib.downloads?.classifiers?.[nativeKey]) {
          nativePath = path.join(this.baseDir, "libraries", lib.downloads.classifiers[nativeKey].path);
        } else if (lib.name) {
          const parts = lib.name.split(":");
          const nativeSuffix = nativeKey.replace("${arch}", "64");
          
          if (parts.length >= 3) {
            const groupId = parts[0];
            const artifactId = parts[1];
            const version = parts[2];
            
            nativePath = path.join(
              this.baseDir,
              "libraries",
              groupId.replace(/\./g, "/"),
              artifactId,
              version,
              `${artifactId}-${version}-${nativeSuffix}.jar`
            );
          }
        }
        
        // Add the native JAR to our list if it exists
        if (nativePath && await fs.pathExists(nativePath)) {
          nativeJars.push(nativePath);
          logger.info(`Found parent native JAR: ${nativePath}`);
        }
      }
      
      logger.info(`Found ${nativeJars.length} LWJGL native JARs in parent version ${parentVersion}`);
    } catch (error) {
      logger.error(`Error getting parent LWJGL libraries: ${error.message}`);
    }
    
    return nativeJars;
  }
}

module.exports = MinecraftLauncher;
