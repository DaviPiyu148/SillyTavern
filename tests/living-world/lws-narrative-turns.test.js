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
    executeNarrativeTurn,
    getNarrativeTurnByLwsId,
    listNarrativeTurns,
    listEvents,
    EVENT_TYPES,
} from '../../src/living-world/index.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('LWS Narrative Turns and Two-Transaction Savepoint Execution', () => {
    let tempDir;
    let world;
    let sim;
    let charA;
    let charB;
    let loc1;
    let loc2;
    let simCharA;
    let simCharB;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-turns-test-'));
        const dbPath = path.join(tempDir, 'turns-test.db');
        await init({ dbPath });

        world = createWorld({ name: 'Turns World' });
        charA = createCharacter(world.lws_id, { name: 'Charlotte' });
        charB = createCharacter(world.lws_id, { name: 'Dave' });
        loc1 = createLocation(world.lws_id, { name: 'Courtyard' });
        loc2 = createLocation(world.lws_id, { name: 'Kitchen' });

        sim = createSimulation(world.lws_id, {
            name: 'Turns Sim',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });

        simCharA = addSimulationCharacter(sim.lws_id, {
            character_id: charA.lws_id,
            initial_location_id: loc1.lws_id,
        });

        simCharB = addSimulationCharacter(sim.lws_id, {
            character_id: charB.lws_id,
            initial_location_id: loc2.lws_id,
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

    test('successful narrative turn executes proposals atomically and commits turn', () => {
        const result = executeNarrativeTurn(sim.lws_id, {
            user_input: 'Charlotte moves to the kitchen and rests.',
            raw_model_output: '<thought>Move and rest</thought>',
            parsed_narrative: 'Charlotte entered the kitchen and took a seat.',
            model_info: { model: 'test-llm', temperature: 0.7 },
            proposals: [
                {
                    event_type: EVENT_TYPES.MOVE_CHARACTER,
                    actor_character_id: simCharA.lws_id,
                    location_id: loc2.lws_id,
                },
                {
                    event_type: EVENT_TYPES.REST,
                    actor_character_id: simCharA.lws_id,
                },
            ],
        });

        expect(result.success).toBe(true);
        expect(result.turn).toBeDefined();
        expect(result.turn.turn_number).toBe(1);
        expect(result.turn.status).toBe('committed');
        expect(result.turn.error_details).toBeNull();
        expect(result.events).toHaveLength(2);

        // Turn is retrievable by UUID
        const fetchedTurn = getNarrativeTurnByLwsId(sim.lws_id, result.turn.lws_id);
        expect(fetchedTurn.status).toBe('committed');

        // Turn is listed
        const turnsList = listNarrativeTurns(sim.lws_id);
        expect(turnsList).toHaveLength(1);
        expect(turnsList[0].lws_id).toBe(result.turn.lws_id);

        // Events are tagged with turn_id
        const events = listEvents(sim.lws_id);
        const turnEvents = events.filter(e => e.turn_id === result.turn.lws_id);
        expect(turnEvents).toHaveLength(2);
    });

    test('failed proposal rolls back all turn events via SAVEPOINT and durably persists rejected turn', () => {
        const eventsBefore = listEvents(sim.lws_id);
        const countBefore = eventsBefore.length;

        // Multi-proposal batch where 1st is valid, 2nd fails authority check (spatial barrier)
        const result = executeNarrativeTurn(sim.lws_id, {
            user_input: 'Charlotte whispers to Dave across distances.',
            raw_model_output: '...',
            parsed_narrative: '...',
            proposals: [
                {
                    // Valid proposal 1
                    event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
                    actor_character_id: simCharA.lws_id,
                    payload: { activity: 'calling out' },
                },
                {
                    // Invalid proposal 2: direct COMMUNICATE requires collocated target (loc1 vs loc2)
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharA.lws_id,
                    target_character_id: simCharB.lws_id,
                    location_id: loc1.lws_id,
                    payload: { message: 'Can you hear me?', channel: 'direct' },
                },
            ],
        });

        // 1. Turn execution returns rejected result without throwing unhandled exception
        expect(result.success).toBe(false);
        expect(result.turn).toBeDefined();
        expect(result.turn.status).toBe('rejected');
        expect(result.turn.error_details).toBeDefined();
        expect(result.turn.error_details.code).toBe('SPATIAL_DISCONNECT');

        // 2. Proposal 1 was rolled back — zero events committed for this turn
        const eventsAfter = listEvents(sim.lws_id);
        expect(eventsAfter.length).toBe(countBefore);
        const turnEvents = eventsAfter.filter(e => e.turn_id === result.turn.lws_id);
        expect(turnEvents).toHaveLength(0);

        // 3. Rejected turn row is physically persisted in database
        const db = getDb();
        const turnInDb = db.prepare('SELECT * FROM lws_narrative_turns WHERE lws_id = ?').get(result.turn.lws_id);
        expect(turnInDb).toBeDefined();
        expect(turnInDb.status).toBe('rejected');

        // 4. Terminal rejected turn is immutable
        expect(() => {
            db.prepare('UPDATE lws_narrative_turns SET status = \'committed\' WHERE id = ?').run(turnInDb.id);
        }).toThrow(/terminal narrative turn rows are immutable/);
    });

    test('narrative turns sequence monotonically', () => {
        const turn1 = executeNarrativeTurn(sim.lws_id, { user_input: 'Turn 1' });
        const turn2 = executeNarrativeTurn(sim.lws_id, { user_input: 'Turn 2' });
        const turn3 = executeNarrativeTurn(sim.lws_id, { user_input: 'Turn 3' });

        expect(turn1.turn.turn_number).toBe(1);
        expect(turn2.turn.turn_number).toBe(2);
        expect(turn3.turn.turn_number).toBe(3);

        const list = listNarrativeTurns(sim.lws_id);
        expect(list).toHaveLength(3);
        expect(list.map(t => t.turn_number)).toEqual([1, 2, 3]);
    });
});
