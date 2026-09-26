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
import { createFaction, addFactionMember } from '../../src/living-world/authored/factions.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { commitEvent } from '../../src/living-world/events/events.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';

describe('LWS Phase 8 — Social & Development REST API Endpoints', () => {
    let server;
    let baseUrl;
    let tempDir;
    let simLwsId;
    let charAliceId;
    let charBobId;
    let factionId;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-social-api-test-'));
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

        const world = createWorld({ name: 'API Social World' });
        const location = createLocation(world.lws_id, { name: 'Plaza' });
        const charA = createCharacter(world.lws_id, { name: 'Alice' });
        const charB = createCharacter(world.lws_id, { name: 'Bob' });
        const faction = createFaction(world.lws_id, { name: 'Vanguard' });
        factionId = faction.lws_id;

        addFactionMember(world.lws_id, faction.lws_id, { character_lws_id: charA.lws_id, role: 'officer' });

        const sim = createSimulation(world.lws_id, {
            name: 'API Social Sim',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });
        simLwsId = sim.lws_id;

        const simCharA = addSimulationCharacter(sim.lws_id, { character_id: charA.lws_id, initial_location_id: location.lws_id });
        const simCharB = addSimulationCharacter(sim.lws_id, { character_id: charB.lws_id, initial_location_id: location.lws_id });
        charAliceId = simCharA.lws_id;
        charBobId = simCharB.lws_id;

        // Establish initial relationship and rumor
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: charAliceId,
            target_character_id: charBobId,
            location_id: location.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                relationship_delta: {
                    delta_trust: 40,
                    delta_affection: 30,
                    delta_familiarity: 50,
                    delta_respect: 20,
                    delta_loyalty: 10,
                    narrative_rationale: 'Allied partnership',
                },
                social_information: {
                    subject_key: 'castle_rumor',
                    topic: 'castle',
                    claim_statement: 'The castle gates will open at dawn.',
                    veracity: 'true',
                    transmission_depth: 0,
                    confidence_score: 90,
                },
            },
            provenance: 'llm_proposal',
        }, { isAdmin: true });
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
    // Tier 1: Privileged Observer
    // ========================================================================

    test('GET /social/graph returns full social graph', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/social/graph`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.graph).toBeDefined();
        expect(data.graph.characters).toHaveLength(2);
        expect(data.graph.edges).toHaveLength(1);
        expect(data.graph.edges[0].trust).toBe(40);
    });

    test('GET /social-information returns simulation-wide rumor list', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/social-information?topic=castle`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.social_information).toHaveLength(1);
        expect(data.social_information[0].subject_key).toBe('castle_rumor');
    });

    test('GET /social-information/:infoLwsId/tree returns rumor tree', async () => {
        const listRes = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/social-information`);
        const listData = await listRes.json();
        const infoLwsId = listData.social_information[0].lws_id;

        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/social-information/${infoLwsId}/tree`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.tree).toBeDefined();
        expect(data.tree.subject_key).toBe('castle_rumor');
    });

    test('GET /faction-memberships returns simulation-wide memberships', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/faction-memberships`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.faction_memberships).toHaveLength(1);
        expect(data.faction_memberships[0].rank_role).toBe('officer');
    });

    // ========================================================================
    // Tier 2: Subjective Character
    // ========================================================================

    test('GET /characters/:charLwsId/relationships returns character-held relationships', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charAliceId}/relationships`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.relationships).toHaveLength(1);
        expect(data.relationships[0].target_character_id).toBe(charBobId);
    });

    test('GET /characters/:charLwsId/relationships/:targetCharLwsId returns specific directional relationship', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charAliceId}/relationships/${charBobId}`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.trust).toBe(40);
        expect(data.familiarity).toBe(50);
    });

    test('GET /characters/:charLwsId/relationships/:targetCharLwsId/evidence returns interaction ledger', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charAliceId}/relationships/${charBobId}/evidence`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.evidence).toHaveLength(1);
        expect(data.evidence[0].delta_trust).toBe(40);
        expect(data.evidence[0].narrative_rationale).toBe('Allied partnership');
    });

    test('GET /characters/:charLwsId/factions returns character faction memberships', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charAliceId}/factions`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.factions).toHaveLength(1);
        expect(data.factions[0].rank_role).toBe('officer');
    });

    test('GET /characters/:charLwsId/known-rumors returns rumors known to character', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/characters/${charAliceId}/known-rumors`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.rumors).toBeDefined();
    });

    // ========================================================================
    // Tier 3: Director Authority Interventions
    // ========================================================================

    test('POST /social-interventions executes authoritative director intervention', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/social-interventions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                actor_character_id: charAliceId,
                target_character_id: charBobId,
                relationship: {
                    delta_trust: 10,
                    delta_affection: 10,
                },
                rationale: 'Director intervention to strengthen alliance',
            }),
        });

        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.status).toBe('committed');
        expect(data.event).toBeDefined();
        expect(data.event.event_type).toBe('DIRECTOR_MODIFY_STATE');
    });
});
