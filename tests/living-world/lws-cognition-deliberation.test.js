import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createInMemoryTestDb } from './fixtures/test-db.js';
import {
    calculateUtilityScore,
    categorizeActionProposal,
    deliberateCharacter,
} from '../../src/living-world/cognition/deliberation.js';
import { initCharacterNeeds } from '../../src/living-world/cognition/needs.js';
import { initCharacterValues } from '../../src/living-world/cognition/values.js';
import { initCharacterEmotion } from '../../src/living-world/cognition/emotions.js';
import { createGoal } from '../../src/living-world/cognition/goals.js';

describe('LWS Phase 7 — Character Deliberation & Decision Making', () => {
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
            INSERT INTO lws_locations (id, lws_id, world_id, name, created_at, updated_at)
            VALUES (1, '50000000-0000-0000-0000-000000000001', 1, 'Town Square', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                   (2, '50000000-0000-0000-0000-000000000002', 1, 'Tavern', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_characters (id, lws_id, world_id, name, created_at, updated_at)
            VALUES (1, '20000000-0000-0000-0000-000000000001', 1, 'Dan', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_simulations (id, lws_id, world_id, name, status, current_fictional_time, created_at, updated_at)
            VALUES (1, '30000000-0000-0000-0000-000000000001', 1, 'Sim 1', 'active', '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_simulation_characters (id, lws_id, simulation_id, character_id, current_location_id, runtime_state, created_at, updated_at)
            VALUES (1, '40000000-0000-0000-0000-000000000001', 1, 1, 1, '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();


        sim = db.prepare('SELECT * FROM lws_simulations WHERE id = 1').get();
        character = db.prepare('SELECT * FROM lws_simulation_characters WHERE id = 1').get();

        initCharacterNeeds(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z');
        initCharacterValues(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T00:00:00Z');
        initCharacterEmotion(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z');
    });

    afterEach(() => {
        if (db && db.open) db.close();
    });

    test('categorizes acute need actions into Category 3', () => {
        const needs = {
            energy: { satisfaction: 15 },
        };
        const proposal = { action_type: 'REST' };

        const cat = categorizeActionProposal(proposal, { needs });
        expect(cat).toBe(3);
    });

    test('categorizes active goal actions into Category 2', () => {
        const goals = [{ status: 'active', objective_action_type: 'WORK' }];
        const proposal = { action_type: 'WORK' };

        const cat = categorizeActionProposal(proposal, { goals });
        expect(cat).toBe(2);
    });

    test('categorizes routine / idle actions into Category 1', () => {
        const currentRoutine = { activity: 'working', location_id: 1 };
        const proposal = { action_type: 'WORK' };

        const cat = categorizeActionProposal(proposal, { routine: currentRoutine });
        expect(cat).toBe(1);
    });

    test('calculates utility score including penalties and travel cost', () => {
        const proposal = {
            action_type: 'MOVE_CHARACTER',
            location_id: '50000000-0000-0000-0000-000000000002',
            payload: { distance: 3 }, // 3 edges -> TravelTimeCost = min(50, 10 * 3) = 30
        };

        const score = calculateUtilityScore(proposal, {
            goals: [],
            needs: { energy: { satisfaction: 50 }, safety: { satisfaction: 50 } },
            values: { honesty: 0 },
            emotion: { dominant_emotion: 'neutral', intensity: 0 },
            consecutiveIdleTurns: 2, // ProcrastinationPenalty = 15 * 2 = 30 for IDLE, 0 for non-idle
        });

        expect(score.penalties.travelTimeCost).toBe(30);
        expect(score.penalties.procrastinationPenalty).toBe(0);
    });

    test('deliberateCharacter dry-run mode produces evaluations without database mutations', () => {
        const result = deliberateCharacter(db, sim.lws_id, character.lws_id, {
            executeChosenAction: false,
            candidates: [
                { action_type: 'WORK', payload: { description: 'Work hard' } },
                { action_type: 'REST', payload: { description: 'Take a break' } },
            ],
        });

        expect(result.dry_run).toBe(true);
        expect(result.chosen_action).toBeDefined();
        expect(result.candidate_evaluations).toHaveLength(2);

        // Verify zero events created
        const evCount = db.prepare('SELECT COUNT(*) AS cnt FROM lws_events').get().cnt;
        expect(evCount).toBe(0);

        // Verify zero intentions created
        const intCount = db.prepare('SELECT COUNT(*) AS cnt FROM lws_character_intentions').get().cnt;
        expect(intCount).toBe(0);
    });

    test('deliberateCharacter execute mode creates intention and commits action event', () => {
        const result = deliberateCharacter(db, sim.lws_id, character.lws_id, {
            executeChosenAction: true,
            candidates: [
                { action_type: 'REST', payload: { duration_seconds: 3600 } },
            ],
        });

        expect(result.success).toBe(true);
        expect(result.intention_id).toBeDefined();

        // Verify intention was completed
        const intention = db.prepare('SELECT * FROM lws_character_intentions WHERE lws_id = ?').get(result.intention_id);
        expect(intention).toBeDefined();
        expect(intention.status).toBe('completed');

        // Verify event was committed with payload.intention
        const events = db.prepare('SELECT * FROM lws_events WHERE simulation_id = ?').all(sim.id);
        expect(events.length).toBeGreaterThan(0);
        const lastEv = events[events.length - 1];
        expect(lastEv.event_type).toBe('REST');
        const p = JSON.parse(lastEv.payload);
        expect(p.intention).toBeDefined();
        expect(p.intention.lws_id).toBe(result.intention_id);
    });
});
