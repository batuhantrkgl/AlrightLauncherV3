const { BrowserWindow, session } = require('electron');
const fetch = require('node-fetch');
const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

class AuthService {
    constructor() {
        this.clientId = "220db509-20fc-4d93-9f18-31682523a165"; // Replace with your actual Microsoft App Client ID
        this.authorizationUrl = 'https://login.live.com/oauth20_authorize.srf';
        this.tokenUrl = 'https://login.live.com/oauth20_token.srf';
        this.redirectUri = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
        this.xboxLiveAuthUrl = 'https://user.auth.xboxlive.com/user/authenticate';
        this.xboxLiveXstsUrl = 'https://xsts.auth.xboxlive.com/xsts/authorize';
        this.minecraftAuthUrl = 'https://api.minecraftservices.com/authentication/login_with_xbox';
        this.minecraftProfileUrl = 'https://api.minecraftservices.com/minecraft/profile';
        
        // Path to save auth data
        this.authDataPath = path.join(
            process.env.APPDATA || process.env.HOME || __dirname,
            '.alrightlauncher',
            'auth.json'
        );
        
        // In-memory storage for auth data
        this.authData = null;
        this.authDataLoaded = false;
        
        // Initialize auth data immediately so it's available
        this.initAuthData();
        
        // Set up automatic token refresh 
        this.setupTokenRefresh();
    }
    
    // Add new asynchronous initialization method
    async initAuthData() {
        try {
            await this.loadAuthData();
        } catch (error) {
            logger.error('Failed to initialize auth data:', error);
        }
    }
    
    // Modify loadAuthData to be more robust
    async loadAuthData() {
        try {
            if (await fs.pathExists(this.authDataPath)) {
                try {
                    const data = await fs.readJson(this.authDataPath);
                    
                    if (!data || typeof data !== 'object') {
                        logger.warn('Auth data file exists but contains invalid data');
                        this.authData = null;
                        return;
                    }
                    
                    this.authData = data;
                    logger.info('Authentication data loaded successfully');
                    logger.info(`Auth data for: ${this.authData?.profile?.name || 'unknown user'}`);
                    
                    // Validate the loaded data
                    if (this.authData && this.authData.expiresAt) {
                        // If token is expired or about to expire (within 10 minutes), try to refresh it
                        const tokenExpiryTime = this.authData.expiresAt;
                        const currentTime = Date.now();
                        const timeUntilExpiry = tokenExpiryTime - currentTime;
                        
                        logger.info(`Token expires in ${Math.round(timeUntilExpiry / 60000)} minutes`);
                        
                        if (timeUntilExpiry < 600000) { // Less than 10 minutes until expiry
                            logger.info('Auth token expired or about to expire, attempting refresh');
                            try {
                                await this.refreshAccessToken();
                            } catch (refreshError) {
                                logger.warn(`Token refresh failed: ${refreshError.message}`);
                                // Only clear auth data if refresh fails with specific errors
                                if (refreshError.message.includes('invalid_grant') || 
                                    refreshError.message.includes('Token refresh failed: 400') ||
                                    refreshError.message.includes('Token refresh failed: 401')) {
                                    logger.warn('Invalid refresh token, clearing auth data');
                                    await this.logout();
                                }
                            }
                        } else {
                            logger.info(`Auth token valid for ${Math.floor(timeUntilExpiry / 60000)} more minutes`);
                        }
                    } else {
                        logger.warn('Loaded auth data is missing expiration time');
                    }
                } catch (parseError) {
                    logger.error(`Failed to parse auth data file: ${parseError.message}`);
                    // Try to back up the corrupted file
                    try {
                        const backupPath = `${this.authDataPath}.bak`;
                        await fs.copy(this.authDataPath, backupPath);
                        logger.info(`Backed up corrupted auth file to ${backupPath}`);
                    } catch (backupError) {
                        logger.error(`Failed to backup corrupted auth file: ${backupError.message}`);
                    }
                    this.authData = null;
                }
            } else {
                logger.info('No saved authentication data found');
                this.authData = null;
            }
        } catch (error) {
            logger.error('Failed to load authentication data:', error);
            this.authData = null;
        } finally {
            this.authDataLoaded = true;
        }
    }
    
