const logger = require('./logger');
const MockAuthServer = require('./mock-auth-server');

/**
 * Initializes the authentication integration between the auth service,
 * mock auth server, and game launcher
 * 
 * @param {Object} options - Configuration options
 * @param {AuthService} options.authService - The authentication service instance
 * @param {MinecraftLauncher} options.minecraftLauncher - The Minecraft launcher instance
 * @param {Object} [options.serverConfig] - Optional configuration for the mock auth server
 * @param {boolean} [options.useGlobalRefs=false] - Whether to store references globally (not recommended)
 * @returns {Object} An object containing cleanup function and service references
 * @throws {Error} If required parameters are missing
 */
async function initAuthIntegration({ 
  authService, 
  minecraftLauncher, 
  serverConfig = {}, 
  useGlobalRefs = false 
} = {}) {
    // Validate required parameters
    if (!authService) {
        throw new Error('Authentication service is required');
    }
    
    if (!minecraftLauncher) {
        throw new Error('Minecraft launcher is required');
    }
    
    // Store references globally if specified (not recommended)
    if (useGlobalRefs) {
        global.authService = authService;
    }
    
    try {
        // Create and start mock auth server with auth service reference
        const mockAuthServer = new MockAuthServer(authService, serverConfig);
        await mockAuthServer.start();
        
        // Store the server reference globally if specified
        if (useGlobalRefs) {
            global.mockAuthServer = mockAuthServer;
        }
        
        logger.info('Authentication integration initialized successfully');
        
        // Return object with cleanup function and references
        return {
            /**
             * Cleans up the authentication integration
             * @returns {Promise<void>} Promise that resolves when cleanup is complete
             */
            cleanup: async () => {
                try {
                    if (mockAuthServer) {
                        await mockAuthServer.stop();
                        logger.info('Mock auth server stopped');
                    }
                    
                    if (useGlobalRefs) {
                        if (global.mockAuthServer) {
                            delete global.mockAuthServer;
                        }
                        
                        if (global.authService) {
                            delete global.authService;
                        }
                    }
                    
                    logger.info('Authentication integration cleaned up successfully');
                } catch (error) {
                    logger.error('Error during authentication cleanup:', error);
                    throw error;
                }
            },
            mockAuthServer,
            authService
        };
    } catch (error) {
        logger.error('Failed to initialize authentication integration:', error);
        
        // Clean up any global references that might have been set
        if (useGlobalRefs && global.authService) {
            delete global.authService;
        }
        
        throw error;
    }
}

module.exports = { initAuthIntegration };