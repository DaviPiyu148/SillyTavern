import { describe, test, expect, beforeEach } from '@jest/globals';
import { openDb, getDb } from '../../src/living-world/db.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { internalCommitEvent } from '../../src/living-world/events/events.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';
import { verifySimulationParity } from '../../src/living-world/events/replay.js';

describe('LWS Phase 6 Zero-SQL Pure Replay & Parity', () => {
    let db;
    let world;
    let locA;
    let charAlice;
    let charBob;
    let sim;
    let simAlice;
    let simBob;

    beforeEach(() => {
        openDb(':memory:');
        db = getDb();

        world = createWorld({ name: 'Replay World', description: 'Test World' });
        locA = createLocation(world.lws_id, { name: 'Great Hall' });
        charAlice = createCharacter(world.lws_id, { name: 'Alice' });
        charBob = createCharacter(world.lws_id, { name: 'Bob' });

        sim = createSimulation(world.lws_id, {
            name: 'Replay Simulation',
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
    });

    test('replays full sequence of Phase 6 events and achieves 100% database parity', () => {
        const simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);

        // 1. COMMUNICATE event: Alice tells Bob secret code
        internalCommitEvent(db, simRow, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: simAlice.lws_id,
            target_character_id: simBob.lws_id,
            location_id: locA.lws_id,
            fictional_time: '2026-06-01T10:00:00Z',
            provenance: 'director',
            payload: {
                message: 'The code is 1234',
                facts: [{ fact_key: 'secret_code', content: '1234' }],
                beliefs: [{ subject: 'Gatekeeper', predicate: 'is_awake', object_value: 'false' }],
            },
        }, { isAdmin: true });

        // 2. OBSERVE event: Bob observes Great Hall
        internalCommitEvent(db, simRow, {
            event_type: EVENT_TYPES.OBSERVE,
            actor_character_id: simBob.lws_id,
            location_id: locA.lws_id,
            fictional_time: '2026-06-01T10:00:00Z',
            provenance: 'director',
            payload: {
                target: 'chandeliers',
                observed_facts: [{ fact_key: 'hall_lighting', content: 'Dim candlelights' }],
            },
        }, { isAdmin: true });

        // 3. INTERACT_OBJECT event: Alice inspects pedestal
        internalCommitEvent(db, simRow, {
            event_type: EVENT_TYPES.INTERACT_OBJECT,
            actor_character_id: simAlice.lws_id,
            location_id: locA.lws_id,
            fictional_time: '2026-06-01T10:00:00Z',
            provenance: 'director',
            payload: {
                object_id: 'stone_pedestal',
                discovered_facts: [{ fact_key: 'pedestal_inscription', content: 'Speak friend' }],
            },
        }, { isAdmin: true });

        // 4. DIRECTOR_MODIFY_STATE: Inject belief and update camera
        internalCommitEvent(db, simRow, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            fictional_time: '2026-06-01T10:00:00Z',
            provenance: 'director',
            payload: {
                target_id: simAlice.lws_id,
                beliefs: [{
                    subject: 'Dragon',
                    predicate: 'is_sleeping',
                    object_value: 'true',
                    confidence: 95,
                    source_basis: 'director_injection',
                }],
                camera: {
                    camera_name: 'default',
                    mode: 'follow_character',
                    target_character_id: simAlice.lws_id,
                },
            },
        }, { isAdmin: true });

        // Verify Parity
        const result = verifySimulationParity(sim.lws_id);
        expect(result.verified).toBe(true);
        expect(result.drift_detected).toBe(false);
        expect(result.character_count).toBe(2);
        expect(result.event_count).toBeGreaterThanOrEqual(4);
    });
});
