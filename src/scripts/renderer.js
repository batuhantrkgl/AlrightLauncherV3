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

// Initialize variables for toggle switches and DOM elements early to avoid reference errors
let offlineMode = false;  
let skipVerification = false;
let offlineToggle = null;
let skipVerificationToggle = null;
let themeSelector = null;
let settingsModal = null;
let settingsToggle = null;
let settingsClose = null;

// Add CSS for version badges (add this near the top of the file)
const styleElement = document.createElement('style');
styleElement.textContent = `
    .version-badge {
        display: inline-block;
        font-size: 0.7em;
        padding: 0.1em 0.4em;
        margin-right: 0.5em;
        border-radius: 3px;
        color: white;
    }
    .version-badge.fabric {
        background-color: #5547b9;
    }
    .version-badge.forge {
        background-color: #e76504;
    }
    .version-badge.quilt {
        background-color: #49a58b;
    }
    .fabric-version {
        border-left: 3px solid #5547b9;
    }
    .forge-version {
        border-left: 3px solid #e76504;
    }
    .quilt-version {
        border-left: 3px solid #49a58b;
    }
`;
document.head.appendChild(styleElement);

// Add version comparison function
function compareVersions(a, b) {
    const aParts = a.split('.').map(Number);
    const bParts = b.split('.').map(Number);
    
    for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aPart = aParts[i] || 0;
        const bPart = bParts[i] || 0;
        
        if (aPart > bPart) return -1;
        if (aPart < bPart) return 1;
    }
    
    return 0;
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
let isOperationInProgress = false;  // Add this missing variable definition

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
    isOperationInProgress = show;  // Set the flag based on the overlay state
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
        let versions = [];
        
        if (offlineMode) {
            window.minecraft.logger.info('Fetching installed versions (offline mode)');
            // Get all installed versions, including Fabric, Forge, etc.
            const installedVersions = await window.minecraft.offline.getInstalledVersions();
            versions = installedVersions;
        } else {
            window.minecraft.logger.info('Fetching online versions');
            // Get vanilla versions from Mojang API
            const vanillaVersions = await window.minecraft.getVersions();
            const releaseVersions = vanillaVersions.filter(v => v.type === 'release');
            versions = releaseVersions;
            
            // Add installed modded versions that aren't in the vanilla list
            try {
                const installedVersions = await window.minecraft.offline.getInstalledVersions();
                const moddedVersions = installedVersions.filter(v => {
                    // Find versions that have modloaders
                    return v.id.includes('fabric') || v.id.includes('forge') || v.id.includes('quilt');
                });
                
                // Add modded versions to the list with proper type labels
                for (const modVersion of moddedVersions) {
                    if (!versions.some(v => v.id === modVersion.id)) {
                        // Add modded version to the list with type detection
                        let type = 'release';
                        if (modVersion.id.includes('fabric')) type = 'fabric';
                        if (modVersion.id.includes('forge')) type = 'forge';
                        if (modVersion.id.includes('quilt')) type = 'quilt';
                        
                        versions.push({
                            ...modVersion,
                            type: type
                        });
                    }
                }
                
                window.minecraft.logger.info(`Added ${moddedVersions.length} modded versions to the list`);
            } catch (error) {
                window.minecraft.logger.warn(`Failed to get installed modded versions: ${error.message}`);
            }
        }
        
        // Sort versions by id (newest first)
        versions.sort((a, b) => compareVersions(a.id, b.id));
        
        return versions;
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

