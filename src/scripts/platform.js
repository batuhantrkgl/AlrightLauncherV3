const os = require('os');
const path = require('path');

function getOSName() {
  switch (process.platform) {
    case 'win32': return 'windows';
    case 'darwin': return 'macos';
    case 'linux': return 'linux';
    default: throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

function getArchName() {
  if (process.platform === 'win32') {
    return process.arch === 'x64' ? '64' : '32';
  }
  return process.arch === 'arm64' ? 'arm64' : 'x86_64';
}

function getAppDataDir() {
  switch (os.platform()) {
    case 'win32':
      return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    case 'darwin':
      return path.join(os.homedir(), 'Library', 'Application Support');
    case 'linux':
      return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    default:
      return os.homedir();
  }
}

module.exports = { getOSName, getArchName, getAppDataDir };
