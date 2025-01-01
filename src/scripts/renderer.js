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

async function fetchVersions() {
    try {
        const versions = await window.minecraft.getVersions();
        return versions.filter(v => v.type === 'release');
    } catch (error) {
        console.error('Error fetching versions:', error);
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

dropdown.addEventListener('click', (e) => {
    if (e.target.classList.contains('version-item')) {
        versionElement.textContent = e.target.textContent;
        dropdown.style.display = 'none';
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
        
        // Use IPC to trigger the download in the main process
        const success = await window.minecraft.ipc.invoke('download-java', downloadUrl);
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
    const version = document.getElementById('version').textContent;
    const username = document.getElementById('username').textContent;
    const playButton = document.querySelector('.play-button');
    const originalText = playButton.textContent;
    window.minecraft.logger.info('=== Starting game launch sequence ===');
    window.minecraft.logger.info(`Version: ${version}`);
    window.minecraft.logger.info(`Username: ${username}`);
    
    try {
        // Disable button immediately
        playButton.disabled = true;

        // Check Java first
        const hasJava = await window.minecraft.isJavaInstalled();
        if (!hasJava) {
            playButton.textContent = 'Java Required';
            return;
        }

        window.minecraft.logger.info(`Starting game launch process for ${version}`);
        window.minecraft.logger.info(`User: ${username}`);
        
        // Verify installation
        playButton.textContent = 'Verifying...';
        const versionPath = window.minecraft.utils.pathJoin(
            window.minecraft.utils.getAppData(),
            '.alrightlauncher',
            'versions',
            version
        );

        // Check if version exists and is complete
        if (!window.minecraft.utils.existsSync(versionPath)) {
            window.minecraft.logger.info(`Version ${version} not found, starting download...`);
            playButton.textContent = 'Installing...';
            const success = await window.minecraft.installVersion(version);
            if (!success) {
                throw new Error('Installation failed');
            }
            window.minecraft.logger.info(`Version ${version} installed successfully`);
        }

        // Verify Java again just before launch
        window.minecraft.logger.info('Verifying Java installation...');
        const javaCheck = await window.minecraft.isJavaInstalled();
        if (!javaCheck) {
            window.minecraft.logger.warn('Java not found, initiating installation...');
            playButton.textContent = 'Installing Java...';
            const javaInstalled = await window.minecraft.checkJava();
            if (!javaInstalled) {
                throw new Error('Java installation failed');
            }
            window.minecraft.logger.info('Java installed successfully');
        }

        // Launch the game
        window.minecraft.logger.info('Launching game...');
        playButton.textContent = 'Launching...';
        const launched = await window.minecraft.launchGame(version, username);
        
        if (launched) {
            window.minecraft.logger.info('Game launched successfully');
            playButton.textContent = 'Playing...';
            
            // Create a function to check if the game is still running
            const checkGameStatus = setInterval(() => {
                window.minecraft.isGameRunning(version).then(running => {
                    if (!running) {
                        clearInterval(checkGameStatus);
                        playButton.textContent = originalText;
                        playButton.disabled = false;
                    }
                });
            }, 5000); // Check every 5 seconds
            
            window.minecraft.logger.info('=== Game launch sequence completed ===');
        } else {
            throw new Error('Game launch failed');
        }
    } catch (error) {
        window.minecraft.logger.error('=== Game launch sequence failed ===');
        window.minecraft.logger.error(`Error details: ${error.stack || error.message}`);
        console.error('Game error:', error);
        alert(`Launch failed: ${error.message || 'Unknown error'}`);
        playButton.textContent = 'Error';
        setTimeout(() => {
            playButton.textContent = originalText;
            playButton.disabled = false;
        }, 2000);
    }
}

// Attach play button click handler
document.querySelector('.play-button').addEventListener('click', playGame);

// Add event handler in renderer process
document.getElementById('createStandalone').addEventListener('click', async () => {
    const modal = document.getElementById('versionSelectModal');
    const versionList = document.getElementById('versionSelectList');
    const searchInput = document.getElementById('versionSearch');
    let versions = [];

    try {
        // Fetch versions
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
        
        // Clear existing options
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
