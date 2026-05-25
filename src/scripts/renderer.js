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

let isOperationInProgress = false;

function initializeRamSettings() {
    const savedRam = localStorage.getItem('maxRam');
    window.minecraft.logger.info(`Saved RAM: ${savedRam || 'default'}`);
}

function disableAllControls(disable) {
    const playButton = document.querySelector('.play-button');
    if (playButton) playButton.disabled = disable;
    const versionElement = document.getElementById('version');
    if (versionElement) {
        versionElement.style.pointerEvents = disable ? 'none' : 'auto';
        versionElement.style.opacity = disable ? '0.7' : '1';
    }
}

function updateProgressLogs(message) {
    const logsContainer = document.getElementById('progressLogs');
    if (!logsContainer) return;
    
    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = message;
    logsContainer.appendChild(line);
    
    while (logsContainer.children.length > 100) {
        logsContainer.removeChild(logsContainer.firstChild);
    }
    
    const container = logsContainer.parentElement;
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function showProgress(show = true) {
    const overlay = document.getElementById('progressOverlay');
    if (!overlay) return;
    overlay.style.display = show ? 'flex' : 'none';

    const backdrop = document.getElementById('progressBackdrop');
    if (backdrop) {
        backdrop.style.display = show ? 'block' : 'none';
    }
    
    if (!show) {
        const logs = document.getElementById('progressLogs');
        if (logs) logs.innerHTML = '';
    }
    
    document.body.classList.toggle('disabled', show);
    isOperationInProgress = show;
}

function updateProgress(percent, text, detail = '') {
    const fill = document.getElementById('progressFill');
    const percentEl = document.getElementById('progressPercent');
    const statusEl = document.getElementById('progressStatus');
    const titleEl = document.getElementById('progressTitle');
    if (fill) fill.style.width = percent + '%';
    if (percentEl) percentEl.textContent = Math.round(percent) + '%';
    if (titleEl && text) titleEl.textContent = text;
    if (statusEl && detail) statusEl.textContent = detail;
}

const versionElement = document.getElementById('version');
const dropdown = document.getElementById('version-dropdown');
// Changed this line to use username-input instead of username
const usernameInput = document.getElementById('username-input');
let originalText = usernameInput ? usernameInput.value : 'Player';

// Update any event listeners for the username
if (usernameInput) {
    usernameInput.addEventListener('focus', function() {
        this.classList.add('editing');
    });

    usernameInput.addEventListener('blur', function() {
        this.classList.remove('editing');
        // Save username to localStorage when user finishes editing
        localStorage.setItem('lastUsername', this.value);
    });
}

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

// Add a state variable for modloader visibility
let showModloaders = localStorage.getItem('showModloaders') === 'true';

// Double-shift detection for quick Fabric version switching
let lastShiftTime = 0;
const DOUBLE_SHIFT_THRESHOLD = 500;

document.addEventListener('keydown', (e) => {
    if (e.key === 'Shift') {
        const now = Date.now();
        if (now - lastShiftTime < DOUBLE_SHIFT_THRESHOLD && lastShiftTime > 0) {
            lastShiftTime = 0;
            handleDoubleShift();
        } else {
            lastShiftTime = now;
        }
    }
});

async function handleDoubleShift() {
    const currentVersion = versionElement?.getAttribute('data-version');
    if (!currentVersion) return;

    // Toggle: if on Fabric, switch back to vanilla; if on vanilla, switch to Fabric
    const fabricMatch = currentVersion.match(/fabric-loader-[\d.]+-(.+)/);
    if (fabricMatch) {
        // Currently on Fabric → switch back to vanilla
        const vanillaVersion = fabricMatch[1];
        versionElement.textContent = vanillaVersion;
        versionElement.setAttribute('data-version', vanillaVersion);
        localStorage.setItem('lastVersion', vanillaVersion);
        window.minecraft.logger.info(`Switched back to vanilla: ${vanillaVersion}`);
        return;
    }

    // Currently on vanilla → fetch latest Fabric loader and switch/install
    const fabricVersions = await window.minecraft.modloaders.getFabricVersions();
    if (!fabricVersions || fabricVersions.length === 0) return;

    const latestStable = fabricVersions.find(v => v.stable) || fabricVersions[0];
    if (!latestStable) return;

    const fabricVersionId = `fabric-loader-${latestStable.version}-${currentVersion}`;

    // Check if Fabric version already exists
    const versions = await fetchVersions();
    const existingFabric = versions.find(v => v.id === fabricVersionId);

    if (existingFabric) {
        versionElement.textContent = fabricVersionId;
        versionElement.setAttribute('data-version', fabricVersionId);
        localStorage.setItem('lastVersion', fabricVersionId);
        showModloaders = true;
        localStorage.setItem('showModloaders', 'true');
        window.minecraft.logger.info(`Switched to Fabric: ${fabricVersionId}`);
    } else {
        showProgress(true);
        updateProgress(10, `Installing Fabric ${latestStable.version} for ${currentVersion}...`);

        const result = await window.minecraft.modloaders.installFabric(currentVersion, latestStable.version);

        if (result.success) {
            updateProgress(100, `Fabric ${latestStable.version} installed for ${currentVersion}`);

            versionElement.textContent = fabricVersionId;
            versionElement.setAttribute('data-version', fabricVersionId);
            localStorage.setItem('lastVersion', fabricVersionId);
            showModloaders = true;
            localStorage.setItem('showModloaders', 'true');

            setTimeout(() => showProgress(false), 1500);
            fetchVersions();
        } else {
            showProgress(false);
            showConfirmDialog('Installation Failed', result.error || 'Failed to install Fabric');
        }
    }
}

// Update the version element click handler to detect Shift key and toggle modloaders
versionElement.addEventListener('click', async (event) => {
    // Toggle modloader visibility when Shift is pressed
    if (event.shiftKey) {
        showModloaders = !showModloaders;
        localStorage.setItem('showModloaders', showModloaders);
        window.minecraft.logger.info(`${showModloaders ? 'Enabled' : 'Disabled'} custom modloaders`);
    }
    
    window.minecraft.logger.info('Fetching Minecraft versions...');
    const versions = await fetchVersions();
    window.minecraft.logger.info(`Found ${versions.length} versions`);
    
    // Clear existing dropdown content
    dropdown.innerHTML = '';
    
    // Filter versions based on preference
    let filteredVersions = versions;
    if (!showModloaders) {
        filteredVersions = versions.filter(v => 
            !v.id.includes('fabric') && 
            !v.id.includes('forge') && 
            !v.id.includes('quilt') &&
            v.type !== 'fabric' && 
            v.type !== 'forge' && 
            v.type !== 'quilt'
        );
    }
    
    // Sort versions - modloaders first, then vanilla
    const moddedVersions = [];
    const vanillaVersions = [];
    
    // Split into modded and vanilla arrays
    filteredVersions.forEach(v => {
        const isFabric = v.id.includes('fabric') || v.type === 'fabric';
        const isForge = v.id.includes('forge') || v.type === 'forge';
        const isQuilt = v.id.includes('quilt');
        
        if (isFabric || isForge || isQuilt) {
            moddedVersions.push(v);
        } else {
            vanillaVersions.push(v);
        }
    });
    
    // Sort each array separately
    moddedVersions.sort((a, b) => compareVersions(a.id, b.id));
    vanillaVersions.sort((a, b) => compareVersions(a.id, b.id));
    
    // Combine into a single sorted array (modded first, then vanilla)
    const sortedVersions = [...moddedVersions, ...vanillaVersions];
    
    // Add notification about Shift key if no modloaders are shown
    if (!showModloaders && moddedVersions.length > 0) {
        dropdown.insertAdjacentHTML('beforeend', 
            `<div class="version-item hint-item">
                <span style="color: #888; font-style: italic; font-size: 0.9em;">
                    Hold Shift and click to show modloaders
                </span>
             </div>`
        );
    }
    
    // Add versions to dropdown with modloader indicators
    sortedVersions.forEach(v => {
        // Determine if this is a modded version
        const isFabric = v.id.includes('fabric') || v.type === 'fabric';
        const isForge = v.id.includes('forge') || v.type === 'forge';
        const isQuilt = v.id.includes('quilt');
        
        // Add CSS class based on modloader type
        const typeClass = isFabric ? 'fabric-version' : 
                         isForge ? 'forge-version' : 
                         isQuilt ? 'quilt-version' : '';
        
        // Add badge based on modloader type
        const typeBadge = isFabric ? '<span class="version-badge fabric">Fabric</span>' : 
                         isForge ? '<span class="version-badge forge">Forge</span>' : 
                         isQuilt ? '<span class="version-badge quilt">Quilt</span>' : '';
        
        // Extract clean version number for display
        let displayVersion = v.id;
        
        // Handle complex Fabric version strings (fabric-loader-x.x.x-mcversion)
        if (isFabric) {
            // Check for the pattern fabric-loader-x.x.x-mcversion
            const fabricPattern = /fabric-loader-[\d\.]+-(\d+\.\d+(?:\.\d+)?)/;
            const fabricMatch = v.id.match(fabricPattern);
            
            if (fabricMatch && fabricMatch[1]) {
                // Extract just the Minecraft version part
                displayVersion = fabricMatch[1];
            } else if (v.id.includes('fabric-')) {
                // Fallback to the simpler pattern if needed
                displayVersion = v.id.replace('fabric-', '');
            }
        } else if (isForge && v.id.includes('forge-')) {
            displayVersion = v.id.replace('forge-', '');
        } else if (isQuilt && v.id.includes('quilt-')) {
            displayVersion = v.id.replace('quilt-', '');
        }
        
        // Store the version ID in data-version attribute without any modifications
        dropdown.insertAdjacentHTML('beforeend', 
            `<div class="version-item ${typeClass}" data-version="${v.id}" data-type="${v.type || 'vanilla'}">
                ${typeBadge}
                <span class="version-text">${displayVersion}</span>
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
    settingsClose = document.querySelector('#settingsModal .modal-close');
    
    // Initialize toggle references
    offlineToggle = document.getElementById('offline-toggle');
    skipVerificationToggle = document.getElementById('skip-verification-toggle');
    
    // Initialize RAM settings
    await initializeRamSettings();
    
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
    if (savedUsername && usernameInput) {
        usernameInput.value = savedUsername;
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
    
    // Load modloader preference
    showModloaders = localStorage.getItem('showModloaders') === 'true';
    window.minecraft.logger.info(`Custom modloaders are ${showModloaders ? 'enabled' : 'disabled'}`);

    // Initialize all settings tabs
    initSettings();
    
    // Play button handler
    document.querySelector('.play-button')?.addEventListener('click', playGame);
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
    if (!themeName) themeName = 'light';
    
    if (themeName === 'light') {
        document.body.removeAttribute('data-theme');
    } else {
        document.body.setAttribute('data-theme', themeName);
    }
    
    localStorage.setItem('theme', themeName);
    
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.checked = (themeName === 'dark');
    }
    
    window.minecraft.logger.info(`Applied theme: ${themeName}`);
}

function initSettings() {
    // === Game Tab ===
    const ramSlider = document.getElementById('ram-slider');
    const ramValue = document.getElementById('ram-value');
    if (ramSlider && ramValue) {
        const savedRam = localStorage.getItem('maxRam') || '2048';
        ramSlider.value = savedRam;
        ramValue.textContent = savedRam + ' MB';
        ramSlider.addEventListener('input', () => {
            const val = ramSlider.value;
            ramValue.textContent = val + ' MB';
            localStorage.setItem('maxRam', val);
            const advMaxRam = document.getElementById('adv-max-ram');
            const advMaxRamVal = document.getElementById('adv-max-ram-value');
            if (advMaxRam && advMaxRamVal) {
                advMaxRam.value = val;
                advMaxRamVal.textContent = val + ' MB';
            }
            // Ensure max >= min
            const minRam = document.getElementById('game-min-ram');
            if (minRam && parseInt(val) < parseInt(minRam.value)) {
                minRam.value = val;
                document.getElementById('game-min-ram-value').textContent = val + ' MB';
                localStorage.setItem('minRam', val);
                const advMinRam = document.getElementById('adv-min-ram');
                const advMinRamVal = document.getElementById('adv-min-ram-value');
                if (advMinRam && advMinRamVal) {
                    advMinRam.value = val;
                    advMinRamVal.textContent = val + ' MB';
                }
            }
        });
    }
    
    const fullscreenToggle = document.getElementById('fullscreen-toggle');
    if (fullscreenToggle) {
        fullscreenToggle.checked = localStorage.getItem('fullscreen') === 'true';
        fullscreenToggle.addEventListener('change', () => {
            localStorage.setItem('fullscreen', fullscreenToggle.checked);
        });
    }
    
    if (offlineToggle) {
        offlineToggle.addEventListener('change', () => {
            offlineMode = offlineToggle.checked;
            localStorage.setItem('offlineMode', offlineMode);
            if (skipVerificationToggle) {
                skipVerificationToggle.disabled = !offlineMode;
            }
        });
    }
    
    if (skipVerificationToggle) {
        skipVerificationToggle.addEventListener('change', () => {
            skipVerification = skipVerificationToggle.checked;
            localStorage.setItem('skipVerification', skipVerification);
        });
    }
    
    // Game Min RAM (sync with advanced)
    const gameMinRam = document.getElementById('game-min-ram');
    const gameMinRamVal = document.getElementById('game-min-ram-value');
    if (gameMinRam && gameMinRamVal) {
        const v = localStorage.getItem('minRam') || '512';
        gameMinRam.value = v;
        gameMinRamVal.textContent = v + ' MB';
        gameMinRam.addEventListener('input', () => {
            const val = gameMinRam.value;
            gameMinRamVal.textContent = val + ' MB';
            localStorage.setItem('minRam', val);
            const advMinRam = document.getElementById('adv-min-ram');
            const advMinRamVal = document.getElementById('adv-min-ram-value');
            if (advMinRam && advMinRamVal) {
                advMinRam.value = val;
                advMinRamVal.textContent = val + ' MB';
            }
            // Ensure min <= max
            const maxRam = document.getElementById('ram-slider');
            if (maxRam && parseInt(val) > parseInt(maxRam.value)) {
                maxRam.value = val;
                document.getElementById('ram-value').textContent = val + ' MB';
                localStorage.setItem('maxRam', val);
                const advMaxRam = document.getElementById('adv-max-ram');
                const advMaxRamVal = document.getElementById('adv-max-ram-value');
                if (advMaxRam && advMaxRamVal) {
                    advMaxRam.value = val;
                    advMaxRamVal.textContent = val + ' MB';
                }
            }
        });
    }
    
    // Display width/height (sync with advanced)
    const gameWinWidth = document.getElementById('game-win-width');
    if (gameWinWidth) {
        gameWinWidth.value = localStorage.getItem('gameWidth') || '854';
        gameWinWidth.addEventListener('change', () => {
            localStorage.setItem('gameWidth', gameWinWidth.value);
            document.getElementById('gameWidth').value = gameWinWidth.value;
        });
    }
    const gameWinHeight = document.getElementById('game-win-height');
    if (gameWinHeight) {
        gameWinHeight.value = localStorage.getItem('gameHeight') || '480';
        gameWinHeight.addEventListener('change', () => {
            localStorage.setItem('gameHeight', gameWinHeight.value);
            document.getElementById('gameHeight').value = gameWinHeight.value;
        });
    }
    
    // Server auto-join
    const gameServerAddr = document.getElementById('game-server-address');
    if (gameServerAddr) {
        gameServerAddr.value = localStorage.getItem('gameServerAddress') || '';
        gameServerAddr.addEventListener('change', () => localStorage.setItem('gameServerAddress', gameServerAddr.value));
    }
    const gameServerPort = document.getElementById('game-server-port');
    if (gameServerPort) {
        gameServerPort.value = localStorage.getItem('gameServerPort') || '25565';
        gameServerPort.addEventListener('change', () => localStorage.setItem('gameServerPort', gameServerPort.value));
    }
    
    // Game arguments
    const gameArgs = document.getElementById('game-args');
    if (gameArgs) {
        gameArgs.value = localStorage.getItem('gameArgs') || '';
        gameArgs.addEventListener('change', () => localStorage.setItem('gameArgs', gameArgs.value));
    }
    
    // Skip title screen
    const skipTitle = document.getElementById('game-skip-title');
    if (skipTitle) {
        skipTitle.checked = localStorage.getItem('skipTitleScreen') === 'true';
        skipTitle.addEventListener('change', () => localStorage.setItem('skipTitleScreen', skipTitle.checked));
    }
    
    // Demo mode
    const demoMode = document.getElementById('game-demo-mode');
    if (demoMode) {
        demoMode.checked = localStorage.getItem('demoMode') === 'true';
        demoMode.addEventListener('change', () => localStorage.setItem('demoMode', demoMode.checked));
    }
    
    // Native launcher
    const nativeLauncher = document.getElementById('game-native-launcher');
    if (nativeLauncher) {
        nativeLauncher.checked = localStorage.getItem('nativeLauncher') === 'true';
        nativeLauncher.addEventListener('change', () => localStorage.setItem('nativeLauncher', nativeLauncher.checked));
    }
    
    // === Appearance Tab ===
    const savedTheme = localStorage.getItem('theme') || 'light';
    document.querySelectorAll('.theme-card').forEach(card => {
        if (card.dataset.theme === savedTheme) {
            card.classList.add('active');
        }
        card.addEventListener('click', () => {
            document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            applyTheme(card.dataset.theme);
        });
    });
    
    // === Servers Tab ===
    const serverForm = document.getElementById('serverForm');
    if (serverForm) {
        serverForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('serverName').value.trim();
            const version = document.getElementById('serverVersion').value;
            const port = parseInt(document.getElementById('serverPort').value) || 25565;
            const memory = parseInt(document.getElementById('serverMemory').value) || 2048;
            const maxPlayers = parseInt(document.getElementById('maxPlayers').value) || 20;
            const viewDistance = parseInt(document.getElementById('viewDistance').value) || 10;
            const difficulty = document.getElementById('difficulty').value;
            const gamemode = document.getElementById('gamemode').value;
            const pvp = document.getElementById('pvp').checked;
            const spawnAnimals = document.getElementById('spawnAnimals').checked;
            const spawnMonsters = document.getElementById('spawnMonsters').checked;
            
            try {
                const result = await window.minecraft.server.create({
                    name, version, port, memory, maxPlayers,
                    viewDistance, difficulty, gamemode,
                    pvp, spawnAnimals, spawnMonsters
                });
                if (result.success) {
                    loadServers();
                    serverForm.reset();
                }
            } catch (err) {
                window.minecraft.logger.error('Failed to create server:', err);
            }
        });
    }
    
    // Populate server version dropdown
    const versionSelect = document.getElementById('serverVersion');
    if (versionSelect) {
        (async () => {
            try {
                const versions = await window.minecraft.getVersions();
                if (versions) {
                    const releaseTypes = ['release', 'snapshot'];
                    versions
                        .filter(v => releaseTypes.includes(v.type))
                        .sort((a, b) => compareVersions(a.id, b.id))
                        .forEach(v => {
                            const opt = document.createElement('option');
                            opt.value = v.id;
                            opt.textContent = v.id;
                            versionSelect.appendChild(opt);
                        });
                }
            } catch (err) {
                window.minecraft.logger.error('Failed to load versions for server:', err);
            }
        })();
    }
    
    loadServers();
    
    window.minecraft.server.onLog((data) => {
        const logContent = document.getElementById('serverLogContent');
        if (!logContent) return;
        const line = document.createElement('div');
        line.className = 'server-log-entry ' + (data.level || 'info');
        line.textContent = data.message || data;
        logContent.appendChild(line);
        line.scrollIntoView({ behavior: 'smooth' });
    });
    
    // Refresh server list periodically
    setInterval(loadServers, 5000);
    
    const clearLogsBtn = document.querySelector('.clear-logs');
    if (clearLogsBtn) {
        clearLogsBtn.addEventListener('click', () => {
            document.getElementById('serverLogContent').textContent = '';
        });
    }
    
    // === Advanced Tab ===
    // Java & Memory
    const advMinRam = document.getElementById('adv-min-ram');
    const advMinRamVal = document.getElementById('adv-min-ram-value');
    if (advMinRam && advMinRamVal) {
        const v = localStorage.getItem('minRam') || '512';
        advMinRam.value = v;
        advMinRamVal.textContent = v + ' MB';
        advMinRam.addEventListener('input', () => {
            const val = advMinRam.value;
            advMinRamVal.textContent = val + ' MB';
            localStorage.setItem('minRam', val);
            // Sync back to Game tab
            const gameMinRam = document.getElementById('game-min-ram');
            const gameMinRamVal = document.getElementById('game-min-ram-value');
            if (gameMinRam && gameMinRamVal) {
                gameMinRam.value = val;
                gameMinRamVal.textContent = val + ' MB';
            }
            // Ensure min <= max
            const maxRam = document.getElementById('ram-slider');
            if (maxRam && parseInt(val) > parseInt(maxRam.value)) {
                maxRam.value = val;
                document.getElementById('ram-value').textContent = val + ' MB';
                localStorage.setItem('maxRam', val);
                const advMaxRam = document.getElementById('adv-max-ram');
                const advMaxRamVal = document.getElementById('adv-max-ram-value');
                if (advMaxRam && advMaxRamVal) {
                    advMaxRam.value = val;
                    advMaxRamVal.textContent = val + ' MB';
                }
            }
        });
    }
    
    const advMaxRam = document.getElementById('adv-max-ram');
    const advMaxRamVal = document.getElementById('adv-max-ram-value');
    if (advMaxRam && advMaxRamVal) {
        const v = localStorage.getItem('maxRam') || '2048';
        advMaxRam.value = v;
        advMaxRamVal.textContent = v + ' MB';
        advMaxRam.addEventListener('input', () => {
            const val = advMaxRam.value;
            advMaxRamVal.textContent = val + ' MB';
            localStorage.setItem('maxRam', val);
            // Sync back to Game tab
            document.getElementById('ram-value').textContent = val + ' MB';
            document.getElementById('ram-slider').value = val;
            // Ensure max >= min
            const minRam = document.getElementById('game-min-ram');
            if (minRam && parseInt(val) < parseInt(minRam.value)) {
                minRam.value = val;
                document.getElementById('game-min-ram-value').textContent = val + ' MB';
                localStorage.setItem('minRam', val);
                const advMinRam = document.getElementById('adv-min-ram');
                const advMinRamVal = document.getElementById('adv-min-ram-value');
                if (advMinRam && advMinRamVal) {
                    advMinRam.value = val;
                    advMinRamVal.textContent = val + ' MB';
                }
            }
        });
    }
    
    const gcType = document.getElementById('gcType');
    if (gcType) {
        gcType.value = localStorage.getItem('gcType') || 'G1GC';
        gcType.addEventListener('change', () => localStorage.setItem('gcType', gcType.value));
    }
    
    const javaPath = document.getElementById('javaPath');
    if (javaPath) {
        javaPath.value = localStorage.getItem('javaPath') || '';
        javaPath.addEventListener('change', () => localStorage.setItem('javaPath', javaPath.value));
    }
    
    document.getElementById('detectJavaBtn')?.addEventListener('click', async () => {
        try {
            const result = await window.minecraft.checkJava({});
            if (result.installed && result.path) {
                javaPath.value = result.path;
                localStorage.setItem('javaPath', result.path);
            }
        } catch {}
    });
    
    const jvmArgs = document.getElementById('jvmArgs');
    if (jvmArgs) {
        jvmArgs.value = localStorage.getItem('jvmArgs') || '';
        jvmArgs.addEventListener('change', () => localStorage.setItem('jvmArgs', jvmArgs.value));
    }
    
    // Game
    const gameWidth = document.getElementById('gameWidth');
    if (gameWidth) {
        gameWidth.value = localStorage.getItem('gameWidth') || '854';
        gameWidth.addEventListener('change', () => localStorage.setItem('gameWidth', gameWidth.value));
    }
    
    const gameHeight = document.getElementById('gameHeight');
    if (gameHeight) {
        gameHeight.value = localStorage.getItem('gameHeight') || '480';
        gameHeight.addEventListener('change', () => localStorage.setItem('gameHeight', gameHeight.value));
    }
    
    const gameDir = document.getElementById('gameDir');
    if (gameDir) {
        gameDir.value = localStorage.getItem('gameDir') || '';
        gameDir.addEventListener('change', () => localStorage.setItem('gameDir', gameDir.value));
    }
    
    document.getElementById('browseGameDir')?.addEventListener('click', async () => {
        try {
            const result = await window.minecraft.system.selectDirectory();
            if (result) {
                gameDir.value = result;
                localStorage.setItem('gameDir', result);
            }
        } catch {}
    });
    
    // Launcher
    const closeAfterLaunch = document.getElementById('closeAfterLaunch');
    if (closeAfterLaunch) {
        closeAfterLaunch.checked = localStorage.getItem('closeAfterLaunch') === 'true';
        closeAfterLaunch.addEventListener('change', () => localStorage.setItem('closeAfterLaunch', closeAfterLaunch.checked));
    }
    
    const minimizeToTray = document.getElementById('minimizeToTray');
    if (minimizeToTray) {
        minimizeToTray.checked = localStorage.getItem('minimizeToTray') === 'true';
        minimizeToTray.addEventListener('change', () => localStorage.setItem('minimizeToTray', minimizeToTray.checked));
    }
    
    const discordRpc = document.getElementById('discordRpc');
    if (discordRpc) {
        discordRpc.checked = localStorage.getItem('discordRpc') === 'true';
        discordRpc.addEventListener('change', () => localStorage.setItem('discordRpc', discordRpc.checked));
    }
    
    const checkUpdates = document.getElementById('checkUpdates');
    if (checkUpdates) {
        checkUpdates.checked = localStorage.getItem('checkUpdates') !== 'false';
        checkUpdates.addEventListener('change', () => localStorage.setItem('checkUpdates', checkUpdates.checked));
    }
    
    // Network
    const downloadThreads = document.getElementById('downloadThreads');
    if (downloadThreads) {
        downloadThreads.value = localStorage.getItem('downloadThreads') || '4';
        downloadThreads.addEventListener('change', () => localStorage.setItem('downloadThreads', downloadThreads.value));
    }
    
    const connectionTimeout = document.getElementById('connectionTimeout');
    if (connectionTimeout) {
        connectionTimeout.value = localStorage.getItem('connectionTimeout') || '30';
        connectionTimeout.addEventListener('change', () => localStorage.setItem('connectionTimeout', connectionTimeout.value));
    }
    
    // Diagnostics
    const devConsole = document.getElementById('devConsole');
    if (devConsole) {
        devConsole.checked = localStorage.getItem('devConsole') === 'true';
        devConsole.addEventListener('change', () => {
            localStorage.setItem('devConsole', devConsole.checked);
            document.querySelector('.debug-panel').style.display = devConsole.checked ? 'block' : 'none';
        });
    }
    
    const verboseLogging = document.getElementById('verboseLogging');
    if (verboseLogging) {
        verboseLogging.checked = localStorage.getItem('verboseLogging') === 'true';
        verboseLogging.addEventListener('change', () => localStorage.setItem('verboseLogging', verboseLogging.checked));
    }
    
    const logLevel = document.getElementById('logLevel');
    if (logLevel) {
        logLevel.value = localStorage.getItem('logLevel') || 'info';
        logLevel.addEventListener('change', () => localStorage.setItem('logLevel', logLevel.value));
    }
    
    const gameProfiler = document.getElementById('gameProfiler');
    if (gameProfiler) {
        gameProfiler.checked = localStorage.getItem('gameProfiler') === 'true';
        gameProfiler.addEventListener('change', () => localStorage.setItem('gameProfiler', gameProfiler.checked));
    }
    
    const crashReportBehavior = document.getElementById('crashReportBehavior');
    if (crashReportBehavior) {
        crashReportBehavior.value = localStorage.getItem('crashReportBehavior') || 'prompt';
        crashReportBehavior.addEventListener('change', () => localStorage.setItem('crashReportBehavior', crashReportBehavior.value));
    }
    
    // Storage (cache buttons)
    document.getElementById('clearAssetCache')?.addEventListener('click', async () => {
        try {
            await window.minecraft.clearCache('assets');
            window.minecraft.logger.info('Asset cache cleared');
        } catch (err) {
            window.minecraft.logger.error('Failed to clear asset cache:', err);
        }
    });
    
    document.getElementById('clearLibraryCache')?.addEventListener('click', async () => {
        try {
            await window.minecraft.clearCache('libraries');
            window.minecraft.logger.info('Library cache cleared');
        } catch (err) {
            window.minecraft.logger.error('Failed to clear library cache:', err);
        }
    });
    
    document.getElementById('clearAllCache')?.addEventListener('click', async () => {
        try {
            await window.minecraft.clearCache('all');
            window.minecraft.logger.info('All cache cleared');
        } catch (err) {
            window.minecraft.logger.error('Failed to clear all cache:', err);
        }
    });
    
    // Data
    document.getElementById('exportSettings')?.addEventListener('click', () => {
        const keys = ['maxRam', 'minRam', 'fullscreen', 'offlineMode', 'skipVerification', 'jvmArgs', 'gcType', 'javaPath', 'theme', 'gameWidth', 'gameHeight', 'gameDir', 'closeAfterLaunch', 'minimizeToTray', 'discordRpc', 'checkUpdates', 'downloadThreads', 'connectionTimeout', 'devConsole', 'verboseLogging', 'logLevel', 'gameProfiler', 'crashReportBehavior', 'gameServerAddress', 'gameServerPort', 'gameArgs', 'skipTitleScreen', 'demoMode', 'nativeLauncher', 'lastVersion', 'showModloaders'];
        const data = {};
        keys.forEach(k => { const v = localStorage.getItem(k); if (v !== null) data[k] = v; });
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'alrightlauncher-settings.json';
        a.click();
        URL.revokeObjectURL(a.href);
    });
    
    document.getElementById('importSettings')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            try {
                const text = await e.target.files[0].text();
                const data = JSON.parse(text);
                Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
                window.minecraft.logger.info('Settings imported');
                location.reload();
            } catch (err) {
                window.minecraft.logger.error('Failed to import settings:', err);
            }
        };
        input.click();
    });
    
    // Danger Zone
    document.getElementById('resetSettings')?.addEventListener('click', () => {
        const keys = ['maxRam', 'minRam', 'fullscreen', 'offlineMode', 'skipVerification', 'jvmArgs', 'gcType', 'javaPath', 'theme', 'gameWidth', 'gameHeight', 'gameDir', 'closeAfterLaunch', 'minimizeToTray', 'discordRpc', 'checkUpdates', 'downloadThreads', 'connectionTimeout', 'devConsole', 'verboseLogging', 'logLevel', 'gameProfiler', 'crashReportBehavior', 'gameServerAddress', 'gameServerPort', 'gameArgs', 'skipTitleScreen', 'demoMode', 'nativeLauncher', 'lastVersion', 'showModloaders'];
        keys.forEach(k => localStorage.removeItem(k));
        window.minecraft.logger.info('All settings reset to defaults');
        location.reload();
    });
    
    // World Manager
    document.getElementById('openWorldManager')?.addEventListener('click', openWorldManager);

    // Crash Reports
    document.getElementById('openCrashReports')?.addEventListener('click', openCrashReports);

    // Benchmark
    document.getElementById('runBenchmark')?.addEventListener('click', runBenchmark);
    document.getElementById('viewBenchmarkHistory')?.addEventListener('click', openBenchmarkHistory);

    // Set up crash toast
    setupCrashToast();

    // Generic modal close: any .modal-close inside a .modal closes its parent
    document.querySelectorAll('.modal .modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            const modal = btn.closest('.modal');
            if (modal) modal.classList.remove('active');
        });
    });
    // Close modal on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    });

    // About
    (async () => {
        const dirEl = document.getElementById('aboutMinecraftDir');
        if (dirEl) {
            try {
                dirEl.textContent = await window.minecraft.system.getMinecraftDir();
            } catch {
                dirEl.textContent = 'Unknown';
            }
        }
        const javaVerEl = document.getElementById('aboutJavaVersion');
        if (javaVerEl) {
            try {
                const result = await window.minecraft.checkJava({});
                javaVerEl.textContent = result.version || result.installed ? 'Detected' : 'Not found';
            } catch {
                javaVerEl.textContent = 'Unknown';
            }
        }
        const memEl = document.getElementById('aboutSystemMemory');
        if (memEl) {
            const mem = navigator.deviceMemory || 0;
            memEl.textContent = mem ? `${mem} GB` : 'Unknown';
        }
    })();
}

async function loadServers() {
    const serverList = document.getElementById('serverList');
    if (!serverList) return;
    
    const existingItems = serverList.querySelector('.server-list-items');
    if (existingItems) existingItems.remove();
    
    const container = document.createElement('div');
    container.className = 'server-list-items';
    
    try {
        const servers = await window.minecraft.server.list();
        if (!servers || servers.length === 0) {
            container.innerHTML = '<div class="no-servers">No servers created yet</div>';
            serverList.appendChild(container);
            return;
        }
        
        servers.forEach(s => {
            const item = document.createElement('div');
            item.className = 'server-item';
            item.dataset.server = s.name;
            item.innerHTML = `
                <span class="status-dot ${s.running ? 'running' : 'stopped'}"></span>
                <div class="server-info">
                    <span class="name">${s.name}</span>
                    <span class="meta">${s.version || '?'} · ${s.port || '25565'}</span>
                </div>
                <div class="server-actions">
                    <button class="server-action-btn start">Start</button>
                    <button class="server-action-btn stop">Stop</button>
                    <button class="server-action-btn delete">✕</button>
                </div>
            `;
            
            item.querySelector('.start')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await window.minecraft.server.start(s.name, s.memory || 2048);
                } catch (err) {
                    window.minecraft.logger.error(`Failed to start server ${s.name}:`, err);
                }
            });
            
            item.querySelector('.stop')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await window.minecraft.server.stop(s.name);
                } catch (err) {
                    window.minecraft.logger.error(`Failed to stop server ${s.name}:`, err);
                }
            });
            
            item.querySelector('.delete')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                try {
                    await window.minecraft.server.delete(s.name);
                    loadServers();
                } catch (err) {
                    window.minecraft.logger.error(`Failed to delete server ${s.name}:`, err);
                }
            });
            
            item.addEventListener('click', () => {
                document.querySelectorAll('.server-item').forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                document.getElementById('logHeader').textContent = s.name + ' Console';
            });
            
            container.appendChild(item);
        });
    } catch (err) {
        container.innerHTML = '<div class="no-servers">Failed to load servers</div>';
    }
    
    serverList.appendChild(container);
}

// Add these global variables at the top of the file
let gameRunning = false;
let launchInProgress = false;

function showConfirmDialog(title, message, confirmText = 'Yes', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        let backdrop = document.getElementById('confirmBackdrop');
        if (!backdrop) {
            backdrop = document.createElement('div');
            backdrop.id = 'confirmBackdrop';
            backdrop.className = 'modal-backdrop-global';
            document.body.appendChild(backdrop);
        }

        let modal = document.getElementById('confirmModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'confirmModal';
            modal.className = 'modal';
            modal.style.zIndex = '4000';
            modal.innerHTML = `
                <div class="modal-content" style="max-width: 450px; text-align: center;">
                    <div class="modal-header">
                        <h2 id="confirmTitle" style="margin: 0;"></h2>
                        <button class="modal-close" id="confirmCloseBtn">&times;</button>
                    </div>
                    <div class="modal-body">
                        <p id="confirmMessage" style="line-height: 1.6; white-space: pre-line;"></p>
                    </div>
                    <div class="modal-footer" style="justify-content: center;">
                        <button id="confirmCancelBtn" class="modal-button secondary"></button>
                        <button id="confirmOkBtn" class="modal-button primary"></button>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = message;
        document.getElementById('confirmOkBtn').textContent = confirmText;
        document.getElementById('confirmCancelBtn').textContent = cancelText;

        const okBtn = document.getElementById('confirmOkBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');
        const closeBtn = document.getElementById('confirmCloseBtn');

        const cleanup = () => {
            backdrop.style.display = 'none';
            modal.classList.remove('active');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            closeBtn.removeEventListener('click', onCancel);
        };

        const onOk = () => { cleanup(); resolve(true); };
        const onCancel = () => { cleanup(); resolve(false); };
        const onBackdropClick = () => { cleanup(); resolve(false); };

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
        closeBtn.addEventListener('click', onCancel);
        backdrop.addEventListener('click', onBackdropClick);

        backdrop.style.display = 'block';
        modal.classList.add('active');
    });
}

async function ensureJavaInstalled(javaVersion = 21) {
    const javaCheck = await window.minecraft.checkJava({ minVersion: javaVersion });
    if (javaCheck.installed) return true;

    const progressOverlay = document.getElementById('progressOverlay');
    const wasProgressShown = progressOverlay && progressOverlay.style.display !== 'none';
    if (wasProgressShown) {
        showProgress(false);
    }

    const installConfirmed = await showConfirmDialog(
        'Java Required',
        `This Minecraft version requires Java ${javaVersion}.\n\nWould you like to install Eclipse Temurin ${javaVersion} JRE automatically?`,
        'Install Java',
        'Cancel'
    );

    if (!installConfirmed) {
        if (wasProgressShown) showProgress(true);
        throw new Error(`Java ${javaVersion} is required to play this Minecraft version. Please install Java ${javaVersion} and try again.`);
    }

    if (wasProgressShown) showProgress(true);
    updateProgress(40, `Downloading Eclipse Temurin ${javaVersion} JRE...`);

    return new Promise((resolve, reject) => {
        window.minecraft.onJavaInstallProgress((progress) => {
            if (progress.type === 'download') {
                updateProgress(
                    40 + Math.floor(progress.progress * 0.2),
                    'Downloading Java...',
                    `${Math.floor(progress.progress)}%`
                );
            } else if (progress.type === 'status') {
                updateProgress(60, progress.message || 'Installing...');
            } else if (progress.type === 'error') {
                console.error('Java install error:', progress.message);
            }
        });

        window.minecraft.installJava({ javaVersion }).then((result) => {
            if (result && result.success) {
                updateProgress(70, 'Java installed!');
                resolve(true);
            } else {
                reject(new Error((result && result.error) || 'Java installation failed'));
            }
        }).catch((err) => {
            reject(new Error(`Java installation failed: ${err.message}`));
        });
    });
}

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
    
    // Get username from input value instead of textContent
    const username = usernameInput ? usernameInput.value : 'Player';
    
    // Get RAM allocation from localStorage
    const maxRam = parseInt(localStorage.getItem('maxRam')) || 2048;
    
    // Save both values when launching the game
    localStorage.setItem('lastUsername', username);
    localStorage.setItem('lastVersion', version);
    
    // Log the exact version being launched
    window.minecraft.logger.info(`Launching version: ${version} with ${maxRam}MB RAM`);
    
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
        
        updateProgress(35, 'Checking Java requirements...');
        let javaReqVer = 21;
        try {
            const javaInfo = await window.minecraft.getRequiredJavaVersion(version);
            javaReqVer = javaInfo.version || 21;
        } catch (e) { /* use default */ }
        updateProgress(40, `Checking Java ${javaReqVer} installation...`);
        await ensureJavaInstalled(javaReqVer);
        
        updateProgress(60, 'Launching game...');
        const launched = await window.minecraft.launchGame(version, username, { 
            offline: offlineMode,
            maxRam: maxRam,
            minRam: parseInt(localStorage.getItem('minRam')) || 512,
            jvmArgs: localStorage.getItem('jvmArgs') || '',
            gameArgs: localStorage.getItem('gameArgs') || '',
            serverAddress: localStorage.getItem('gameServerAddress') || '',
            serverPort: parseInt(localStorage.getItem('gameServerPort')) || 25565,
            skipTitleScreen: localStorage.getItem('skipTitleScreen') === 'true',
            demoMode: localStorage.getItem('demoMode') === 'true',
            nativeLauncher: localStorage.getItem('nativeLauncher') === 'true',
            gameWidth: parseInt(localStorage.getItem('gameWidth')) || 854,
            gameHeight: parseInt(localStorage.getItem('gameHeight')) || 480,
        });
        
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

async function initializeAuth() {
    console.log('Initializing authentication UI');
    const usernameInput = document.getElementById('username-input');
    
    if (!usernameInput) {
        console.error('Username input not found. Authentication UI cannot be initialized.');
        return;
    }
    
    // Create and add login button if it doesn't exist
    loginButton = document.getElementById('ms-login-btn');
    if (!loginButton) {
        loginButton = document.createElement('button');
        loginButton.id = 'ms-login-btn';
        loginButton.className = 'ms-login-btn';
        loginButton.textContent = 'Login with Microsoft';
        
        // Add to the username container
        const container = usernameInput.parentElement;
        if (container) {
            container.appendChild(loginButton);
            
            // Also add a logout hint element
            const logoutHint = document.createElement('div');
            logoutHint.className = 'username-logout-hint';
            logoutHint.textContent = 'Click to log out';
            container.appendChild(logoutHint);
            
            console.log('Added login button and logout hint to username container');
        } else {
            console.error('Username container not found');
        }
    }
    
    // Add login button click handler
    loginButton.addEventListener('click', async function() {
        try {
            console.log('Login button clicked');
            loginButton.disabled = true;
            loginButton.textContent = 'Logging in...';
            
            console.log('Microsoft login clicked, sending auth request...');
            const profile = await window.minecraft.auth.login();
            
            // Enhanced error checking
            if (!profile || profile.error || !profile.name) {
                throw new Error(profile?.error || 'Login failed: Invalid or missing profile data');
            }
            
            console.log(`Successfully logged in as ${profile.name}`);
            updateUIForLoggedInUser(profile);
        } catch (error) {
            console.error('Login failed:', error);
            alert(`Login failed: ${error.message}`);
            
            // Reset button state
            loginButton.disabled = false;
            loginButton.textContent = 'Login with Microsoft';
        }
    });
    
    // Create a direct logout button for testing/debugging
    const debugLogoutBtn = document.createElement('button');
    debugLogoutBtn.id = 'debug-logout-btn';
    debugLogoutBtn.textContent = 'Force Logout';
    debugLogoutBtn.style.position = 'fixed';
    debugLogoutBtn.style.bottom = '10px';
    debugLogoutBtn.style.right = '10px';
    debugLogoutBtn.style.zIndex = '9999';
    debugLogoutBtn.style.padding = '5px';
    debugLogoutBtn.style.backgroundColor = '#f44336';
    debugLogoutBtn.style.color = 'white';
    debugLogoutBtn.style.border = 'none';
    debugLogoutBtn.style.borderRadius = '4px';
    debugLogoutBtn.style.cursor = 'pointer';
    debugLogoutBtn.style.display = 'none'; // Hidden by default
    
    document.body.appendChild(debugLogoutBtn);
    
    // Add debug logout button click handler
    debugLogoutBtn.addEventListener('click', async function() {
        try {
            console.log('Debug logout button clicked');
            debugLogoutBtn.disabled = true;
            debugLogoutBtn.textContent = 'Logging out...';
            
            const result = await window.minecraft.auth.logout();
            console.log('Logout result:', result);
            
            updateUIForLoggedOutUser();
            alert('You have been logged out (debug mode)');
            
            debugLogoutBtn.disabled = false;
            debugLogoutBtn.textContent = 'Force Logout';
        } catch (error) {
            console.error('Debug logout failed:', error);
            alert(`Logout failed: ${error.message}`);
            
            debugLogoutBtn.disabled = false;
            debugLogoutBtn.textContent = 'Force Logout';
        }
    });
    
    // Make debug button visible with Ctrl+Alt+Shift+D
    document.addEventListener('keydown', function(e) {
        if (e.ctrlKey && e.altKey && e.shiftKey && e.key.toLowerCase() === 'd') {
            debugLogoutBtn.style.display = debugLogoutBtn.style.display === 'none' ? 'block' : 'none';
            console.log('Debug logout button toggled:', debugLogoutBtn.style.display);
        }
    });
    
    // Global key state tracking with better debugging
    let ctrlShiftPressed = false;
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
            if (!ctrlShiftPressed) {
                console.log('Ctrl+Shift pressed');
                ctrlShiftPressed = true;
            }
            
            // Only show hover effect if authenticated
            if (isAuthenticated && usernameInput) {
                usernameInput.classList.add('ctrl-shift-hover');
                console.log('Added ctrl-shift-hover class to username input');
            }
        }
    });
    
    document.addEventListener('keyup', function(e) {
        // If either Ctrl/Cmd or Shift is released
        if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) {
            if (ctrlShiftPressed) {
                console.log('Ctrl+Shift released');
                ctrlShiftPressed = false;
            }
            
            if (usernameInput) {
                usernameInput.classList.remove('ctrl-shift-hover');
                console.log('Removed ctrl-shift-hover class from username input');
            }
        }
    });
    
    // Clear the state when window loses focus
    window.addEventListener('blur', function() {
        if (ctrlShiftPressed) {
            console.log('Window lost focus, clearing Ctrl+Shift state');
            ctrlShiftPressed = false;
            
            if (usernameInput) {
                usernameInput.classList.remove('ctrl-shift-hover');
                console.log('Removed ctrl-shift-hover class from username input');
            }
        }
    });
    
    // COMPLETELY NEW APPROACH: Use mousedown instead of click for more reliable detection
    usernameInput.addEventListener('mousedown', async function(e) {
        console.log('Username mousedown detected');
        console.log('Ctrl+Shift pressed:', ctrlShiftPressed);
        console.log('Authenticated:', isAuthenticated);
        
        // Only proceed if user is authenticated and Ctrl+Shift is pressed
        if (isAuthenticated && ctrlShiftPressed) {
            e.preventDefault(); // Prevent focus
            console.log('Ctrl+Shift+Click detected on username, attempting logout');
            
            // Add visual feedback immediately
            this.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
            
            // Use a confirm dialog to prevent accidental logout
            if (confirm('Are you sure you want to log out from your Microsoft account?')) {
                try {
                    this.style.backgroundColor = 'rgba(255, 150, 150, 0.5)';
                    console.log('Sending logout request...');
                    
                    // DIRECT API CALL with detailed logging
                    const response = await fetch('http://localhost:3000/api/logout', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    }).catch(err => {
                        console.log('Fetch API error:', err);
                        return null;
                    });
                    
                    console.log('Fetch response:', response);
                    
                    // Then try the built-in logout function
                    console.log('Calling window.minecraft.auth.logout()');
                    const result = await window.minecraft.auth.logout();
                    console.log('Logout result:', result);
                    
                    if (result === true) {
                        console.log('Logout successful, updating UI');
                        // Remove the ctrl-shift-hover class
                        this.classList.remove('ctrl-shift-hover');
                        // Clear custom styles
                        this.style.backgroundColor = '';
                        // Update UI
                        updateUIForLoggedOutUser();
                        // Show success message
                        alert('You have been successfully logged out.');
                    } else {
                        console.error('Logout returned false or unexpected value:', result);
                        throw new Error('Logout operation did not complete successfully');
                    }
                } catch (error) {
                    console.error('Logout error:', error);
                    console.error('Error stack:', error.stack);
                    
                    // Clear custom styles
                    this.style.backgroundColor = '';
                    alert(`Logout failed: ${error.message}. Check console for details.`);
                    
                    // Force logout UI as last resort
                    const forceLogout = confirm('Logout API failed. Would you like to force logout locally?');
                    if (forceLogout) {
                        console.log('Forcing local logout state');
                        updateUIForLoggedOutUser();
                    }
                }
            } else {
                // Clear custom styles if logout was cancelled
                this.style.backgroundColor = '';
                console.log('Logout cancelled by user');
            }
        }
    });
    
    // Add account button handler
    const addAccountBtn = document.getElementById('accountAddBtn');
    if (addAccountBtn) {
        addAccountBtn.addEventListener('click', async () => {
            try {
                const profile = await window.minecraft.auth.login();
                if (profile && !profile.error && profile.name) {
                    await window.accounts.add({
                        id: profile.id || profile.uuid || profile.name,
                        username: profile.name,
                        refreshToken: profile.refreshToken || null,
                        profile: profile
                    });
                    await loadAccounts();
                } else {
                    alert('Login failed: ' + (profile?.error || 'Invalid profile'));
                }
            } catch (e) {
                console.error('Add account failed:', e);
            }
        });
    }

    // Listen for profile updates from main process
    if (window.minecraft.auth.onProfileUpdate) {
        console.log('Setting up profile update listener');
        window.minecraft.auth.onProfileUpdate((profile) => {
            console.log('Profile update received:', profile);
            if (profile) {
                updateUIForLoggedInUser(profile);
            } else {
                updateUIForLoggedOutUser();
            }
        });
    } else {
        console.error('window.minecraft.auth.onProfileUpdate is not a function');
    }
    
    // Check if user is already authenticated
    try {
        console.log('Checking current authentication status');
        const profile = await window.minecraft.auth.getProfile();
        console.log('Authentication check result:', profile);
        
        if (profile) {
            updateUIForLoggedInUser(profile);
        } else {
            updateUIForLoggedOutUser();
        }
    } catch (error) {
        console.error('Failed to check authentication status:', error);
        updateUIForLoggedOutUser();
    }
}