    // Improve saveAuthData to ensure the directory exists
    async saveAuthData() {
        try {
            if (this.authData) {
                // Ensure the directory exists
                await fs.ensureDir(path.dirname(this.authDataPath));
                
                // Add a timestamp to the saved data for debugging
                const dataToSave = {
                    ...this.authData,
                    savedAt: Date.now()
                };
                
                // Write the file with pretty formatting (makes debugging easier)
                await fs.writeJson(this.authDataPath, dataToSave, { spaces: 2 });
                
                logger.info('Authentication data saved successfully');
                logger.info(`Saved auth data for: ${this.authData?.profile?.name || 'unknown user'}`);
                return true;
            } else {
                logger.warn('No auth data to save');
                return false;
            }
        } catch (error) {
            logger.error('Failed to save authentication data:', error);
            logger.error(error.stack);
            return false;
        }
    }
    
    // Set up periodic token refresh
    setupTokenRefresh() {
        // Check token validity every 15 minutes
        const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
        
        this.refreshInterval = setInterval(() => {
            if (this.isLoggedIn()) {
                const timeUntilExpiry = this.authData.expiresAt - Date.now();
                
                // Refresh if less than 30 minutes until expiry
                if (timeUntilExpiry < 30 * 60 * 1000) {
                    logger.info('Running scheduled token refresh');
                    this.refreshAccessToken().catch(error => {
                        logger.warn(`Scheduled token refresh failed: ${error.message}`);
                    });
                }
            }
        }, REFRESH_INTERVAL);
    }
    
