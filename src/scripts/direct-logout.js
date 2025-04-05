/**
 * Direct logout handler that bypasses any issues with the main renderer.js implementation
 * This is a backup to ensure logout functionality always works
 */
(function() {
    // Wait for DOM content to be loaded
    document.addEventListener('DOMContentLoaded', function() {
        console.log('Direct logout handler initialized');
        
        // Variables to track state
        let ctrlShiftPressed = false;
        let logoutButton = null;
        
        // Create a logout button that will be shown when Ctrl+Shift is pressed
        function createLogoutButton() {
            if (document.getElementById('direct-logout-btn')) return;
            
            const usernameContainer = document.querySelector('.username-container');
            if (!usernameContainer) return;
            
            const btn = document.createElement('button');
            btn.id = 'direct-logout-btn';
            btn.className = 'logout-button';
            btn.textContent = 'Log Out';
            btn.addEventListener('click', performLogout);
            
            usernameContainer.appendChild(btn);
            logoutButton = btn;
            
            console.log('Direct logout button created');
        }
        
        // Function to perform the actual logout
        async function performLogout() {
            try {
                console.log('Direct logout button clicked, attempting logout');
                
                if (logoutButton) {
                    logoutButton.textContent = 'Logging out...';
                    logoutButton.disabled = true;
                }
                
                // Call the logout API
                const result = await window.minecraft.auth.logout();
                console.log('Direct logout result:', result);
                
                // Handle the result
                if (result === true || result === 'success' || (result && result.success)) {
                    console.log('Logout successful via direct handler');
                    
                    // Force reload the page to ensure clean state
                    setTimeout(() => {
                        alert('You have been successfully logged out.');
                        window.location.reload();
                    }, 500);
                } else {
                    throw new Error('Logout operation failed');
                }
            } catch (error) {
                console.error('Direct logout error:', error);
                
                if (logoutButton) {
                    logoutButton.textContent = 'Log Out';
                    logoutButton.disabled = false;
                }
                
                alert(`Logout failed: ${error.message}. Check browser console for details.`);
                
                // Show emergency logout as fallback
                const emergencyBtn = document.getElementById('emergency-logout');
                if (emergencyBtn) {
                    emergencyBtn.style.display = 'block';
                    emergencyBtn.addEventListener('click', forceLogout);
                }
            }
        }
        
        // Force logout by clearing local state and reloading
        function forceLogout() {
            console.log('Emergency logout triggered');
            
            // Clear any stored tokens
            localStorage.removeItem('mc_auth_token');
            localStorage.removeItem('msLoginState');
            
            // Force a page reload
            alert('Emergency logout complete. The page will now reload.');
            window.location.reload();
        }
        
        // Keyboard event handlers
        document.addEventListener('keydown', function(e) {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                ctrlShiftPressed = true;
                
                // Find username input to check if authenticated
                const usernameInput = document.getElementById('username-input');
                if (usernameInput && usernameInput.disabled) {
                    // User is likely authenticated if the input is disabled
                    console.log('Ctrl+Shift pressed, user appears to be authenticated');
                    
                    // Show logout button
                    if (logoutButton) {
                        logoutButton.style.display = 'block';
                    }
                    
                    // Create logout button if it doesn't exist yet
                    createLogoutButton();
                }
            }
        });
        
        document.addEventListener('keyup', function(e) {
            if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) {
                ctrlShiftPressed = false;
                
                // Hide logout button
                if (logoutButton) {
                    logoutButton.style.display = 'none';
                }
            }
        });
        
        // Emergency logout button setup
        const emergencyBtn = document.getElementById('emergency-logout');
        if (emergencyBtn) {
            emergencyBtn.addEventListener('click', forceLogout);
            
            // Show emergency logout with special key combination
            document.addEventListener('keydown', function(e) {
                if (e.ctrlKey && e.altKey && e.key === 'l') {
                    emergencyBtn.style.display = 'block';
                }
            });
        }
        
        // Also handle direct clicks on the username input
        const usernameInput = document.getElementById('username-input');
        if (usernameInput) {
            usernameInput.addEventListener('click', function() {
                if (ctrlShiftPressed && this.disabled) {
                    console.log('Username input clicked while Ctrl+Shift pressed');
                    performLogout();
                }
            });
        }
        
        // Initialize by creating the logout button
        createLogoutButton();
    });
})();