// Update UI when user is logged in
function updateUIForLoggedInUser(profile) {
    // Check if profile is valid
    if (!profile || !profile.name) {
        console.error('Invalid profile data:', profile);
        return; // Don't update UI with invalid data
    }
    
    const usernameInput = document.getElementById('username-input');
    if (!usernameInput) {
        console.error('Username input not found when trying to update UI for logged in user');
        return;
    }
    
    console.log('Updating UI for logged-in user:', profile.name);
    isAuthenticated = true;
    
    // Update username input with Minecraft username
    usernameInput.value = profile.name;
    usernameInput.disabled = true;
    usernameInput.classList.add('username-locked');
    // Add a tooltip to hint at the logout feature
    usernameInput.title = "Ctrl+Shift+Click to logout";
    
    // Show the debug logout button if authorized
    const debugBtn = document.getElementById('debug-logout-btn');
    if (debugBtn) {
        debugBtn.dataset.allowed = 'true';
    }
    
    // Update login button to show status
    if (loginButton) {
        loginButton.textContent = 'Logged in';
        loginButton.classList.add('logged-in');
        loginButton.disabled = true;
    }
    
    // Save the username to local storage
    localStorage.setItem('lastUsername', profile.name);

    // Save account for switcher
    if (window.accounts && window.accounts.add) {
        window.accounts.add({
            id: profile.id || profile.uuid || profile.name,
            username: profile.name,
            refreshToken: profile.refreshToken || null,
            profile: profile
        }).then(() => loadAccounts()).catch(e => console.error('Failed to save account:', e));
    }
    
    console.log(`Logged in as ${profile.name}`);
}

