/* global globalThis */
import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { setConfigFilePath } from '../../src/util.js';

// Resolve repository root dynamically
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

// Initialize configuration so ST endpoints can resolve configuration without exiting
const defaultConfigPath = path.join(repoRoot, 'default', 'config.yaml');
if (fs.existsSync(defaultConfigPath)) {
    setConfigFilePath(defaultConfigPath);
}

// Ensure DATA_ROOT is available
if (!globalThis.DATA_ROOT) {
    globalThis.DATA_ROOT = path.join(repoRoot, 'data');
}
if (!globalThis.COMMAND_LINE_ARGS) {
    globalThis.COMMAND_LINE_ARGS = { dataRoot: globalThis.DATA_ROOT };
}

// Dynamically import ST modules after config is set
const { setupPrivateEndpoints } = await import('../../src/server-startup.js');
const { requireLoginMiddleware } = await import('../../src/users.js');
const { init, onExit } = await import('../../src/living-world/index.js');

describe('Real SillyTavern Host Routing and Authentication Integration', () => {
    let server;
    let baseUrl;
    let tempDir;
    let simulateAuthenticated = false;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-st-integration-test-'));
        const dbPath = path.join(tempDir, 'integration-test.db');
        await init({ dbPath });

        const app = express();
        app.use(express.json());

        // Middleware simulating ST's authentication context toggle
        app.use((req, _res, next) => {
            if (simulateAuthenticated) {
                req.user = {
                    profile: { handle: 'default-user', admin: true, enabled: true },
                    directories: {},
                };
            }
            next();
        });

        // 1. ST Authentication boundary (from src/users.js)
        app.use(requireLoginMiddleware);

        // 2. ST Canonical Private Endpoint Registration (from src/server-startup.js)
        setupPrivateEndpoints(app);

        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        await onExit();
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
        if (tempDir) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                void err;
            }
        }
    });

    test('unauthenticated request to /api/living-world/status is rejected with HTTP 403 by ST authentication', async () => {
        simulateAuthenticated = false;

        const response = await fetch(`${baseUrl}/api/living-world/status`);
        expect(response.status).toBe(403);
    });

    test('unauthenticated request to /api/living-world/ping is rejected with HTTP 403 by ST authentication', async () => {
        simulateAuthenticated = false;

        const response = await fetch(`${baseUrl}/api/living-world/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(response.status).toBe(403);
    });

    test('authenticated request reaches /api/living-world/status through ST setupPrivateEndpoints', async () => {
        simulateAuthenticated = true;

        const response = await fetch(`${baseUrl}/api/living-world/status`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.initialized).toBe(true);
        expect(data.schemaVersion).toBe(5);
    });

    test('authenticated request reaches /api/living-world/ping through ST setupPrivateEndpoints', async () => {
        simulateAuthenticated = true;

        const response = await fetch(`${baseUrl}/api/living-world/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.pong).toBe(true);
        expect(typeof data.timestamp).toBe('number');
    });

    test('unsupported subpath under /api/living-world returns HTTP 404 through ST routing pipeline', async () => {
        simulateAuthenticated = true;

        const response = await fetch(`${baseUrl}/api/living-world/unsupported-action`);
        expect(response.status).toBe(404);
    });
});