// Update the version element click handler to display modded versions properly
versionElement.addEventListener('click', async () => {
    window.minecraft.logger.info('Fetching Minecraft versions...');
    const versions = await fetchVersions();
    window.minecraft.logger.info(`Found ${versions.length} versions`);
    
    // Clear existing dropdown content
    dropdown.innerHTML = '';
    
    // Add versions to dropdown with modloader indicators
    versions.forEach(v => {
        // Determine if this is a modded version
        const isFabric = v.id.includes('fabric') || v.type === 'fabric';
        const isForge = v.id.includes('forge') || v.type === 'forge';
        const isQuilt = v.id.includes('quilt') || v.type === 'quilt';
        
        // Add CSS class based on modloader type
        const typeClass = isFabric ? 'fabric-version' : 
                         isForge ? 'forge-version' : 
                         isQuilt ? 'quilt-version' : '';
        
        // Add badge based on modloader type
        const typeBadge = isFabric ? '<span class="version-badge fabric">Fabric</span>' : 
                         isForge ? '<span class="version-badge forge">Forge</span>' : 
                         isQuilt ? '<span class="version-badge quilt">Quilt</span>' : '';
        
        // Store the version ID in data-version attribute without any modifications
        dropdown.insertAdjacentHTML('beforeend', 
            `<div class="version-item ${typeClass}" data-version="${v.id}" data-type="${v.type || 'vanilla'}">
                ${typeBadge}
                <span class="version-text">${v.id}</span>
             </div>`
        );
    });
    
    dropdown.style.display = 'block';
});

document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== versionElement) {
        dropdown.style.display = 'none';
    }
});

