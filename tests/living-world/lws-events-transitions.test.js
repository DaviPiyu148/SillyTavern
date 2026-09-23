import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    init,
    onExit,
    getDb,
    createWorld,
    createCharacter,
    createLocation,
    createSimulation,
    addSimulationCharacter,
    getSimulationCharacterByLwsId,
    commitEvent,
    EVENT_TYPES,
} from '../../src/living-world/index.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('LWS State Transitions and Transactional Atomicity', () => {
    let tempDir;
    let world;
    let sim;
    let char;
    let loc1;
    let loc2;
    let simChar;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-trans-test-'));
        const dbPath = path.join(tempDir, 'transitions-test.db');
        await init({ dbPath });

        world = createWorld({ name: 'Transitions World' });
        char = createCharacter(world.lws_id, { name: 'Eldrin', description: 'Mage' });
        loc1 = createLocation(world.lws_id, { name: 'Library' });
        loc2 = createLocation(world.lws_id, { name: 'Dungeon' });

        sim = createSimulation(world.lws_id, {
            name: 'Transitions Sim',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });

        simChar = addSimulationCharacter(sim.lws_id, {
            character_id: char.lws_id,
            initial_location_id: loc1.lws_id,
            activity: 'studying',
            physical_condition: 'energized',
            runtime_state: { mana: 100, inventory: ['spellbook'] },
        });
    });

    afterEach(async () => {
        await onExit();
        if (tempDir) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                void err;
            }
        }
    });

    test('MOVE_CHARACTER updates location atomically with event commit', () => {
        const event = commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.MOVE_CHARACTER,
            actor_character_id: simChar.lws_id,
            location_id: loc2.lws_id,
            provenance: 'user',
        });

        expect(event.sequence_number).toBeGreaterThan(1);
        expect(event.event_type).toBe(EVENT_TYPES.MOVE_CHARACTER);

        const updatedChar = getSimulationCharacterByLwsId(sim.lws_id, simChar.lws_id);
        expect(updatedChar.current_location_id).toBe(loc2.lws_id);
    });

    test('UPDATE_CHARACTER_ACTIVITY updates activity atomically', () => {
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
            actor_character_id: simChar.lws_id,
            payload: { activity: 'casting ritual' },
            provenance: 'user',
        });

        const updatedChar = getSimulationCharacterByLwsId(sim.lws_id, simChar.lws_id);
        expect(updatedChar.activity).toBe('casting ritual');
    });

    test('UPDATE_PHYSICAL_CONDITION updates physical condition atomically', () => {
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.UPDATE_PHYSICAL_CONDITION,
            actor_character_id: simChar.lws_id,
            payload: { physical_condition: 'exhausted' },
            provenance: 'user',
        });

        const updatedChar = getSimulationCharacterByLwsId(sim.lws_id, simChar.lws_id);
        expect(updatedChar.physical_condition).toBe('exhausted');
    });

    test('UPDATE_RUNTIME_STATE deep-merges runtime state JSON recursively', () => {
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
            actor_character_id: simChar.lws_id,
            payload: {
                patch: {
                    mana: 80,
                    stats: { intelligence: 18, wisdom: 15 },
                },
            },
            provenance: 'user',
        });

        const updatedChar = getSimulationCharacterByLwsId(sim.lws_id, simChar.lws_id);
        expect(updatedChar.runtime_state.mana).toBe(80);
        expect(updatedChar.runtime_state.inventory).toEqual(['spellbook']); // Preserved
        expect(updatedChar.runtime_state.stats).toEqual({ intelligence: 18, wisdom: 15 });
    });

    test('REST updates activity to "resting"', () => {
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.REST,
            actor_character_id: simChar.lws_id,
            provenance: 'user',
        });

        const updatedChar = getSimulationCharacterByLwsId(sim.lws_id, simChar.lws_id);
        expect(updatedChar.activity).toBe('resting');
    });

    test('WORK updates activity to "working"', () => {
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.WORK,
            actor_character_id: simChar.lws_id,
            provenance: 'user',
        });

        const updatedChar = getSimulationCharacterByLwsId(sim.lws_id, simChar.lws_id);
        expect(updatedChar.activity).toBe('working');
    });

    test('CHARACTER_JOIN creates new SimulationCharacter and links event atomically', () => {
        const char2 = createCharacter(world.lws_id, { name: 'Rowan' });

        const event = commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            location_id: loc1.lws_id,
            payload: {
                character_id: char2.lws_id,
                activity: 'standing guard',
                physical_condition: 'vigilant',
                runtime_state: { armor: 'plate' },
            },
            provenance: 'user',
        });

        expect(event.event_type).toBe(EVENT_TYPES.CHARACTER_JOIN);
        expect(event.actor_character_id).toBeDefined();

        const createdSimChar = getSimulationCharacterByLwsId(sim.lws_id, event.actor_character_id);
        expect(createdSimChar.character_id).toBe(char2.lws_id);
        expect(createdSimChar.current_location_id).toBe(loc1.lws_id);
        expect(createdSimChar.activity).toBe('standing guard');
        expect(createdSimChar.physical_condition).toBe('vigilant');
        expect(createdSimChar.runtime_state).toEqual({ armor: 'plate' });
        expect(createdSimChar.authored_snapshot.name).toBe('Rowan');
    });

    test('CHARACTER_LEAVE soft-deletes character atomically with deleted_at = event.created_at', () => {
        const leaveEvent = commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_LEAVE,
            actor_character_id: simChar.lws_id,
            payload: { reason: 'Journey completed' },
            provenance: 'user',
        });

        expect(leaveEvent.event_type).toBe(EVENT_TYPES.CHARACTER_LEAVE);

        // Verification in database that deleted_at is set to exact event.created_at
        const db = getDb();
        const row = db.prepare('SELECT * FROM lws_simulation_characters WHERE lws_id = ?').get(simChar.lws_id);
        expect(row.deleted_at).toBe(leaveEvent.created_at);

        // getSimulationCharacterByLwsId throws not found for soft-deleted character
        expect(() => {
            getSimulationCharacterByLwsId(sim.lws_id, simChar.lws_id);
        }).toThrow(/SimulationCharacter not found/);
    });

    test('DIRECTOR_MODIFY_STATE modifies simulation settings and character fields atomically', () => {
        // 1. Target simulation
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            payload: {
                target: 'simulation',
                settings_patch: { weather: 'stormy', difficulty: 'hard' },
            },
            provenance: 'director',
        }, { isAdmin: true });

        const db = getDb();
        const simRow = db.prepare('SELECT settings FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
        expect(JSON.parse(simRow.settings)).toEqual({ weather: 'stormy', difficulty: 'hard' });

        // 2. Target character
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            actor_character_id: simChar.lws_id,
            location_id: loc2.lws_id,
            payload: {
                activity: 'meditating',
                physical_condition: 'transcendent',
                runtime_state: { divine_buff: true },
            },
            provenance: 'director',
        }, { isAdmin: true });

        const updatedChar = getSimulationCharacterByLwsId(sim.lws_id, simChar.lws_id);
        expect(updatedChar.current_location_id).toBe(loc2.lws_id);
        expect(updatedChar.activity).toBe('meditating');
        expect(updatedChar.physical_condition).toBe('transcendent');
        expect(updatedChar.runtime_state.divine_buff).toBe(true);
        expect(updatedChar.runtime_state.mana).toBe(100); // deepMerge preserved existing mana
    });
});