// Update UI when user is logged out
function updateUIForLoggedOutUser() {
    const usernameInput = document.getElementById('username-input');
    if (!usernameInput) {
        console.error('Username input not found when trying to update UI for logout');
        return;
    }
    
    console.log('User is logged out, updating UI');
    isAuthenticated = false;
    
    // Re-enable username editing
    usernameInput.disabled = false;
    usernameInput.classList.remove('username-locked');
    usernameInput.classList.remove('ctrl-shift-hover');
    usernameInput.title = "";
    
    // Hide the debug logout button
    const debugBtn = document.getElementById('debug-logout-btn');
    if (debugBtn) {
        debugBtn.dataset.allowed = 'false';
    }
    
    // Load saved username if available
    const savedUsername = localStorage.getItem('lastUsername') || 'Player';
    usernameInput.value = savedUsername;
    
    // Reset or recreate login button
    if (!loginButton || !document.body.contains(loginButton)) {
        console.log('Login button not found in DOM, creating a new one');
        // If the button doesn't exist or isn't in the DOM, create it
        loginButton = document.createElement('button');
        loginButton.id = 'ms-login-btn';
        loginButton.className = 'ms-login-btn';
        loginButton.textContent = 'Login with Microsoft';
        
        // Add to the username container
        const container = usernameInput.parentElement;
        if (container) {
            container.appendChild(loginButton);
            console.log('Added login button to username container');
        } else {
            // If no parent container, insert after the username input
            usernameInput.insertAdjacentElement('afterend', loginButton);
            console.log('Added login button after username input');
        }
        
        // Add click event listener
        loginButton.addEventListener('click', async function() {
            try {
                loginButton.disabled = true;
                loginButton.textContent = 'Logging in...';
                
                console.log('Microsoft login clicked, sending auth request...');
                const profile = await window.minecraft.auth.login();
                
                // Enhanced error checking
                if (!profile || profile.error || !profile.name) {
                    throw new Error(profile?.error || 'Login failed: Invalid or missing profile data');
                }
                
                console.log(`Successfully logged in as ${profile.name}`);
                updateUIForLoggedInUser(profile);
            } catch (error) {
                console.error('Login failed:', error);
                alert(`Login failed: ${error.message}`);
                
                // Reset button state
                loginButton.disabled = false;
                loginButton.textContent = 'Login with Microsoft';
            }
        });
    } else {
        console.log('Login button found in DOM, updating its state');
    }
    
    // Update button state
    loginButton.textContent = 'Login with Microsoft';
    loginButton.classList.remove('logged-in');
    loginButton.disabled = false;
    loginButton.style.display = 'block'; // Ensure it's visible
    
    // Reload accounts
    loadAccounts().catch(e => console.error('Failed to reload accounts:', e));
    
    console.log('User is not logged in, login button is ready');
}

