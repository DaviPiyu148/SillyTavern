import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createInMemoryTestDb } from './fixtures/test-db.js';
import {
    createGoal,
    getGoalByLwsId,
    listCharacterGoals,
    updateGoal,
    deleteGoal,
    allocateGoalIndex,
} from '../../src/living-world/cognition/goals.js';
import {
    createIntention,
    getIntentionByLwsId,
    listCharacterIntentions,
    updateIntentionStatus,
    allocateAttemptIndex,
} from '../../src/living-world/cognition/intentions.js';
import {
    LwsValidationError,
    LwsConflictError,
    LwsInvalidStateTransitionError,
} from '../../src/living-world/errors.js';

describe('LWS Phase 7 — Goals & Intentions Lifecycles', () => {
    let db;
    let sim;
    let character;

    beforeEach(() => {
        db = createInMemoryTestDb();

        db.prepare(`
            INSERT INTO lws_worlds (id, lws_id, name, created_at, updated_at)
            VALUES (1, '10000000-0000-0000-0000-000000000001', 'Test World', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_characters (id, lws_id, world_id, name, created_at, updated_at)
            VALUES (1, '20000000-0000-0000-0000-000000000001', 1, 'Charlie', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_simulations (id, lws_id, world_id, name, status, current_fictional_time, created_at, updated_at)
            VALUES (1, '30000000-0000-0000-0000-000000000001', 1, 'Sim 1', 'active', '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_simulation_characters (id, lws_id, simulation_id, character_id, runtime_state, created_at, updated_at)
            VALUES (1, '40000000-0000-0000-0000-000000000001', 1, 1, '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        sim = db.prepare('SELECT * FROM lws_simulations WHERE id = 1').get();
        character = db.prepare('SELECT * FROM lws_simulation_characters WHERE id = 1').get();
    });

    afterEach(() => {
        if (db && db.open) db.close();
    });

    describe('Goals CRUD and Invariants', () => {
        test('creates goal with priority in [1, 79] and allocates sequential goalIndex', () => {
            const index1 = allocateGoalIndex(db, character.id);
            expect(index1).toBe(1);

            const goal1 = createGoal(db, sim, character, {
                title: 'Collect firewood',
                goal_type: 'short_term',
                priority: 45,
                urgency: 60,
            });

            expect(goal1).toBeDefined();
            expect(goal1.priority).toBe(45);
            expect(goal1.status).toBe('active');

            const index2 = allocateGoalIndex(db, character.id);
            expect(index2).toBe(2);

            const goal2 = createGoal(db, sim, character, {
                title: 'Build shelter',
                goal_type: 'long_term',
                priority: 70,
            });
            expect(goal2.priority).toBe(70);
        });

        test('rejects priority out of range [1, 79] for non-acute goals', () => {
            expect(() => {
                createGoal(db, sim, character, {
                    title: 'Invalid goal',
                    priority: 85,
                });
            }).toThrow(LwsValidationError);

            expect(() => {
                createGoal(db, sim, character, {
                    title: 'Invalid goal zero',
                    priority: 0,
                });
            }).toThrow(LwsValidationError);
        });

        test('enforces client_goal_key uniqueness across all goals including soft-deleted', () => {
            const g1 = createGoal(db, sim, character, {
                title: 'Keyed Goal',
                client_goal_key: 'unique_key_1',
            });
            expect(g1.client_goal_key).toBe('unique_key_1');

            // Soft-delete g1
            deleteGoal(db, g1.lws_id);

            // Re-using the same client_goal_key must fail with LwsConflictError
            expect(() => {
                createGoal(db, sim, character, {
                    title: 'Keyed Goal 2',
                    client_goal_key: 'unique_key_1',
                });
            }).toThrow(LwsConflictError);
        });

        test('soft-delete marks status = abandoned and cancels child intentions', () => {
            const goal = createGoal(db, sim, character, { title: 'Hunt wildlife' });

            const intention = createIntention(db, sim, character, {
                goal_id: goal.lws_id,
                action_type: 'WORK',
                status: 'active',
            });

            expect(intention.status).toBe('active');

            deleteGoal(db, goal.lws_id);

            const fetchedGoal = getGoalByLwsId(db, goal.lws_id);
            expect(fetchedGoal.status).toBe('abandoned');
            expect(fetchedGoal.deleted_at).toBeDefined();

            const fetchedIntention = getIntentionByLwsId(db, intention.lws_id);
            expect(fetchedIntention.status).toBe('cancelled');
            expect(fetchedIntention.cancellation_reason).toBe('goal_deleted');
        });

        test('terminal goal cannot be updated', () => {
            const goal = createGoal(db, sim, character, { title: 'Complete me' });
            updateGoal(db, goal.lws_id, { status: 'completed' });

            expect(() => {
                updateGoal(db, goal.lws_id, { title: 'New title' });
            }).toThrow(LwsInvalidStateTransitionError);
        });

        test('acute goals cannot be manually modified via updateGoal', () => {
            // Direct insert of acute goal
            db.prepare(`
                INSERT INTO lws_character_goals (
                    lws_id, simulation_id, simulation_character_id, title,
                    goal_type, status, priority, urgency, progress, created_at, updated_at
                ) VALUES ('g-acute-1', 1, 1, 'Rest acute', 'acute_need', 'active', 90, 100, 0, '2026-01-01', '2026-01-01')
            `).run();

            expect(() => {
                updateGoal(db, 'g-acute-1', { priority: 50 });
            }).toThrow(LwsInvalidStateTransitionError);

            expect(() => {
                updateGoal(db, 'g-acute-1', { status: 'abandoned' });
            }).toThrow(LwsInvalidStateTransitionError);
        });

        test('goal mutations emit authoritative committed events to lws_events', () => {
            const goal = createGoal(db, sim, character, { title: 'Event-backed goal', priority: 55 });
            const eventsAfterCreate = db.prepare('SELECT * FROM lws_events WHERE simulation_id = ?').all(sim.id);
            expect(eventsAfterCreate.length).toBe(1);
            expect(eventsAfterCreate[0].event_type).toBe('UPDATE_RUNTIME_STATE');
            const createPayload = JSON.parse(eventsAfterCreate[0].payload);
            expect(createPayload.cognition?.create_goal?.lws_id).toBe(goal.lws_id);

            updateGoal(db, goal.lws_id, { progress: 40 });
            const eventsAfterUpdate = db.prepare('SELECT * FROM lws_events WHERE simulation_id = ?').all(sim.id);
            expect(eventsAfterUpdate.length).toBe(2);
            const updatePayload = JSON.parse(eventsAfterUpdate[1].payload);
            expect(updatePayload.cognition?.update_goal?.progress).toBe(40);

            deleteGoal(db, goal.lws_id);
            const eventsAfterDelete = db.prepare('SELECT * FROM lws_events WHERE simulation_id = ?').all(sim.id);
            expect(eventsAfterDelete.length).toBe(3);
            const deletePayload = JSON.parse(eventsAfterDelete[2].payload);
            expect(deletePayload.cognition?.update_goal?.is_deleted).toBe(true);
        });
    });

    describe('Intentions Lifecycles', () => {
        test('allocates attemptIndex sequentially within causalContext', () => {
            const causalContext = 'deliberate:2026-01-01T08:00:00Z';
            const att1 = allocateAttemptIndex(db, sim.id, character.id, causalContext);
            expect(att1).toBe(1);

            // Record event carrying payload.cognition.failed_intention with attempt_index: 1
            db.prepare(`
                INSERT INTO lws_events (
                    lws_id, simulation_id, sequence_number, event_type, actor_character_id, fictional_time,
                    provenance, payload, created_at
                ) VALUES ('ev-1', 1, 1, 'UPDATE_RUNTIME_STATE', 1, '2026-01-01T08:00:00Z', 'simulation_engine', ?, '2026-01-01')
            `).run(JSON.stringify({
                cognition: {
                    failed_intention: {
                        attempt_index: 1,
                        causal_context: causalContext,
                    },
                },
            }));


            const att2 = allocateAttemptIndex(db, sim.id, character.id, causalContext);
            expect(att2).toBe(2);
        });

        test('updates intention status to failed with failure_reason', () => {
            const intention = createIntention(db, sim, character, {
                action_type: 'WORK',
                status: 'executing',
            });

            updateIntentionStatus(db, intention.lws_id, 'failed', { failure_reason: 'PRECONDITION_FAILED' });

            const updated = getIntentionByLwsId(db, intention.lws_id);
            expect(updated.status).toBe('failed');
            expect(updated.failure_reason).toBe('PRECONDITION_FAILED');
        });
    });
});
