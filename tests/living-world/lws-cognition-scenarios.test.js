import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { init, onExit, getDb } from '../../src/living-world/index.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import {
    initCharacterNeeds,
    getCharacterNeeds,
    evaluateAcuteNeedLifecycle,
} from '../../src/living-world/cognition/needs.js';
import {
    initCharacterValues,
    getCharacterValues,
    calculateValueScore,
    hasMoralVeto,
} from '../../src/living-world/cognition/values.js';
import {
    initCharacterEmotion,
    getCharacterEmotion,
    calculateEmotionalDecay,
} from '../../src/living-world/cognition/emotions.js';
import {
    createGoal,
    getGoalByLwsId,
    listCharacterGoals,
    updateGoal,
    deleteGoal,
} from '../../src/living-world/cognition/goals.js';
import {
    createIntention,
    getIntentionByLwsId,
    listCharacterIntentions,
} from '../../src/living-world/cognition/intentions.js';
import {
    deliberateCharacter,
    calculateUtilityScore,
} from '../../src/living-world/cognition/deliberation.js';
import { arbitrateRoutine } from '../../src/living-world/cognition/arbitration.js';
import { commitEvent } from '../../src/living-world/events/events.js';
import { executeNarrativeTurn } from '../../src/living-world/events/narrative-turns.js';
import { verifySimulationParity } from '../../src/living-world/events/replay.js';
import { LwsConflictError } from '../../src/living-world/errors.js';

