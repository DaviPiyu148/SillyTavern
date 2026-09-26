import express from 'express';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';
import { openDb, closeDb } from '../../src/living-world/db.js';

describe('LWS Phase 13 Hardening — Observability, Health & Diagnostics Endpoints', () => {
    let server;
    let baseUrl;
    let tempDir;
    let originalDataRoot;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-hardening-health-'));
        originalDataRoot = globalThis.DATA_ROOT;
        globalThis.DATA_ROOT = tempDir;

        const dbPath = path.join(tempDir, 'living-world', 'lws.db');
        openDb(dbPath);

        const app = express();
        app.use(express.json());

        // Mock auth middleware support
        app.use((req, res, next) => {
            const role = req.headers['x-mock-user-role'];
            if (role === 'admin') {
                req.user = { profile: { admin: true } };
            } else if (role === 'non-admin') {
                req.user = { profile: { admin: false } };
            } else if (role === 'unauthenticated') {
                req.user = false;
            }
            next();
        });

        app.use('/api/living-world', lwsRouter);

        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
    });

    afterAll(async () => {
        closeDb();
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
        globalThis.DATA_ROOT = originalDataRoot;
        if (tempDir && fs.existsSync(tempDir)) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (_) {
                // Ignore cleanup lock in Windows temp
            }
        }
    });

    test('GET /health returns 200 OK with sanitized operational fields and zero sensitive leakage', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/health`);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.status).toBe('healthy');
        expect(data.schema_version).toBe(9);
        expect(data.initialized).toBe(true);
        expect(typeof data.uptime_seconds).toBe('number');
        expect(typeof data.active_simulations_count).toBe('number');
        expect(data.memory_mb).toBeDefined();
        expect(typeof data.memory_mb.rss).toBe('number');
        expect(typeof data.memory_mb.heap_used).toBe('number');

        // Verify zero leakage of filesystem paths, entity names, or SQL internals
        const bodyStr = JSON.stringify(data);
        expect(bodyStr).not.toContain('lws.db');
        expect(bodyStr).not.toContain('dataRoot');
        expect(bodyStr).not.toContain('SELECT');
        expect(bodyStr).not.toContain('C:');
        expect(bodyStr).not.toContain('/home/');
    });

    test('GET /diagnostics returns 200 with catalog counts and enforces admin authorization', async () => {
        // 1. Non-admin request rejected with 403
        const nonAdminRes = await fetch(`${baseUrl}/api/living-world/diagnostics`, {
            headers: { 'x-mock-user-role': 'non-admin' },
        });
        expect(nonAdminRes.status).toBe(403);

        // 2. Unauthenticated request rejected with 401
        const unauthRes = await fetch(`${baseUrl}/api/living-world/diagnostics`, {
            headers: { 'x-mock-user-role': 'unauthenticated' },
        });
        expect(unauthRes.status).toBe(401);

        // 3. Admin request succeeds with 200
        const adminRes = await fetch(`${baseUrl}/api/living-world/diagnostics`, {
            headers: { 'x-mock-user-role': 'admin' },
        });

        expect(adminRes.status).toBe(200);
        const data = await adminRes.json();
        expect(data.integrity_ok).toBe(true);
        expect(data.foreign_keys_ok).toBe(true);
        expect(data.schema_version).toBe(9);
        expect(data.triggers_active).toBe(106);
        expect(data.user_tables_count).toBe(36);
        expect(data.user_indexes_count).toBe(61);
        expect(data.tables).toBeDefined();
        expect(data.orphan_checks).toBeDefined();
    });

    test('POST /admin/backup triggers hot database backup and enforces admin authorization', async () => {
        // 1. Non-admin request rejected with 403
        const nonAdminRes = await fetch(`${baseUrl}/api/living-world/admin/backup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-mock-user-role': 'non-admin',
            },
            body: JSON.stringify({ destination_filename: 'unauthorized_backup.db' }),
        });
        expect(nonAdminRes.status).toBe(403);

        // 2. Admin request succeeds with 200
        const adminRes = await fetch(`${baseUrl}/api/living-world/admin/backup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-mock-user-role': 'admin',
            },
            body: JSON.stringify({ destination_filename: 'admin_triggered_backup.db' }),
        });

        expect(adminRes.status).toBe(200);
        const data = await adminRes.json();
        expect(data.status).toBe('completed');
        expect(data.backup_filename).toBe('admin_triggered_backup.db');
        expect(fs.existsSync(data.backup_path)).toBe(true);
    });
});
