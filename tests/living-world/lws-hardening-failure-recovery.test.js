import { openDb, closeDb, getDb } from '../../src/living-world/db.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { executeNarrativeTurn } from '../../src/living-world/events/narrative-turns.js';
import { simulationLocks } from '../../src/living-world/simulations/lock.js';
import { LwsTurnRejectedError } from '../../src/living-world/errors.js';

describe('LWS Phase 13 Hardening — Failure Recovery & Fault Tolerance', () => {
    let db;
    let world;
    let loc1;
    let loc2;
    let char1;
    let sim;
    let simChar1;

    beforeEach(() => {
        db = openDb(':memory:');

        world = createWorld({ name: 'Failure Recovery World' });
        loc1 = createLocation(world.lws_id, { name: 'Harbor Gate' });
        loc2 = createLocation(world.lws_id, { name: 'Distant Outpost' });

        char1 = createCharacter(world.lws_id, { name: 'Garrick' });
        sim = createSimulation(world.lws_id, {
            name: 'Recovery Sim',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });
        simChar1 = addSimulationCharacter(sim.lws_id, { character_id: char1.lws_id, initial_location_id: loc1.lws_id });
    });

    afterEach(() => {
        closeDb();
    });

    test('recovers cleanly from rejected narrative turns committing durable rejection audit records', () => {
        // Attempt a turn with an invalid/impossible state proposal
        const result = executeNarrativeTurn(sim.lws_id, {
            user_input: 'Teleport into the void',
            proposals: [
                {
                    event_type: 'move_character',
                    actor_character_id: simChar1.lws_id,
                    location_id: '00000000-0000-0000-0000-000000000000',
                },
            ],
        });

        expect(result.success).toBe(false);
        expect(result.turn.status).toBe('rejected');

        // Verify rejected narrative turn record is durably stored in lws_narrative_turns
        const simRow = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
        const turns = db.prepare('SELECT * FROM lws_narrative_turns WHERE simulation_id = ?').all(simRow.id);
        expect(turns).toHaveLength(1);
        expect(turns[0].status).toBe('rejected');

        // Verify character location was NOT mutated (atomic rollback)
        const charInDb = db.prepare('SELECT current_location_id FROM lws_simulation_characters WHERE lws_id = ?').get(simChar1.lws_id);
        const loc1InDb = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ?').get(loc1.lws_id);
        expect(charInDb.current_location_id).toBe(loc1InDb.id);
    });

    test('resolves simulation lock contention sequentially without deadlocks', async () => {
        const order = [];

        const task1 = simulationLocks.withLock(sim.lws_id, async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            order.push('task1');
            return 'res1';
        });

        const task2 = simulationLocks.withLock(sim.lws_id, async () => {
            order.push('task2');
            return 'res2';
        });

        const [r1, r2] = await Promise.all([task1, task2]);

        expect(r1).toBe('res1');
        expect(r2).toBe('res2');
        expect(order).toEqual(['task1', 'task2']);
        expect(simulationLocks.chains.has(sim.lws_id)).toBe(false);
    });

    test('releases simulation lock even when an async operation throws', async () => {
        await expect(
            simulationLocks.withLock(sim.lws_id, async () => {
                throw new Error('MUTEX_OPERATION_FAILED');
            })
        ).rejects.toThrow('MUTEX_OPERATION_FAILED');

        // Lock must be released and free for subsequent tasks
        expect(simulationLocks.chains.has(sim.lws_id)).toBe(false);

        const subsequentTask = await simulationLocks.withLock(sim.lws_id, async () => 'recovered');
        expect(subsequentTask).toBe('recovered');
    });
});