// ==================== Account Switcher ====================
let accountSwitcherVisible = false;

async function loadAccounts() {
    try {
        const accounts = await window.accounts.get();
        const list = document.getElementById('accountList');
        const switcher = document.getElementById('accountSwitcher');
        if (!list || !switcher) return;
        list.innerHTML = '';
        if (!accounts || accounts.length === 0) {
            switcher.style.display = 'none';
            accountSwitcherVisible = false;
            return;
        }
        switcher.style.display = 'block';
        accountSwitcherVisible = true;
        accounts.forEach(acc => {
            const item = document.createElement('div');
            item.className = 'account-item' + (acc.isActive ? ' active' : '');
            const initial = (acc.username || '?')[0].toUpperCase();
            item.innerHTML = `
                <div class="account-avatar">${initial}</div>
                <span class="account-name">${acc.username}</span>
                <button class="account-remove-btn" data-id="${acc.id}">&times;</button>
            `;
            item.addEventListener('click', async (e) => {
                if (e.target.classList.contains('account-remove-btn')) return;
                if (acc.isActive) return;
                const result = await window.accounts.switch(acc.id);
                if (result.success) {
                    await loadAccounts();
                }
            });
            item.querySelector('.account-remove-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                await window.accounts.remove(acc.id);
                await loadAccounts();
            });
            list.appendChild(item);
        });
    } catch (e) {
        console.error('Failed to load accounts:', e);
    }
}