// Modify version selection to use data-version attribute and store only the version ID
dropdown.addEventListener('click', (e) => {
    // Handle clicks on both the version item div and any children (like badge spans)
    const versionItem = e.target.closest('.version-item');
    
    if (versionItem) {
        // Use the data-version attribute to get the actual version ID without badges
        const selectedVersion = versionItem.getAttribute('data-version');
        
        // Store the clean version ID but display with appropriate formatting
        versionElement.textContent = selectedVersion; // Show only the version ID, no badge text
        versionElement.setAttribute('data-version', selectedVersion);
        
        dropdown.style.display = 'none';
        
        // Save selected version to localStorage
        localStorage.setItem('lastVersion', selectedVersion);
        
        window.minecraft.logger.info(`Selected version: ${selectedVersion}`);
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

window.addEventListener('DOMContentLoaded', async () => {
    window.minecraft.logger.info('=== Loading saved settings ===');
    
    // Initialize DOM element references after the document has loaded
    settingsModal = document.getElementById('settingsModal');
    settingsToggle = document.querySelector('.settings-toggle');
    settingsClose = document.querySelector('.settings-close');
    
    // Initialize toggle references
    offlineToggle = document.getElementById('offline-toggle');
    skipVerificationToggle = document.getElementById('skip-verification-toggle');
    themeSelector = document.getElementById('theme-selector');
    
    // Setup settings modal event listeners once the elements are available
    if (settingsToggle) {
        settingsToggle.addEventListener('click', () => {
            if (settingsModal) {
                settingsModal.classList.add('active');
                window.minecraft.logger.info('Settings modal opened');
            }
        });
    }
    
    if (settingsClose) {
        settingsClose.addEventListener('click', () => {
            if (settingsModal) {
                settingsModal.classList.remove('active');
                window.minecraft.logger.info('Settings modal closed');
            }
        });
    }
    
    if (settingsModal) {
        settingsModal.addEventListener('click', (e) => {
            // If the click is on the modal background, not on the content
            if (e.target === settingsModal) {
                settingsModal.classList.remove('active');
            }
        });
    }
    
    // Tab switching functionality
    const settingsTabs = document.querySelectorAll('.settings-tab');
    const tabContents = document.querySelectorAll('.tab-content');
    
    settingsTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.getAttribute('data-tab');
            
            // Remove active class from all tabs and contents
            settingsTabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            
            // Add active class to clicked tab and corresponding content
            tab.classList.add('active');
            const targetElement = document.getElementById(targetTab);
            if (targetElement) {
                targetElement.classList.add('active');
            }
        });
    });
    
    // Load previously used username
    const savedUsername = localStorage.getItem('lastUsername');
    if (savedUsername) {
        document.getElementById('username').textContent = savedUsername;
        window.minecraft.logger.info(`Loaded saved username: ${savedUsername}`);
    }
    
    // Load last played version and update the UI
    const savedVersion = localStorage.getItem('lastVersion');
    if (savedVersion) {
        // Remove duplicated "Fabric" prefix if present
        let cleanVersion = savedVersion;
        if (cleanVersion.startsWith('Fabricfabric-')) {
            cleanVersion = cleanVersion.replace('Fabricfabric-', 'fabric-');
            // Update localStorage with fixed version
            localStorage.setItem('lastVersion', cleanVersion);
        }
        
        document.getElementById('version').textContent = cleanVersion;
        document.getElementById('version').setAttribute('data-version', cleanVersion);
        window.minecraft.logger.info(`Loaded last played version: ${cleanVersion}`);
    }
    
    // Load RAM setting
    const savedRam = localStorage.getItem('maxRam');
    window.minecraft.logger.info(`Saved RAM: ${savedRam || 'default'}`);
    
    // Load theme setting
    const savedTheme = localStorage.getItem('theme');
    window.minecraft.logger.info(`Saved theme: ${savedTheme || 'default'}`);
    
    // Apply the saved theme or default to light
    applyTheme(savedTheme || 'light');
    
    // Set up theme selector event listener
    if (themeSelector) {
        themeSelector.value = savedTheme || 'light';
        themeSelector.addEventListener('change', (e) => {
            applyTheme(e.target.value);
        });
    }
    
    // Set up theme toggle for backward compatibility
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.checked = (savedTheme === 'dark');
        themeToggle.addEventListener('change', (e) => {
            applyTheme(e.target.checked ? 'dark' : 'light');
        });
    }
    
    // Load fullscreen setting
    const savedFullscreen = localStorage.getItem('fullscreen');
    window.minecraft.logger.info(`Saved fullscreen: ${savedFullscreen || 'default'}`);
    
    // Load offline mode settings
    const savedOfflineMode = localStorage.getItem('offlineMode') === 'true';
    const savedSkipVerification = localStorage.getItem('skipVerification') === 'true';
    window.minecraft.logger.info(`Saved offline mode: ${savedOfflineMode}`);
    window.minecraft.logger.info(`Saved skip verification: ${savedSkipVerification}`);
    
    // Apply settings
    offlineMode = savedOfflineMode;
    skipVerification = savedSkipVerification;
    
    if (offlineToggle) {
        offlineToggle.checked = offlineMode;
        
        // Add event listener for offline toggle
        offlineToggle.addEventListener('change', (e) => {
            offlineMode = e.target.checked;
            localStorage.setItem('offlineMode', offlineMode);
            
            // Enable/disable skip verification toggle
            if (skipVerificationToggle) {
                skipVerificationToggle.disabled = !offlineMode;
            }
            
            window.minecraft.logger.info(`Offline mode ${offlineMode ? 'enabled' : 'disabled'}`);
        });
    }
    
    if (skipVerificationToggle) {
        skipVerificationToggle.checked = skipVerification;
        skipVerificationToggle.disabled = !offlineMode;
        
        // Add event listener for skip verification toggle
        skipVerificationToggle.addEventListener('change', (e) => {
            skipVerification = e.target.checked;
            localStorage.setItem('skipVerification', skipVerification);
            window.minecraft.logger.info(`Skip verification ${skipVerification ? 'enabled' : 'disabled'}`);
        });
    }
    
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
    
    // Check for missing profiles after loading versions
    await checkAndCreateMissingProfiles();
});

// Add the missing updateInstalledVersions function if it doesn't exist
async function updateInstalledVersions() {
    try {
        const installedVersions = await window.minecraft.offline.getInstalledVersions();
        window.minecraft.logger.info(`Found ${installedVersions.length} installed versions`);
    } catch (error) {
        window.minecraft.logger.error(`Failed to get installed versions: ${error.message}`);
    }
}

// Add missing checkAndCreateMissingProfiles function if needed
async function checkAndCreateMissingProfiles() {
    try {
        if (window.minecraft.profiles && window.minecraft.profiles.createMissing) {
            const result = await window.minecraft.profiles.createMissing();
            window.minecraft.logger.info(`Checked for missing profiles: ${result.success ? 'success' : 'failed'}`);
        }
    } catch (error) {
        window.minecraft.logger.error(`Failed to check missing profiles: ${error.message}`);
    }
}

