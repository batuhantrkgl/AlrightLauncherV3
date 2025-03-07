// Initialize logger at the start of the file
if (!window.minecraft?.logger) {
    console.warn('Logger not available, creating fallback logger');
    window.minecraft = window.minecraft || {};
    window.minecraft.logger = {
        info: console.log,
        warn: console.warn,
        error: console.error,
        addLogListener: () => {},
        removeLogListener: () => {},
        clearLogs: () => {},
        saveLogs: () => Promise.resolve(false)
    };
}

// Add version comparison function
function compareVersions(a, b) {
    // Split version strings into components (e.g., "1.19.2" => [1, 19, 2])
    const aParts = a.split('.').map(part => parseInt(part, 10) || 0);
    const bParts = b.split('.').map(part => parseInt(part, 10) || 0);
    
    // Compare each component
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) {
            return bVal - aVal; // Descending order (newer versions first)
        }
    }
    return 0;
}

let isOperationInProgress = false;

function showProgress(show = true) {
    const overlay = document.getElementById('progressOverlay');
    overlay.style.display = show ? 'flex' : 'none';
    
    if (!show) {
        // Clear logs when hiding
        recentLogs = [];
        document.getElementById('progressLogs').innerHTML = '';
    }
    
    // Disable/enable UI elements
    document.body.classList.toggle('disabled', show);
    isOperationInProgress = show;
}

function updateProgress(percent, text, detail = '') {
    const fill = document.getElementById('progressFill');
    const textEl = document.getElementById('progressText');
    const detailEl = document.getElementById('progressDetail');
    
    fill.style.width = `${percent}%`;
    textEl.textContent = text;
    detailEl.textContent = detail;
    
    // Add to logs
    updateProgressLogs(`${text}: ${detail}`);
}

let recentLogs = [];

function updateProgressLogs(message) {
    const logsContainer = document.getElementById('progressLogs');
    
    // Add new log to array
    recentLogs.push(message);
    
    // Keep only last 3 logs
    if (recentLogs.length > 3) {
        recentLogs.shift();
    }
    
    // Update display
    logsContainer.innerHTML = recentLogs
        .map((log, index) => `
            <div class="log-line ${index === recentLogs.length - 1 ? 'new' : ''}">
                ${log}
            </div>
        `)
        .join('');
}

const versionElement = document.getElementById('version');
const dropdown = document.getElementById('version-dropdown');
const username = document.getElementById('username');
let originalText = username.textContent;

// Username handling
username.addEventListener('focus', function() {
    this.classList.add('editing');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(this.childNodes[0], 1);
    range.setEnd(this.childNodes[0], this.textContent.length);
    selection.removeAllRanges();
    selection.addRange(range);
});

// Username handling - update to save on blur
username.addEventListener('blur', function() {
    this.classList.remove('editing');
    // Save username to localStorage when user finishes editing
    localStorage.setItem('lastUsername', this.textContent);
});

username.addEventListener('focus', function() {
    this.classList.add('editing');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(this.childNodes[0], 1);
    range.setEnd(this.childNodes[0], this.textContent.length);
    selection.removeAllRanges();
    selection.addRange(range);
});

async function fetchVersions() {
    try {
        if (offlineMode) {
            window.minecraft.logger.info('Fetching installed versions (offline mode)');
            const versions = await window.minecraft.offline.getInstalledVersions();
            // Sort versions by id (newest first)
            versions.sort((a, b) => compareVersions(a.id, b.id));
            return versions;
        } else {
            window.minecraft.logger.info('Fetching online versions');
            const versions = await window.minecraft.getVersions();
            const releaseVersions = versions.filter(v => v.type === 'release');
            // Sort versions by id (newest first)
            releaseVersions.sort((a, b) => compareVersions(a.id, b.id));
            return releaseVersions;
        }
    } catch (error) {
        window.minecraft.logger.error('Error fetching versions:', error);
        
        // If online fetch fails, try to fall back to offline versions
        if (!offlineMode) {
            window.minecraft.logger.info('Falling back to installed versions');
            try {
                const installedVersions = await window.minecraft.offline.getInstalledVersions();
                // Sort installed versions
                installedVersions.sort((a, b) => compareVersions(a.id, b.id));
                
                if (installedVersions.length > 0) {
                    // Suggest enabling offline mode
                    const shouldEnableOffline = confirm(
                        "Failed to fetch online versions. Would you like to enable offline mode?"
                    );
                    
                    if (shouldEnableOffline) {
                        offlineToggle.checked = true;
                        offlineMode = true;
                        localStorage.setItem('offlineMode', true);
                        
                        // Enable skip verification toggle
                        skipVerificationToggle.disabled = false;
                    }
                    
                    return installedVersions;
                }
            } catch (fallbackError) {
                window.minecraft.logger.error('Fallback to offline versions failed:', fallbackError);
            }
        }
        
        return [];
    }
}