// Initialize auth when the window loads
window.addEventListener('DOMContentLoaded', async () => {
    await initializeAuth();
    await loadAccounts();
});

// ==================== Crash Toast ====================
function setupCrashToast() {
    window.crashReports.onCrash((data) => {
        const toast = document.getElementById('crashToast');
        const text = document.getElementById('crashToastText');
        const btn = document.getElementById('crashToastBtn');
        const close = document.getElementById('crashToastClose');
        if (!toast || !text) return;
        text.textContent = `Minecraft crashed (${data.version || 'unknown version'})`;
        toast.style.display = 'block';
        if (btn) {
            btn.onclick = () => {
                showCrashReportModal(data);
                toast.style.display = 'none';
            };
        }
        if (close) {
            close.onclick = () => { toast.style.display = 'none'; };
        }
        setTimeout(() => { if (toast) toast.style.display = 'none'; }, 10000);
    });
}

async function showCrashReportModal(crashData) {
    const crashModal = document.getElementById('crashReportModal');
    const crashContent = document.getElementById('crashContent');
    if (!crashModal || !crashContent) return;
    if (crashData.crashContent) {
        crashContent.textContent = crashData.crashContent;
    } else {
        crashContent.textContent = 'No crash details available.';
    }
    crashModal.classList.add('active');
}

