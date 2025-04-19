/**
 * Auth debugging helper utility
 * Provides comprehensive functions to diagnose and resolve authentication issues
 * @version 1.0.1
 */

// Save in window scope with IIFE pattern to avoid polluting global namespace
window.authDebug = (() => {
    // Constants
    const AUTH_KEYS = ['lastUsername', 'mc_auth_token', 'mc_session_id', 'mc_refresh_token'];
    const AUTH_COOKIE_PREFIXES = ['mc_', 'auth_'];
    
    // Private utility functions
    const formatTimestamp = () => {
        return new Date().toISOString();
    };
    
    const logMessage = (level, message, data) => {
        const timestamp = formatTimestamp();
        const prefix = `[Auth Debug ${level}] [${timestamp}]`;
        
        if (data) {
            console[level](prefix, message, data);
        } else {
            console[level](prefix, message);
        }
    };
    
    // Public API
    return {
        /**
         * Check the current authentication status
         * @returns {Promise<Object|null>} User profile or null if not authenticated
         */
        async checkAuth() {
            try {
                logMessage('log', 'Checking authentication status...');
                
                if (!window.minecraft?.auth?.getProfile) {
                    logMessage('error', 'Authentication API not available');
                    return null;
                }
                
                const profile = await window.minecraft.auth.getProfile();
                logMessage('log', 'Auth profile retrieved:', profile);
                
                // Verify token expiration if available
                if (profile?.expiresAt) {
                    const expiresAt = new Date(profile.expiresAt);
                    const now = new Date();
                    const timeRemaining = expiresAt - now;
                    
                    if (timeRemaining <= 0) {
                        logMessage('warn', 'Authentication token has expired');
                    } else {
                        const minutesRemaining = Math.round(timeRemaining / 60000);
                        logMessage('info', `Token expires in approximately ${minutesRemaining} minutes`);
                    }
                }
                
                return profile;
            } catch (error) {
                logMessage('error', 'Auth check failed:', error);
                return null;
            }
        },
        
        /**
         * Force a logout attempt
         * @returns {Promise<boolean>} Success status
         */
        async forceLogout() {
            try {
                logMessage('log', 'Attempting forced logout...');
                
                if (!window.minecraft?.auth?.logout) {
                    logMessage('error', 'Logout API not available');
                    return false;
                }
                
                const result = await window.minecraft.auth.logout();
                logMessage('log', 'Logout result:', result);
                return true;
            } catch (error) {
                logMessage('error', 'Force logout failed:', error);
                return false;
            }
        },
        
        /**
         * Clear auth-related localStorage items
         * @returns {Array<string>} List of removed keys
         */
        clearLocalStorage() {
            logMessage('log', 'Clearing auth-related localStorage items...');
            const removedKeys = [];
            
            // Remove exact keys
            AUTH_KEYS.forEach(key => {
                if (localStorage.getItem(key)) {
                    logMessage('info', `Removing "${key}" from localStorage`);
                    localStorage.removeItem(key);
                    removedKeys.push(key);
                }
            });
            
            // Look for any other keys that might be auth-related
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.includes('auth') || key.includes('token') || key.includes('session'))) {
                    logMessage('info', `Found and removing potential auth key: "${key}"`);
                    localStorage.removeItem(key);
                    removedKeys.push(key);
                }
            }
            
            logMessage('info', `Cleared ${removedKeys.length} items from localStorage`);
            return removedKeys;
        },
        
        /**
         * Clear auth-related cookies
         * @returns {number} Number of cookies cleared
         */
        clearCookies() {
            logMessage('log', 'Clearing auth-related cookies...');
            let count = 0;
            
            document.cookie.split(';').forEach(cookie => {
                const cookieName = cookie.split('=')[0].trim();
                
                // Check if cookie matches any auth prefix
                if (AUTH_COOKIE_PREFIXES.some(prefix => cookieName.startsWith(prefix)) ||
                    cookieName.includes('auth') || cookieName.includes('session')) {
                    
                    document.cookie = `${cookieName}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
                    logMessage('info', `Cleared cookie: ${cookieName}`);
                    count++;
                }
            });
            
            logMessage('info', `Cleared ${count} cookies`);
            return count;
        },
        
        /**
         * Get auth-related debug information
         * @returns {Object} Debug information
         */
        getDebugInfo() {
            const info = {
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                localStorage: {},
                authAPIsAvailable: !!window.minecraft?.auth,
                cookies: document.cookie.split(';').map(c => c.trim()).filter(c => 
                    AUTH_COOKIE_PREFIXES.some(prefix => c.startsWith(prefix)) ||
                    c.includes('auth') || c.includes('session')
                )
            };
            
            // Collect localStorage keys (just keys, not values for security)
            AUTH_KEYS.forEach(key => {
                info.localStorage[key] = localStorage.getItem(key) ? '(present)' : '(not set)';
            });
            
            logMessage('info', 'Collected debug information', info);
            return info;
        },
        
        /**
         * Complete reset of auth state
         * @param {boolean} reload - Whether to reload the page after reset
         * @returns {Promise<boolean>} Success status
         */
        async resetAll(reload = true) {
            logMessage('log', 'Performing complete auth reset...');
            
            try {
                await this.forceLogout();
                this.clearLocalStorage();
                this.clearCookies();
                
                logMessage('info', 'Auth reset completed successfully');
                
                if (reload) {
                    logMessage('log', 'Reloading page...');
                    setTimeout(() => location.reload(), 500);
                }
                
                return true;
            } catch (error) {
                logMessage('error', 'Error during auth reset:', error);
                return false;
            }
        },
        
        /**
         * Show help information in console
         */
        help() {
            console.group('Auth Debug Helper - Available Commands');
            console.log('window.authDebug.checkAuth() - Check current auth status');
            console.log('window.authDebug.forceLogout() - Force logout');
            console.log('window.authDebug.clearLocalStorage() - Clear auth localStorage');
            console.log('window.authDebug.clearCookies() - Clear auth cookies');
            console.log('window.authDebug.getDebugInfo() - Get debug information');
            console.log('window.authDebug.resetAll() - Complete reset');
            console.log('window.authDebug.help() - Show this help');
            console.log('');
            console.log('Keyboard shortcuts:');
            console.log('Ctrl+Alt+A - Check auth status');
            console.log('Ctrl+Alt+D - Show debug info');
            console.log('Ctrl+Alt+H - Show help');
            console.groupEnd();
        }
    };
})();

// Enhanced keyboard shortcuts
document.addEventListener('keydown', function(e) {
    // Only process if not in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
    }
    
    // Ctrl+Alt+A to check auth status
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'a') {
        console.clear();
        window.authDebug.checkAuth();
    }
    
    // Ctrl+Alt+D to show debug info
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'd') {
        console.clear();
        window.authDebug.getDebugInfo();
    }
    
    // Ctrl+Alt+H to show help
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'h') {
        console.clear();
        window.authDebug.help();
    }
});

// Initialize with help message
console.log('%cAuth Debug Helper loaded', 'font-weight: bold; color: #4CAF50; font-size: 14px;');
console.log('Use window.authDebug functions or press Ctrl+Alt+H for help');