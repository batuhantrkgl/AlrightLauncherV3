module.exports = {
    microsoft: {
        clientId: 'YOUR_CLIENT_ID', // Replace with your Azure App Client ID
        redirectUri: 'https://login.microsoftonline.com/common/oauth2/nativeclient',
        scope: 'XboxLive.signin offline_access',
        authUrl: 'https://login.live.com/oauth20_authorize.srf'
    }
};