versionElement.addEventListener('click', async () => {
    window.minecraft.logger.info('Fetching Minecraft versions...');
    const versions = await fetchVersions();
    window.minecraft.logger.info(`Found ${versions.length} versions`);
    
    dropdown.innerHTML = versions
        .map(v => `<div class="version-item">${v.id}</div>`)
        .join('');
    
    dropdown.style.display = 'block';
});

document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== versionElement) {
        dropdown.style.display = 'none';
    }
});

// Modify version selection to save the selected version
dropdown.addEventListener('click', (e) => {
    if (e.target.classList.contains('version-item')) {
        const selectedVersion = e.target.textContent;
        versionElement.textContent = selectedVersion;
        dropdown.style.display = 'none';
        
        // Save selected version to localStorage
        localStorage.setItem('lastVersion', selectedVersion);
    }
});

// Debug panel functionality
const debugPanel = document.querySelector('.debug-panel');
const debugToggle = document.querySelector('.debug-toggle');
const logContent = document.getElementById('logContent');
let autoscroll = true;

debugToggle.addEventListener('click', () => {
    debugPanel.classList.toggle('open');
});

document.getElementById('clearLogs').addEventListener('click', () => {
    window.minecraft.logger.clearLogs();
    logContent.innerHTML = '';
});

document.getElementById('saveLogs').addEventListener('click', async () => {
    await window.minecraft.logger.saveLogs();
});

document.getElementById('toggleAutoscroll').addEventListener('click', (e) => {
    autoscroll = !autoscroll;
    e.target.style.opacity = autoscroll ? 1 : 0.5;
});

function addLogEntry(entry) {
    const div = document.createElement('div');
    div.className = `log-entry log-${entry.level}`;
    div.textContent = `[${new Date(entry.timestamp).toLocaleTimeString()}] ${entry.message}`;
    logContent.appendChild(div);
    
    if (autoscroll) {
        div.scrollIntoView({ behavior: 'smooth' });
    }
}

window.minecraft.logger.addLogListener(addLogEntry);

// Settings panel functionality
const settingsModal = document.getElementById('settingsModal');
const ramSlider = document.getElementById('ram-slider');
const ramValue = document.getElementById('ram-value');
const themeToggle = document.getElementById('theme-toggle');
const fullscreenToggle = document.getElementById('fullscreen-toggle');

// Add settings for offline mode
const offlineToggle = document.getElementById('offline-toggle');
const skipVerificationToggle = document.getElementById('skip-verification-toggle');
let offlineMode = false;
let skipVerification = false;

// Offline mode toggle handler
offlineToggle.addEventListener('change', (e) => {
    offlineMode = e.target.checked;
    localStorage.setItem('offlineMode', offlineMode);
    
    // Enable/disable skip verification based on offline mode
    skipVerificationToggle.disabled = !offlineMode;
    if (!offlineMode) {
        skipVerificationToggle.checked = false;
        skipVerification = false;
        localStorage.setItem('skipVerification', false);
    }
    
    window.minecraft.logger.info(`Offline mode ${offlineMode ? 'enabled' : 'disabled'}`);
    
    // If enabling offline mode, check installed versions
    if (offlineMode) {
        updateInstalledVersions();
    }
});

// Skip verification toggle handler
skipVerificationToggle.addEventListener('change', (e) => {
    skipVerification = e.target.checked;
    localStorage.setItem('skipVerification', skipVerification);
    window.minecraft.logger.info(`Skip verification ${skipVerification ? 'enabled' : 'disabled'}`);
});

// Function to update installed versions when in offline mode
async function updateInstalledVersions() {
    try {
        window.minecraft.logger.info('Fetching installed versions for offline mode...');
        const installedVersions = await window.minecraft.offline.getInstalledVersions();
        
        if (installedVersions.length === 0) {
            window.minecraft.logger.warn('No installed versions found. Offline mode might not work properly.');
            offlineToggle.checked = false;
            offlineMode = false;
            localStorage.setItem('offlineMode', false);
            return;
        }
        
        window.minecraft.logger.info(`Found ${installedVersions.length} installed versions`);
        
        // If we're in offline mode, update the version dropdown to only show installed versions
        if (offlineMode) {
            dropdown.innerHTML = installedVersions
                .map(v => `<div class="version-item">${v.id}</div>`)
                .join('');
                
            // If current selected version is not installed, select the first installed version
            const currentVersion = versionElement.textContent;
            const isCurrentInstalled = installedVersions.some(v => v.id === currentVersion);
            
            if (!isCurrentInstalled && installedVersions.length > 0) {
                versionElement.textContent = installedVersions[0].id;
            }
        }
    } catch (error) {
        window.minecraft.logger.error('Failed to fetch installed versions:', error);
    }
}

// Update settings toggle handler
debugToggle?.addEventListener('click', () => {
    if (settingsModal) {
        const isOpen = settingsModal.style.display === 'flex';
        settingsModal.style.display = isOpen ? 'none' : 'flex';
        window.minecraft.logger.info(`Settings panel ${isOpen ? 'closed' : 'opened'}`);
    }
});

// Handle settings close button
document.querySelector('.settings-close')?.addEventListener('click', () => {
    if (settingsModal) {
        settingsModal.style.display = 'none';
    }
});

