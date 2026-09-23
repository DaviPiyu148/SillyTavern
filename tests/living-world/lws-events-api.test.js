import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import {
    init,
    onExit,
    createWorld,
    createCharacter,
    createLocation,
    createSimulation,
    addSimulationCharacter,
    EVENT_TYPES,
} from '../../src/living-world/index.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';

describe('LWS Phase 4 Events, Turns, and Replay REST API Endpoints', () => {
    let server;
    let baseUrl;
    let tempDir;
    let testWorld;
    let testChar;
    let testLoc;
    let testSim;
    let testSimChar;
    let isAdminUser = false;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-events-api-test-'));
        const dbPath = path.join(tempDir, 'events-api-test.db');
        await init({ dbPath });

        testWorld = createWorld({ name: 'API World' });
        testChar = createCharacter(testWorld.lws_id, { name: 'Evelyn' });
        testLoc = createLocation(testWorld.lws_id, { name: 'Sanctuary' });

        testSim = createSimulation(testWorld.lws_id, {
            name: 'API Sim',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });

        testSimChar = addSimulationCharacter(testSim.lws_id, {
            character_id: testChar.lws_id,
            initial_location_id: testLoc.lws_id,
        });

        const app = express();
        app.use(express.json());

        // Middleware to mock SillyTavern user and admin context
        app.use((req, res, next) => {
            req.user = {
                profile: {
                    admin: isAdminUser,
                },
            };
            next();
        });

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

    // ------------------------------------------------------------------------
    // 1. POST /simulations/:simLwsId/events
    // ------------------------------------------------------------------------
    test('POST /simulations/:simLwsId/events commits event with HTTP 201', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${testSim.lws_id}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_type: EVENT_TYPES.REST,
                actor_character_id: testSimChar.lws_id,
                payload: {},
            }),
        });

        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.lws_id).toBeDefined();
        expect(data.event_type).toBe(EVENT_TYPES.REST);
        expect(data.actor_character_id).toBe(testSimChar.lws_id);
    });

    test('POST /simulations/:simLwsId/events rejects client-forged system provenance with HTTP 403', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${testSim.lws_id}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_type: EVENT_TYPES.REST,
                actor_character_id: testSimChar.lws_id,
                provenance: 'system',
            }),
        });

        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.code).toBe('FORBIDDEN_PROVENANCE');
    });

    test('POST /simulations/:simLwsId/events handles idempotency replay (201) and conflict (409)', async () => {
        const key = 'idem-key-12345';

        // First call: succeeds
        const res1 = await fetch(`${baseUrl}/api/living-world/simulations/${testSim.lws_id}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_type: EVENT_TYPES.REST,
                actor_character_id: testSimChar.lws_id,
                payload: { duration: 10 },
                idempotency_key: key,
            }),
        });
        expect(res1.status).toBe(201);
        const event1 = await res1.json();

        // Exact replay: returns existing event with HTTP 201
        const res2 = await fetch(`${baseUrl}/api/living-world/simulations/${testSim.lws_id}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_type: EVENT_TYPES.REST,
                actor_character_id: testSimChar.lws_id,
                payload: { duration: 10 },
                idempotency_key: key,
            }),
        });
        expect(res2.status).toBe(201);
        const event2 = await res2.json();
        expect(event2.lws_id).toBe(event1.lws_id);

        // Tampered payload with same key: returns HTTP 409 Conflict
        const res3 = await fetch(`${baseUrl}/api/living-world/simulations/${testSim.lws_id}/events`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_type: EVENT_TYPES.REST,
                actor_character_id: testSimChar.lws_id,
                payload: { duration: 999 }, // Different duration
                idempotency_key: key,
            }),
        });
        expect(res3.status).toBe(409);
    });

    // ------------------------------------------------------------------------
    // 2. GET /simulations/:simLwsId/events & 3. GET /simulations/:simLwsId/events/:eventLwsId
    // ------------------------------------------------------------------------
    test('GET /simulations/:simLwsId/events lists events with pagination', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${testSim.lws_id}/events?limit=10&offset=0`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBeGreaterThan(0);

        const firstEvent = data[0];
        const singleRes = await fetch(`${baseUrl}/api/living-world/simulations/${testSim.lws_id}/events/${firstEvent.lws_id}`);
        expect(singleRes.status).toBe(200);
        const singleData = await singleRes.json();
        expect(singleData.lws_id).toBe(firstEvent.lws_id);
    });

    // ------------------------------------------------------------------------
    // 4. POST /simulations/:simLwsId/turns & 5/6. GET /turns
    // ------------------------------------------------------------------------
    test('POST /simulations/:simLwsId/turns executes successful turn with HTTP 201', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${testSim.lws_id}/turns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_input: 'Evelyn rests.',
                proposals: [
                    {
                        event_type: EVENT_TYPES.REST,
                        actor_character_id: testSimChar.lws_id,
                    },
                ],
            }),
        });

        expect(res.status).toBe(201);
        const turn = await res.json();
        expect(turn.status).toBe('committed');
        expect(turn.lws_id).toBeDefined();

        // Retrieve turn by UUID
        const getRes = await fetch(`${baseUrl}/api/living-world/simulations/${testSim.lws_id}/turns/${turn.lws_id}`);
        expect(getRes.status).toBe(200);
        const fetchedTurn = await getRes.json();
        expect(fetchedTurn.lws_id).toBe(turn.lws_id);

        // List turns
        const listRes = await fetch(`${baseUrl}/api/living-world/simulations/${testSim.lws_id}/turns`);
        expect(listRes.status).toBe(200);
        const list = await listRes.json();
        expect(list.some(t => t.lws_id === turn.lws_id)).toBe(true);
    });

    test('POST /simulations/:simLwsId/turns returns HTTP 422 with rejected turn body when authority fails', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${testSim.lws_id}/turns`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_input: 'Illegal action',
                proposals: [
                    {
                        // Actor in loc1 Sanctuary, object in nonexistent or wrong location
                        event_type: EVENT_TYPES.INTERACT_OBJECT,
                        actor_character_id: testSimChar.lws_id,
                        location_id: '00000000-0000-0000-0000-000000000001', // Nonexistent
                    },
                ],
            }),
        });

        expect(res.status).toBe(422);
        const turn = await res.json();
        expect(turn.status).toBe('rejected');
        expect(turn.error_details).toBeDefined();
    });

    // ------------------------------------------------------------------------
    // 7. POST /simulations/:simLwsId/replay-verify
    // ------------------------------------------------------------------------
    test('POST /simulations/:simLwsId/replay-verify confirms parity with HTTP 200', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${testSim.lws_id}/replay-verify`, {
            method: 'POST',
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.verified).toBe(true);
        expect(data.drift_detected).toBe(false);
    });

    // ------------------------------------------------------------------------
    // Soft-delete across active, paused, and archived simulations
    // ------------------------------------------------------------------------
    test('DELETE /simulations/:simLwsId operates across active, paused, and archived simulations', async () => {
        // 1. Delete active simulation
        const simActive = createSimulation(testWorld.lws_id, {
            name: 'Active Sim to Delete',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });
        const resActive = await fetch(`${baseUrl}/api/living-world/simulations/${simActive.lws_id}`, {
            method: 'DELETE',
        });
        expect(resActive.status).toBe(204);

        // 2. Delete paused simulation
        const simPaused = createSimulation(testWorld.lws_id, {
            name: 'Paused Sim to Delete',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });
        await fetch(`${baseUrl}/api/living-world/simulations/${simPaused.lws_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'paused' }),
        });
        const resPaused = await fetch(`${baseUrl}/api/living-world/simulations/${simPaused.lws_id}`, {
            method: 'DELETE',
        });
        expect(resPaused.status).toBe(204);

        // 3. Delete archived simulation
        const simArchived = createSimulation(testWorld.lws_id, {
            name: 'Archived Sim to Delete',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });
        await fetch(`${baseUrl}/api/living-world/simulations/${simArchived.lws_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'archived' }),
        });
        const resArchived = await fetch(`${baseUrl}/api/living-world/simulations/${simArchived.lws_id}`, {
            method: 'DELETE',
        });
        expect(resArchived.status).toBe(204);
    });
});
