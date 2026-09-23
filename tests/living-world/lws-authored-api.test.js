import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { init, onExit } from '../../src/living-world/index.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';

describe('Authored HTTP API Endpoints', () => {
    let server;
    let baseUrl;
    let tempDir;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-authored-api-test-'));
        const dbPath = path.join(tempDir, 'authored-test.db');
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

    test('POST /worlds creates a world with HTTP 201', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/worlds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Aethelgard', description: 'Realm of eternal dawn' }),
        });
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.name).toBe('Aethelgard');
        expect(data.lws_id).toBeDefined();
        expect(data.id).toBeUndefined();
    });

    test('POST /worlds rejects invalid payload with HTTP 400 without leaking stack traces', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/worlds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '' }),
        });
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBeDefined();
        expect(data.stack).toBeUndefined();
    });

    test('rejects non-UUID path parameters with HTTP 400', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/worlds/not-a-valid-uuid`);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain('UUID');
    });

    test('full Character CRUD lifecycle via API', async () => {
        // Create world
        const wRes = await fetch(`${baseUrl}/api/living-world/worlds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Character Test World' }),
        });
        const world = await wRes.json();

        // Create character
        const cRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/characters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Kaelen',
                description: 'A silent archer',
                scenario: 'Standing watch at the tower',
            }),
        });
        expect(cRes.status).toBe(201);
        const char = await cRes.json();
        expect(char.name).toBe('Kaelen');
        expect(char.scenario_context).toBe('Standing watch at the tower');

        // Get character
        const getRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/characters/${char.lws_id}`);
        expect(getRes.status).toBe(200);
        const fetched = await getRes.json();
        expect(fetched.name).toBe('Kaelen');

        // Patch character
        const patchRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/characters/${char.lws_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personality: 'Observant and quiet' }),
        });
        expect(patchRes.status).toBe(200);
        const patched = await patchRes.json();
        expect(patched.personality).toBe('Observant and quiet');

        // List characters
        const listRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/characters`);
        expect(listRes.status).toBe(200);
        const list = await listRes.json();
        expect(list).toHaveLength(1);

        // Delete character
        const delRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/characters/${char.lws_id}`, {
            method: 'DELETE',
        });
        expect(delRes.status).toBe(204);

        // Fetch deleted returns 404
        const afterDelRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/characters/${char.lws_id}`);
        expect(afterDelRes.status).toBe(404);
    });

    test('AuthoredPromptConfig creation and duplicate 409 rejection via API', async () => {
        const wRes = await fetch(`${baseUrl}/api/living-world/worlds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Prompt World' }),
        });
        const world = await wRes.json();

        // Create prompt config
        const pRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/prompt-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ style_notes: 'Atmospheric prose' }),
        });
        expect(pRes.status).toBe(201);

        // Duplicate create -> 409 Conflict
        const dupRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/prompt-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ style_notes: 'Second style' }),
        });
        expect(dupRes.status).toBe(409);
    });

    test('deleted-World descendant behavior: all scoped routes return HTTP 404 when world is soft-deleted', async () => {
        // Setup world with descendant entities
        const wRes = await fetch(`${baseUrl}/api/living-world/worlds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Doomed World' }),
        });
        const world = await wRes.json();

        const cRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/characters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Doomed Citizen' }),
        });
        const char = await cRes.json();

        // Soft-delete the World
        const delWRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}`, {
            method: 'DELETE',
        });
        expect(delWRes.status).toBe(204);

        // 1. Collection query returns 404
        const charListRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/characters`);
        expect(charListRes.status).toBe(404);
        const charListData = await charListRes.json();
        expect(charListData.error).toBe('World not found');

        // 2. Entity query returns 404
        const charGetRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/characters/${char.lws_id}`);
        expect(charGetRes.status).toBe(404);

        // 3. Entity create returns 404
        const charCreateRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/characters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Orphan' }),
        });
        expect(charCreateRes.status).toBe(404);

        // 4. Locations collection returns 404
        const locListRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/locations`);
        expect(locListRes.status).toBe(404);

        // 5. Factions collection returns 404
        const factionListRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/factions`);
        expect(factionListRes.status).toBe(404);

        // 6. World rules collection returns 404
        const ruleListRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/world-rules`);
        expect(ruleListRes.status).toBe(404);

        // 7. Scenarios collection returns 404
        const scenarioListRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/scenarios`);
        expect(scenarioListRes.status).toBe(404);

        // 8. Prompt config returns 404
        const promptRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/prompt-config`);
        expect(promptRes.status).toBe(404);
    });

    test('soft-deleted relationship behavior via API', async () => {
        const wRes = await fetch(`${baseUrl}/api/living-world/worlds`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Relationship Test World' }),
        });
        const world = await wRes.json();

        // Create faction
        const fRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/factions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Guardians' }),
        });
        const faction = await fRes.json();

        // Create character
        const cRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/characters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'Guard Captain' }),
        });
        const char = await cRes.json();

        // Delete character first
        await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/characters/${char.lws_id}`, {
            method: 'DELETE',
        });

        // Attempt to add soft-deleted character to faction -> 404
        const addRes = await fetch(`${baseUrl}/api/living-world/worlds/${world.lws_id}/factions/${faction.lws_id}/members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ character_lws_id: char.lws_id, role: 'Captain' }),
        });
        expect(addRes.status).toBe(404);
        const addData = await addRes.json();
        expect(addData.error).toBe('Character not found');
    });
});