// Add tab functionality
document.querySelectorAll('.settings-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        const tabId = tab.getAttribute('data-tab');
        
        // Update active tab
        document.querySelectorAll('.settings-tab').forEach(t => {
            t.classList.remove('active');
        });
        tab.classList.add('active');
        
        // Update active content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });
        document.getElementById(tabId).classList.add('active');
        
        window.minecraft.logger.info(`Settings tab switched to: ${tabId}`);
    });
});

// Close settings when clicking outside the modal
document.addEventListener('click', (e) => {
    if (settingsModal && settingsModal.style.display === 'flex') {
        // Check if the click target is outside the settings content and not the settings toggle button
        if (!e.target.closest('.settings-content') && !e.target.closest('.debug-toggle')) {
            settingsModal.style.display = 'none';
            window.minecraft.logger.info('Settings closed by clicking outside');
        }
    }
});

// RAM slider
if (ramSlider && ramValue) {
    ramSlider.addEventListener('input', (e) => {
        const value = e.target.value;
        ramValue.textContent = value;
        localStorage.setItem('maxRam', value);
        window.minecraft.logger.info(`RAM value changed to ${value}MB`);
    });
}

// Theme toggle
themeToggle.addEventListener('change', (e) => {
    const isDark = e.target.checked;
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    window.minecraft.logger.info(`Theme changed to ${isDark ? 'dark' : 'light'} mode`);
});

// Fullscreen toggle with error handling
fullscreenToggle.addEventListener('change', async (e) => {
    try {
        const isFullscreen = e.target.checked;
        window.minecraft.logger.info(`Fullscreen toggle requested: ${isFullscreen}`);
        await window.minecraft.window.toggleFullscreen();
        localStorage.setItem('fullscreen', isFullscreen);
        window.minecraft.logger.info('Fullscreen toggle successful');
    } catch (error) {
        window.minecraft.logger.error(`Fullscreen toggle failed: ${error.message}`);
        e.target.checked = !e.target.checked; // Revert the toggle if there's an error
    }
});

// Listen for fullscreen changes from the main process
window.minecraft.window.onFullscreenChange((isFullscreen) => {
    fullscreenToggle.checked = isFullscreen;
});

