import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { init, onExit, getDb } from '../../src/living-world/index.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { createAmbientArchetype } from '../../src/living-world/population/archetypes.js';
import { buildTransientId, getTimeBucket } from '../../src/living-world/population/common.js';

describe('LWS Phase 9 — Population & Environment REST API Endpoints', () => {
    let server;
    let baseUrl;
    let tempDir;
    let worldLwsId;
    let locLwsId;
    let simLwsId;
    let charAliceId;
    let archetypeLwsId;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-env-api-test-'));
        const dbPath = path.join(tempDir, 'test.db');
        await init({ dbPath });

        const app = express();
        app.use(express.json());

        app.use((req, _res, next) => {
            req.user = {
                profile: { handle: 'test-admin', admin: true, enabled: true },
            };
            req.isAdmin = true;
            next();
        });

        app.use('/api/living-world', lwsRouter);

        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;

        const world = createWorld({ name: 'API Env World' });
        worldLwsId = world.lws_id;

        const location = createLocation(world.lws_id, { name: 'Town Square' });
        locLwsId = location.lws_id;

        const charA = createCharacter(world.lws_id, { name: 'Alice' });

        const arch = createAmbientArchetype(getDb(), world.lws_id, {
            archetype_key: 'baker',
            name: 'Town Baker',
            description: 'A local baker',
            roles: ['baker'],
            weight: 50,
            location_filter_tags: [],
            time_filter_buckets: [],
        });
        archetypeLwsId = arch.lws_id;

        const sim = createSimulation(world.lws_id, {
            name: 'API Env Sim',
            initial_fictional_time: '2026-06-15T10:00:00Z',
        });
        simLwsId = sim.lws_id;

        const simCharA = addSimulationCharacter(sim.lws_id, { character_id: charA.lws_id, initial_location_id: location.lws_id });
        charAliceId = simCharA.lws_id;
    });

    afterAll(async () => {
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
        await onExit();
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    // ========================================================================
    // Authored Ambient Archetypes Endpoints
    // ========================================================================

    test('GET /worlds/:worldLwsId/ambient-archetypes returns list', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/worlds/${worldLwsId}/ambient-archetypes`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ambient_archetypes).toHaveLength(1);
        expect(data.ambient_archetypes[0].archetype_key).toBe('baker');
    });

    test('GET /worlds/:worldLwsId/ambient-archetypes/:archetypeLwsId returns single archetype', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/worlds/${worldLwsId}/ambient-archetypes/${archetypeLwsId}`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.lws_id).toBe(archetypeLwsId);
        expect(data.name).toBe('Town Baker');
    });

    test('PATCH /worlds/:worldLwsId/ambient-archetypes/:archetypeLwsId updates archetype', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/worlds/${worldLwsId}/ambient-archetypes/${archetypeLwsId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ weight: 75 }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.weight).toBe(75);
    });

    // ========================================================================
    // Tier 1: Observer API Endpoints
    // ========================================================================

    test('GET /simulations/:simLwsId/locations/:locLwsId/environment returns environment state', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/locations/${locLwsId}/environment`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.weather).toBe('clear');
        expect(data.temperature_celsius).toBeDefined();
        expect(data.lighting_level).toBeDefined();
    });

    test('GET /simulations/:simLwsId/locations/:locLwsId/operational-state returns operational state', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/locations/${locLwsId}/operational-state`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.access_status).toBe('open');
        expect(data.crowd_density).toBe('moderate');
    });

    test('GET /simulations/:simLwsId/locations/:locLwsId/ambient-population returns dynamic ambient population preview', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/locations/${locLwsId}/ambient-population`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.ambient_population).toBeDefined();
        expect(Array.isArray(data.ambient_population)).toBe(true);
        expect(data.time_bucket).toBe(getTimeBucket('2026-06-15T10:00:00Z'));
    });

    test('GET /simulations/:simLwsId/population-tiers returns characters tier breakdown', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/population-tiers`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.character_tiers).toBeDefined();
        expect(Array.isArray(data.character_tiers)).toBe(true);
    });

    test('GET /simulations/:simLwsId/promoted-entities returns promoted records list', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/promoted-entities`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.promoted_entities).toBeDefined();
        expect(Array.isArray(data.promoted_entities)).toBe(true);
    });

    // ========================================================================
    // Tier 2: Subjective Character Endpoints
    // ========================================================================

    test('GET /simulations/:simLwsId/characters/:charLwsId/perceived-environment returns sensory perception', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charAliceId}/perceived-environment`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.character_id).toBe(charAliceId);
        expect(data.perceived_sensory).toBeDefined();
        expect(data.perceived_sensory.visual_clarity).toBe('normal');
        expect(data.perceived_sensory.is_accessible).toBe(true);
    });

    // ========================================================================
    // Tier 3: Director Authority Endpoints
    // ========================================================================

    test('POST /simulations/:simLwsId/environment-interventions applies authoritative weather & access changes', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/environment-interventions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location_id: locLwsId,
                environment: {
                    weather: 'storm',
                    temperature_override: -5.0,
                },
                operational_state: {
                    access_override: 'barricaded',
                },
            }),
        });

        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.status).toBe('committed');
        expect(data.event.event_type).toBe('DIRECTOR_MODIFY_STATE');

        // Verify updated state
        const envRes = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/locations/${locLwsId}/environment`);
        const envData = await envRes.json();
        expect(envData.weather).toBe('storm');
        expect(envData.temperature_celsius).toBe(-5.0);

        const opsRes = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/locations/${locLwsId}/operational-state`);
        const opsData = await opsRes.json();
        expect(opsData.access_status).toBe('barricaded');

        // Reset location operational state back to open for subsequent tests
        await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/environment-interventions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                location_id: locLwsId,
                operational_state: {
                    access_override: 'open',
                },
            }),
        });
    });

    test('POST /simulations/:simLwsId/promotions executes authoritative promotion of transient entity', async () => {
        const timeBucket = getTimeBucket('2026-06-15T10:00:00Z');
        const transientId = buildTransientId(simLwsId, locLwsId, timeBucket, 'baker', 0);

        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/promotions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transient_id: transientId,
                name: 'Thomas the Baker',
                target_tier: 'supporting',
                promotion_reason: 'director_intervention',
            }),
        });

        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.status).toBe('promoted');
        expect(data.character_id).toBeDefined();
        expect(data.tier).toBe('supporting');
    });
});