// ==================== World Manager ====================
async function openWorldManager() {
    const modal = document.getElementById('worldManagerModal');
    const list = document.getElementById('worldList');
    if (!modal || !list) return;
    modal.classList.add('active');
    list.innerHTML = '<div class="world-manager">Loading worlds...</div>';
    try {
        const worlds = await window.worlds.get();
        const container = document.createElement('div');
        container.className = 'world-manager';
        list.innerHTML = '';
        if (!worlds || worlds.length === 0) {
            container.innerHTML = '<div class="no-worlds">No worlds found</div>';
            list.appendChild(container);
            return;
        }
        worlds.forEach(w => {
            const sizeStr = w.size > 1048576 ? (w.size / 1048576).toFixed(1) + ' MB' : w.size > 1024 ? (w.size / 1024).toFixed(1) + ' KB' : w.size + ' B';
            const dateStr = new Date(w.lastModified).toLocaleDateString();
            const item = document.createElement('div');
            item.className = 'world-item';
            item.innerHTML = `
                <div class="world-info">
                    <span class="world-name">${w.name}</span>
                    <span class="world-meta">Last played: ${dateStr}</span>
                </div>
                <span class="world-size">${sizeStr}</span>
                <div class="world-actions">
                    <button class="world-action-btn backup">Backup</button>
                    <button class="world-action-btn restore">Restore</button>
                    <button class="world-action-btn delete">Delete</button>
                </div>
            `;
            item.querySelector('.backup').addEventListener('click', async () => {
                const result = await window.worlds.backup(w.name);
                if (result.success) {
                    window.minecraft.logger.info(`World ${w.name} backed up`);
                    alert(`World "${w.name}" backed up successfully!`);
                } else {
                    alert('Backup failed: ' + (result.error || 'Unknown error'));
                }
            });
            item.querySelector('.restore').addEventListener('click', async () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.zip';
                input.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const result = await window.worlds.restore(file.path || file.name);
                    if (result.success) {
                        window.minecraft.logger.info('World restored');
                        alert('World restored successfully!');
                        openWorldManager();
                    } else {
                        alert('Restore failed: ' + (result.error || 'Unknown error'));
                    }
                };
                input.click();
            });
            item.querySelector('.delete').addEventListener('click', async () => {
                if (!confirm(`Delete world "${w.name}"? This cannot be undone.`)) return;
                const result = await window.worlds.delete(w.name);
                if (result.success) {
                    window.minecraft.logger.info(`World ${w.name} deleted`);
                    openWorldManager();
                } else {
                    alert('Delete failed: ' + (result.error || 'Unknown error'));
                }
            });
            container.appendChild(item);
        });
        list.appendChild(container);
    } catch (e) {
        list.innerHTML = '<div class="no-worlds">Failed to load worlds: ' + e.message + '</div>';
    }
}

