/**
 * Auth debugging helper utility
 * Adds functions to help diagnose authentication issues
 */

// Save this in window scope so it's accessible from the console
window.authDebug = {
    /**
     * Check the current authentication status
     */
    async checkAuth() {
        try {
            console.log('Checking authentication status...');
            const profile = await window.minecraft.auth.getProfile();
            console.log('Auth profile:', profile);
            return profile;
        } catch (error) {
            console.error('Auth check failed:', error);
            return null;
        }
    },
    
    /**
     * Force a logout attempt
     */
    async forceLogout() {
        try {
            console.log('Attempting forced logout...');
            const result = await window.minecraft.auth.logout();
            console.log('Logout result:', result);
            return result;
        } catch (error) {
            console.error('Force logout failed:', error);
            return false;
        }
    },
    
    /**
     * Clear related localStorage items
     */
    clearLocalStorage() {
        console.log('Clearing auth-related localStorage items...');
        const authKeys = ['lastUsername', 'mc_auth_token'];
        authKeys.forEach(key => {
            if (localStorage.getItem(key)) {
                console.log(`Removing ${key} from localStorage`);
                localStorage.removeItem(key);
            }
        });
        return true;
    },
    
    /**
     * Complete reset
     */
    async resetAll() {
        await this.forceLogout();
        this.clearLocalStorage();
        console.log('Auth reset completed');
        location.reload();
    }
};

// Add a keyboard shortcut to access the auth debugger
document.addEventListener('keydown', function(e) {
    // Ctrl+Alt+A to print auth status to console
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'a') {
        window.authDebug.checkAuth();
    }
});

console.log('Auth helper loaded - use window.authDebug functions or Ctrl+Alt+A to check auth status');
