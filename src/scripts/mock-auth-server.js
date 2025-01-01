const http = require('http');

class MockAuthServer {
    constructor() {
        this.server = null;
        this.port = 25566; // Use a port that won't conflict with Minecraft
    }

    start() {
        this.server = http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            // Handle preflight requests
            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            // Mock responses for different endpoints
            const mockResponses = {
                '/session/minecraft/join': {
                    status: 'ok'
                },
                '/session/minecraft/hasJoined': {
                    id: this.generateOfflineUUID(),
                    name: 'Player',
                    properties: []
                },
                '/api/profiles/minecraft': [{
                    id: this.generateOfflineUUID(),
                    name: 'Player'
                }]
            };

            // Send mock response
            const response = mockResponses[req.url] || { error: 'Not found' };
            res.writeHead(200);
            res.end(JSON.stringify(response));
        });

        this.server.listen(this.port, '127.0.0.1', () => {
            console.log(`Mock auth server running on port ${this.port}`);
        });
    }

    stop() {
        if (this.server) {
            this.server.close();
            this.server = null;
        }
    }

    generateOfflineUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
}

module.exports = MockAuthServer;
