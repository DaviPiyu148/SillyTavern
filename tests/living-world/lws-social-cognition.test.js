import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    init,
    onExit,
    createWorld,
    createLocation,
    createCharacter,
    createFaction,
    addFactionMember,
    createSimulation,
    addSimulationCharacter,
    commitEvent,
    calculateProposalScore,
    deliberateCharacter,
    EVENT_TYPES,
    getDb,
} from '../../src/living-world/index.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('LWS Phase 8 Social Cognition & Deliberation Integration', () => {
    let tempDir;
    let world;
    let location;
    let factionAllies;
    let sim;
    let charAlice;
    let charBob;
    let charEnemy;
    let simCharAlice;
    let simCharBob;
    let simCharEnemy;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-cog-test-'));
        const dbPath = path.join(tempDir, 'cog-test.db');
        await init({ dbPath });

        world = createWorld({ name: 'Cognition World' });
        location = createLocation(world.lws_id, { name: 'Town Square' });
        factionAllies = createFaction(world.lws_id, { name: 'Allies' });

        charAlice = createCharacter(world.lws_id, { name: 'Alice' });
        charBob = createCharacter(world.lws_id, { name: 'Bob' });
        charEnemy = createCharacter(world.lws_id, { name: 'Enemy' });

        addFactionMember(world.lws_id, factionAllies.lws_id, { character_lws_id: charAlice.lws_id, role: 'member' });
        addFactionMember(world.lws_id, factionAllies.lws_id, { character_lws_id: charBob.lws_id, role: 'member' });

        sim = createSimulation(world.lws_id, {
            name: 'Cognition Sim',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });

        simCharAlice = addSimulationCharacter(sim.lws_id, { character_id: charAlice.lws_id, initial_location_id: location.lws_id });
        simCharBob = addSimulationCharacter(sim.lws_id, { character_id: charBob.lws_id, initial_location_id: location.lws_id });
        simCharEnemy = addSimulationCharacter(sim.lws_id, { character_id: charEnemy.lws_id, initial_location_id: location.lws_id });
    });

    afterEach(async () => {
        await onExit();
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('calculates social utility boosting score for friendly targets', () => {
        const proposalFriend = {
            action_type: 'TALK',
            target_character_id: simCharBob.lws_id,
            target_entity_type: 'character',
            expected_need_satisfactions: { socialization: 20 },
        };

        const stateWithFriend = {
            needs: { socialization: { satisfaction: 50, decay_rate: 100 } },
            values: { benevolence: { strength: 40 } },
            emotions: { dominant_emotion: 'joy', intensity: 50, valence: 30 },
            relationships: {
                [simCharBob.lws_id]: {
                    affection: 60,
                    trust: 50,
                    respect: 40,
                    loyalty: 30,
                    sameFaction: true,
                },
            },
        };

        const scoreFriend = calculateProposalScore(proposalFriend, stateWithFriend);
        expect(scoreFriend.utility_breakdown.u_social).toBeGreaterThan(0);
        expect(scoreFriend.total_score).toBeGreaterThan(50);
    });

    test('calculates social utility penalizing score for hostile targets', () => {
        const proposalEnemy = {
            action_type: 'TALK',
            target_character_id: simCharEnemy.lws_id,
            target_entity_type: 'character',
            expected_need_satisfactions: { socialization: 20 },
        };

        const stateWithEnemy = {
            needs: { socialization: { satisfaction: 50, decay_rate: 100 } },
            values: { benevolence: { strength: 40 } },
            emotions: { dominant_emotion: 'neutral', intensity: 0, valence: 0 },
            relationships: {
                [simCharEnemy.lws_id]: {
                    affection: -80,
                    trust: -90,
                    respect: -50,
                    loyalty: -70,
                    sameFaction: false,
                },
            },
        };

        const scoreEnemy = calculateProposalScore(proposalEnemy, stateWithEnemy);
        expect(scoreEnemy.utility_breakdown.u_social).toBeLessThan(0);
    });

    test('enforces moral veto precedence over high social utility', () => {
        const evilProposalForFriend = {
            action_type: 'MURDER',
            target_character_id: simCharEnemy.lws_id,
            target_entity_type: 'character',
            moral_conflict: 90, // Exceeds moral veto threshold (>= 75)
        };

        const state = {
            needs: {},
            values: { justice: { strength: 80 } },
            emotions: {},
            relationships: {
                [simCharEnemy.lws_id]: {
                    affection: -100,
                    trust: -100,
                },
            },
        };

        const score = calculateProposalScore(evilProposalForFriend, state);
        expect(score.vetoed).toBe(true);
        expect(score.veto_reason).toContain('Moral conflict');
    });

    test('deliberateCharacter automatically integrates directional relationships from database', () => {
        const db = getDb();

        // Establish positive relationship Alice -> Bob
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: simCharAlice.lws_id,
            target_character_id: simCharBob.lws_id,
            location_id: location.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                relationship_delta: {
                    delta_trust: 50,
                    delta_affection: 50,
                    narrative_rationale: 'Good companions',
                },
            },
            provenance: 'llm_proposal',
        }, { isAdmin: true });

        const deliberation = deliberateCharacter(db, sim.lws_id, simCharAlice.lws_id, {
            candidates: [
                {
                    action_type: 'ASSIST',
                    target_character_id: simCharBob.lws_id,
                    target_entity_type: 'character',
                    expected_need_satisfactions: { socialization: 15 },
                },
                {
                    action_type: 'IDLE',
                    expected_need_satisfactions: {},
                },
            ],
        });

        expect(deliberation.chosen_action).toBeDefined();
        expect(deliberation.chosen_action.action_type).toBe('ASSIST');
        expect(deliberation.scores[0].utility_breakdown.u_social).toBeGreaterThan(0);
    });
});
