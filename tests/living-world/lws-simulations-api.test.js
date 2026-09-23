import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { init, onExit, createWorld, createCharacter, createLocation, deleteLocation, deleteWorld } from '../../src/living-world/index.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';

describe('LWS Phase 3 Simulation REST API Endpoints', () => {
    let server;
    let baseUrl;
    let tempDir;
    let testWorld;
    let testChar;
    let testLoc;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-sim-api-test-'));
        const dbPath = path.join(tempDir, 'sim-api-test.db');
        await init({ dbPath });

        testWorld = createWorld({ name: 'Sim World' });
        testChar = createCharacter(testWorld.lws_id, { name: 'Bob', description: 'Hero' });
        testLoc = createLocation(testWorld.lws_id, { name: 'Capital City' });

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

    test('POST /worlds/:worldLwsId/simulations creates a simulation with HTTP 201', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/simulations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Main Timeline',
                initial_fictional_time: '2026-06-01T12:00:00Z',
            }),
        });
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.lws_id).toBeDefined();
        expect(data.name).toBe('Main Timeline');
        expect(data.status).toBe('active');
        expect(data.current_fictional_time).toBe('2026-06-01T12:00:00Z');
        expect(data.world_id).toBe(testWorld.lws_id);
    });

    test('POST /worlds/:worldLwsId/simulations rejects invalid fictional timestamps with HTTP 400', async () => {
        // 1. Missing timestamp
        let res = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/simulations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'No Time Sim' }),
        });
        expect(res.status).toBe(400);

        // 2. Semantic calendar impossibility (Feb 29 on non-leap year)
        res = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/simulations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Bad Date Sim',
                initial_fictional_time: '2026-02-29T12:00:00Z',
            }),
        });
        expect(res.status).toBe(400);
        const errData = await res.json();
        expect(errData.error).toBeDefined();
    });

    test('GET /worlds/:worldLwsId/simulations returns HTTP 200 with simulation array', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/simulations`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThanOrEqual(1);
    });

    test('PATCH /simulations/:simLwsId validates status transition and rejects illegal transition with HTTP 400', async () => {
        const createRes = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/simulations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Transition API Sim',
                initial_fictional_time: '2026-06-01T12:00:00Z',
            }),
        });
        const sim = await createRes.json();

        // active -> archived
        let res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'archived' }),
        });
        expect(res.status).toBe(200);

        // archived -> active is illegal
        res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'active' }),
        });
        expect(res.status).toBe(400);
    });

    test('full SimulationCharacter lifecycle via API', async () => {
        const simRes = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/simulations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Character API Sim',
                initial_fictional_time: '2026-06-01T12:00:00Z',
            }),
        });
        const sim = await simRes.json();

        // 1. Add character (POST)
        let res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                character_id: testChar.lws_id,
                initial_location_id: testLoc.lws_id,
                activity: 'standing',
            }),
        });
        expect(res.status).toBe(201);
        const simChar = await res.json();
        expect(simChar.lws_id).toBeDefined();
        expect(simChar.activity).toBe('standing');
        expect(simChar.authored_snapshot.name).toBe('Bob');

        // 2. Duplicate character in same simulation rejected (HTTP 409)
        res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ character_id: testChar.lws_id }),
        });
        expect(res.status).toBe(409);

        // 3. List characters (GET)
        res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters`);
        expect(res.status).toBe(200);
        const charList = await res.json();
        expect(charList).toHaveLength(1);

        // 4. Update character (PATCH)
        res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simChar.lws_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activity: 'running', physical_condition: 'tired' }),
        });
        expect(res.status).toBe(200);
        const updatedChar = await res.json();
        expect(updatedChar.activity).toBe('running');
        expect(updatedChar.physical_condition).toBe('tired');

        // 5. Delete character (DELETE)
        res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simChar.lws_id}`, {
            method: 'DELETE',
        });
        expect(res.status).toBe(204);

        // 6. Get deleted character returns 404
        res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simChar.lws_id}`);
        expect(res.status).toBe(404);
    });

    test('soft-deleted location guard via API rejects new assignment with HTTP 400', async () => {
        const deletedLoc = createLocation(testWorld.lws_id, { name: 'Vanished Tower' });
        deleteLocation(testWorld.lws_id, deletedLoc.lws_id);

        const simRes = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/simulations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Loc Guard Sim',
                initial_fictional_time: '2026-06-01T12:00:00Z',
            }),
        });
        const sim = await simRes.json();

        const res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                character_id: testChar.lws_id,
                initial_location_id: deletedLoc.lws_id,
            }),
        });
        expect(res.status).toBe(400);
    });

    test('Simulation soft-delete and cascade behavior', async () => {
        const simRes = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/simulations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Simulation To Soft Delete',
                initial_fictional_time: '2026-06-01T12:00:00Z',
            }),
        });
        const sim = await simRes.json();

        // Add a character
        const charRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ character_id: testChar.lws_id }),
        });
        const simChar = await charRes.json();

        // 1. Soft-delete the simulation (DELETE 204)
        let res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}`, {
            method: 'DELETE',
        });
        expect(res.status).toBe(204);

        // 2. Repeated delete returns 404
        res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}`, {
            method: 'DELETE',
        });
        expect(res.status).toBe(404);

        // 3. GET simulation returns 404
        res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}`);
        expect(res.status).toBe(404);

        // 4. Child character routes return 404
        res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters`);
        expect(res.status).toBe(404);

        res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simChar.lws_id}`);
        expect(res.status).toBe(404);
    });

    test('soft-deleted World gates all simulation routes with HTTP 404', async () => {
        const doomedWorld = createWorld({ name: 'Doomed World' });
        const simRes = await fetch(`${baseUrl}/api/living-world/worlds/${doomedWorld.lws_id}/simulations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: 'Doomed Simulation',
                initial_fictional_time: '2026-06-01T12:00:00Z',
            }),
        });
        const sim = await simRes.json();

        // Soft-delete the parent world
        deleteWorld(doomedWorld.lws_id);

        // Any attempt to access simulations of that world returns 404
        let res = await fetch(`${baseUrl}/api/living-world/worlds/${doomedWorld.lws_id}/simulations`);
        expect(res.status).toBe(404);

        res = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}`);
        expect(res.status).toBe(404);
    });
});