// Load saved settings
window.addEventListener('DOMContentLoaded', async () => {
    window.minecraft.logger.info('=== Loading saved settings ===');
    
    // Load previously used username
    const savedUsername = localStorage.getItem('lastUsername');
    if (savedUsername) {
        document.getElementById('username').textContent = savedUsername;
        window.minecraft.logger.info(`Loaded saved username: ${savedUsername}`);
    }
    
    // Load last played version and update the UI
    const savedVersion = localStorage.getItem('lastVersion');
    if (savedVersion) {
        document.getElementById('version').textContent = savedVersion;
        window.minecraft.logger.info(`Loaded last played version: ${savedVersion}`);
    }
    
    const savedRam = localStorage.getItem('maxRam');
    window.minecraft.logger.info(`Saved RAM: ${savedRam || 'default'}`);
    
    const savedTheme = localStorage.getItem('theme');
    window.minecraft.logger.info(`Saved theme: ${savedTheme || 'default'}`);
    
    const savedFullscreen = localStorage.getItem('fullscreen');
    window.minecraft.logger.info(`Saved fullscreen: ${savedFullscreen || 'default'}`);
    
    // Load RAM setting
    if (savedRam) {
        ramSlider.value = savedRam;
        ramValue.textContent = savedRam;
    }

    // Load theme setting
    if (savedTheme === 'dark') {
        themeToggle.checked = true;
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    // Load fullscreen setting
    if (savedFullscreen === 'true') {
        fullscreenToggle.checked = true;
        await window.minecraft.window.toggleFullscreen();
    }

    // Check current fullscreen state
    const isFullscreen = await window.minecraft.window.isFullscreen();
    fullscreenToggle.checked = isFullscreen;
    
    window.minecraft.logger.info('=== Settings loaded successfully ===');
    
    // Load offline mode settings
    const savedOfflineMode = localStorage.getItem('offlineMode') === 'true';
    const savedSkipVerification = localStorage.getItem('skipVerification') === 'true';
    
    window.minecraft.logger.info(`Saved offline mode: ${savedOfflineMode}`);
    window.minecraft.logger.info(`Saved skip verification: ${savedSkipVerification}`);
    
    // Apply settings
    offlineMode = savedOfflineMode;
    skipVerification = savedSkipVerification;
    
    offlineToggle.checked = offlineMode;
    skipVerificationToggle.checked = skipVerification;
    skipVerificationToggle.disabled = !offlineMode;
    
    // If offline mode is enabled, update installed versions
    if (offlineMode) {
        await updateInstalledVersions();
    }
    
    // Check Java availability after loading saved settings
    const playButton = document.querySelector('.play-button');
    playButton.disabled = true;
    playButton.textContent = 'Checking Java...';

    try {
        const hasJava = await window.minecraft.isJavaInstalled();
        if (!hasJava) {
            playButton.textContent = 'Java Required';
            playButton.disabled = true;
            return;
        }
        playButton.disabled = false;
        playButton.textContent = 'Play';
    } catch (error) {
        window.minecraft.logger.error(`Startup Java check failed: ${error.message}`);
        playButton.textContent = 'Java Error';
    }
});

// Check Java on startup
function disableUI() {
    document.body.classList.add('overlay-disabled');
    const buttons = document.querySelectorAll('button');
    buttons.forEach(btn => btn.disabled = true);
}

function enableUI() {
    document.body.classList.remove('overlay-disabled');
    const buttons = document.querySelectorAll('button');
    buttons.forEach(btn => btn.disabled = false);
}

async function getJavaDownloadUrl() {
    try {
        const apiUrl = 'https://api.adoptium.net/v3/assets/feature_releases/21/ga';
        const params = new URLSearchParams({
            'architecture': 'x64',
            'heap_size': 'normal',
            'image_type': 'jdk',  // Changed from 'jre' to 'jdk' since MSI is in JDK distribution
            'jvm_impl': 'hotspot',
            'os': 'windows',
            'page': '0',
            'page_size': '1',
            'project': 'jdk',
            'sort_order': 'DESC',
            'vendor': 'eclipse'
        });

        window.minecraft.logger.info('Fetching Java download URL from Adoptium API...');
        
        // Add timeout and proper headers
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
        
        const response = await fetch(`${apiUrl}?${params}`, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'AlrightLauncher'
            },
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = await response.json();
        window.minecraft.logger.info('API response received:', JSON.stringify(data));
        
        if (!Array.isArray(data) || data.length === 0) {
            throw new Error('No Java downloads found');
        }

        const binary = data[0].binary;
        if (!binary || !binary.installer || !binary.installer.link) {
            // Fallback to direct URL if API response is invalid
            return 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_x64_windows_hotspot_21.0.5_11.msi';
        }

        const downloadUrl = binary.installer.link;
        window.minecraft.logger.info('Successfully retrieved Java MSI installer URL: ' + downloadUrl);
        return downloadUrl;
    } catch (error) {
        window.minecraft.logger.error(`Failed to get Java download URL: ${error.message}`);
        // Fallback URL if API fails
        return 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.5%2B11/OpenJDK21U-jdk_x64_windows_hotspot_21.0.5_11.msi';
    }
}

async function downloadJava() {
    try {
        const downloadUrl = await getJavaDownloadUrl();
        window.minecraft.logger.info('Starting Java download from: ' + downloadUrl);
        
        // Create progress indicator in the UI
        const progressElement = document.createElement('div');
        progressElement.className = 'java-download-progress';
        progressElement.innerHTML = '<span>Downloading Java...</span><progress value="0" max="100"></progress>';
        document.body.appendChild(progressElement);
        
        // Use IPC to trigger the download in the main process with progress updates
        const success = await window.minecraft.ipc.invoke('download-java', downloadUrl, (progress) => {
            const progressBar = progressElement.querySelector('progress');
            if (progressBar) {
                progressBar.value = progress;
                progressElement.querySelector('span').textContent = `Downloading Java... ${progress}%`;
            }
        });
        
        // Remove progress indicator
        if (progressElement.parentNode) {
            progressElement.parentNode.removeChild(progressElement);
        }
        
        if (!success) {
            throw new Error('Download process failed');
        }
        
        window.minecraft.logger.info('Java download completed successfully');
        return true;
    } catch (error) {
        window.minecraft.logger.error('Java download failed: ' + error.message);
        return false;
    }
}

async function showJavaInstallPrompt() {
    return new Promise((resolve) => {
        const modal = document.getElementById('javaModal');
        const installBtn = document.getElementById('installJavaBtn');
        const cancelBtn = document.getElementById('cancelJavaBtn');
        modal.classList.add('active');

        installBtn.onclick = async () => {
            installBtn.disabled = true;
            cancelBtn.disabled = true;
            installBtn.textContent = 'Installing...';
            
            disableUI();
            const downloaded = await downloadJava();
            if (downloaded) {
                const success = await window.minecraft.checkJava();
                if (success) {
                    window.minecraft.logger.info('Java installation completed successfully');
                    modal.classList.remove('active');
                    enableUI();
                    resolve(true);
                    return;
                }
            }
            window.minecraft.logger.error('Java installation failed');
            installBtn.textContent = 'Installation Failed';
            setTimeout(() => {
                installBtn.disabled = false;
                cancelBtn.disabled = false;
                installBtn.textContent = 'Try Again';
            }, 2000);
            enableUI();
            resolve(false);
        };

        cancelBtn.onclick = () => {
            modal.classList.remove('active');
            resolve(false);
        };
    });
}

window.addEventListener('DOMContentLoaded', async () => {
    const playButton = document.querySelector('.play-button');
    playButton.disabled = true;
    playButton.textContent = 'Checking Java...';

    try {
        const hasJava = await window.minecraft.isJavaInstalled();
        if (!hasJava) {
            playButton.textContent = 'Java Required';
            playButton.disabled = true;
            return;
        }
        playButton.disabled = false;
        playButton.textContent = 'Play';
    } catch (error) {
        window.minecraft.logger.error(`Startup Java check failed: ${error.message}`);
        playButton.textContent = 'Java Error';
    }
});

async function playGame() {
    if (isOperationInProgress) return;
    
    const version = document.getElementById('version').textContent;
    const username = document.getElementById('username').textContent;
    
    // Save both values when launching the game
    localStorage.setItem('lastUsername', username);
    localStorage.setItem('lastVersion', version);
    
    try {
        showProgress(true);
        updateProgress(0, 'Preparing to launch...');
        
        // If in offline mode, verify files unless skipped
        if (offlineMode && !skipVerification) {
            updateProgress(10, 'Verifying game files...');
            
            try {
                const verificationResult = await window.minecraft.offline.verifyFiles(version);
                
                if (!verificationResult.success) {
                    const missingFiles = verificationResult.missing || [];
                    const corruptedFiles = verificationResult.corrupted || [];
                    
                    if (missingFiles.length > 0 || corruptedFiles.length > 0) {
                        throw new Error(
                            `File verification failed. Missing: ${missingFiles.length}, Corrupted: ${corruptedFiles.length}`
                        );
                    }
                }
                
                window.minecraft.logger.info('File verification passed');
            } catch (verifyError) {
                throw new Error(`File verification error: ${verifyError.message}`);
            }
        }
        
        updateProgress(40, 'Checking Java installation...');
        const javaVersion = await window.minecraft.checkJava();
        
        if (!javaVersion.installed) {
            throw new Error('Java is not properly installed');
        }
        
        updateProgress(60, 'Launching game...');
        const launched = await window.minecraft.launchGame(version, username, { offline: offlineMode });
        
        if (launched.success) {
            updateProgress(100, 'Game launched successfully!');
            setTimeout(() => showProgress(false), 1000);
        } else {
            throw new Error(launched.error || 'Failed to launch game');
        }
        
    } catch (error) {
        updateProgress(100, 'Error', error.message);
        setTimeout(() => showProgress(false), 2000);
    }
}

// Attach play button click handler
document.querySelector('.play-button').addEventListener('click', playGame);

// Expose a method to manually verify files
window.verifyFiles = async (version) => {
    try {
        showProgress(true);
        updateProgress(0, 'Starting file verification...');
        
        const versionToVerify = version || document.getElementById('version').textContent;
        
        // Get file status first
        updateProgress(20, 'Checking file status...');
        const fileStatus = await window.minecraft.offline.getFileStatus(versionToVerify);
        
        updateProgress(50, 'Verifying file integrity...');
        const result = await window.minecraft.offline.verifyFiles(versionToVerify);
        
        if (result.success) {
            updateProgress(100, 'Verification successful', 'All files are valid');
            setTimeout(() => {
                showProgress(false);
                alert('Verification successful. All files are valid.');
            }, 1000);
        } else {
            const message = `Verification failed. Missing: ${result.missing.length}, Corrupted: ${result.corrupted.length}`;
            updateProgress(100, 'Verification failed', message);
            setTimeout(() => {
                showProgress(false);
                alert(message);
            }, 1000);
        }
        
        return result;
    } catch (error) {
        updateProgress(100, 'Verification error', error.message);
        setTimeout(() => showProgress(false), 1000);
        throw error;
    }
};

// Add a "Verify Files" button in the settings modal
const verifyFilesBtn = document.createElement('button');
verifyFilesBtn.className = 'settings-button';
verifyFilesBtn.textContent = 'Verify Game Files';
verifyFilesBtn.addEventListener('click', () => window.verifyFiles());

// Add the button to the Game Settings section
const gameSettingsSection = document.querySelector('.settings-section:nth-of-type(4)');
if (gameSettingsSection) {
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'setting-item';
    buttonContainer.appendChild(verifyFilesBtn);
    gameSettingsSection.appendChild(buttonContainer);
}

// Add event handler in renderer process
document.getElementById('createStandalone').addEventListener('click', async () => {
    const modal = document.getElementById('versionSelectModal');
    const versionList = document.getElementById('versionSelectList');
    const searchInput = document.getElementById('versionSearch');
    let versions = [];

    try {
        // Fetch versions - already sorted by fetchVersions
        versions = await fetchVersions();
        
        // Populate version list
        versionList.innerHTML = versions.map(v => `
            <label class="version-item-checkbox">
                <input type="checkbox" value="${v.id}">
                ${v.id}
            </label>
        `).join('');

        // Show modal
        modal.classList.add('active');

        // Search functionality
        searchInput.addEventListener('input', (e) => {
            const search = e.target.value.toLowerCase();
            const items = versionList.querySelectorAll('.version-item-checkbox');
            items.forEach(item => {
                const version = item.textContent.trim().toLowerCase();
                item.style.display = version.includes(search) ? 'flex' : 'none';
            });
        });

        // Select/Unselect all
        document.getElementById('selectAllVersions').onclick = () => {
            versionList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
        };

        document.getElementById('unselectAllVersions').onclick = () => {
            versionList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        };

        // Close modal handlers
        const closeButtons = modal.querySelectorAll('.modal-close');
        closeButtons.forEach(btn => {
            btn.onclick = () => modal.classList.remove('active');
        });

        // Confirm selection
        document.getElementById('confirmVersionSelect').onclick = async () => {
            const selectedVersions = Array.from(versionList.querySelectorAll('input[type="checkbox"]:checked'))
                .map(cb => cb.value);

            if (selectedVersions.length === 0) {
                window.minecraft.logger.warn('No versions selected');
                return;
            }

            modal.classList.remove('active');
            
            const button = document.getElementById('createStandalone');
            const originalText = button.textContent;
            
            try {
                button.disabled = true;
                button.textContent = 'Creating...';
                
                const result = await window.minecraft.ipc.invoke('create-standalone', selectedVersions);
                
                if (result.success) {
                    window.minecraft.logger.info('Standalone version created successfully');
                    button.textContent = 'Success!';
                } else {
                    throw new Error(result.error || 'Failed to create standalone version');
                }
            } catch (error) {
                window.minecraft.logger.error(`Failed to create standalone: ${error.message}`);
                button.textContent = 'Failed!';
            } finally {
                setTimeout(() => {
                    button.disabled = false;
                    button.textContent = originalText;
                }, 2000);
            }
        };

    } catch (error) {
        window.minecraft.logger.error('Failed to load version selection:', error);
    }
});

// If you have a login overlay in your HTML, you might want to hide it or remove it
const loginOverlay = document.getElementById('loginOverlay');
if (loginOverlay) {
    loginOverlay.remove();
}

// Add crash handling
window.minecraft.onGameCrash((data) => {
    const modal = document.getElementById('crashReportModal');
    const content = document.getElementById('crashContent');
    const copyButton = document.getElementById('copyCrashReport');
    
    // Display crash content
    content.textContent = data.crashContent;
    modal.classList.add('active');

    // Copy button handler
    copyButton.onclick = () => {
        navigator.clipboard.writeText(data.crashContent)
            .then(() => {
                copyButton.textContent = 'Copied!';
                setTimeout(() => {
                    copyButton.textContent = 'Copy Report';
                }, 2000);
            });
    };

    // Reset play button
    const playButton = document.querySelector('.play-button');
    playButton.textContent = 'Play';
    playButton.disabled = false;
    
    window.minecraft.logger.error(`Game crashed: ${data.version}`);
});

window.minecraft.onGameClose((data) => {
    // Map common exit codes
    const exitCodes = {
        0: 'normal exit',
        1: 'error exit',
        3489660927: 'crash or force close'
    };

    const exitMessage = exitCodes[data.code] || `unknown exit code ${data.code}`;
    
    if (data.code === 0) {
        window.minecraft.logger.info(`Game closed normally: ${data.version}`);
    } else {
        window.minecraft.logger.warn(`Game closed with ${exitMessage}: ${data.version}`);
    }
    
    const playButton = document.querySelector('.play-button');
    if (playButton) {
        playButton.textContent = 'Play';
        playButton.disabled = false;
    }
});

// Add some CSS to ensure the crash report is scrollable and readable
const style = document.createElement('style');
style.textContent = `
.crash-content {
    max-height: 400px;
    overflow-y: auto;
    background: #1a1a1a;
    color: #fff;
    padding: 10px;
    font-family: monospace;
    white-space: pre-wrap;
    word-wrap: break-word;
    border-radius: 4px;
    margin: 10px 0;
}
`;
document.head.appendChild(style);

// Add server version selector population
async function populateServerVersions() {
    const serverVersionSelect = document.getElementById('serverVersion');
    if (!serverVersionSelect) return;

    try {
        window.minecraft.logger.info('Fetching versions for server creation...');
        const versions = await fetchVersions();
        
        // Clear existing options - sorting handled by fetchVersions already
        serverVersionSelect.innerHTML = `
            <option value="" disabled selected>Select a version</option>
            ${versions.map(v => `<option value="${v.id}">${v.id}</option>`).join('')}
        `;
        
        window.minecraft.logger.info(`Loaded ${versions.length} versions for server selection`);
    } catch (error) {
        window.minecraft.logger.error('Failed to load server versions:', error);
        serverVersionSelect.innerHTML = '<option value="" disabled selected>Failed to load versions</option>';
    }
}

// Add form submission handler
document.getElementById('serverForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;

    try {
        submitButton.disabled = true;
        submitButton.textContent = 'Creating...';

        const serverData = {
            name: form.serverName.value,
            version: form.serverVersion.value,
            port: parseInt(form.serverPort.value) || 25565
        };

        window.minecraft.logger.info(`Creating server: ${JSON.stringify(serverData)}`);
        const result = await window.minecraft.server.create(serverData);

        if (result.error) {
            throw new Error(result.error);
        }

        window.minecraft.logger.info(`Server "${serverData.name}" created successfully`);
        submitButton.textContent = 'Success!';
        form.reset();
    } catch (error) {
        window.minecraft.logger.error(`Server creation failed: ${error.message}`);
        submitButton.textContent = 'Failed!';
    } finally {
        setTimeout(() => {
            submitButton.disabled = false;
            submitButton.textContent = originalText;
        }, 2000);
    }
});

