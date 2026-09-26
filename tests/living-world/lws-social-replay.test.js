import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    init,
    onExit,
    createWorld,
    createCharacter,
    createFaction,
    addFactionMember,
    createLocation,
    createSimulation,
    addSimulationCharacter,
    commitEvent,
    listEvents,
    replaySimulation,
    verifySimulationParity,
    advanceFictionalTime,
    EVENT_TYPES,
    getDb,
} from '../../src/living-world/index.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('LWS Phase 8 Zero-SQL Pure Replay & Social Parity Verification', () => {
    let tempDir;
    let world;
    let location;
    let faction;
    let sim;
    let charAlice;
    let charBob;
    let simCharAlice;
    let simCharBob;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-social-replay-test-'));
        const dbPath = path.join(tempDir, 'social-replay.db');
        await init({ dbPath });

        world = createWorld({ name: 'Replay World' });
        location = createLocation(world.lws_id, { name: 'Great Hall' });
        faction = createFaction(world.lws_id, { name: 'Knights of the Sun' });

        charAlice = createCharacter(world.lws_id, { name: 'Alice' });
        charBob = createCharacter(world.lws_id, { name: 'Bob' });

        addFactionMember(world.lws_id, faction.lws_id, { character_lws_id: charAlice.lws_id, role: 'commander' });

        sim = createSimulation(world.lws_id, {
            name: 'Replay Sim',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });

        simCharAlice = addSimulationCharacter(sim.lws_id, { character_id: charAlice.lws_id, initial_location_id: location.lws_id });
        simCharBob = addSimulationCharacter(sim.lws_id, { character_id: charBob.lws_id, initial_location_id: location.lws_id });
    });

    afterEach(async () => {
        await onExit();
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('replays diverse Phase 8 events and achieves 100% database parity', async () => {
        const db = getDb();

        // 1. COMMUNICATE with relationship delta, rumor, and belief
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: simCharAlice.lws_id,
            target_character_id: simCharBob.lws_id,
            location_id: location.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                message: 'I have heard of a lurking shadow.',
                relationship_delta: {
                    delta_trust: 30,
                    delta_affection: 20,
                    delta_familiarity: 40,
                    delta_respect: 15,
                    delta_loyalty: 10,
                    narrative_rationale: 'Shared intelligence',
                },
                social_information: {
                    subject_key: 'shadow_monster',
                    topic: 'mystery',
                    claim_statement: 'A lurking shadow was seen in the catacombs.',
                    veracity: 'true',
                    transmission_depth: 0,
                    confidence_score: 85,
                },
            },
            provenance: 'llm_proposal',
        }, { isAdmin: true });

        // 2. TRANSFER_ITEM with gift impact
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.TRANSFER_ITEM,
            actor_character_id: simCharAlice.lws_id,
            target_character_id: simCharBob.lws_id,
            location_id: location.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                item_name: 'Silver Amulet',
                relationship_impact: {
                    delta_trust: 15,
                    delta_affection: 25,
                    delta_familiarity: 10,
                    delta_loyalty: 5,
                },
            },
            provenance: 'llm_proposal',
        }, { isAdmin: true });

        // 3. COMBAT_ACTION involving combat relationship impact
        const combatEvent = commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMBAT_ACTION,
            actor_character_id: simCharBob.lws_id,
            target_character_id: simCharAlice.lws_id,
            location_id: location.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                action: 'duel_strike',
                relationship_impact: {
                    delta_trust: -10,
                    delta_affection: -5,
                    delta_respect: 10,
                    delta_loyalty: 0,
                },
            },
            provenance: 'llm_proposal',
        }, { isAdmin: true });

        // 4. UPDATE_RUNTIME_STATE with character development record
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
            actor_character_id: simCharAlice.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                social_state: {
                    development_record: {
                        dimension_category: 'value_shift',
                        dimension_key: 'courage',
                        previous_value: 0,
                        new_value: 60,
                        trigger_category: 'acute_trauma',
                        causal_event_ids: [combatEvent.lws_id],
                        stability: 75,
                    },
                },
            },
            provenance: 'llm_proposal',
        }, { isAdmin: true });

        // 5. DIRECTOR_MODIFY_STATE modifying faction membership
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            actor_character_id: simCharAlice.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                target: 'faction_membership',
                faction_id: faction.lws_id,
                rank_role: 'grandmaster',
                standing: 80,
                loyalty_score: 95,
                membership_status: 'active',
            },
            provenance: 'director',
        }, { isAdmin: true });

        // 6. TIME_ADVANCE via advanceFictionalTime
        await advanceFictionalTime(db, {
            simLwsId: sim.lws_id,
            durationSeconds: 86400,
            provenance: 'user',
        });

        // --------------------------------------------------------------------
        // Pure In-Memory Fold & Parity Assertion
        // --------------------------------------------------------------------
        const events = listEvents(sim.lws_id, { unlimited: true });
        const replayed = replaySimulation(events);

        expect(replayed.simulation.current_fictional_time).toBe('2026-06-02T12:00:00Z');
        expect(Object.keys(replayed.characters)).toHaveLength(2);
        expect(Object.keys(replayed.relationships)).toHaveLength(2);
        expect(replayed.relationshipEvidence.length).toBeGreaterThanOrEqual(3);
        expect(replayed.developmentRecords).toHaveLength(1);

        const parity = verifySimulationParity(sim.lws_id);
        expect(parity.verified).toBe(true);
        expect(parity.parity_matched).toBe(true);
        expect(parity.drift_detected).toBe(false);
        expect(parity.differences).toHaveLength(0);
    });
});