// Add theme handling function
function applyTheme(themeName) {
    // If no theme is specified, use light theme
    if (!themeName) themeName = 'light';
    
    // Set the data-theme attribute on the document body
    if (themeName === 'light') {
        document.body.removeAttribute('data-theme');
    } else {
        document.body.setAttribute('data-theme', themeName);
    }
    
    // Save the theme preference
    localStorage.setItem('theme', themeName);
    
    // Update any UI elements that show the theme status
    if (themeSelector) {
        themeSelector.value = themeName;
    }
    
    // If using dark theme, also set the theme toggle
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.checked = (themeName === 'dark');
    }
    
    window.minecraft.logger.info(`Applied theme: ${themeName}`);
}

// Add these global variables at the top of the file
let gameRunning = false;
let launchInProgress = false;

// Update the playGame function to disable UI during launch
async function playGame() {
    if (isOperationInProgress || gameRunning || launchInProgress) return;
    
    launchInProgress = true;
    
    // Get the version from data-version attribute first, then fallback to text content
    let version = versionElement.getAttribute('data-version') || versionElement.textContent;
    
    // Extra safety check: Remove duplicated "Fabric" prefix if present
    if (version.startsWith('Fabricfabric-')) {
        version = version.replace('Fabricfabric-', 'fabric-');
        window.minecraft.logger.info(`Fixed duplicated prefix in version: ${version}`);
    }
    
    const username = document.getElementById('username').textContent;
    
    // Save both values when launching the game
    localStorage.setItem('lastUsername', username);
    localStorage.setItem('lastVersion', version);
    
    // Log the exact version being launched
    window.minecraft.logger.info(`Launching version: ${version}`);
    
    try {
        // Disable all UI elements
        disableAllControls(true);
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
            gameRunning = true;
            
            // Hide progress overlay
            setTimeout(() => {
                showProgress(false);
                // Hide the launcher after a short delay
                setTimeout(() => {
                    window.minecraft.ipc.invoke('hide-window');
                    window.minecraft.logger.info('Launcher hidden while game is running');
                }, 2000); // 2-second delay before hiding
            }, 1000);
        } else {
            throw new Error(launched.error || 'Failed to launch game');
        }
    } catch (error) {
        updateProgress(100, 'Error', error.message);
        setTimeout(() => {
            showProgress(false);
            disableAllControls(false); // Re-enable controls
        }, 2000);
    } finally {
        launchInProgress = false;
    }
}

// Add function to disable all UI controls
function disableAllControls(disable = true) {
    // Disable version dropdown
    const versionElement = document.getElementById('version');
    versionElement.style.pointerEvents = disable ? 'none' : 'auto';
    versionElement.style.opacity = disable ? '0.7' : '1';
    
    // Disable username editing
    const username = document.getElementById('username');
    username.contentEditable = disable ? 'false' : 'true';
    username.style.opacity = disable ? '0.7' : '1';
    
    // Disable play button
    const playButton = document.querySelector('.play-button');
    playButton.disabled = disable;
    playButton.textContent = disable ? (gameRunning ? 'Game Running' : 'Launching...') : 'Play';
    
    // Disable settings/debug toggles
    const debugToggle = document.querySelector('.debug-toggle');
    if (debugToggle) {
        debugToggle.disabled = disable;
        debugToggle.style.opacity = disable ? '0.5' : '1';
    }
}

// Add event listeners for game status changes
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
    
    // Re-enable all controls
    gameRunning = false;
    disableAllControls(false);
    
    // Show the launcher window
    window.minecraft.ipc.invoke('show-window');
});

// Attach play button click handler
document.querySelector('.play-button').addEventListener('click', playGame);

