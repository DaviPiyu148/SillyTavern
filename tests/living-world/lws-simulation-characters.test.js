import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    createWorld,
    createCharacter,
    createLocation,
    deleteLocation,
    createSimulation,
    updateSimulation,
    addSimulationCharacter,
    getSimulationCharacterByLwsId,
    listSimulationCharacters,
    updateSimulationCharacter,
    deleteSimulationCharacter,
    LwsNotFoundError,
    LwsConflictError,
} from '../../src/living-world/index.js';

describe('LWS SimulationCharacter Service: Runtime State, Immutability, and Location Guards', () => {
    let world;
    let sim;
    let char;
    let loc;

    beforeEach(() => {
        openDb(':memory:');
        world = createWorld({ name: 'Emerald World' });
        sim = createSimulation(world.lws_id, {
            name: 'Emerald Timeline',
            initial_fictional_time: '2026-06-01T10:00:00Z',
        });
        char = createCharacter(world.lws_id, {
            name: 'Alice',
            description: 'Explorer',
            personality: 'Curious',
        });
        loc = createLocation(world.lws_id, { name: 'Emerald Forest' });
    });

    afterEach(() => {
        closeDb();
    });

    test('adds an authored character to a simulation with runtime state and snapshot', () => {
        const simChar = addSimulationCharacter(sim.lws_id, {
            character_id: char.lws_id,
            initial_location_id: loc.lws_id,
            activity: 'exploring',
            physical_condition: 'healthy',
            runtime_state: { energy: 100 },
        });

        expect(simChar.character_id).toBe(char.lws_id);
        expect(simChar.simulation_id).toBe(sim.lws_id);
        expect(simChar.current_location_id).toBe(loc.lws_id);
        expect(simChar.activity).toBe('exploring');
        expect(simChar.physical_condition).toBe('healthy');
        expect(simChar.runtime_state).toEqual({ energy: 100 });
        expect(simChar.authored_snapshot.name).toBe('Alice');
        expect(simChar.authored_snapshot.personality).toBe('Curious');
    });

    test('prevents adding the same character twice to the same simulation (active uniqueness)', () => {
        addSimulationCharacter(sim.lws_id, { character_id: char.lws_id });

        expect(() => {
            addSimulationCharacter(sim.lws_id, { character_id: char.lws_id });
        }).toThrow(LwsConflictError);
    });

    test('rejects adding a character to an archived simulation', () => {
        updateSimulation(sim.lws_id, { status: 'archived' });

        expect(() => {
            addSimulationCharacter(sim.lws_id, { character_id: char.lws_id });
        }).toThrow(/Cannot add character to archived simulation/);
    });

    test('rejects newly assigning a soft-deleted location on creation and update', () => {
        const deletedLoc = createLocation(world.lws_id, { name: 'Sunken Ruins' });
        deleteLocation(world.lws_id, deletedLoc.lws_id);

        // 1. Rejected on initial add
        expect(() => {
            addSimulationCharacter(sim.lws_id, {
                character_id: char.lws_id,
                initial_location_id: deletedLoc.lws_id,
            });
        }).toThrow(/Cannot newly assign a soft-deleted location/);

        // Add character at active location
        const simChar = addSimulationCharacter(sim.lws_id, {
            character_id: char.lws_id,
            initial_location_id: loc.lws_id,
        });

        // 2. Rejected on update
        expect(() => {
            updateSimulationCharacter(sim.lws_id, simChar.lws_id, {
                current_location_id: deletedLoc.lws_id,
            });
        }).toThrow(/Cannot newly assign a soft-deleted location/);
    });

    test('preserves existing soft-deleted location references when updating other fields', () => {
        const simChar = addSimulationCharacter(sim.lws_id, {
            character_id: char.lws_id,
            initial_location_id: loc.lws_id,
            activity: 'standing',
        });

        // Soft-delete the location the character is currently at
        deleteLocation(world.lws_id, loc.lws_id);

        // Updating activity while keeping the current location must succeed
        const updated = updateSimulationCharacter(sim.lws_id, simChar.lws_id, {
            activity: 'sitting down',
            physical_condition: 'rested',
        });

        expect(updated.activity).toBe('sitting down');
        expect(updated.physical_condition).toBe('rested');
        expect(updated.current_location_id).toBe(loc.lws_id);
    });

    test('rejects runtime mutations when simulation is paused or archived', () => {
        const simChar = addSimulationCharacter(sim.lws_id, { character_id: char.lws_id });

        // Pause simulation
        updateSimulation(sim.lws_id, { status: 'paused' });

        expect(() => {
            updateSimulationCharacter(sim.lws_id, simChar.lws_id, { activity: 'walking' });
        }).toThrow(/Simulation is paused/);

        // Resume then archive
        updateSimulation(sim.lws_id, { status: 'active' });
        updateSimulation(sim.lws_id, { status: 'archived' });

        expect(() => {
            updateSimulationCharacter(sim.lws_id, simChar.lws_id, { activity: 'walking' });
        }).toThrow(/Simulation is archived/);
    });

    test('rejects attempts to modify immutable fields (character_id, simulation_id, authored_snapshot)', () => {
        const simChar = addSimulationCharacter(sim.lws_id, { character_id: char.lws_id });

        expect(() => {
            updateSimulationCharacter(sim.lws_id, simChar.lws_id, { character_id: 'new-id' });
        }).toThrow(/character_id is immutable/);

        expect(() => {
            updateSimulationCharacter(sim.lws_id, simChar.lws_id, { simulation_id: 'new-id' });
        }).toThrow(/simulation_id is immutable/);

        expect(() => {
            updateSimulationCharacter(sim.lws_id, simChar.lws_id, { authored_snapshot: {} });
        }).toThrow(/authored_snapshot is immutable/);
    });

    test('soft-deletes a SimulationCharacter and excludes from active list', () => {
        const simChar = addSimulationCharacter(sim.lws_id, { character_id: char.lws_id });

        const deleted = deleteSimulationCharacter(sim.lws_id, simChar.lws_id);
        expect(deleted).toBe(true);

        expect(() => getSimulationCharacterByLwsId(sim.lws_id, simChar.lws_id)).toThrow(LwsNotFoundError);
        const activeList = listSimulationCharacters(sim.lws_id);
        expect(activeList).toHaveLength(0);
    });
});