// Call this when the page loads
window.addEventListener('DOMContentLoaded', () => {
    // ...existing DOMContentLoaded code...
    populateServerVersions();
});

// Add server monitoring functionality
let currentServer = null;

async function updateServerList() {
    const serverList = document.getElementById('serverList');
    const servers = await window.minecraft.server.list();
    
    serverList.innerHTML = servers.map(server => `
        <div class="server-item" data-name="${server.name}">
            <div class="server-info">
                <span class="status ${server.status}"></span>
                <div class="server-details">
                    <strong>${server.name}</strong>
                    <small>Version: ${server.version}</small>
                    <small>Port: ${server.port}</small>
                </div>
            </div>
            <div class="server-actions">
                <button class="server-action ${server.status === 'running' ? 'stop' : 'start'}-btn">
                    ${server.status === 'running' ? 'Stop' : 'Start'}
                </button>
            </div>
        </div>
    `).join('');

    // Add click handlers
    serverList.querySelectorAll('.server-action').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const serverItem = e.target.closest('.server-item');
            const serverName = serverItem.dataset.name;
            const action = e.target.classList.contains('start-btn') ? 'start' : 'stop';
            
            try {
                if (action === 'start') {
                    const config = loadServerConfig(serverName);
                    await window.minecraft.server.start(serverName, config.memory);
                    currentServer = serverName;
                } else {
                    await window.minecraft.server.stop(serverName);
                    currentServer = null;
                }
                await updateServerList();
            } catch (error) {
                window.minecraft.logger.error(`Failed to ${action} server: ${error.message}`);
            }
        });
    });
}