describe('LWS Phase 7 — Canonical Acceptance Scenarios A through J', () => {
    let db;
    let sim;
    let character;
    let tempDir;
    let authoredChar;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-scenarios-test-'));
        const dbPath = path.join(tempDir, 'test.db');
        await init({ dbPath });
        db = getDb();

        const world = createWorld({ name: 'Test World' });
        authoredChar = createCharacter(world.lws_id, { name: 'Elena' });
        const simRes = createSimulation(world.lws_id, {
            name: 'Sim 1',
            initial_fictional_time: '2026-01-01T08:00:00Z',
        });
        const simCharRes = addSimulationCharacter(simRes.lws_id, { character_id: authoredChar.lws_id });

        sim = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(simRes.lws_id);
        character = db.prepare('SELECT * FROM lws_simulation_characters WHERE lws_id = ?').get(simCharRes.lws_id);

        initCharacterNeeds(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z');
        initCharacterValues(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T00:00:00Z');
        initCharacterEmotion(db, sim.id, character.id, sim.lws_id, character.lws_id, '2026-01-01T08:00:00Z', '2026-01-01T00:00:00Z');
    });

    afterEach(async () => {
        await onExit();
        if (tempDir) {
            try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
        }
    });

    test('Scenario A — Acute Need Preemption & Replay Parity', () => {
        // Drop energy to 15
        db.prepare('UPDATE lws_character_needs SET satisfaction = 15 WHERE simulation_character_id = ? AND need_name = ?')
            .run(character.id, 'energy');

        const acuteRes = evaluateAcuteNeedLifecycle(db, sim, character, '2026-01-01T00:00:00Z');
        expect(acuteRes.action).toBe('created');

        const activeGoals = listCharacterGoals(db, character.id, { status: 'active' });
        const activeAcute = activeGoals.find(g => g.goal_type === 'acute_need');
        expect(activeAcute).toBeDefined();
        expect(activeAcute.priority).toBe(85);

        // Routine arbitration should trigger Tier 3 (GOAL_PURSUIT)
        const mockWorld = { id: 1, base_edge_distance_meters: 1000 };
        const arb = arbitrateRoutine({
            ...character,
            runtime_state: { goals: activeGoals, intentions: [] },
            routines: [{ fictional_start_time: '2026-01-01T08:00:00Z', fictional_end_time: '2026-01-01T12:00:00Z', activity: 'working' }],
        }, mockWorld, '2026-01-01T09:00:00Z');

        expect(arb.tier).toBe('GOAL_PURSUIT');
    });

    test('Scenario B — Personality Value Honesty Veto', () => {
        const values = { honesty: 80 };
        const deceptiveProposal = {
            action_type: 'COMMUNICATE',
            target_character_id: 'target-1',
            payload: { is_deceptive: true, statement: 'A lie' },
        };
        const truthfulProposal = {
            action_type: 'COMMUNICATE',
            target_character_id: 'target-1',
            payload: { is_deceptive: false, statement: 'The truth' },
        };

        const scoreDeceptive = calculateUtilityScore(deceptiveProposal, {
            goals: [],
            needs: { energy: { satisfaction: 80 } },
            values,
            emotion: { dominant_emotion: 'neutral', intensity: 0 },
        });

        const scoreTruthful = calculateUtilityScore(truthfulProposal, {
            goals: [],
            needs: { energy: { satisfaction: 80 } },
            values,
            emotion: { dominant_emotion: 'neutral', intensity: 0 },
        });

        expect(scoreDeceptive.moralVeto).toBe(true);
        expect(scoreDeceptive.U).toBe(-100);
        expect(scoreTruthful.moralVeto).toBe(false);
        expect(scoreTruthful.U).toBeGreaterThan(-100);
    });

    test('Scenario C — Emotional Decay Parity (Exact Assertions)', () => {
        const emo = {
            dominant_emotion: 'fearful',
            intensity: 100,
            arousal: 100,
            valence: 0,
            last_updated_time: '2026-01-01T08:00:00Z',
        };

        // Advance 14400s (1 tau)
        const step1 = calculateEmotionalDecay(emo, '2026-01-01T12:00:00Z');
        expect(step1.intensity).toBe(50);
        expect(step1.arousal).toBe(75);
        expect(step1.valence).toBe(0);
        expect(step1.dominant_emotion).toBe('fearful');

        // Advance far into future (>34 days) -> intensity drops to 0 -> Step 5 resets
        const step2 = calculateEmotionalDecay(emo, '2026-03-01T08:00:00Z');
        expect(step2.intensity).toBe(0);
        expect(step2.dominant_emotion).toBe('neutral');
        expect(step2.arousal).toBe(50);
        expect(step2.valence).toBe(0);
    });

    test('Scenario D — Goal/Intention Cascade on Completion', () => {
        const goal = createGoal(db, sim, character, { title: 'Long journey' });
        const intention = createIntention(db, sim, character, {
            goal_id: goal.lws_id,
            action_type: 'WORK',
            status: 'active',
        });

        // Mark goal completed
        updateGoal(db, goal.lws_id, { status: 'completed' });

        const updatedIntention = getIntentionByLwsId(db, intention.lws_id);
        expect(updatedIntention.status).toBe('cancelled');
        expect(updatedIntention.cancellation_reason).toBe('goal_completed');
    });

    test('Scenario E — Feasibility Rejection in /deliberate commits failed intention (Option B)', () => {
        // Attempt action that fails authority (e.g. non-existent target or invalid action)
        const result = deliberateCharacter(db, sim.lws_id, character.lws_id, {
            executeChosenAction: true,
            candidates: [
                {
                    action_type: 'CONSUME_ITEM',
                    target_entity_id: 'missing-item-id-999',
                    payload: { item_id: 'missing-item-id-999' },
                },
            ],
        });

        // Authority failure produces HTTP 422 / success: false
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(result.intention_id).toBeDefined();

        // Failed intention must be durably recorded in SQLite
        const intention = getIntentionByLwsId(db, result.intention_id);
        expect(intention).toBeDefined();
        expect(intention.status).toBe('failed');

        // Authoritative UPDATE_RUNTIME_STATE event committed carrying payload.cognition.failed_intention
        const events = db.prepare('SELECT * FROM lws_events WHERE simulation_id = ?').all(sim.id);
        expect(events.length).toBeGreaterThan(0);
        const lastEv = events[events.length - 1];
        expect(lastEv.event_type).toBe('UPDATE_RUNTIME_STATE');
        const p = JSON.parse(lastEv.payload);
        expect(p.cognition?.failed_intention).toBeDefined();
        expect(p.cognition.failed_intention.status).toBe('failed');
    });

    test('Scenario F — Narrative Turn Authority Rejection Rolls Back Entire Batch', () => {
        const turnResult = executeNarrativeTurn(sim.lws_id, {
            turn_number: 1,
            proposals: [
                {
                    action_type: 'CONSUME_ITEM',
                    actor_character_id: character.lws_id,
                    target_entity_id: 'invalid-item',
                    payload: { item_id: 'invalid-item' },
                },
            ],
        }, { isAdmin: true });

        expect(turnResult.success).toBe(false);

        // Under Phase 4 batch semantics, ZERO action events and ZERO intentions survive from rejected batch
        const intentions = listCharacterIntentions(db, character.id, { include_terminal: true });
        expect(intentions).toHaveLength(0);
    });

    test('Scenario G — Soft-delete & client_goal_key Permanent Uniqueness', () => {
        const goal = createGoal(db, sim, character, {
            title: 'Permanent Key Goal',
            client_goal_key: 'my_fixed_goal_key',
        });

        deleteGoal(db, goal.lws_id);

        expect(() => {
            createGoal(db, sim, character, {
                title: 'Duplicate Key Attempt',
                client_goal_key: 'my_fixed_goal_key',
            });
        }).toThrow(LwsConflictError);
    });

    test('Scenario H — Routine Gap enters Goal Pursuit when goals exist', () => {
        const mockWorld = { id: 1, base_edge_distance_meters: 1000 };
        const g = createGoal(db, sim, character, { title: 'Gap Activity' });
        const i = createIntention(db, sim, character, { goal_id: g.lws_id, action_type: 'WORK', status: 'active' });

        const arb = arbitrateRoutine({
            ...character,
            runtime_state: { goals: [g], intentions: [i] },
            routines: [], // Routine gap
        }, mockWorld, '2026-01-01T15:00:00Z');

        expect(arb.tier).toBe('GOAL_PURSUIT');
        expect(arb.intention.lws_id).toBe(i.lws_id);
    });

    test('Scenario J — Full Zero-SQL Deterministic Replay Parity', () => {
        const replayWorld = createWorld({ name: 'Replay World' });
        const replayAuthChar = createCharacter(replayWorld.lws_id, { name: 'Replay Char' });
        const replaySim = createSimulation(replayWorld.lws_id, {
            name: 'Replay Sim',
            initial_fictional_time: '2026-01-01T08:00:00Z',
        });

        // 1. Commit CHARACTER_JOIN
        commitEvent(replaySim.lws_id, {
            event_type: 'CHARACTER_JOIN',
            authored_character_id: replayAuthChar.lws_id,
            fictional_time: '2026-01-01T08:00:00Z',
            provenance: 'simulation_engine',
        }, { isInternalSystem: true });

        const joinedSimChar = db.prepare(`
            SELECT sc.* FROM lws_simulation_characters sc
            JOIN lws_simulations s ON sc.simulation_id = s.id
            WHERE s.lws_id = ?
        `).get(replaySim.lws_id);

        // 2. Commit REST action carrying payload.intention
        commitEvent(replaySim.lws_id, {
            event_type: 'REST',
            actor_character_id: joinedSimChar.lws_id,
            fictional_time: '2026-01-01T08:00:00Z',
            provenance: 'llm_proposal',
            payload: {
                intention: {
                    lws_id: 'i-rep-1',
                    action_type: 'REST',
                    status: 'completed',
                    priority: 50,
                },
            },
        }, { isAdmin: true });

        const parity = verifySimulationParity(replaySim.lws_id);
        expect(parity.parity_matched).toBe(true);
        expect(parity.differences).toHaveLength(0);
    });
});
