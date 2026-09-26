import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { init, onExit, getDb } from '../../src/living-world/index.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { initCharacterNeeds } from '../../src/living-world/cognition/needs.js';
import { initCharacterValues } from '../../src/living-world/cognition/values.js';
import { initCharacterEmotion } from '../../src/living-world/cognition/emotions.js';

describe('LWS Phase 7 — Cognition REST API Endpoints', () => {
    let server;
    let baseUrl;
    let tempDir;
    let simLwsId;
    let charLwsId;
    let isAdminUser = false;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-cognition-api-test-'));
        const dbPath = path.join(tempDir, 'test.db');
        await init({ dbPath });

        const app = express();
        app.use(express.json());

        app.use((req, _res, next) => {
            req.user = {
                profile: { handle: 'test-user', admin: isAdminUser, enabled: true },
            };
            req.isAdmin = isAdminUser;
            next();
        });

        app.use('/api/living-world', lwsRouter);

        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;

        const world = createWorld({ name: 'Cognition World' });
        const char = createCharacter(world.lws_id, { name: 'Finn' });
        const sim = createSimulation(world.lws_id, {
            name: 'Cognition Sim',
            initial_fictional_time: '2026-01-01T08:00:00Z',
        });
        const simChar = addSimulationCharacter(sim.lws_id, { character_id: char.lws_id });

        simLwsId = sim.lws_id;
        charLwsId = simChar.lws_id;

        const db = getDb();
        const simRow = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = ?').get(simLwsId);
        const charRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(charLwsId);

        initCharacterNeeds(db, simRow.id, charRow.id, simLwsId, charLwsId, '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z');
        initCharacterValues(db, simRow.id, charRow.id, simLwsId, charLwsId, '2026-01-01T00:00:00Z');
        initCharacterEmotion(db, simRow.id, charRow.id, simLwsId, charLwsId, '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z');
    });

    afterAll(async () => {
        await onExit();
        if (server) await new Promise(resolve => server.close(resolve));
        if (tempDir) {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
        }
    });

    test('GET /characters/:charLwsId/cognition returns full cognition payload', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charLwsId}/cognition`);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.character_id).toBe(charLwsId);
        expect(data.needs).toHaveLength(5);
        expect(data.values).toHaveLength(6);
        expect(data.current_emotion).toBeDefined();
        expect(data.active_goals).toBeDefined();
    });

    test('GET /characters/:charLwsId/needs returns 5 needs', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charLwsId}/needs`);
        expect(res.status).toBe(200);

        const data = await res.json();
        expect(data.needs).toHaveLength(5);
    });

    test('PUT /characters/:charLwsId/needs/:needName requires admin and updates need', async () => {
        // Non-admin -> 403
        isAdminUser = false;
        const resForbidden = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charLwsId}/needs/energy`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: 45 }),
        });
        expect(resForbidden.status).toBe(403);

        // Admin -> 200
        isAdminUser = true;
        const resOk = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charLwsId}/needs/energy`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: 45 }),
        });
        expect(resOk.status).toBe(200);

        const updated = await resOk.json();
        expect(updated.satisfaction).toBe(45);
    });

    test('Goals CRUD lifecycle via REST API', async () => {
        // Create Goal -> 201
        const resCreate = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charLwsId}/goals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Scout perimeter',
                priority: 60,
                client_goal_key: 'scout_perimeter_1',
            }),
        });
        expect(resCreate.status).toBe(201);
        const goal = await resCreate.json();
        expect(goal.lws_id).toBeDefined();
        expect(goal.title).toBe('Scout perimeter');

        // Duplicate client_goal_key -> 409
        const resConflict = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charLwsId}/goals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Duplicate key goal',
                client_goal_key: 'scout_perimeter_1',
            }),
        });
        expect(resConflict.status).toBe(409);

        // Patch immutable field -> 422
        const resImmutable = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charLwsId}/goals/${goal.lws_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client_goal_key: 'different_key' }),
        });
        expect(resImmutable.status).toBe(422);

        // Patch mutable field -> 200
        const resPatch = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charLwsId}/goals/${goal.lws_id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ progress: 50, priority: 70 }),
        });
        expect(resPatch.status).toBe(200);
        const patchedGoal = await resPatch.json();
        expect(patchedGoal.progress).toBe(50);
        expect(patchedGoal.priority).toBe(70);

        // Delete goal -> 204
        const resDelete = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charLwsId}/goals/${goal.lws_id}`, {
            method: 'DELETE',
        });
        expect(resDelete.status).toBe(204);
    });

    test('GET /characters/:charLwsId/values returns 6 values', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charLwsId}/values`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.values).toHaveLength(6);
    });

    test('POST /characters/:charLwsId/deliberate dry run vs execute mode', async () => {
        // Dry run
        const resDry = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charLwsId}/deliberate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                execute_chosen_action: false,
                candidates: [{ action_type: 'REST' }],
            }),
        });
        expect(resDry.status).toBe(200);
        const dryData = await resDry.json();
        expect(dryData.dry_run).toBe(true);

        // Execute mode
        const resExec = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charLwsId}/deliberate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                execute_chosen_action: true,
                candidates: [{ action_type: 'REST' }],
            }),
        });
        expect(resExec.status).toBe(200);
        const execData = await resExec.json();
        expect(execData.success).toBe(true);
        expect(execData.intention_id).toBeDefined();
    });
});
