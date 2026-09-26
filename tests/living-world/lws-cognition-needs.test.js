import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createInMemoryTestDb } from './fixtures/test-db.js';
import {
    initCharacterNeeds,
    getCharacterNeeds,
    calculateNeedsDecay,
    evaluateAcuteNeedLifecycle,
    isSeverePhysicalCondition,
    deriveInterruptedActivity,
    getNeedRelevance,
    NEED_NAMES,
} from '../../src/living-world/cognition/needs.js';
import { createGoal, listCharacterGoals } from '../../src/living-world/cognition/goals.js';

describe('LWS Phase 7 — Character Needs & Physical Conditions', () => {
    let db;
    let sim;
    let character;

    beforeEach(() => {
        db = createInMemoryTestDb();

        // Create authored world and character
        db.prepare(`
            INSERT INTO lws_worlds (id, lws_id, name, created_at, updated_at)
            VALUES (1, '10000000-0000-0000-0000-000000000001', 'Test World', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_characters (id, lws_id, world_id, name, created_at, updated_at)
            VALUES (1, '20000000-0000-0000-0000-000000000001', 1, 'Alice', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
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

    test('initializes all 5 needs at satisfaction 100 and decay rate 100', () => {
        initCharacterNeeds(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z');

        const needs = getCharacterNeeds(db, character.id);
        expect(needs).toHaveLength(5);

        const needNames = needs.map(n => n.need_name);
        expect(needNames).toEqual(['energy', 'nourishment', 'social', 'safety', 'morale']);

        for (const n of needs) {
            expect(n.satisfaction).toBe(100);
            expect(n.decay_rate).toBe(100);
            expect(n.last_evaluated_time).toBe('2026-01-01T08:00:00Z');
        }
    });

    test('calculates base decay across 1 hour interval correctly', () => {
        const initialNeeds = {
            energy: { satisfaction: 100, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
            nourishment: { satisfaction: 100, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
            social: { satisfaction: 100, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
            safety: { satisfaction: 100, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
            morale: { satisfaction: 100, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
        };

        const result = calculateNeedsDecay(
            initialNeeds,
            '2026-01-01T09:00:00Z', // 1 hour later
            { isResting: false, collocatedCount: 2, inCombat: false, locationTags: [] }
        );

        // Awake energy: -3 pts/hr
        expect(result.updatedNeeds.energy.satisfaction).toBe(97);
        // Nourishment: -4 pts/hr (Spec §5.1)
        expect(result.updatedNeeds.nourishment.satisfaction).toBe(96);
        // Social with collocated: -1 pts/hr
        expect(result.updatedNeeds.social.satisfaction).toBe(99);
        // Safety neutral: 0
        expect(result.updatedNeeds.safety.satisfaction).toBe(100);
        // Morale post-segment: min non-morale is 97 (>60) -> rMorale = +1 -> 100 (clamped at 100)
        expect(result.updatedNeeds.morale.satisfaction).toBe(100);
    });

    test('calculates resting energy recovery (+15 pts/hr)', () => {
        const initialNeeds = {
            energy: { satisfaction: 50, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
            nourishment: { satisfaction: 80, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
            social: { satisfaction: 80, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
            safety: { satisfaction: 80, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
            morale: { satisfaction: 80, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
        };

        const result = calculateNeedsDecay(
            initialNeeds,
            '2026-01-01T09:00:00Z',
            { isResting: true, collocatedCount: 0, inCombat: false, locationTags: [] }
        );

        expect(result.updatedNeeds.energy.satisfaction).toBe(65); // 50 + 15 = 65
    });

    test('post-segment morale decreases when any need drops <= 20', () => {
        const initialNeeds = {
            energy: { satisfaction: 15, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
            nourishment: { satisfaction: 80, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
            social: { satisfaction: 80, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
            safety: { satisfaction: 80, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
            morale: { satisfaction: 50, decay_rate: 100, last_evaluated_time: '2026-01-01T08:00:00Z' },
        };

        const result = calculateNeedsDecay(
            initialNeeds,
            '2026-01-01T09:00:00Z',
            { isResting: false, collocatedCount: 1, inCombat: false, locationTags: [] }
        );

        // min non-morale <= 20 (energy is 12) -> rMorale = -1 -> 50 - 1 = 49
        expect(result.updatedNeeds.morale.satisfaction).toBe(49);
    });

    test('evaluates acute need lifecycle and creates acute goal', () => {
        initCharacterNeeds(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z');

        // Set energy satisfaction to 10 in SQLite
        db.prepare('UPDATE lws_character_needs SET satisfaction = 10 WHERE simulation_character_id = ? AND need_name = ?')
            .run(character.id, 'energy');

        const acuteRes = evaluateAcuteNeedLifecycle(db, sim, character, '2026-01-01T00:00:00Z');
        expect(acuteRes).toBeDefined();
        expect(acuteRes.action).toBe('created');
        expect(acuteRes.priority).toBe(90); // 80 + (20 - 10) = 90

        const goals = listCharacterGoals(db, character.id, { goal_type: 'acute_need' });
        expect(goals).toHaveLength(1);
        expect(goals[0].status).toBe('active');
        expect(goals[0].priority).toBe(90);
        expect(goals[0].urgency).toBe(100);
        expect(goals[0].objective_action_type).toBe('REST');
    });

    test('acute need tie-breaking selects safety over nourishment over energy', () => {
        initCharacterNeeds(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z');

        // Set both safety and nourishment to 15
        db.prepare('UPDATE lws_character_needs SET satisfaction = 15 WHERE simulation_character_id = ? AND need_name IN (\'safety\', \'nourishment\')')
            .run(character.id);

        const acuteRes = evaluateAcuteNeedLifecycle(db, sim, character, '2026-01-01T00:00:00Z');
        expect(acuteRes.action).toBe('created');

        const goals = listCharacterGoals(db, character.id, { goal_type: 'acute_need' });
        expect(goals).toHaveLength(1);
        // Safety wins tie-breaker -> objective is MOVE_CHARACTER
        expect(goals[0].objective_action_type).toBe('MOVE_CHARACTER');
    });

    test('completes acute goal when need recovers above 20', () => {
        initCharacterNeeds(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z');

        // Create acute goal first
        db.prepare('UPDATE lws_character_needs SET satisfaction = 10 WHERE simulation_character_id = ? AND need_name = ?')
            .run(character.id, 'energy');
        evaluateAcuteNeedLifecycle(db, sim, character, '2026-01-01T00:00:00Z');

        // Now recover satisfaction to 50
        db.prepare('UPDATE lws_character_needs SET satisfaction = 50 WHERE simulation_character_id = ? AND need_name = ?')
            .run(character.id, 'energy');

        const recoverRes = evaluateAcuteNeedLifecycle(db, sim, character, '2026-01-01T00:00:00Z');
        expect(recoverRes.action).toBe('completed');

        const activeGoals = listCharacterGoals(db, character.id, { status: 'active', goal_type: 'acute_need' });
        expect(activeGoals).toHaveLength(0);

        const allGoals = listCharacterGoals(db, character.id, { goal_type: 'acute_need', include_deleted: true });
        expect(allGoals[0].status).toBe('completed');
        expect(allGoals[0].progress).toBe(100);
    });

    test('detects severe physical conditions correctly', () => {
        expect(isSeverePhysicalCondition({ physical_condition: 'healthy' })).toBe(false);
        expect(isSeverePhysicalCondition({ physical_condition: 'exhausted' })).toBe(true);
        expect(isSeverePhysicalCondition({ physical_condition: 'starving' })).toBe(true);
        expect(isSeverePhysicalCondition({ physical_condition: 'incapacitated' })).toBe(true);

        expect(deriveInterruptedActivity({ physical_condition: 'exhausted' })).toBe('collapsing_to_rest');
        expect(deriveInterruptedActivity({ physical_condition: 'starving' })).toBe('seeking_sustenance');
    });

    test('need relevance matrix conforms to frozen specification', () => {
        expect(getNeedRelevance('energy', { action_type: 'REST' })).toBe(1.00);
        expect(getNeedRelevance('nourishment', { action_type: 'CONSUME_ITEM' })).toBe(1.00);
        expect(getNeedRelevance('social', { action_type: 'COMMUNICATE' })).toBe(0.80);
        expect(getNeedRelevance('safety', { action_type: 'MOVE_CHARACTER', payload: { is_destination_safe: true } })).toBe(0.90);
    });
});