function loadServerConfig(serverName) {
    // Load server configuration from localStorage
    const savedConfig = localStorage.getItem(`server-${serverName}`);
    return savedConfig ? JSON.parse(savedConfig) : {
        memory: 2048,
        maxPlayers: 20,
        viewDistance: 10,
        difficulty: 'normal',
        gamemode: 'survival',
        pvp: true,
        spawnAnimals: true,
        spawnMonsters: true
    };
}

// Add form submission handler with enhanced configuration
document.getElementById('serverForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const submitButton = form.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;

    try {
        submitButton.disabled = true;
        submitButton.textContent = 'Creating...';

        const serverData = {
            name: form.serverName.value,
            version: form.serverVersion.value,
            port: parseInt(form.serverPort.value) || 25565,
            memory: parseInt(form.serverMemory.value) || 2048,
            settings: {
                maxPlayers: parseInt(form.maxPlayers.value) || 20,
                viewDistance: parseInt(form.viewDistance.value) || 10,
                difficulty: form.difficulty.value,
                gamemode: form.gamemode.value,
                pvp: form.pvp.checked,
                spawnAnimals: form.spawnAnimals.checked,
                spawnMonsters: form.spawnMonsters.checked
            }
        };

        // Save configuration
        localStorage.setItem(`server-${serverData.name}`, JSON.stringify(serverData));

        window.minecraft.logger.info(`Creating server: ${JSON.stringify(serverData)}`);
        const result = await window.minecraft.server.create(serverData);

        if (result.error) {
            throw new Error(result.error);
        }

        window.minecraft.logger.info(`Server "${serverData.name}" created successfully`);
        submitButton.textContent = 'Success!';
        form.reset();
        await updateServerList();
    } catch (error) {
        window.minecraft.logger.error(`Server creation failed: ${error.message}`);
        submitButton.textContent = 'Failed!';
    } finally {
        setTimeout(() => {
            submitButton.disabled = false;
            submitButton.textContent = originalText;
        }, 2000);
    }
});

