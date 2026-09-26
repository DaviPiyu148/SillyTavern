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
    createLocation,
    createCharacter,
    createSimulation,
    commitEvent,
    EVENT_TYPES,
    GENERATION_MODES,
} from '../../src/living-world/index.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';

describe('Phase 10 — Prompt Context & Generation REST API Endpoints', () => {
    let server;
    let baseUrl;
    let tempDir;
    let worldLwsId;
    let locLwsId;
    let simLwsId;
    let charAId;
    let charBId;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-prompt-api-test-'));
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

        const world = createWorld({ name: 'API Prompt World', premise: 'A world of high adventure' });
        worldLwsId = world.lws_id;

        const loc = createLocation(world.lws_id, { name: 'Sunken Citadel' });
        locLwsId = loc.lws_id;

        const charA = createCharacter(world.lws_id, { name: 'Thorne', personality: 'Stern and direct' });
        charAId = charA.lws_id;

        const charB = createCharacter(world.lws_id, { name: 'Seraphina', personality: 'Wise scholar' });
        charBId = charB.lws_id;

        const sim = createSimulation(world.lws_id, { name: 'Citadel Sim', initial_fictional_time: '1000-01-01T12:00:00Z' });
        simLwsId = sim.lws_id;

        commitEvent(simLwsId, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            actor_character_id: charAId,
            location_id: locLwsId,
            fictional_time: '1000-01-01T12:00:00Z',
            payload: { character_id: charAId, activity: 'exploring', physical_condition: 'healthy' },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });

        commitEvent(simLwsId, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            actor_character_id: charBId,
            location_id: locLwsId,
            fictional_time: '1000-01-01T12:00:00Z',
            payload: { character_id: charBId, activity: 'deciphering runes', physical_condition: 'healthy' },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });
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

    test('POST /api/living-world/simulations/:simLwsId/prompt-context/build returns layered prompt breakdown', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/prompt-context/build`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                character_lws_id: charAId,
                generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
                user_input: 'Seraphina, what do these glyphs mean?',
                max_tokens: 2048,
            }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.context).toBeDefined();
        expect(data.context.simulation_id).toBe(simLwsId);
        expect(data.context.authored_character_id).toBe(charAId);
        expect(data.context.character_id).toBeDefined();
        expect(data.context.layers).toBeDefined();
        expect(data.context.token_budget).toBeDefined();
        expect(data.context.token_budget.max_tokens).toBe(2048);
        expect(data.context.messages).toHaveLength(2);
    });

    test('POST /api/living-world/simulations/:simLwsId/prompt-context/build returns 400 for invalid mode', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/prompt-context/build`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                generation_mode: 'non_existent_mode',
            }),
        });

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toContain('Invalid generation mode');
    });

    test('POST /api/living-world/simulations/:simLwsId/generate runs generation turn and records narrative turn', async () => {
        const mockResponse = `
<lws_proposal>
{
  "event_type": "COMMUNICATE",
  "actor_character_id": "${charAId}",
  "target_character_id": "${charBId}",
  "location_id": "${locLwsId}",
  "payload": {
    "channel": "direct",
    "content": "Can you translate the archway?"
  }
}
</lws_proposal>
Thorne pointed his torch toward the crumbling archway. "Can you translate the archway?" he asked quietly.`;

        const res = await fetch(`${baseUrl}/api/living-world/simulations/${simLwsId}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                character_lws_id: charAId,
                generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
                user_input: 'Ask Seraphina about the archway',
                mock_response: mockResponse,
            }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.narrative).toContain('Thorne pointed his torch');
        expect(data.proposals).toHaveLength(1);
        expect(data.events).toHaveLength(1);
        expect(data.turn).toBeDefined();
        expect(data.turn.status).toBe('committed');
    });

    test('POST /api/living-world/simulations/:simLwsId/generate returns 404 for unknown simulation', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/simulations/00000000-0000-0000-0000-000000000000/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
        });

        expect(res.status).toBe(404);
    });
});
