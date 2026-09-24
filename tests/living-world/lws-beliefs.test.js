import { describe, test, expect, beforeEach } from '@jest/globals';
import { openDb, getDb } from '../../src/living-world/db.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { internalCommitEvent } from '../../src/living-world/events/events.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';
import {
    listCharacterBeliefs,
    getCharacterBelief,
    upsertCharacterBelief,
    softDeleteCharacterBelief,
} from '../../src/living-world/perception/beliefs.js';

describe('LWS Phase 6 Beliefs & Suspicions', () => {
    let db;
    let world;
    let loc;
    let charAlice;
    let charBob;
    let sim;
    let simAlice;

    beforeEach(() => {
        openDb(':memory:');
        db = getDb();

        world = createWorld({ name: 'Belief World', description: 'Test World' });
        loc = createLocation(world.lws_id, { name: 'Town Square' });
        charAlice = createCharacter(world.lws_id, { name: 'Alice' });
        charBob = createCharacter(world.lws_id, { name: 'Bob' });
        sim = createSimulation(world.lws_id, {
            name: 'Belief Simulation',
            initial_fictional_time: '2026-06-01T10:00:00Z',
        });
        simAlice = addSimulationCharacter(sim.lws_id, {
            character_id: charAlice.lws_id,
            initial_location_id: loc.lws_id,
        });
        addSimulationCharacter(sim.lws_id, {
            character_id: charBob.lws_id,
            initial_location_id: loc.lws_id,
        });
    });

    test('upserts, reads, and lists character beliefs with valid attributes', () => {
        const simRow = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
        const aliceRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simAlice.lws_id);

        const belief = upsertCharacterBelief(db, {
            simulation_id: simRow.id,
            simulation_character_id: aliceRow.id,
            char_lws_id: simAlice.lws_id,
            subject: 'Bob',
            predicate: 'is_trustworthy',
            object_value: 'false',
            confidence: 75,
            source_basis: 'observation',
            fictional_time_formed: '2026-06-01T10:00:00Z',
        });

        expect(belief).toBeDefined();
        expect(belief.lws_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(belief.subject).toBe('Bob');
        expect(belief.predicate).toBe('is_trustworthy');
        expect(belief.object_value).toBe('false');
        expect(belief.confidence).toBe(75);
        expect(belief.source_basis).toBe('observation');

        const single = getCharacterBelief(db, simAlice.lws_id, 'Bob', 'is_trustworthy');
        expect(single.lws_id).toBe(belief.lws_id);

        const list = listCharacterBeliefs(db, simAlice.lws_id);
        expect(list).toHaveLength(1);
        expect(list[0].lws_id).toBe(belief.lws_id);
    });

    test('soft deletes a character belief', () => {
        const simRow = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
        const aliceRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simAlice.lws_id);

        upsertCharacterBelief(db, {
            simulation_id: simRow.id,
            simulation_character_id: aliceRow.id,
            char_lws_id: simAlice.lws_id,
            subject: 'Bob',
            predicate: 'is_thief',
            object_value: 'true',
            confidence: 60,
            source_basis: 'hearsay',
            fictional_time_formed: '2026-06-01T10:00:00Z',
        });

        const deleted = softDeleteCharacterBelief(db, simAlice.lws_id, 'Bob', 'is_thief');
        expect(deleted).toBe(true);

        const activeList = listCharacterBeliefs(db, simAlice.lws_id);
        expect(activeList).toHaveLength(0);

        const allList = listCharacterBeliefs(db, simAlice.lws_id, { includeDeleted: true });
        expect(allList).toHaveLength(1);
    });

    test('DIRECTOR_MODIFY_STATE mutates beliefs and preserves deterministic causal event linkage', () => {
        const simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);

        const directorEvent = internalCommitEvent(db, simRow, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            fictional_time: '2026-06-01T10:00:00Z',
            provenance: 'director',
            payload: {
                target_type: 'character',
                target_id: simAlice.lws_id,
                beliefs: [
                    {
                        subject: 'Mayor',
                        predicate: 'is_corrupt',
                        object_value: 'true',
                        confidence: 90,
                        source_basis: 'director_injection',
                    },
                ],
            },
        }, { isAdmin: true });

        expect(directorEvent).toBeDefined();

        const aliceBeliefs = listCharacterBeliefs(db, simAlice.lws_id);
        expect(aliceBeliefs).toHaveLength(1);

        const mayorBelief = aliceBeliefs[0];
        expect(mayorBelief.subject).toBe('Mayor');
        expect(mayorBelief.predicate).toBe('is_corrupt');
        expect(mayorBelief.object_value).toBe('true');
        expect(mayorBelief.confidence).toBe(90);
        expect(mayorBelief.source_basis).toBe('director_injection');
        expect(mayorBelief.causal_event_lws_id).toBe(directorEvent.lws_id);
    });

    test('enforces confidence boundaries (1..100) and rejects out-of-range values', () => {
        const simRow = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
        const aliceRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simAlice.lws_id);

        // Positive boundary: 1
        const b1 = upsertCharacterBelief(db, {
            simulation_id: simRow.id,
            simulation_character_id: aliceRow.id,
            char_lws_id: simAlice.lws_id,
            subject_key: 'test:min_confidence',
            statement: 'Minimum confidence test',
            confidence: 1,
            source_basis: 'intuition',
        });
        expect(b1.confidence).toBe(1);

        // Positive boundary: 100
        const b100 = upsertCharacterBelief(db, {
            simulation_id: simRow.id,
            simulation_character_id: aliceRow.id,
            char_lws_id: simAlice.lws_id,
            subject_key: 'test:max_confidence',
            statement: 'Maximum confidence test',
            confidence: 100,
            source_basis: 'deduction',
        });
        expect(b100.confidence).toBe(100);

        // Negative boundary: 0 (rejected)
        expect(() => {
            upsertCharacterBelief(db, {
                simulation_id: simRow.id,
                simulation_character_id: aliceRow.id,
                char_lws_id: simAlice.lws_id,
                subject_key: 'test:zero_confidence',
                statement: 'Zero confidence should fail',
                confidence: 0,
            });
        }).toThrow(/confidence must be an integer between 1 and 100/i);

        // Negative boundary: 101 (rejected)
        expect(() => {
            upsertCharacterBelief(db, {
                simulation_id: simRow.id,
                simulation_character_id: aliceRow.id,
                char_lws_id: simAlice.lws_id,
                subject_key: 'test:excess_confidence',
                statement: '101 confidence should fail',
                confidence: 101,
            });
        }).toThrow(/confidence must be an integer between 1 and 100/i);
    });
});
