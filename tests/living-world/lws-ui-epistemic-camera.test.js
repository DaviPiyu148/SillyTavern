import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import {
    init,
    onExit,
    getDb,
    createWorld,
    createLocation,
    createCharacter,
    createSimulation,
    addSimulationCharacter,
    EVENT_TYPES,
} from '../../src/living-world/index.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';
import { LwsApiClient } from '../../public/scripts/living-world/api.js';

describe('LWS UI Epistemic Camera & Multi-Character Autonomy (lws-ui-epistemic-camera)', () => {
    let server;
    let baseUrl;
    let tempDir;
    let client;

    let world;
    let locLibrary;
    let locArchives;
    let charDave;
    let charCharlotte;
    let sim;
    let simDave;
    let simCharlotte;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-ui-epistemic-test-'));
        const dbPath = path.join(tempDir, 'ui-epistemic-test.db');
        await init({ dbPath });

        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.user = { profile: { handle: 'test-admin', admin: true, enabled: true } };
            next();
        });
        app.use('/api/living-world', lwsRouter);

        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        client = new LwsApiClient({ baseUrl });

        // Seed World and Locations with travel connection (1800s / 30m distance)
        world = createWorld({ name: 'Epistemic Test World' });

        locArchives = createLocation(world.lws_id, {
            name: 'Grand Archives',
            description: 'A subterranean repository of ancient folios',
        });

        locLibrary = createLocation(world.lws_id, {
            name: 'Academy Library',
            description: 'A quiet reading hall overlooking the courtyard',
            extensions: {
                connections: {
                    [locArchives.lws_id]: { duration_seconds: 1800 },
                },
            },
        });

        // Seed Characters
        charDave = createCharacter(world.lws_id, { name: 'Dave' });
        charCharlotte = createCharacter(world.lws_id, { name: 'Charlotte' });

        // Create Simulation starting on Monday 08:45:00Z
        sim = createSimulation(world.lws_id, {
            name: 'Autonomous Simulation',
            initial_fictional_time: '2026-06-01T08:45:00Z',
        });

        // Add Dave at Academy Library
        simDave = addSimulationCharacter(sim.lws_id, {
            character_id: charDave.lws_id,
            current_location_id: locLibrary.lws_id,
            activity: 'reading astronomy codex',
        });

        // Add Charlotte initially at Academy Library
        simCharlotte = addSimulationCharacter(sim.lws_id, {
            character_id: charCharlotte.lws_id,
            current_location_id: locLibrary.lws_id,
            activity: 'preparing research notes',
        });

        // Assign Charlotte a routine: Monday 09:30 - 12:00 at Grand Archives
        // (Planned departure discovered at 09:00:00Z, arrival at 09:30:00Z)
        await client.updateRoutines(sim.lws_id, simCharlotte.lws_id, {
            routines: [{
                block_id: 'charlotte_archival_study',
                day_of_week: 'monday',
                start_time: '09:30:00',
                end_time: '12:00:00',
                activity: 'studying ancient folios',
                target_location_id: locArchives.lws_id,
                priority: 80,
            }],
        });

        // Camera set to follow Dave
        await client.setSimulationCamera(sim.lws_id, {
            mode: 'follow_character',
            target_character_lws_id: simDave.lws_id,
        });
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

    it('verifies camera follows Dave before temporal advancement', async () => {
        const cam = await client.getSimulationCamera(sim.lws_id);
        expect(cam.mode).toBe('follow_character');
        expect(cam.target_character_lws_id).toBe(simDave.lws_id);
    });

    it('AC-3a: advancing time causes off-camera Charlotte to execute routine travel in SQLite independently', async () => {
        // Advance time from 08:45:00Z to 10:00:00Z (75 minutes / 4500 seconds)
        // Charlotte's routine triggers departure at 09:00:00Z and arrival at 09:30:00Z at Grand Archives
        const advRes = await client.advanceTime(sim.lws_id, {
            target_fictional_time: '2026-06-01T10:00:00Z',
        });
        expect(advRes).toBeDefined();

        // Query database ground truth for Charlotte
        const db = getDb();
        const charRow = db.prepare(`
            SELECT sc.*, loc.lws_id AS loc_lws_id, loc.name AS loc_name
            FROM lws_simulation_characters sc
            JOIN lws_locations loc ON sc.current_location_id = loc.id
            WHERE sc.lws_id = ?
        `).get(simCharlotte.lws_id);

        expect(charRow.loc_lws_id).toBe(locArchives.lws_id);
        expect(charRow.loc_name).toBe('Grand Archives');
        expect(charRow.activity).toBe('studying ancient folios');

        // Verify Dave remained at Academy Library
        const daveRow = db.prepare(`
            SELECT sc.*, loc.lws_id AS loc_lws_id, loc.name AS loc_name
            FROM lws_simulation_characters sc
            JOIN lws_locations loc ON sc.current_location_id = loc.id
            WHERE sc.lws_id = ?
        `).get(simDave.lws_id);

        expect(daveRow.loc_lws_id).toBe(locLibrary.lws_id);
        expect(daveRow.loc_name).toBe('Academy Library');
    });

    it('AC-3b: querying Dave subjective perspective reveals zero unperceived sensory info or distant knowledge', async () => {
        const davePersp = await client.getCharacterPerspective(sim.lws_id, simDave.lws_id);
        expect(davePersp).toBeDefined();
        expect(davePersp.character.lws_id).toBe(simDave.lws_id);
        expect(davePersp.current_location.lws_id).toBe(locLibrary.lws_id);

        // Epistemic isolation: co-located characters at Library must NOT include Charlotte (who is at Archives)
        const coLocatedCharIds = (davePersp.co_located_characters || []).map(c => c.lws_id);
        expect(coLocatedCharIds).not.toContain(simCharlotte.lws_id);

        // Dave has zero unperceived knowledge or memories regarding Charlotte's travel or arrival at Archives
        const knowledgeItems = davePersp.knowledge || [];
        expect(knowledgeItems.some(k => k.content?.includes('Grand Archives') || k.content?.includes('studying ancient folios'))).toBe(false);

        const memoryItems = davePersp.memories || [];
        expect(memoryItems.some(m => m.summary?.includes('Grand Archives') || m.description?.includes('Grand Archives'))).toBe(false);
    });

    it('AC-3c: switching camera to Charlotte immediately reveals her authoritative location and state without synthesizing memories', async () => {
        // Record Charlotte memory count before camera switch
        const charlottePerspBefore = await client.getCharacterPerspective(sim.lws_id, simCharlotte.lws_id);
        const memoryCountBefore = (charlottePerspBefore.memories || []).length;

        // Switch camera to follow Charlotte
        const camUpdate = await client.setSimulationCamera(sim.lws_id, {
            mode: 'follow_character',
            target_character_lws_id: simCharlotte.lws_id,
        });
        expect(camUpdate.mode).toBe('follow_character');
        expect(camUpdate.target_character_lws_id).toBe(simCharlotte.lws_id);

        // Query Charlotte's subjective perspective after camera switch
        const charlottePersp = await client.getCharacterPerspective(sim.lws_id, simCharlotte.lws_id);
        expect(charlottePersp.character.lws_id).toBe(simCharlotte.lws_id);
        expect(charlottePersp.current_location.lws_id).toBe(locArchives.lws_id);
        expect(charlottePersp.character.activity).toBe('studying ancient folios');

        // Needs and runtime state are authoritatively maintained and progressed
        expect(charlottePersp.character.runtime_state).toBeDefined();
        const charlotteCognition = await client.getCharacterCognition(sim.lws_id, simCharlotte.lws_id);
        expect(charlotteCognition.needs).toBeDefined();

        // Invariant: camera switching itself does not synthesize memories
        const memoryCountAfter = (charlottePersp.memories || []).length;
        expect(memoryCountAfter).toBe(memoryCountBefore);
    });

    it('AC-4: mind inspector subjective cognition vs Observer privileged ground truth', async () => {
        // Dave's cognition endpoint returns only Dave's subjective drives and goals
        const daveCognition = await client.getCharacterCognition(sim.lws_id, simDave.lws_id);
        expect(daveCognition).toBeDefined();
        expect(daveCognition.needs).toBeDefined();

        // Privileged Observer Perspective returns global ground truth
        const observerPersp = await client.getObserverPerspective(sim.lws_id);
        expect(observerPersp).toBeDefined();
        expect(observerPersp.privileged).toBe(true);
        expect(observerPersp.simulation.lws_id).toBe(sim.lws_id);

        // Observer perspective includes all active characters across all distinct locations
        const allChars = observerPersp.characters || [];
        expect(allChars.length).toBeGreaterThanOrEqual(2);

        const observedDave = allChars.find(c => c.lws_id === simDave.lws_id);
        const observedCharlotte = allChars.find(c => c.lws_id === simCharlotte.lws_id);

        expect(observedDave).toBeDefined();
        expect(observedDave.current_location_id).toBe(locLibrary.lws_id);

        expect(observedCharlotte).toBeDefined();
        expect(observedCharlotte.current_location_id).toBe(locArchives.lws_id);
        expect(observedCharlotte.activity).toBe('studying ancient folios');
    });
});