// ==================== Crash Reports Viewer ====================
async function openCrashReports() {
    const modal = document.getElementById('crashReportsModal');
    const list = document.getElementById('crashReportsList');
    if (!modal || !list) return;
    modal.classList.add('active');
    list.innerHTML = '<div class="crash-viewer">Loading...</div>';
    try {
        const reports = await window.crashReports.get();
        list.innerHTML = '';
        if (!reports || reports.length === 0) {
            list.innerHTML = '<div class="no-crash-reports">No crash reports found</div>';
            return;
        }
        reports.forEach(r => {
            const section = document.createElement('div');
            section.className = 'crash-section';
            section.innerHTML = `
                <div class="crash-section-header">
                    <h4>${r.filename}</h4>
                    <div>
                        <span class="crash-section-time">${new Date(r.time).toLocaleString()}</span>
                        <button class="crash-delete-btn" data-file="${r.filename}">&times;</button>
                    </div>
                </div>
                <div class="crash-section-desc">${r.description}</div>
                ${r.stacktrace ? `<div class="crash-stacktrace">${r.stacktrace}</div>` : ''}
            `;
            section.querySelector('.crash-delete-btn').addEventListener('click', async () => {
                await window.crashReports.delete(r.filename);
                openCrashReports();
            });
            list.appendChild(section);
        });
    } catch (e) {
        list.innerHTML = '<div class="no-crash-reports">Failed to load crash reports: ' + e.message + '</div>';
    }
}

