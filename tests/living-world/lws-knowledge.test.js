import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { openDb, closeDb, getDb } from '../../src/living-world/db.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { internalCommitEvent } from '../../src/living-world/events/events.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';
import {
    listCharacterKnowledge,
    getCharacterFact,
    upsertCharacterKnowledge,
    softDeleteCharacterKnowledge,
} from '../../src/living-world/perception/knowledge.js';

describe('LWS Phase 6 Knowledge Base, Channels & Evidence', () => {
    let db;
    let world;
    let locRoomA;
    let locRoomB;
    let charAlice;
    let charBob;
    let charCharlie;
    let sim;
    let simAlice;
    let simBob;
    let simCharlie;

    beforeEach(() => {
        openDb(':memory:');
        db = getDb();

        world = createWorld({ name: 'Knowledge World', description: 'Test World' });

        locRoomA = createLocation(world.lws_id, {
            name: 'Room A',
            extensions: { parent_location_id: null },
        });

        locRoomB = createLocation(world.lws_id, {
            name: 'Room B',
            extensions: { parent_location_id: null },
        });

        charAlice = createCharacter(world.lws_id, { name: 'Alice' });
        charBob = createCharacter(world.lws_id, { name: 'Bob' });
        charCharlie = createCharacter(world.lws_id, { name: 'Charlie' });

        sim = createSimulation(world.lws_id, {
            name: 'Knowledge Simulation',
            initial_fictional_time: '2026-06-01T10:00:00Z',
        });

        simAlice = addSimulationCharacter(sim.lws_id, {
            character_id: charAlice.lws_id,
            initial_location_id: locRoomA.lws_id,
        });

        simBob = addSimulationCharacter(sim.lws_id, {
            character_id: charBob.lws_id,
            initial_location_id: locRoomA.lws_id,
        });

        simCharlie = addSimulationCharacter(sim.lws_id, {
            character_id: charCharlie.lws_id,
            initial_location_id: locRoomB.lws_id,
        });
    });

    afterEach(() => {
        closeDb();
    });

    test('upserts and retrieves individual knowledge fact with provenance', () => {
        const simCharRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simAlice.lws_id);
        const simRow = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);

        const fact = upsertCharacterKnowledge(db, {
            simulation_id: simRow.id,
            simulation_character_id: simCharRow.id,
            char_lws_id: simAlice.lws_id,
            fact_key: 'castle_location',
            content: 'The castle is north of the river',
            source_channel: 'backstory',
            fictional_time_acquired: '2026-06-01T10:00:00Z',
        });

        expect(fact).toBeDefined();
        expect(fact.fact_key).toBe('castle_location');
        expect(fact.content).toBe('The castle is north of the river');
        expect(fact.source_channel).toBe('backstory');

        const retrieved = getCharacterFact(db, simAlice.lws_id, 'castle_location');
        expect(retrieved.lws_id).toBe(fact.lws_id);

        const allKnowledge = listCharacterKnowledge(db, simAlice.lws_id);
        expect(allKnowledge).toHaveLength(1);
        expect(allKnowledge[0].fact_key).toBe('castle_location');
    });

    test('soft deletes a knowledge fact', () => {
        const simCharRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simAlice.lws_id);
        const simRow = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);

        upsertCharacterKnowledge(db, {
            simulation_id: simRow.id,
            simulation_character_id: simCharRow.id,
            char_lws_id: simAlice.lws_id,
            fact_key: 'secret_code',
            content: '9999',
            source_channel: 'director_injection',
            fictional_time_acquired: '2026-06-01T10:00:00Z',
        });

        expect(listCharacterKnowledge(db, simAlice.lws_id)).toHaveLength(1);

        softDeleteCharacterKnowledge(db, simAlice.lws_id, 'secret_code');
        expect(listCharacterKnowledge(db, simAlice.lws_id)).toHaveLength(0);

        expect(() => {
            getCharacterFact(db, simAlice.lws_id, 'secret_code');
        }).toThrow(/not found/i);
    });

    describe('Canonical Scenario 3: Knowledge Transfer via Co-Located Communication & Object Evidence', () => {
        test('Alice communicates vault code to Bob, Bob discovers chest ruby, Charlie receives 0 facts', () => {
            const simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
            const aliceRow = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simAlice.lws_id);

            // Step 0: Alice knows vault_code from backstory
            upsertCharacterKnowledge(db, {
                simulation_id: simRow.id,
                simulation_character_id: aliceRow.id,
                char_lws_id: simAlice.lws_id,
                fact_key: 'vault_code',
                content: '4829',
                source_channel: 'backstory',
                fictional_time_acquired: '2026-06-01T09:00:00Z',
            });

            // Action 1: Alice tells Bob the vault_code in Room A
            const commEvent = internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simAlice.lws_id,
                target_character_id: simBob.lws_id,
                location_id: locRoomA.lws_id,
                fictional_time: '2026-06-01T10:00:00Z',
                provenance: 'director',
                payload: {
                    message: 'The code to the vault is 4829.',
                    facts: [
                        { fact_key: 'vault_code', content: '4829' },
                    ],
                },
            }, { isAdmin: true });

            // Action 2: Bob inspects a locked chest in Room A, discovering chest_contents
            const inspectEvent = internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.INTERACT_OBJECT,
                actor_character_id: simBob.lws_id,
                location_id: locRoomA.lws_id,
                fictional_time: '2026-06-01T10:00:00Z',
                provenance: 'director',
                payload: {
                    object_id: 'ancient_chest',
                    action: 'open_with_code',
                    discovered_facts: [
                        { fact_key: 'chest_contents', content: 'Ancient Ruby' },
                    ],
                },
            }, { isAdmin: true });

            // Verify Bob's knowledge
            const bobKnowledge = listCharacterKnowledge(db, simBob.lws_id);
            expect(bobKnowledge).toHaveLength(2);

            const bobVaultFact = bobKnowledge.find(k => k.fact_key === 'vault_code');
            expect(bobVaultFact).toBeDefined();
            expect(bobVaultFact.content).toBe('4829');
            expect(bobVaultFact.source_channel).toBe('communication');
            expect(bobVaultFact.source_character_lws_id).toBe(simAlice.lws_id);
            expect(bobVaultFact.source_event_lws_id).toBe(commEvent.lws_id);

            const bobChestFact = bobKnowledge.find(k => k.fact_key === 'chest_contents');
            expect(bobChestFact).toBeDefined();
            expect(bobChestFact.content).toBe('Ancient Ruby');
            expect(bobChestFact.source_channel).toBe('evidence');
            expect(bobChestFact.source_event_lws_id).toBe(inspectEvent.lws_id);

            // Verify Charlie in Room B has ZERO knowledge of either fact
            const charlieKnowledge = listCharacterKnowledge(db, simCharlie.lws_id);
            expect(charlieKnowledge).toHaveLength(0);
        });
    });
});
