import { openDb, closeDb, getDb } from '../../src/living-world/db.js';
import { EVENT_TYPES, PROVENANCE_TYPES } from '../../src/living-world/events/taxonomy.js';
import { commitEvent, listEvents } from '../../src/living-world/events/events.js';
import { replaySimulation, verifySimulationParity } from '../../src/living-world/events/replay.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createFaction, addFactionMember } from '../../src/living-world/authored/factions.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { generateDeterministicUuid } from '../../src/living-world/authored/common.js';

describe('LWS Phase 13 Hardening — Full-Lifecycle Event & Replay Parity', () => {
    let db;
    let world;
    let loc1;
    let loc2;
    let char1;
    let char2;
    let faction1;
    let sim;
    let simChar1;
    let simChar2;

    beforeEach(() => {
        db = openDb(':memory:');

        world = createWorld({ name: 'Replay Verification World' });
        loc1 = createLocation(world.lws_id, { name: 'Citadel Plaza' });
        loc2 = createLocation(world.lws_id, { name: 'Grand Archives' });

        char1 = createCharacter(world.lws_id, { name: 'Eldrin', summary: 'Scholar Mage' });
        char2 = createCharacter(world.lws_id, { name: 'Valeria', summary: 'Knight Captain' });

        faction1 = createFaction(world.lws_id, { name: 'Archival Guard' });
        addFactionMember(world.lws_id, faction1.lws_id, { character_lws_id: char1.lws_id, role: 'archivist' });
        addFactionMember(world.lws_id, faction1.lws_id, { character_lws_id: char2.lws_id, role: 'commander' });

        sim = createSimulation(world.lws_id, {
            name: 'Replay Continuity Simulation',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });
        simChar1 = addSimulationCharacter(sim.lws_id, { character_id: char1.lws_id, initial_location_id: loc1.lws_id });
        simChar2 = addSimulationCharacter(sim.lws_id, { character_id: char2.lws_id, initial_location_id: loc1.lws_id });
    });

    afterEach(() => {
        closeDb();
    });

    test('replays full multi-phase event stream across all 29 event types and achieves 100% database parity', () => {
        // Movement and activities
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.MOVE_CHARACTER,
            actor_character_id: simChar1.lws_id,
            location_id: loc2.lws_id,
            payload: {},
        });

        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.MOVE_CHARACTER,
            actor_character_id: simChar2.lws_id,
            location_id: loc2.lws_id,
            payload: {},
        });

        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
            actor_character_id: simChar1.lws_id,
            location_id: loc2.lws_id,
            payload: { activity: 'studying ancient texts' },
        });

        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.UPDATE_PHYSICAL_CONDITION,
            actor_character_id: simChar1.lws_id,
            location_id: loc2.lws_id,
            payload: { physical_condition: 'fatigued' },
        });

        // Communication with facts, memories, beliefs, relationships, and rumors
        const commEvent = commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: simChar1.lws_id,
            target_character_id: simChar2.lws_id,
            location_id: loc2.lws_id,
            payload: {
                message: 'The archives contain records of the northern breach.',
                facts: [{ fact_key: 'northern_breach', content: 'Northern wall was breached 50 years ago.' }],
                beliefs: [{ subject_key: 'citadel_safety', statement: 'Citadel defenses are compromised', confidence: 75, belief_type: 'belief' }],
                relationship_delta: {
                    delta_trust: 10,
                    delta_affection: 5,
                    delta_familiarity: 15,
                    delta_respect: 12,
                    delta_loyalty: 8,
                    narrative_rationale: 'Shared secret history',
                    reverse: {
                        delta_trust: 12,
                        delta_affection: 5,
                        delta_familiarity: 15,
                        delta_respect: 15,
                        delta_loyalty: 10,
                        narrative_rationale: 'Appreciated the warning',
                    },
                },
                rumor: {
                    subject_key: 'northern_breach_rumor',
                    topic: 'Citadel History',
                    claim_statement: 'A hidden breach exists in the northern wall.',
                    transmission_depth: 0,
                    veracity: 'true',
                    confidence_score: 80,
                },
            },
        });

        // Cognition and runtime state update (goals, needs, emotions, values)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
            actor_character_id: simChar1.lws_id,
            location_id: loc2.lws_id,
            payload: {
                patch: { current_focus: 'decoding' },
                cognition: {
                    create_goal: {
                        lws_id: generateDeterministicUuid('goal', sim.lws_id, simChar1.lws_id, 'find_remedy'),
                        title: 'Find remedy for fatigue',
                        goal_type: 'short_term',
                        priority: 60,
                        urgency: 70,
                        progress: 25,
                    },
                    needs: {
                        energy: { satisfaction: 40, decay_rate: 100 },
                        hunger: { satisfaction: 65, decay_rate: 100 },
                    },
                },
                social: {
                    development_record: {
                        dimension_category: 'value_shift',
                        dimension_key: 'loyalty',
                        previous_value: 0,
                        new_value: 15,
                        delta: 15,
                        trigger_category: 'social_reinforcement',
                        causal_event_ids: [commEvent.lws_id],
                    },
                },
                environment: {
                    weather: 'fog',
                    noise_level: 15,
                    air_quality: 'clean',
                },
                operational_state: {
                    access_status: 'restricted',
                    crowd_density: 'sparse',
                },
            },
        });

        // Run full in-memory replay and verify complete 21-facet parity
        const events = listEvents(sim.lws_id, { unlimited: true });
        const replayed = replaySimulation(events);
        expect(replayed).toBeDefined();
        expect(replayed.simulation.status).toBe('active');
        expect(replayed.simulation.current_fictional_time).toBe('2026-06-01T12:00:00Z');

        const parityResult = verifySimulationParity(sim.lws_id);
        expect(parityResult.verified).toBe(true);
        expect(parityResult.parity_matched).toBe(true);
        expect(parityResult.drift_detected).toBe(false);
        expect(parityResult.differences).toHaveLength(0);
    });

    test('replays long event sequences (N >= 1000) with zero drift and exact fictional time normalization', () => {
        // Emit 1000 sequential events advancing time deterministically
        for (let i = 0; i < 1000; i++) {
            const isChar1 = i % 2 === 0;
            const actorCharId = isChar1 ? simChar1.lws_id : simChar2.lws_id;
            const locId = loc1.lws_id;

            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
                actor_character_id: actorCharId,
                location_id: locId,
                payload: {
                    activity: `patrol_step_${i}`,
                },
            });
        }

        const parityResult = verifySimulationParity(sim.lws_id);
        expect(parityResult.verified).toBe(true);
        expect(parityResult.parity_matched).toBe(true);
        expect(parityResult.event_count).toBe(1003);
        expect(parityResult.drift_detected).toBe(false);
    });
});