// Add server log monitoring
window.minecraft.server.onLog((data) => {
    const logContent = document.getElementById('serverLogContent');
    const logEntry = document.createElement('div');
    logEntry.className = `server-log-entry ${data.level}`;
    logEntry.textContent = `[${new Date(data.timestamp).toLocaleTimeString()}] [${data.server}] ${data.message}`;
    logContent.appendChild(logEntry);
    
    if (logContent.children.length > 1000) {
        logContent.removeChild(logContent.firstChild);
    }
    
    logContent.scrollTop = logContent.scrollHeight;
});

// Clear server logs
document.querySelector('.clear-logs')?.addEventListener('click', () => {
    const logContent = document.getElementById('serverLogContent');
    logContent.innerHTML = '';
});

// Update server list periodically
setInterval(updateServerList, 5000);

// Initial server list update
window.addEventListener('DOMContentLoaded', () => {
    // ...existing DOMContentLoaded code...
    updateServerList();
});

window.minecraft.onInstallProgress((data) => {
    updateProgress(
        data.percent,
        data.phase,
        data.detail + ' (' + Math.round(data.percent) + '%)'
    );
});

// Update System
let updateInfo = null;

// Setup update listeners as early as possible
window.minecraft.updates.onUpdateAvailable((data) => {
    updateInfo = data;
    window.minecraft.logger.info(`Update available: ${data.remoteVersion}`);
    showUpdateNotification(data);
});

