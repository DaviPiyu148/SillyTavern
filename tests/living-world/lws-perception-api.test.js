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
    commitEvent,
    EVENT_TYPES,
} from '../../src/living-world/index.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';

describe('LWS Phase 6 Perception, Knowledge, Memory, Belief & Observer REST API', () => {
    let server;
    let baseUrl;
    let tempDir;
    let world;
    let locA;
    let charAlice;
    let charBob;
    let sim;
    let simAlice;
    let simBob;
    let commEvent;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-perception-api-test-'));
        const dbPath = path.join(tempDir, 'perception-api-test.db');
        await init({ dbPath });

        world = createWorld({ name: 'API Perception World' });
        locA = createLocation(world.lws_id, { name: 'Plaza' });
        charAlice = createCharacter(world.lws_id, { name: 'Alice' });
        charBob = createCharacter(world.lws_id, { name: 'Bob' });

        sim = createSimulation(world.lws_id, {
            name: 'API Perception Sim',
            initial_fictional_time: '2026-06-01T10:00:00Z',
        });

        simAlice = addSimulationCharacter(sim.lws_id, {
            character_id: charAlice.lws_id,
            initial_location_id: locA.lws_id,
        });

        simBob = addSimulationCharacter(sim.lws_id, {
            character_id: charBob.lws_id,
            initial_location_id: locA.lws_id,
        });

        commEvent = commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: simAlice.lws_id,
            target_character_id: simBob.lws_id,
            location_id: locA.lws_id,
            fictional_time: '2026-06-01T10:00:00Z',
            provenance: 'director',
            payload: {
                message: 'Hello Bob, here is the secret.',
                facts: [{ fact_key: 'secret_passage', content: 'Behind the tapestry' }],
            },
        }, { isAdmin: true });

        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.user = { profile: { admin: true } };
            next();
        });
        app.use('/api/living-world', lwsRouter);

        await new Promise(resolve => {
            server = http.createServer(app).listen(0, '127.0.0.1', () => {
                const addr = server.address();
                baseUrl = `http://127.0.0.1:${addr.port}/api/living-world`;
                resolve();
            });
        });
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

    // --- Perceptions ---
    test('GET /simulations/:simLwsId/events/:eventLwsId/perceptions lists event perceptions', async () => {
        const res = await fetch(`${baseUrl}/simulations/${sim.lws_id}/events/${commEvent.lws_id}/perceptions`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toHaveProperty('perceptions');
        expect(Array.isArray(data.perceptions)).toBe(true);
        expect(data.perceptions.length).toBeGreaterThanOrEqual(1);
    });

    test('GET /simulations/:simLwsId/characters/:charLwsId/perceptions lists character perceptions', async () => {
        const res = await fetch(`${baseUrl}/simulations/${sim.lws_id}/characters/${simBob.lws_id}/perceptions`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toHaveProperty('perceptions');
        expect(Array.isArray(data.perceptions)).toBe(true);
    });

    // --- Knowledge ---
    test('GET /simulations/:simLwsId/characters/:charLwsId/knowledge lists knowledge', async () => {
        const res = await fetch(`${baseUrl}/simulations/${sim.lws_id}/characters/${simBob.lws_id}/knowledge`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toHaveProperty('knowledge');
        expect(data.knowledge.some(k => k.fact_key === 'secret_passage')).toBe(true);
    });

    test('POST and GET single knowledge fact', async () => {
        // POST knowledge (Director injection)
        const postRes = await fetch(`${baseUrl}/simulations/${sim.lws_id}/characters/${simAlice.lws_id}/knowledge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                fact_key: 'dragon_weakness',
                content: 'Cold iron arrow',
                source_channel: 'director_injection',
            }),
        });
        expect(postRes.status).toBe(201);
        const createdFact = await postRes.json();
        expect(createdFact.fact_key).toBe('dragon_weakness');
        expect(createdFact.content).toBe('Cold iron arrow');

        // GET single fact
        const getRes = await fetch(`${baseUrl}/simulations/${sim.lws_id}/characters/${simAlice.lws_id}/knowledge/dragon_weakness`);
        expect(getRes.status).toBe(200);
        const fetchedFact = await getRes.json();
        expect(fetchedFact.content).toBe('Cold iron arrow');
    });

    // --- Memories ---
    test('GET memories and GET /memories/retrieve with query parameters', async () => {
        // GET memories
        const getRes = await fetch(`${baseUrl}/simulations/${sim.lws_id}/characters/${simAlice.lws_id}/memories`);
        expect(getRes.status).toBe(200);
        const getData = await getRes.json();
        expect(getData).toHaveProperty('memories');
        expect(getData.memories.length).toBeGreaterThanOrEqual(1);

        // GET retrieve memories via query params
        const retRes = await fetch(`${baseUrl}/simulations/${sim.lws_id}/characters/${simAlice.lws_id}/memories/retrieve?query=secret&limit=5`);
        expect(retRes.status).toBe(200);
        const retData = await retRes.json();
        expect(retData).toHaveProperty('memories');
        expect(Array.isArray(retData.memories)).toBe(true);
    });

    // --- Beliefs ---
    test('PUT and GET character beliefs', async () => {
        // PUT belief (Director update)
        const putRes = await fetch(`${baseUrl}/simulations/${sim.lws_id}/characters/${simAlice.lws_id}/beliefs/Bob:is_honest`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                statement: 'Bob is genuinely honest',
                belief_type: 'belief',
                confidence: 85,
                source_basis: 'observation',
            }),
        });
        expect(putRes.status).toBe(200);
        const updatedBelief = await putRes.json();
        expect(updatedBelief.confidence).toBe(85);
        expect(updatedBelief.statement).toBe('Bob is genuinely honest');

        // GET beliefs list
        const getRes = await fetch(`${baseUrl}/simulations/${sim.lws_id}/characters/${simAlice.lws_id}/beliefs`);
        expect(getRes.status).toBe(200);
        const listData = await getRes.json();
        expect(listData.beliefs.some(b => b.subject_key === 'Bob:is_honest')).toBe(true);
    });

    // --- Camera & Perspectives ---
    test('GET and POST camera, and GET subjective & observer perspectives', async () => {
        // POST camera focus
        const camRes = await fetch(`${baseUrl}/simulations/${sim.lws_id}/camera`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                camera_name: 'default',
                mode: 'follow_character',
                target_character_id: simAlice.lws_id,
            }),
        });
        expect(camRes.status).toBe(200);
        const camData = await camRes.json();
        expect(camData.mode).toBe('follow_character');
        expect(camData.target_character_lws_id).toBe(simAlice.lws_id);

        // GET camera focus
        const getCamRes = await fetch(`${baseUrl}/simulations/${sim.lws_id}/camera`);
        expect(getCamRes.status).toBe(200);
        const fetchedCam = await getCamRes.json();
        expect(fetchedCam.mode).toBe('follow_character');

        // GET subjective perspective for Alice
        const persRes = await fetch(`${baseUrl}/simulations/${sim.lws_id}/characters/${simAlice.lws_id}/perspective`);
        expect(persRes.status).toBe(200);
        const persData = await persRes.json();
        expect(persData.character.lws_id).toBe(simAlice.lws_id);
        expect(persData.current_location.lws_id).toBe(locA.lws_id);
        expect(persData.privileged).toBe(false);

        // GET privileged Observer perspective
        const obsRes = await fetch(`${baseUrl}/simulations/${sim.lws_id}/observer/perspective`);
        expect(obsRes.status).toBe(200);
        const obsData = await obsRes.json();
        expect(obsData.simulation.lws_id).toBe(sim.lws_id);
        expect(obsData.privileged).toBe(true);
        expect(obsData.characters).toHaveLength(2);
    });
});
