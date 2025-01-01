const { ipcRenderer } = require('electron');
const AuthHandler = require('../auth-handler');
const authHandler = new AuthHandler();

document.addEventListener('DOMContentLoaded', () => {
    const loginButton = document.getElementById('loginButton');
    loginButton.addEventListener('click', async () => {
        try {
            const auth = await authHandler.authenticate();
            if (auth) {
                window.location.href = 'main.html';
            }
        } catch (error) {
            console.error('Login failed:', error);
            alert('Login failed. Please try again.');
        }
    });
});