// Expose a method to manually verify files
window.verifyFiles = async (version) => {
    try {
        showProgress(true);
        updateProgress(0, 'Starting file verification...');
        const versionToVerify = version || versionElement.getAttribute('data-version') || versionElement.textContent;
        
        // Get file status first
        updateProgress(20, 'Checking file status...');
        // We'll skip getting file status since we're not using the result
        
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

// Add form submission handlers
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
            maxPlayers: parseInt(form.maxPlayers.value) || 20,
            viewDistance: parseInt(form.viewDistance.value) || 10,
            difficulty: form.difficulty.value,
            gamemode: form.gamemode.value,
            pvp: form.pvp.checked,
            spawnAnimals: form.spawnAnimals.checked,
            spawnMonsters: form.spawnMonsters.checked
        };

        localStorage.setItem(`server-${serverData.name}`, JSON.stringify(serverData));
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
            maxPlayers: parseInt(form.maxPlayers.value) || 20,
            viewDistance: parseInt(form.viewDistance.value) || 10,
            difficulty: form.difficulty.value,
            gamemode: form.gamemode.value,
            pvp: form.pvp.checked,
            spawnAnimals: form.spawnAnimals.checked,
            spawnMonsters: form.spawnMonsters.checked
        };

        localStorage.setItem(`server-${serverData.name}`, JSON.stringify(serverData));
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
    updateServerList();
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

