import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { init, onExit } from '../../src/living-world/index.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';

describe('LWS API Endpoints (Unit / Transport Level)', () => {
    let server;
    let baseUrl;
    let tempDir;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-api-test-'));
        const dbPath = path.join(tempDir, 'test.db');
        await init({ dbPath });

        const app = express();
        app.use(express.json());
        app.use('/api/living-world', lwsRouter);

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

    test('GET /api/living-world/status returns HTTP 200 with status and schemaVersion when healthy', async () => {
        const response = await fetch(`${baseUrl}/api/living-world/status`);
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.initialized).toBe(true);
        expect(data.schemaVersion).toBe(2);
    });

    test('POST /api/living-world/ping returns HTTP 200 with pong and timestamp when healthy', async () => {
        const response = await fetch(`${baseUrl}/api/living-world/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(response.status).toBe(200);

        const data = await response.json();
        expect(data.pong).toBe(true);
        expect(typeof data.timestamp).toBe('number');
        expect(data.timestamp).toBeLessThanOrEqual(Date.now());
    });

    test('unknown routes under /api/living-world return HTTP 404', async () => {
        const response = await fetch(`${baseUrl}/api/living-world/undefined-route`);
        expect(response.status).toBe(404);
    });

    test('returns HTTP 503 Service Unavailable when LWS subsystem is degraded or shut down', async () => {
        // Temporarily shut down LWS
        await onExit();

        const statusRes = await fetch(`${baseUrl}/api/living-world/status`);
        expect(statusRes.status).toBe(503);
        const statusData = await statusRes.json();
        expect(statusData.error).toBe('Living World subsystem is unavailable');
        expect(statusData.initialized).toBe(false);
        expect(statusData.schemaVersion).toBeNull();

        const pingRes = await fetch(`${baseUrl}/api/living-world/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });
        expect(pingRes.status).toBe(503);
        const pingData = await pingRes.json();
        expect(pingData.error).toBe('Living World subsystem is unavailable');

        // Re-initialize for subsequent tests
        const dbPath = path.join(tempDir, 'test.db');
        await init({ dbPath });
    });

    test('safe responses do not leak file paths, internal database details, or stack traces', async () => {
        await onExit();

        const response = await fetch(`${baseUrl}/api/living-world/status`);
        const text = await response.text();

        expect(text).not.toContain(tempDir);
        expect(text).not.toContain('.db');
        expect(text).not.toContain('better-sqlite3');
        expect(text).not.toContain('stack');
        expect(text).not.toContain('node_modules');

        const dbPath = path.join(tempDir, 'test.db');
        await init({ dbPath });
    });
});
