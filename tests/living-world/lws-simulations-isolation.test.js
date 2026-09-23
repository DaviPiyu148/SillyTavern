import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    createWorld,
    createCharacter,
    createLocation,
    deleteCharacter,
    getCharacterByLwsId,
    createSimulation,
    addSimulationCharacter,
    getSimulationCharacterByLwsId,
    updateSimulationCharacter,
} from '../../src/living-world/index.js';

describe('LWS Two-Simulation Isolation Proof and Authored Immutability', () => {
    let db;
    let world;
    let daveAuthored;
    let officeLoc;
    let beachLoc;

    beforeEach(() => {
        db = openDb(':memory:');
        world = createWorld({ name: 'Multiverse World' });

        daveAuthored = createCharacter(world.lws_id, {
            name: 'Dave',
            description: 'Hardworking engineer',
            personality: 'Analytical and focused',
        });

        officeLoc = createLocation(world.lws_id, { name: 'Tech Office' });
        beachLoc = createLocation(world.lws_id, { name: 'Sunny Beach' });
    });

    afterEach(() => {
        closeDb();
    });

    test('proves that two simulations of the same character mutate independently without affecting each other or the authored card', () => {
        // 1. Create Simulation A
        const simA = createSimulation(world.lws_id, {
            name: 'Timeline A (Workday)',
            initial_fictional_time: '2026-06-01T09:00:00Z',
        });

        // 2. Create Simulation B
        const simB = createSimulation(world.lws_id, {
            name: 'Timeline B (Vacation)',
            initial_fictional_time: '2026-07-15T11:00:00Z',
        });

        // 3. Instantiate Dave into both simulations
        const daveInA = addSimulationCharacter(simA.lws_id, {
            character_id: daveAuthored.lws_id,
            initial_location_id: officeLoc.lws_id,
            activity: 'working',
            physical_condition: 'focused',
            runtime_state: { task: 'coding' },
        });

        const daveInB = addSimulationCharacter(simB.lws_id, {
            character_id: daveAuthored.lws_id,
            initial_location_id: beachLoc.lws_id,
            activity: 'relaxing',
            physical_condition: 'rested',
            runtime_state: { beverage: 'lemonade' },
        });

        expect(daveInA.lws_id).not.toBe(daveInB.lws_id);
        expect(daveInA.character_id).toBe(daveAuthored.lws_id);
        expect(daveInB.character_id).toBe(daveAuthored.lws_id);

        // 4. Mutate Dave's state in Simulation A
        updateSimulationCharacter(simA.lws_id, daveInA.lws_id, {
            activity: 'attending urgent meeting',
            physical_condition: 'stressed',
            runtime_state: { task: 'meeting', urgency: 'high' },
        });

        // 5. Verify Simulation A has updated
        const daveInAUpdated = getSimulationCharacterByLwsId(simA.lws_id, daveInA.lws_id);
        expect(daveInAUpdated.activity).toBe('attending urgent meeting');
        expect(daveInAUpdated.physical_condition).toBe('stressed');
        expect(daveInAUpdated.runtime_state).toEqual({ task: 'meeting', urgency: 'high' });

        // 6. VERIFY SIMULATION B IS COMPLETELY UNCHANGED
        const daveInBAfterA = getSimulationCharacterByLwsId(simB.lws_id, daveInB.lws_id);
        expect(daveInBAfterA.current_location_id).toBe(beachLoc.lws_id);
        expect(daveInBAfterA.activity).toBe('relaxing');
        expect(daveInBAfterA.physical_condition).toBe('rested');
        expect(daveInBAfterA.runtime_state).toEqual({ beverage: 'lemonade' });

        // 7. VERIFY AUTHORED CHARACTER IN lws_characters IS COMPLETELY UNCHANGED
        const daveAuthoredAfter = getCharacterByLwsId(world.lws_id, daveAuthored.lws_id);
        expect(daveAuthoredAfter.name).toBe('Dave');
        expect(daveAuthoredAfter.description).toBe('Hardworking engineer');
        expect(daveAuthoredAfter.personality).toBe('Analytical and focused');

        // Verify authored DB row does not contain runtime fields
        const rawAuthoredRow = db.prepare('SELECT * FROM lws_characters WHERE lws_id = ?').get(daveAuthored.lws_id);
        expect(rawAuthoredRow.activity).toBeUndefined();
        expect(rawAuthoredRow.current_location_id).toBeUndefined();
        expect(rawAuthoredRow.physical_condition).toBeUndefined();
    });

    test('proves that soft-deleting an authored character does not corrupt or break existing simulations', () => {
        const sim = createSimulation(world.lws_id, {
            name: 'Resilience Timeline',
            initial_fictional_time: '2026-06-01T09:00:00Z',
        });

        const simDave = addSimulationCharacter(sim.lws_id, {
            character_id: daveAuthored.lws_id,
            initial_location_id: officeLoc.lws_id,
            activity: 'working',
        });

        // Soft-delete Dave from the authored world
        deleteCharacter(world.lws_id, daveAuthored.lws_id);

        // Active authored query now throws 404
        expect(() => getCharacterByLwsId(world.lws_id, daveAuthored.lws_id)).toThrow(/Character not found/);

        // Existing simulation character continues running without error
        const existingSimDave = getSimulationCharacterByLwsId(sim.lws_id, simDave.lws_id);
        expect(existingSimDave.character_id).toBe(daveAuthored.lws_id);
        expect(existingSimDave.activity).toBe('working');
        expect(existingSimDave.authored_snapshot.name).toBe('Dave');
        expect(existingSimDave.authored_snapshot.personality).toBe('Analytical and focused');

        // Runtime mutation on the existing character continues to succeed
        const updated = updateSimulationCharacter(sim.lws_id, simDave.lws_id, {
            activity: 'having lunch',
        });
        expect(updated.activity).toBe('having lunch');
    });
});