// Setup update listeners as early as possible
window.minecraft.updates.onUpdateAvailable((data) => {
    window.updateInfo = data; // Use window to make it globally accessible
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
                    window.updateInfo = result; // Use window to make it globally accessible
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

// Function to ensure all installed versions have profiles
async function checkAndCreateMissingProfiles() {
    console.log('Checking for missing profiles for installed versions...');
    try {
        const result = await window.minecraft.profiles.createMissing();
        if (result.success) {
            console.log(`Profile check complete: ${result.created} created, ${result.existing} already exist`);
            if (result.created > 0) {
                // Refresh the profiles list if any were created
                await loadProfiles();
            }
        } else {
            console.error('Failed to check for missing profiles:', result.error);
        }
    } catch (error) {
        console.error('Error checking for missing profiles:', error);
    }
}

// Add a button handler for profile import
document.getElementById('importMinecraftProfiles').addEventListener('click', async () => {
    try {
        // First try the default location
        showProgress('Importing profiles', 'Checking for Minecraft profiles...');
        const result = await window.minecraft.profiles.importFromMinecraft();
        hideProgress();
        
        if (result.success) {
            showNotification(`Successfully imported ${result.imported} profiles`);
            // Refresh the profiles list
            await loadProfiles();
        } else if (result.error === 'Minecraft profiles not found') {
            // If default location doesn't work, let user select a file
            const fileResult = await window.minecraft.profiles.selectMinecraftProfilesPath();
            if (!fileResult.canceled && fileResult.path) {
                showProgress('Importing profiles', 'Importing from selected file...');
                const customResult = await window.minecraft.profiles.importFromMinecraft(fileResult.path);
                hideProgress();
                
                if (customResult.success) {
                    showNotification(`Successfully imported ${customResult.imported} profiles`);
                    // Refresh the profiles list
                    await loadProfiles();
                } else {
                    showError(`Failed to import profiles: ${customResult.error}`);
                }
            }
        } else {
            showError(`Failed to import profiles: ${result.error}`);
        }
    } catch (error) {
        hideProgress();
        showError(`Profile import error: ${error.message}`);
    }
});

// Add settings modal functionality
// Remove these duplicate implementations that appear later in the file
// if (typeof settingsModal === 'undefined') { ... }
// const settingsModal = document.getElementById('settingsModal'); ...

window.minecraft.onInstallProgress((data) => {
    updateProgress(
        data.percent,
        data.phase,
        data.detail + ' (' + Math.round(data.percent) + '%)'
    );
});

// Update System
// Only initialize updateInfo if it's not already defined
if (typeof updateInfo === 'undefined') {
    let updateInfo = null;
}

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

// Function to ensure all installed versions have profiles
async function checkAndCreateMissingProfiles() {
    console.log('Checking for missing profiles for installed versions...');
    try {
        const result = await window.minecraft.profiles.createMissing();
        if (result.success) {
            console.log(`Profile check complete: ${result.created} created, ${result.existing} already exist`);
            if (result.created > 0) {
                // Refresh the profiles list if any were created
                await loadProfiles();
            }
        } else {
            console.error('Failed to check for missing profiles:', result.error);
        }
    } catch (error) {
        console.error('Error checking for missing profiles:', error);
    }
}

// Add a button handler for profile import
document.getElementById('importMinecraftProfiles').addEventListener('click', async () => {
    try {
        // First try the default location
        showProgress('Importing profiles', 'Checking for Minecraft profiles...');
        const result = await window.minecraft.profiles.importFromMinecraft();
        hideProgress();
        
        if (result.success) {
            showNotification(`Successfully imported ${result.imported} profiles`);
            // Refresh the profiles list
            await loadProfiles();
        } else if (result.error === 'Minecraft profiles not found') {
            // If default location doesn't work, let user select a file
            const fileResult = await window.minecraft.profiles.selectMinecraftProfilesPath();
            if (!fileResult.canceled && fileResult.path) {
                showProgress('Importing profiles', 'Importing from selected file...');
                const customResult = await window.minecraft.profiles.importFromMinecraft(fileResult.path);
                hideProgress();
                
                if (customResult.success) {
                    showNotification(`Successfully imported ${customResult.imported} profiles`);
                    // Refresh the profiles list
                    await loadProfiles();
                } else {
                    showError(`Failed to import profiles: ${customResult.error}`);
                }
            }
        } else {
            showError(`Failed to import profiles: ${result.error}`);
        }
    } catch (error) {
        hideProgress();
        showError(`Profile import error: ${error.message}`);
    }
});

// Add a simulation control panel to the settings page in the renderer.js file:

// ...existing code...

// Function to set up simulation UI
async function setupSimulationUI() {
    // Get the advanced settings tab content
    const advancedTab = document.getElementById('advanced-settings');
    if (!advancedTab) return;
    
    // Create simulation section
    const simulationSection = document.createElement('div');
    simulationSection.className = 'settings-section';
    simulationSection.innerHTML = `
        <h3>Update Simulation (Debug)</h3>
        <div class="setting-item">
            <label>Enable Update Simulation</label>
            <label class="theme-switch">
                <input type="checkbox" id="simulation-toggle">
                <span class="slider"></span>
            </label>
            <div class="simulation-status" style="color: #888; margin-top: 5px;">Simulation inactive</div>
            <p class="setting-description">
                This will simulate an update process when you check for updates
            </p>
        </div>
        <div class="setting-item">
            <label>Make Download Fail</label>
            <label class="theme-switch">
                <input type="checkbox" id="simulation-fail-download">
                <span class="slider"></span>
            </label>
        </div>
        <div class="setting-item">
            <label>Make Installation Fail</label>
            <label class="theme-switch">
                <input type="checkbox" id="simulation-fail-install">
                <span class="slider"></span>
            </label>
        </div>
        <div class="setting-item">
            <p class="setting-description" style="margin-top: 15px;">
                <strong>How to use:</strong><br>
                1. Enable simulation using the toggle above<br>
                2. Select failure points if desired<br>
                3. Go to Game Settings and click "Check for Updates"<br>
                4. The launcher will simulate an update and/or failure
            </p>
        </div>
    `;
    
    // Add to Advanced settings tab
    advancedTab.appendChild(simulationSection);
    
    // Get simulation status
    const simulationStatus = await window.minecraft.updates.getSimulationStatus();
    
    // Set up event handlers
    const simulationToggle = document.getElementById('simulation-toggle');
    const statusIndicator = document.querySelector('.simulation-status');
    const failDownloadToggle = document.getElementById('simulation-fail-download');
    const failInstallToggle = document.getElementById('simulation-fail-install');
    
    // Update status indicator
    function updateStatusIndicator(enabled) {
        if (enabled) {
            statusIndicator.textContent = 'Simulation ACTIVE';
            statusIndicator.style.color = '#00aa00';
            statusIndicator.style.fontWeight = 'bold';
        } else {
            statusIndicator.textContent = 'Simulation inactive';
            statusIndicator.style.color = '#888';
            statusIndicator.style.fontWeight = 'normal';
        }
    }
    
    // Initialize UI based on current status
    if (simulationStatus.enabled) {
        simulationToggle.checked = true;
        updateStatusIndicator(true);
        
        // Fill in current values
        if (simulationStatus.config) {
            failDownloadToggle.checked = simulationStatus.config.failDownload || false;
            failInstallToggle.checked = simulationStatus.config.failInstall || false;
        }
    }
    
    // Main simulation toggle
    simulationToggle.addEventListener('change', async (e) => {
        try {
            const options = {
                failDownload: failDownloadToggle.checked,
                failInstall: failInstallToggle.checked
            };
            
            const result = await window.minecraft.updates.toggleSimulation(e.target.checked, options);
            
            if (result.enabled) {
                window.minecraft.logger.info('Update simulation enabled');
                updateStatusIndicator(true);
                
                const message = options.failDownload ? 
                    'Update simulation will fail during download' : 
                    options.failInstall ? 
                        'Update simulation will fail during installation' : 
                        'Update simulation enabled (simulates an update with no failures)';
                
                window.alert(`Simulation ENABLED!\n\n${message}\n\nGo to Game Settings tab and click "Check for Updates" to test.`);
            } else {
                window.minecraft.logger.info('Update simulation disabled');
                updateStatusIndicator(false);
            }
        } catch (error) {
            window.minecraft.logger.error(`Failed to toggle simulation: ${error.message}`);
            e.target.checked = !e.target.checked; // Revert toggle state on error
            window.alert(`Simulation toggle failed: ${error.message}`);
        }
    });
    
    // Failure option toggles
    failDownloadToggle.addEventListener('change', async (e) => {
        if (simulationToggle.checked) {
            try {
                const options = {
                    failDownload: e.target.checked,
                    failInstall: failInstallToggle.checked
                };
                
                await window.minecraft.updates.toggleSimulation(true, options);
                window.minecraft.logger.info(`Download failure simulation ${e.target.checked ? 'enabled' : 'disabled'}`);
            } catch (error) {
                window.minecraft.logger.error(`Failed to update simulation: ${error.message}`);
                e.target.checked = !e.target.checked; // Revert toggle state on error
            }
        }
    });
    
    failInstallToggle.addEventListener('change', async (e) => {
        if (simulationToggle.checked) {
            try {
                const options = {
                    failDownload: failDownloadToggle.checked,
                    failInstall: e.target.checked
                };
                
                await window.minecraft.updates.toggleSimulation(true, options);
                window.minecraft.logger.info(`Install failure simulation ${e.target.checked ? 'enabled' : 'disabled'}`);
            } catch (error) {
                window.minecraft.logger.error(`Failed to update simulation: ${error.message}`);
                e.target.checked = !e.target.checked; // Revert toggle state on error
            }
        }
    });
}

// Define helper function for notification (missing implementation)
function showNotification(message) {
    window.minecraft.logger.info(message);
    // Could be implemented with a toast/notification UI
    // For now, just log it
    alert(message);
}

function showError(message) {
    window.minecraft.logger.error(message);
    alert(`Error: ${message}`);
}

function hideProgress() {
    showProgress(false);
}

// Helper function for loading profiles (referenced but not implemented)
async function loadProfiles() {
    try {
        if (window.minecraft.profiles && window.minecraft.profiles.getProfiles) {
            const profiles = await window.minecraft.profiles.getProfiles();
            window.minecraft.logger.info(`Loaded ${profiles.length} profiles`);
            // Implement UI update for profiles if needed
        }
    } catch (error) {
        window.minecraft.logger.error(`Failed to load profiles: ${error.message}`);
    }
}

// ...existing code...


