const logger = require('./logger');
const MockAuthServer = require('./mock-auth-server');

/**
 * Initializes the authentication integration between the auth service,
 * mock auth server, and game launcher
 * 
 * @param {AuthService} authService - The authentication service instance
 * @param {MinecraftLauncher} minecraftLauncher - The Minecraft launcher instance
 */
function initAuthIntegration(authService, minecraftLauncher) {
    // Make auth service globally available so launcher can use it
    global.authService = authService;
    
    // Create and start mock auth server with auth service reference
    const mockAuthServer = new MockAuthServer(authService);
    mockAuthServer.start();
    
    // Store the server so we can properly stop it when app closes
    global.mockAuthServer = mockAuthServer;
    
    logger.info('Authentication integration initialized');
    
    // Return cleanup function
    return function cleanup() {
        if (global.mockAuthServer) {
            global.mockAuthServer.stop();
            delete global.mockAuthServer;
        }
        
        if (global.authService) {
            delete global.authService;
        }
        
        logger.info('Authentication integration cleaned up');
    };
}

module.exports = { initAuthIntegration };