// ==================== Benchmark Mode ====================
async function runBenchmark() {
    const confirmed = confirm('Run a 60-second benchmark? The game will launch in offline mode and FPS data will be collected.');
    if (!confirmed) return;

    const progressOverlay = document.getElementById('progressOverlay');
    if (progressOverlay) {
        showProgress(true);
        updateProgress(10, 'Starting benchmark...');
    }

    try {
        const version = (document.getElementById('version')?.getAttribute('data-version') || document.getElementById('version')?.textContent || 'latest').trim();
        const maxRam = parseInt(localStorage.getItem('maxRam')) || 4096;

        updateProgress(20, 'Launching Minecraft for benchmark...');
        window.minecraft.logger.info(`Benchmark: launching ${version} with ${maxRam}MB RAM`);

        window.benchmark.onComplete(async (data) => {
            if (progressOverlay) showProgress(false);
            const modal = document.getElementById('benchmarkModal');
            const content = document.getElementById('benchmarkContent');
            if (!modal || !content) return;
            modal.classList.add('active');
            content.innerHTML = '<div class="benchmark-progress">Benchmark complete, loading results...</div>';
            const history = await window.benchmark.getHistory();
            const last = history && history.length > 0 ? history[history.length - 1] : null;
            if (last) {
                const fpsClass = last.avgFps >= 60 ? 'good' : last.avgFps >= 30 ? 'avg' : 'bad';
                content.innerHTML = `
                    <div class="benchmark-result">
                        <div class="benchmark-result-header">
                            <h4>Benchmark Complete</h4>
                            <span class="benchmark-result-time">${new Date(last.timestamp).toLocaleString()}</span>
                        </div>
                        <div class="benchmark-stats">
                            <div class="benchmark-stat">
                                <span class="benchmark-stat-label">Avg FPS</span>
                                <span class="benchmark-stat-value ${fpsClass}">${last.avgFps}</span>
                            </div>
                            <div class="benchmark-stat">
                                <span class="benchmark-stat-label">Min FPS</span>
                                <span class="benchmark-stat-value">${last.minFps}</span>
                            </div>
                            <div class="benchmark-stat">
                                <span class="benchmark-stat-label">Max FPS</span>
                                <span class="benchmark-stat-value">${last.maxFps}</span>
                            </div>
                        </div>
                        <p style="font-size:0.75rem;color:var(--text-muted);margin:8px 0 0 0;">
                            Version: ${last.version} | Samples: ${last.samples} | Duration: ${last.duration}s
                        </p>
                    </div>
                    <div style="margin-top:12px;"><h4 style="font-size:0.9rem;margin:0 0 8px 0;">History</h4></div>
                `;
            }
            if (history && history.length > 1) {
                for (let i = history.length - 2; i >= 0; i--) {
                    const h = history[i];
                    const div = document.createElement('div');
                    div.className = 'benchmark-history-item';
                    div.innerHTML = `
                        <div class="benchmark-history-info">
                            <span class="ver">${h.version}</span>
                            <span class="meta"> &middot; ${new Date(h.timestamp).toLocaleDateString()} &middot; ${h.duration || 60}s</span>
                        </div>
                        <span class="benchmark-history-fps">${h.avgFps} FPS</span>
                    `;
                    content.appendChild(div);
                }
            } else if (last) {
                const noHist = document.createElement('div');
                noHist.className = 'no-benchmarks';
                noHist.textContent = 'No previous benchmarks';
                content.appendChild(noHist);
            }
        });

        const result = await window.benchmark.run({ version, maxRam, duration: 60 });
        if (result.error) {
            if (progressOverlay) showProgress(false);
            alert('Benchmark failed: ' + result.error);
        } else {
            updateProgress(80, 'Benchmark in progress... (60s)');
        }
    } catch (e) {
        if (progressOverlay) showProgress(false);
        window.minecraft.logger.error('Benchmark error: ' + e.message);
        alert('Benchmark failed: ' + e.message);
    }
}

async function openBenchmarkHistory() {
    const modal = document.getElementById('benchmarkModal');
    const content = document.getElementById('benchmarkContent');
    if (!modal || !content) return;
    modal.classList.add('active');
    content.innerHTML = '<div class="benchmark-progress">Loading...</div>';
    try {
        const history = await window.benchmark.getHistory();
        content.innerHTML = '';
        if (!history || history.length === 0) {
            content.innerHTML = '<div class="no-benchmarks">No benchmark history found</div>';
            return;
        }
        history.slice().reverse().forEach(h => {
            const fpsClass = h.avgFps >= 60 ? 'good' : h.avgFps >= 30 ? 'avg' : 'bad';
            const div = document.createElement('div');
            div.className = 'benchmark-result';
            div.innerHTML = `
                <div class="benchmark-result-header">
                    <h4>${h.version}</h4>
                    <span class="benchmark-result-time">${new Date(h.timestamp).toLocaleString()}</span>
                </div>
                <div class="benchmark-stats">
                    <div class="benchmark-stat">
                        <span class="benchmark-stat-label">Avg FPS</span>
                        <span class="benchmark-stat-value ${fpsClass}">${h.avgFps}</span>
                    </div>
                    <div class="benchmark-stat">
                        <span class="benchmark-stat-label">Min FPS</span>
                        <span class="benchmark-stat-value">${h.minFps}</span>
                    </div>
                    <div class="benchmark-stat">
                        <span class="benchmark-stat-label">Max FPS</span>
                        <span class="benchmark-stat-value">${h.maxFps}</span>
                    </div>
                </div>
                <p style="font-size:0.75rem;color:var(--text-muted);margin:8px 0 0 0;">
                    Samples: ${h.samples} | Duration: ${h.duration || 60}s
                </p>
            `;
            content.appendChild(div);
        });
    } catch (e) {
        content.innerHTML = '<div class="no-benchmarks">Failed to load history: ' + e.message + '</div>';
    }
}

// Add event listener for external links
document.addEventListener('DOMContentLoaded', () => {
    // Single event handler for all external links including donation message
    document.addEventListener('click', (event) => {
        // Find if clicked element or any of its parents has the external-link class
        const link = event.target.closest('.external-link');
        
        if (link) {
            event.preventDefault();
            event.stopPropagation(); // Prevent event bubbling
            
            // Prevent multiple triggers
            if (link.dataset.processing) return;
            
            // Set a flag to prevent multiple rapid clicks
            link.dataset.processing = "true";
            
            const url = link.getAttribute('href');
            window.minecraft.system.openExternal(url);
            
            // Remove the processing flag after a short delay
            setTimeout(() => {
                delete link.dataset.processing;
            }, 1000);
        }
    });
    
});