    // Enhanced version of refreshAccessToken
    async refreshAccessToken() {
        try {
            if (!this.authData || !this.authData.refreshToken) {
                throw new Error('No refresh token available');
            }
            
            logger.info('Refreshing access token using refresh token');
            
            const body = new URLSearchParams({
                client_id: this.clientId,
                refresh_token: this.authData.refreshToken,
                grant_type: 'refresh_token'
            });
            
            const response = await fetch(this.tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: body
            });
            
            // Get the response as text first for better error logging
            const responseText = await response.text();
            
            if (!response.ok) {
                logger.error(`Token refresh failed: Status ${response.status} - ${responseText}`);
                
                // If refresh token is invalid, we need to force re-login
                if (response.status === 400 || response.status === 401) {
                    logger.warn('Refresh token invalid or expired, clearing saved authentication');
                    await this.logout();
                }
                
                throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
            }
            
            let tokenData;
            try {
                tokenData = JSON.parse(responseText);
            } catch (parseError) {
                logger.error(`Failed to parse token response: ${parseError.message}`);
                logger.error(`Response data: ${responseText}`);
                throw new Error('Invalid token response format');
            }
            
            if (!tokenData.access_token) {
                logger.error('Token response missing access_token');
                logger.error(`Response data: ${JSON.stringify(tokenData)}`);
                throw new Error('Invalid token response: missing access_token');
            }
            
            // Update the authentication data
            this.authData = {
                ...this.authData,
                accessToken: tokenData.access_token,
                refreshToken: tokenData.refresh_token || this.authData.refreshToken, // Keep old refresh token if not provided
                expiresAt: Date.now() + (tokenData.expires_in * 1000)
            };
            
            // Re-validate Minecraft profile with new token
            try {
                const profile = await this.getMinecraftProfile(this.authData.accessToken);
                this.authData.profile = profile;
            } catch (profileError) {
                logger.error(`Failed to refresh Minecraft profile: ${profileError.message}`);
                // Continue anyway, at least we have a valid token
            }
            
            // Save updated auth data
            await this.saveAuthData();
            logger.info('Access token refreshed successfully');
            
            return true;
        } catch (error) {
            logger.error(`Failed to refresh access token: ${error.message}`);
            throw error;
        }
    }
    
    // Improved isLoggedIn to wait for auth data to be loaded
    async ensureAuthDataLoaded() {
        if (!this.authDataLoaded) {
            logger.info('Waiting for auth data to load...');
            await this.loadAuthData();
        }
    }
    
    isLoggedIn() {
        return (
            this.authData && 
            this.authData.profile && 
            this.authData.accessToken && 
            this.authData.expiresAt && 
            this.authData.expiresAt > Date.now() + 60000 // Make sure we have at least a minute left
        );
    }
    
    // Modify getProfile to ensure auth data is loaded
    async getProfile() {
        try {
            // Make sure auth data is loaded
            await this.ensureAuthDataLoaded();
            
            // If not logged in, return null immediately
            if (!this.isLoggedIn()) {
                return null;
            }
            
            // If logged in but expiring soon, try to refresh
            if (this.authData.expiresAt < Date.now() + 10 * 60 * 1000) { // Less than 10 minutes left
                try {
                    logger.info('Token expiring soon, refreshing automatically');
                    await this.refreshAccessToken();
                } catch (refreshError) {
                    logger.warn(`Auto-refresh failed during getProfile: ${refreshError.message}`);
                    // Continue with the existing token if it's still valid
                    if (!this.isLoggedIn()) {
                        return null;
                    }
                }
            }
            
            return this.authData.profile;
        } catch (error) {
            logger.error(`Error in getProfile: ${error.message}`);
            return null;
        }
    }
    
    // Add an improved login method with better error handling
    async login() {
        try {
            logger.info('Starting Microsoft authentication flow');
            
            // Step 1: Get Microsoft OAuth token
            logger.info('Step 1: Getting authorization code');
            const msAuthResult = await this.getMicrosoftAuthCode();
            
            if (!msAuthResult || !msAuthResult.code) {
                logger.error('Failed to get Microsoft authorization code');
                return { error: 'Failed to get Microsoft authorization code' };
            }
            
            logger.info('Step 2: Exchanging code for access token');
            const tokenResponse = await this.exchangeCodeForToken(msAuthResult.code);
            
            if (!tokenResponse || !tokenResponse.access_token) {
                logger.error('Failed to get access token');
                return { error: 'Failed to get access token' };
            }
            
            // Step 3: Authenticate with Xbox Live
            logger.info('Step 3: Authenticating with Xbox Live');
            const xboxLiveResponse = await this.authenticateWithXboxLive(tokenResponse.access_token);
            
            if (!xboxLiveResponse || !xboxLiveResponse.Token) {
                logger.error('Xbox Live authentication failed');
                return { error: 'Xbox Live authentication failed' };
            }
            
            // Step 4: Get XSTS token
            logger.info('Step 4: Getting XSTS token');
            const xstsResponse = await this.getXstsToken(xboxLiveResponse.Token);
            
            if (!xstsResponse || !xstsResponse.token) {
                logger.error('Failed to get XSTS token');
                return { error: 'Failed to get XSTS token' };
            }
            
            // Step 5: Authenticate with Minecraft
            logger.info('Step 5: Authenticating with Minecraft');
            const mcResponse = await this.authenticateWithMinecraft(xstsResponse);
            
            if (!mcResponse || !mcResponse.access_token) {
                logger.error('Minecraft authentication failed');
                return { error: 'Minecraft authentication failed' };
            }
            
            // Step 6: Get Minecraft profile
            logger.info('Step 6: Getting Minecraft profile');
            const profile = await this.getMinecraftProfile(mcResponse.access_token);
            
            if (!profile || !profile.name) {
                logger.error('Failed to get Minecraft profile');
                return { error: 'Failed to get Minecraft profile' };
            }
            
            // Save authentication data
            this.authData = {
                profile,
                accessToken: mcResponse.access_token,
                refreshToken: tokenResponse.refresh_token,
                expiresAt: Date.now() + (tokenResponse.expires_in * 1000)
            };
            
            await this.saveAuthData();
            logger.info(`Authentication successful! Logged in as ${profile.name}`);
            return profile;
        } catch (error) {
            logger.error('Login failed:', error);
            
            // Provide more specific error messages based on error types
            if (error.message?.includes('Xbox account')) {
                return { error: "This account doesn't have an Xbox account. Please create one first." };
            } else if (error.message?.includes('country where Xbox Live is not available')) {
                return { error: "Xbox Live is not available in your country." };
            } else if (error.message?.includes('own Minecraft')) {
                return { error: "You don't own Minecraft. Please purchase the game first." };
            }
            
            return { error: error.message || 'Authentication failed' };
        }
    }
    
    // Improve logout to be more robust
    async logout() {
        try {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
                this.refreshInterval = null;
            }
            
            // Clear the in-memory auth data
            this.authData = null;
            
            // Remove the auth data file
            if (await fs.pathExists(this.authDataPath)) {
                await fs.remove(this.authDataPath);
                logger.info(`Removed auth data file at ${this.authDataPath}`);
            }
            
            logger.info('Logged out successfully');
            return true;
        } catch (error) {
            logger.error('Logout failed:', error);
            return false;
        }
    }
    
    // Open Microsoft login window and get auth code
    getMicrosoftAuthCode() {
        return new Promise((resolve, reject) => {
            // Create a new session for the auth window with permissive CSP
            const authSession = session.fromPartition('auth-session');
            
            // Set permissive CSP for the authentication window
            authSession.webRequest.onHeadersReceived((details, callback) => {
                callback({
                    responseHeaders: {
                        ...details.responseHeaders,
                        'Content-Security-Policy': [
                            "default-src * 'unsafe-inline' 'unsafe-eval'; script-src * 'unsafe-inline' 'unsafe-eval'; connect-src * 'unsafe-inline'; img-src * data: blob: 'unsafe-inline'; frame-src *; style-src * 'unsafe-inline';"
                        ]
                    }
                });
            });

            const authWindow = new BrowserWindow({
                width: 600,
                height: 800,
                show: true,
                autoHideMenuBar: true,
                webPreferences: {
                    nodeIntegration: false,
                    contextIsolation: true,
                    session: authSession,
                    webSecurity: true
                }
            });
            
            // Flag to prevent multiple resolves
            let isResolved = false;
            
            // Build Microsoft OAuth URL
            const authUrl = `${this.authorizationUrl}?client_id=${this.clientId}&response_type=code&redirect_uri=${encodeURIComponent(this.redirectUri)}&scope=XboxLive.signin%20offline_access`;
            
            authWindow.loadURL(authUrl);
            
            // Debug the load process
            authWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
                logger.error(`Auth window failed to load: ${errorDescription} (${errorCode})`);
                if (!isResolved) {
                    isResolved = true;
                    authWindow.destroy();
                    reject(new Error(`Failed to load auth window: ${errorDescription}`));
                }
            });
            
            // Handle navigation events to extract the authorization code
            authWindow.webContents.on('did-navigate', (event, url) => {
                logger.info(`Auth window navigated to: ${url}`);
                this.handleAuthRedirect(url, authWindow, resolve, reject, isResolved).then(resolved => {
                    isResolved = resolved;
                });
            });
            
            // This is crucial - capture redirects that happen without a full navigation
            authWindow.webContents.on('will-redirect', (event, url) => {
                logger.info(`Auth window will redirect to: ${url}`);
                this.handleAuthRedirect(url, authWindow, resolve, reject, isResolved).then(resolved => {
                    isResolved = resolved;
                });
            });
            
            // Handle window close
            authWindow.on('closed', () => {
                // Only reject if we haven't resolved yet
                if (!isResolved) {
                    isResolved = true;
                    logger.info('Auth window closed by user before completing authentication');
                    reject(new Error('Authentication cancelled'));
                }
            });
        });
    }
    
    // Helper method to handle auth redirects and extract code
    async handleAuthRedirect(url, authWindow, resolve, reject, isResolved) {
        if (isResolved) return true; // Already handled
        
        try {
            // Check if this is our redirect URI
            if (url.startsWith(this.redirectUri)) {
                // Extract the authorization code
                const urlObj = new URL(url);
                const code = urlObj.searchParams.get('code');
                const error = urlObj.searchParams.get('error');
                
                if (error) {
                    logger.error(`Auth error: ${error} - ${urlObj.searchParams.get('error_description')}`);
                    authWindow.destroy();
                    reject(new Error(`Authentication error: ${error}`));
                    return true;
                }
                
                if (code) {
                    logger.info('Successfully obtained authorization code');
                    // Slight delay before closing to ensure the code is properly captured
                    setTimeout(() => {
                        authWindow.destroy();
                        resolve({ code });
                    }, 100);
                    return true;
                }
            }
        } catch (error) {
            logger.error('Error handling auth redirect:', error);
        }
        
        return false;
    }
    
    // Exchange authorization code for access token
    async exchangeCodeForToken(code) {
        try {
            logger.info('Exchanging authorization code for access token');
            
            const body = new URLSearchParams({
                client_id: this.clientId,
                code: code,
                grant_type: 'authorization_code',
                redirect_uri: this.redirectUri
            });
            
            logger.info(`Sending token request to: ${this.tokenUrl}`);
            
            const response = await fetch(this.tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: body
            });
            
            const data = await response.text();
            
            if (!response.ok) {
                logger.error(`Token exchange failed: Status ${response.status} - ${data}`);
                throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`);
            }
            
            try {
                // Try to parse the response
                const tokenData = JSON.parse(data);
                logger.info('Successfully obtained access token');
                return tokenData;
            } catch (parseError) {
                logger.error(`Failed to parse token response: ${parseError.message}`);
                logger.error(`Response data: ${data}`);
                throw new Error('Invalid token response format');
            }
        } catch (error) {
            logger.error('Token exchange failed:', error);
            throw error; // Rethrow to propagate the error
        }
    }
    
    // Authenticate with Xbox Live
    async authenticateWithXboxLive(accessToken) {
        try {
            logger.info('Authenticating with Xbox Live');
            
            const response = await fetch(this.xboxLiveAuthUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    Properties: {
                        AuthMethod: 'RPS',
                        SiteName: 'user.auth.xboxlive.com',
                        RpsTicket: `d=${accessToken}`
                    },
                    RelyingParty: 'http://auth.xboxlive.com',
                    TokenType: 'JWT'
                })
            });
            
            if (!response.ok) {
                const error = await response.text();
                logger.error(`Xbox Live authentication failed: ${error}`);
                throw new Error(`Xbox Live authentication failed: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            logger.info('Successfully authenticated with Xbox Live');
            return data;
        } catch (error) {
            logger.error('Xbox Live authentication failed:', error);
            throw error;
        }
    }
    
    // Get XSTS token
    async getXstsToken(xblToken) {
        try {
            logger.info('Getting XSTS token');
            
            const response = await fetch(this.xboxLiveXstsUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify({
                    Properties: {
                        SandboxId: 'RETAIL',
                        UserTokens: [xblToken]
                    },
                    RelyingParty: 'rp://api.minecraftservices.com/',
                    TokenType: 'JWT'
                })
            });
            
            // Check for specific error status
            if (response.status === 401) {
                const errorData = await response.json();
                const xErr = errorData.XErr;
                
                if (xErr === 2148916233) {
                    throw new Error("This account doesn't have an Xbox account. Please create one first.");
                } else if (xErr === 2148916238) {
                    throw new Error("This account is from a country where Xbox Live is not available.");
                }
                
                throw new Error(`Xbox Live error: ${xErr}`);
            }
            
            if (!response.ok) {
                const error = await response.text();
                logger.error(`XSTS token request failed: ${error}`);
                throw new Error(`XSTS token request failed: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            logger.info('Successfully obtained XSTS token');
            
            return {
                token: data.Token,
                userHash: data.DisplayClaims.xui[0].uhs
            };
        } catch (error) {
            logger.error('XSTS token request failed:', error);
            throw error;
        }
    }
    
    // Authenticate with Minecraft services
    async authenticateWithMinecraft(xstsData) {
        try {
            logger.info('Authenticating with Minecraft services');
            
            const response = await fetch(this.minecraftAuthUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    identityToken: `XBL3.0 x=${xstsData.userHash};${xstsData.token}`
                })
            });
            
            if (!response.ok) {
                const error = await response.text();
                logger.error(`Minecraft authentication failed: ${error}`);
                throw new Error(`Minecraft authentication failed: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            logger.info('Successfully authenticated with Minecraft services');
            return data;
        } catch (error) {
            logger.error('Minecraft authentication failed:', error);
            throw error;
        }
    }
    
    // Get Minecraft profile
    async getMinecraftProfile(accessToken) {
        try {
            logger.info('Getting Minecraft profile');
            
            const response = await fetch(this.minecraftProfileUrl, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`
                }
            });
            
            if (response.status === 404) {
                throw new Error("You don't own Minecraft. Please purchase the game first.");
            }
            
            if (!response.ok) {
                const error = await response.text();
                logger.error(`Failed to get Minecraft profile: ${error}`);
                throw new Error(`Failed to get Minecraft profile: ${response.status} ${response.statusText}`);
            }
            
            const profile = await response.json();
            logger.info(`Successfully retrieved Minecraft profile for ${profile.name}`);
            return profile;
        } catch (error) {
            logger.error('Failed to get Minecraft profile:', error);
            throw error;
        }
    }
}

module.exports = AuthService;
