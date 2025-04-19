const http = require('http');
const fetch = require('node-fetch');
const logger = require('./logger');
const net = require('net');

class MockAuthServer {
    constructor(authService) {
        this.server = null;
        this.port = 25566; // Default port that won't conflict with Minecraft
        this.authService = authService; // Store the auth service reference
    }

    // Check if a port is available
    isPortAvailable(port) {
        return new Promise((resolve) => {
            const server = net.createServer();
            
            server.once('error', (err) => {
                // If the error is EADDRINUSE, port is not available
                if (err.code === 'EADDRINUSE') {
                    resolve(false);
                } else {
                    // For other errors, we still consider it unavailable
                    resolve(false);
                }
            });
            
            server.once('listening', () => {
                // Close the server and return true - port is available
                server.close();
                resolve(true);
            });
            
            server.listen(port, '127.0.0.1');
        });
    }

    // Find an available port starting from the default
    async findAvailablePort(startPort = 25566, maxAttempts = 20) {
        let port = startPort;
        let attempts = 0;
        
        while (attempts < maxAttempts) {
            if (await this.isPortAvailable(port)) {
                return port;
            }
            port++;
            attempts++;
        }
        
        throw new Error(`Could not find an available port after ${maxAttempts} attempts`);
    }

    async start() {
        try {
            // Find an available port
            this.port = await this.findAvailablePort();
            logger.info(`Using port ${this.port} for auth proxy server`);
            
            this.server = http.createServer(async (req, res) => {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

                // Handle preflight requests
                if (req.method === 'OPTIONS') {
                    res.writeHead(200);
                    res.end();
                    return;
                }

                // Try to get authentication data if available
                let authData = null;
                if (this.authService) {
                    try {
                        authData = await this.authService.getGameAuthData();
                        if (authData) {
                            logger.info(`Using authenticated session for ${authData.profile.name}`);
                        }
                    } catch (error) {
                        logger.error(`Error getting auth data: ${error.message}`);
                    }
                }

                // Get request body for POST requests
                let body = '';
                if (req.method === 'POST') {
                    req.on('data', chunk => {
                        body += chunk.toString();
                    });
                    
                    await new Promise(resolve => {
                        req.on('end', resolve);
                    });
                }

                try {
                    // If user is authenticated, forward requests to real Minecraft services
                    if (authData && authData.accessToken) {
                        await this.handleAuthenticatedRequest(req, res, authData, body);
                    } else {
                        // Fall back to mock responses for offline mode
                        this.handleOfflineRequest(req, res);
                    }
                } catch (error) {
                    logger.error(`Error handling auth request: ${error.message}`);
                    res.writeHead(500);
                    res.end(JSON.stringify({ error: 'Internal server error' }));
                }
            });

            return new Promise((resolve, reject) => {
                this.server.listen(this.port, '127.0.0.1', () => {
                    logger.info(`Auth proxy server running on port ${this.port}`);
                    resolve(this.port);
                });
                
                this.server.on('error', (err) => {
                    logger.error(`Server error: ${err.message}`);
                    reject(err);
                });
            });
        } catch (error) {
            logger.error(`Failed to start auth server: ${error.message}`);
            throw error;
        }
    }

    async handleAuthenticatedRequest(req, res, authData, body) {
        const url = req.url;
        const method = req.method;
        let targetUrl = '';
        let headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authData.accessToken}`
        };

        // Determine which endpoint to forward to
        if (url === '/session/minecraft/join') {
            targetUrl = 'https://sessionserver.mojang.com/session/minecraft/join';
        } else if (url.startsWith('/session/minecraft/hasJoined')) {
            // Forward the hasJoined request with all query parameters
            targetUrl = `https://sessionserver.mojang.com${url}`;
            // No authorization needed for this public endpoint
            delete headers.Authorization;
        } else if (url === '/api/profiles/minecraft') {
            targetUrl = 'https://api.minecraftservices.com/minecraft/profile';
        } else {
            // Unknown endpoint, fall back to mock response
            this.handleOfflineRequest(req, res);
            return;
        }

        try {
            logger.info(`Forwarding ${method} request to ${targetUrl}`);
            
            const fetchOptions = {
                method: method,
                headers: headers
            };
            
            if (method === 'POST' && body) {
                fetchOptions.body = body;
            }
            
            const response = await fetch(targetUrl, fetchOptions);
            const responseData = await response.text();
            
            // Forward the response status and data
            res.writeHead(response.status);
            res.end(responseData);
            
            logger.info(`Forwarded ${method} request to ${targetUrl} with status ${response.status}`);
        } catch (error) {
            logger.error(`Error forwarding request: ${error.message}`);
            // If forward fails, fall back to mock
            this.handleOfflineRequest(req, res);
        }
    }

    handleOfflineRequest(req, res) {
        // Generate a fixed UUID based on the username to make it consistent
        const username = req.headers['x-minecraft-username'] || 'Player';
        const uuid = this.generateOfflineUUID(username);
        
        // Mock responses for different endpoints
        const mockResponses = {
          '/session/minecraft/join': {
            status: 'ok'
          },
          '/session/minecraft/hasJoined': {
            id: uuid,
            name: username,
            properties: []
          },
          '/api/profiles/minecraft': [{
            id: uuid,
            name: username
          }],
          '/session/minecraft/profile/9c6ce9363b2349dba0cfce03e0e1801e': {
            id: uuid,  // Make sure we never return null for id
            name: username,
            properties: []
          },
          // Handle the generic case for any profile request
          '/publickeys': {
            profileKeys: []
          }
        };
    
        // Handle profile requests with a UUID in the URL
        if (req.url.startsWith('/session/minecraft/profile/')) {
          const uuidFromUrl = req.url.split('/').pop().split('?')[0];
          if (!mockResponses[req.url]) {
            mockResponses[req.url] = {
              id: uuidFromUrl.replace(/-/g, ''),  // Remove hyphens to match Minecraft's format
              name: username,
              properties: []
            };
          }
        }
    
        // Send mock response
        const response = mockResponses[req.url] || { error: 'Not found' };
        res.writeHead(200);
        res.end(JSON.stringify(response));
        
        logger.info(`Sent mock response for offline mode: ${req.url}`);
      }
    
      generateOfflineUUID(username = '') {
        if (username === '') {
          // Generate random UUID if no username
          return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
          });
        }
        
        // Generate deterministic UUID from username (for consistent UUIDs in offline mode)
        const md5 = require('crypto').createHash('md5').update(username).digest('hex');
        return `${md5.substr(0, 8)}-${md5.substr(8, 4)}-${md5.substr(12, 4)}-${md5.substr(16, 4)}-${md5.substr(20, 12)}`;
      }

    async getPort() {
        return this.port;
    }

    stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
            logger.info('Auth proxy server stopped');
        }
    }
}

module.exports = MockAuthServer;