const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const { spawn, exec } = require('child_process');
const os = require('os');
const logger = require('./logger');

function getOS() {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'mac';
    case 'linux': return 'linux';
    default: throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function getArch() {
  if (process.arch === 'x64' || process.arch === 'amd64') return 'x64';
  if (process.arch === 'arm64') return 'arm64';
  return 'x64';
}

function getExt() {
  if (process.platform === 'win32') return 'msi';
  if (process.platform === 'darwin') return 'pkg';
  return 'tar.gz';
}

class JavaInstaller {
  constructor(options = {}) {
    this.javaVersion = options.javaVersion || 21;
    this.tempDir = options.tempDir || os.tmpdir();
    this.timeout = options.timeout || 120000;
    this.installDir = options.installDir || this._defaultInstallDir();
  }

  _defaultInstallDir() {
    if (process.platform === 'win32') {
      return path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Eclipse Adoptium');
    }
    if (process.platform === 'darwin') {
      return '/Library/Java/JavaVirtualMachines';
    }
    return '/usr/lib/jvm';
  }

  _buildPrimaryUrl() {
    const osName = getOS();
    const arch = getArch();
    const ext = getExt();
    return `https://api.adoptium.net/v3/installer/latest/${this.javaVersion}/ga/${osName}/${arch}/jre/hotspot/normal/eclipse?project=jdk`;
  }

  _buildFallbackUrl() {
    const osName = getOS();
    const arch = getArch();
    const knownFallbacks = {
      8: { repo: 'temurin8-binaries', build: 'jdk8u402-b06' },
      11: { repo: 'temurin11-binaries', build: 'jdk-11.0.22+7' },
      17: { repo: 'temurin17-binaries', build: 'jdk-17.0.12+7' },
      21: { repo: 'temurin21-binaries', build: 'jdk-21.0.4+7' },
    };
    const fb = knownFallbacks[this.javaVersion];
    if (!fb) return this._buildPrimaryUrl();
    const ext = getExt();
    const file = `OpenJDK${this.javaVersion}U-jre_${osName}_${arch}_hotspot_${fb.build.replace(/[+]/g, '_')}.${ext}`;
    return `https://github.com/adoptium/${fb.repo}/releases/download/${fb.build}/${file}`;
  }

  async downloadFile(destination, url) {
    return new Promise((resolve, reject) => {
      fs.ensureDirSync(path.dirname(destination));
      let receivedBytes = 0;
      let totalBytes = 0;

      const doDownload = (downloadUrl, redirectCount = 0) => {
        if (redirectCount > 5) return reject(new Error('Too many redirects'));
        logger.info(`Starting download from: ${downloadUrl}`);
        const file = fs.createWriteStream(destination);

        const request = https.get(downloadUrl, { timeout: this.timeout }, (response) => {
          if (response.statusCode >= 300 && response.statusCode < 400) {
            const redirectUrl = response.headers.location;
            response.resume();
            file.close();
            fs.removeSync(destination);
            return redirectUrl ? doDownload(redirectUrl, redirectCount + 1) : reject(new Error('Redirect with no location'));
          }
          if (response.statusCode !== 200) {
            file.close();
            fs.removeSync(destination);
            return reject(new Error(`Server returned ${response.statusCode}`));
          }
          totalBytes = parseInt(response.headers['content-length'], 10) || 0;
          response.on('data', (chunk) => {
            receivedBytes += chunk.length;
          });
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            logger.info(`Download completed: ${destination}`);
            resolve(destination);
          });
        });
        request.on('error', (err) => { file.close(); fs.removeSync(destination); reject(err); });
        request.on('timeout', () => { request.abort(); file.close(); fs.removeSync(destination); reject(new Error('Download timed out')); });
        file.on('error', (err) => { file.close(); fs.removeSync(destination); reject(err); });
      };
      doDownload(url);
    });
  }

  async verifyDownload(filePath) {
    try {
      const stats = await fs.stat(filePath);
      return stats.isFile() && stats.size > 0;
    } catch { return false; }
  }

  async install(progressCallback) {
    const ext = getExt();
    const installerPath = path.join(this.tempDir, `java_${this.javaVersion}_installer.${ext}`);

    try {
      logger.info(`Starting Java ${this.javaVersion} installation for ${process.platform}`);
      progressCallback?.({ type: 'status', message: `Downloading Eclipse Temurin ${this.javaVersion} JRE...` });

      if (await fs.pathExists(installerPath)) await fs.remove(installerPath);

      try {
        await this.downloadFile(installerPath, this._buildPrimaryUrl());
      } catch (downloadError) {
        logger.warn(`Primary download failed: ${downloadError.message}. Trying fallback...`);
        progressCallback?.({ type: 'status', message: 'Trying alternative download source...' });
        if (await fs.pathExists(installerPath)) await fs.remove(installerPath);
        await this.downloadFile(installerPath, this._buildFallbackUrl());
      }

      if (!(await this.verifyDownload(installerPath))) {
        throw new Error('Downloaded file is invalid or corrupt');
      }

      progressCallback?.({ type: 'status', message: 'Installing Java...' });
      await this.runInstaller(installerPath, progressCallback);

      progressCallback?.({ type: 'status', message: 'Java installation complete!' });

      try { await fs.remove(installerPath); } catch { /* ignore */ }
      return true;
    } catch (error) {
      logger.error(`Installation failed: ${error.message}`);
      try { if (await fs.pathExists(installerPath)) await fs.remove(installerPath); } catch { /* ignore */ }
      progressCallback?.({ type: 'error', message: `Installation failed: ${error.message}` });
      throw error;
    }
  }

  runInstaller(installerPath, progressCallback = () => {}) {
    return new Promise((resolve, reject) => {
      if (process.platform === 'win32') {
        this._installWindows(installerPath, resolve, reject);
      } else if (process.platform === 'darwin') {
        this._installMac(installerPath, resolve, reject);
      } else if (process.platform === 'linux') {
        this._installLinux(installerPath, resolve, reject);
      } else {
        reject(new Error(`Unsupported platform: ${process.platform}`));
      }
    });
  }

  _installWindows(installerPath, resolve, reject) {
    const cmd = `Start-Process msiexec -ArgumentList '/i "${installerPath}" /passive /norestart' -Verb RunAs -Wait`;
    const proc = spawn('powershell', ['-Command', cmd], { stdio: 'ignore', shell: true });
    proc.on('error', (err) => reject(new Error(`Failed to start installer: ${err.message}`)));
    proc.on('close', (code) => {
      code === 0 ? resolve(true) : reject(new Error(`Installer exited with code ${code}`));
    });
  }

  _installMac(installerPath, resolve, reject) {
    if (installerPath.endsWith('.pkg')) {
      const proc = spawn('sudo', ['installer', '-pkg', installerPath, '-target', '/'], { stdio: 'pipe' });
      proc.on('error', (err) => reject(new Error(`Failed to start installer: ${err.message}`)));
      proc.on('close', (code) => {
        code === 0 ? resolve(true) : reject(new Error(`Installer exited with code ${code}`));
      });
    } else if (installerPath.endsWith('.tar.gz')) {
      const javaDir = path.join(this.installDir, `temurin-${this.javaVersion}`);
      fs.ensureDirSync(javaDir);
      const tar = spawn('tar', ['-xzf', installerPath, '-C', javaDir, '--strip-components=1'], { stdio: 'pipe' });
      tar.on('error', (err) => reject(new Error(`Failed to extract: ${err.message}`)));
      tar.on('close', (code) => {
        if (code !== 0) return reject(new Error(`tar exited with code ${code}`));
        const jhome = path.join(javaDir, 'Contents', 'Home');
        if (fs.existsSync(jhome)) {
          const linkName = `temurin-${this.javaVersion}.jdk`;
          const linkPath = path.join(this.installDir, linkName);
          fs.ensureDirSync(this.installDir);
          if (!fs.existsSync(linkPath)) {
            fs.symlinkSync(javaDir, linkPath, 'junction');
          }
        }
        resolve(true);
      });
    } else {
      reject(new Error(`Unsupported installer format: ${installerPath}`));
    }
  }

  _installLinux(installerPath, resolve, reject) {
    const javaDir = path.join(this.installDir, `temurin-${this.javaVersion}-jre`);
    fs.ensureDirSync(javaDir);
    const tar = spawn('tar', ['-xzf', installerPath, '-C', javaDir, '--strip-components=1'], { stdio: 'pipe' });
    tar.on('error', (err) => reject(new Error(`Failed to extract: ${err.message}`)));
    tar.on('close', (code) => {
      if (code !== 0) return reject(new Error(`tar exited with code ${code}`));
      const binPath = path.join(javaDir, 'bin', 'java');
      if (fs.existsSync(binPath)) {
        fs.chmodSync(binPath, 0o755);
      }
      resolve(true);
    });
  }
}

module.exports = JavaInstaller;
