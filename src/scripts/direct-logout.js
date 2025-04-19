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
        let eventHandlers = []; // Track event handlers for cleanup
        
        // Function to safely add event listeners with cleanup capability
        function addSafeEventListener(element, event, handler) {
            if (element) {
                element.addEventListener(event, handler);
                eventHandlers.push({ element, event, handler });
            }
        }
        
        // Function to remove all registered event listeners
        function cleanupEventListeners() {
            eventHandlers.forEach(({ element, event, handler }) => {
                element.removeEventListener(event, handler);
            });
            eventHandlers = [];
        }
        
        // Create a logout button that will be shown when Ctrl+Shift is pressed
        function createLogoutButton() {
            if (document.getElementById('direct-logout-btn')) return;
            
            const usernameContainer = document.querySelector('.username-container');
            if (!usernameContainer) return;
            
            const btn = document.createElement('button');
            btn.id = 'direct-logout-btn';
            btn.className = 'logout-button';
            btn.textContent = 'Log Out';
            btn.style.display = 'none'; // Hide by default
            
            addSafeEventListener(btn, 'click', performLogout);
            
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
                showEmergencyLogout();
            }
        }
        
        // Show emergency logout button
        function showEmergencyLogout() {
            const emergencyBtn = document.getElementById('emergency-logout');
            if (emergencyBtn) {
                emergencyBtn.style.display = 'block';
                // Only add the event listener once
                if (!emergencyBtn.hasAttribute('data-event-attached')) {
                    addSafeEventListener(emergencyBtn, 'click', forceLogout);
                    emergencyBtn.setAttribute('data-event-attached', 'true');
                }
            }
        }
        
        // Force logout by clearing local state and reloading
        function forceLogout() {
            console.log('Emergency logout triggered');
            
            // Clear any stored tokens
            try {
                localStorage.removeItem('mc_auth_token');
                localStorage.removeItem('msLoginState');
                // Clear any additional tokens that might be used
                sessionStorage.removeItem('mc_auth_token');
                
                // Clear cookies if possible
                document.cookie.split(';').forEach(cookie => {
                    const [name] = cookie.trim().split('=');
                    if (name.includes('auth') || name.includes('token') || name.includes('login')) {
                        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
                    }
                });
                
                // Force a page reload
                alert('Emergency logout complete. The page will now reload.');
                window.location.reload();
            } catch (error) {
                console.error('Error during force logout:', error);
                alert('Failed to complete emergency logout. Please close your browser completely.');
            }
        }
        
        // Handle key combinations
        function handleKeyDown(e) {
            // Ctrl+Shift combination
            if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
                ctrlShiftPressed = true;
                
                // Find username input to check if authenticated
                const usernameInput = document.getElementById('username-input');
                const donationMessage = document.getElementById('donation-message');
                
                if (usernameInput && usernameInput.disabled) {
                    // User is likely authenticated if the input is disabled
                    console.log('Ctrl+Shift pressed, user appears to be authenticated');
                    
                    // Show logout button
                    if (logoutButton) {
                        logoutButton.style.display = 'block';
                    }
                    
                    // Add hover effect to donation message too
                    if (donationMessage) {
                        donationMessage.classList.add('ctrl-shift-hover');
                    }
                    
                    // Create logout button if it doesn't exist yet
                    createLogoutButton();
                }
            }
            
            // Ctrl+Alt+L for emergency logout
            if (e.ctrlKey && e.altKey && e.key === 'l') {
                showEmergencyLogout();
            }
        }
        
        function handleKeyUp(e) {
            if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) {
                ctrlShiftPressed = false;
                
                // Hide logout button
                if (logoutButton) {
                    logoutButton.style.display = 'none';
                }
                
                // Remove hover effect from donation message
                const donationMessage = document.getElementById('donation-message');
                if (donationMessage) {
                    donationMessage.classList.remove('ctrl-shift-hover');
                }
            }
        }
        
        // Username input click handler
        function handleUsernameClick() {
            if (ctrlShiftPressed && this.disabled) {
                console.log('Username input clicked while Ctrl+Shift pressed');
                performLogout();
            }
        }
        
        // Set up all event listeners
        function initializeEventListeners() {
            // Keyboard events
            addSafeEventListener(document, 'keydown', handleKeyDown);
            addSafeEventListener(document, 'keyup', handleKeyUp);
            
            // Emergency logout button
            const emergencyBtn = document.getElementById('emergency-logout');
            if (emergencyBtn) {
                addSafeEventListener(emergencyBtn, 'click', forceLogout);
                emergencyBtn.setAttribute('data-event-attached', 'true');
            }
            
            // Username input events
            const usernameInput = document.getElementById('username-input');
            if (usernameInput) {
                addSafeEventListener(usernameInput, 'click', handleUsernameClick);
            }
        }
        
        // Initialize component
        function initialize() {
            createLogoutButton();
            initializeEventListeners();
            
            // Add a MutationObserver to watch for DOM changes
            // This helps if elements we need are added dynamically
            const observer = new MutationObserver((mutations) => {
                const usernameContainer = document.querySelector('.username-container');
                const usernameInput = document.getElementById('username-input');
                
                if ((usernameContainer && !logoutButton) || 
                    (usernameInput && !usernameInput.hasAttribute('data-event-attached'))) {
                    createLogoutButton();
                    
                    if (usernameInput && !usernameInput.hasAttribute('data-event-attached')) {
                        addSafeEventListener(usernameInput, 'click', handleUsernameClick);
                        usernameInput.setAttribute('data-event-attached', 'true');
                    }
                }
            });
            
            observer.observe(document.body, { 
                childList: true, 
                subtree: true 
            });
            
            // Store the observer for cleanup
            window._logoutObserver = observer;
        }
        
        // Run initialization
        initialize();
        
        // Cleanup function - attach to window for possible external usage
        window._cleanupDirectLogout = function() {
            cleanupEventListeners();
            if (window._logoutObserver) {
                window._logoutObserver.disconnect();
                delete window._logoutObserver;
            }
            if (logoutButton && logoutButton.parentNode) {
                logoutButton.parentNode.removeChild(logoutButton);
            }
            console.log('Direct logout handler cleaned up');
        };
    });
})();