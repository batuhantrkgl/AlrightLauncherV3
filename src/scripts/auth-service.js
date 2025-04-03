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
        
        // Load saved auth data
        this.loadAuthData();
    }
    
    // Load saved authentication data
    async loadAuthData() {
        try {
            if (await fs.pathExists(this.authDataPath)) {
                this.authData = await fs.readJson(this.authDataPath);
                logger.info('Authentication data loaded successfully');
            } else {
                logger.info('No saved authentication data found');
            }
        } catch (error) {
            logger.error('Failed to load authentication data:', error);
            this.authData = null;
        }
    }
    
    // Save authentication data to disk
    async saveAuthData() {
        try {
            if (this.authData) {
                await fs.ensureDir(path.dirname(this.authDataPath));
                await fs.writeJson(this.authDataPath, this.authData, { spaces: 2 });
                logger.info('Authentication data saved successfully');
            }
        } catch (error) {
            logger.error('Failed to save authentication data:', error);
        }
    }
    
    // Check if user is logged in
    isLoggedIn() {
        return this.authData && this.authData.profile && 
               this.authData.accessToken && this.authData.expiresAt && 
               this.authData.expiresAt > Date.now();
    }
    
    // Get the current user profile
    getProfile() {
        return this.isLoggedIn() ? this.authData.profile : null;
    }
    
    // Start the login process
    async login() {
        try {
            logger.info('Starting Microsoft authentication flow');
            
            // Step 1: Get Microsoft OAuth token
            logger.info('Step 1: Getting authorization code');
            const msAuthResult = await this.getMicrosoftAuthCode();
            
            if (!msAuthResult || !msAuthResult.code) {
                throw new Error('Failed to get Microsoft authorization code');
            }
            
            logger.info('Step 2: Exchanging code for access token');
            const tokenResponse = await this.exchangeCodeForToken(msAuthResult.code);
            
            if (!tokenResponse || !tokenResponse.access_token) {
                throw new Error('Failed to get access token');
            }
            
            // Step 3: Authenticate with Xbox Live
            logger.info('Step 3: Authenticating with Xbox Live');
            const xboxLiveResponse = await this.authenticateWithXboxLive(tokenResponse.access_token);
            
            if (!xboxLiveResponse || !xboxLiveResponse.Token) {
                throw new Error('Xbox Live authentication failed');
            }
            
            // Step 4: Get XSTS token
            logger.info('Step 4: Getting XSTS token');
            const xstsResponse = await this.getXstsToken(xboxLiveResponse.Token);
            
            if (!xstsResponse || !xstsResponse.token) {
                throw new Error('Failed to get XSTS token');
            }
            
            // Step 5: Authenticate with Minecraft
            logger.info('Step 5: Authenticating with Minecraft');
            const mcResponse = await this.authenticateWithMinecraft(xstsResponse);
            
            if (!mcResponse || !mcResponse.access_token) {
                throw new Error('Minecraft authentication failed');
            }
            
            // Step 6: Get Minecraft profile
            logger.info('Step 6: Getting Minecraft profile');
            const profile = await this.getMinecraftProfile(mcResponse.access_token);
            
            if (!profile || !profile.name) {
                throw new Error('Failed to get Minecraft profile');
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
            throw error;
        }
    }
    
    // Logout and clear saved data
    async logout() {
        this.authData = null;
        try {
            if (await fs.pathExists(this.authDataPath)) {
                await fs.remove(this.authDataPath);
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