window.minecraft.updates.onDownloadProgress((data) => {
    updateDownloadProgress(data.progress);
});

function showUpdateNotification(updateData) {
    const notification = document.createElement('div');
    notification.className = 'update-notification';
    notification.innerHTML = `
        <div class="update-notification-content">
            <div class="update-notification-header">
                <h3>Update Available</h3>
                <button class="update-notification-close">✕</button>
            </div>
            <div class="update-notification-body">
                <p>Version ${updateData.remoteVersion} is available.</p>
                <p>You are currently using version ${updateData.currentVersion}.</p>
                ${updateData.releaseNotes ? 
                  `<div class="update-release-notes">${updateData.releaseNotes}</div>` : ''}
            </div>
            <div class="update-notification-footer">
                <button class="update-notification-download">Download & Install</button>
                <button class="update-notification-later">Later</button>
            </div>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    notification.querySelector('.update-notification-close').addEventListener('click', () => {
        notification.remove();
    });
    
    notification.querySelector('.update-notification-later').addEventListener('click', () => {
        notification.remove();
    });
    
    notification.querySelector('.update-notification-download').addEventListener('click', async () => {
        notification.remove();
        await downloadAndInstallUpdate(updateData);
    });
}

async function downloadAndInstallUpdate(updateData) {
    try {
        // Show progress overlay
        showProgress(true);
        updateProgress(0, 'Preparing update download...');
        
        // Start download
        const downloadResult = await window.minecraft.updates.downloadUpdate(updateData);
        
        if (downloadResult.error) {
            throw new Error(downloadResult.error);
        }
        
        updateProgress(100, 'Download complete', 'Preparing to install...');
        
        // Install update
        const installResult = await window.minecraft.updates.installUpdate(downloadResult);
        
        if (installResult.error) {
            throw new Error(installResult.error);
        }
        
        // The app will restart as part of the installation
    } catch (error) {
        window.minecraft.logger.error(`Update failed: ${error.message}`);
        updateProgress(0, 'Update Failed', error.message);
        setTimeout(() => showProgress(false), 3000);
    }
}

function updateDownloadProgress(progress) {
    updateProgress(progress, 'Downloading Update...', `${progress}% complete`);
}

// Add check for updates button to settings
window.addEventListener('DOMContentLoaded', () => {
    // ...existing code...
    
    // Add update channel selector
    const gameSettingsSection = document.querySelector('.settings-section:nth-of-type(4)');
    if (gameSettingsSection) {
        // Update channel selector
        const updateChannelContainer = document.createElement('div');
        updateChannelContainer.className = 'setting-item';
        updateChannelContainer.innerHTML = `
            <label for="update-channel">Update Channel:</label>
            <select id="update-channel">
                <option value="stable">Stable</option>
                <option value="beta">Beta</option>
            </select>
        `;
        gameSettingsSection.appendChild(updateChannelContainer);
        
        // Check for updates button
        const checkUpdatesContainer = document.createElement('div');
        checkUpdatesContainer.className = 'setting-item';
        const checkUpdatesBtn = document.createElement('button');
        checkUpdatesBtn.className = 'settings-button';
        checkUpdatesBtn.textContent = 'Check for Updates';
        checkUpdatesBtn.addEventListener('click', async () => {
            const channel = document.getElementById('update-channel').value;
            localStorage.setItem('updateChannel', channel);
            window.minecraft.logger.info(`Checking for updates in ${channel} channel...`);
            
            try {
                checkUpdatesBtn.disabled = true;
                checkUpdatesBtn.textContent = 'Checking...';
                
                const result = await window.minecraft.updates.checkForUpdates(channel);
                
                if (result.error) {
                    throw new Error(result.error);
                }
                
                if (result.updateAvailable) {
                    updateInfo = result;
                    showUpdateNotification(result);
                    checkUpdatesBtn.textContent = 'Update Available';
                } else {
                    checkUpdatesBtn.textContent = 'Up to Date';
                    window.minecraft.logger.info('No updates available');
                }
            } catch (error) {
                window.minecraft.logger.error(`Update check failed: ${error.message}`);
                checkUpdatesBtn.textContent = 'Check Failed';
            } finally {
                setTimeout(() => {
                    checkUpdatesBtn.disabled = false;
                    checkUpdatesBtn.textContent = 'Check for Updates';
                }, 3000);
            }
        });
        
        checkUpdatesContainer.appendChild(checkUpdatesBtn);
        gameSettingsSection.appendChild(checkUpdatesContainer);
        
        // Load saved update channel preference
        const savedChannel = localStorage.getItem('updateChannel') || 'stable';
        document.getElementById('update-channel').value = savedChannel;
    }
});

// ...existing code...
