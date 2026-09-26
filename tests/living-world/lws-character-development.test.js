import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    init,
    onExit,
    createWorld,
    createCharacter,
    createLocation,
    createSimulation,
    addSimulationCharacter,
    commitEvent,
    advanceFictionalTime,
    getDevelopmentRecord,
    listCharacterDevelopmentRecords,
    getCharacterValues,
    getCharacterNeeds,
    EVENT_TYPES,
    getDb,
} from '../../src/living-world/index.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('LWS Phase 8 Character Development & Enforceable Causality', () => {
    let tempDir;
    let world;
    let location;
    let sim;
    let charAlice;
    let charBob;
    let simCharAlice;
    let simCharBob;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-dev-test-'));
        const dbPath = path.join(tempDir, 'dev-test.db');
        await init({ dbPath });

        world = createWorld({ name: 'Dev World' });
        location = createLocation(world.lws_id, { name: 'Town Square' });
        charAlice = createCharacter(world.lws_id, { name: 'Alice' });
        charBob = createCharacter(world.lws_id, { name: 'Bob' });

        sim = createSimulation(world.lws_id, {
            name: 'Dev Sim',
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

    // ========================================================================
    // 9 Causality Tests (6 Negative + 3 Positive)
    // ========================================================================

    describe('Development Causality Ledger Verification (9 Cases)', () => {
        // --- 3 Positive Causality Cases ---

        test('Case 7 (Positive): traumatic combat trigger produces valid value shift and projects to character values', () => {
            const db = getDb();

            // 1. Commit combat event involving Alice and Bob
            const combatEvent = commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMBAT_ACTION,
                actor_character_id: simCharBob.lws_id,
                target_character_id: simCharAlice.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { action: 'attack', damage: 40 },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            // 2. Commit development record referencing the combat event
            const devEvent = commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                actor_character_id: simCharAlice.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    social_state: {
                        development_record: {
                            dimension_category: 'value_shift',
                            dimension_key: 'courage',
                            previous_value: 0,
                            new_value: 70,
                            trigger_category: 'acute_trauma',
                            causal_event_ids: [combatEvent.lws_id],
                            stability: 80,
                        },
                    },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            expect(devEvent).toBeDefined();

            // Verify development record logged
            const records = listCharacterDevelopmentRecords(db, sim.lws_id, simCharAlice.lws_id);
            expect(records).toHaveLength(1);
            expect(records[0].dimension_key).toBe('courage');
            expect(records[0].delta).toBe(70);
            expect(records[0].trigger_category).toBe('acute_trauma');
            expect(records[0].causal_event_ids).toContain(combatEvent.lws_id);

            // Verify dual-store projection to lws_character_values
            const values = getCharacterValues(db, simCharAlice.lws_id);
            const val = values.find(v => v.dimension === 'courage');
            expect(val).toBeDefined();
            expect(val.strength).toBe(70);
        });

        test('Case 8 (Positive): sustained need starvation produces valid baseline need decay rate shift', async () => {
            const db = getDb();

            // 1. Advance time causing starvation
            const advanceResult = await advanceFictionalTime(db, {
                simLwsId: sim.lws_id,
                durationSeconds: 86400,
                provenance: 'user',
            });
            const timeEvent1 = advanceResult.root_event;

            // 2. Commit development record shifting hunger baseline decay rate
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                actor_character_id: simCharAlice.lws_id,
                fictional_time: advanceResult.current_fictional_time,
                payload: {
                    social_state: {
                        development_record: {
                            dimension_category: 'baseline_need_shift',
                            dimension_key: 'nourishment',
                            previous_value: 100,
                            new_value: 150,
                            trigger_category: 'sustained_experience',
                            causal_event_ids: [timeEvent1.lws_id],
                            stability: 60,
                        },
                    },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            // Verify development record logged
            const records = listCharacterDevelopmentRecords(db, sim.lws_id, simCharAlice.lws_id);
            expect(records).toHaveLength(1);
            expect(records[0].dimension_category).toBe('baseline_need_shift');

            // Verify projection into character needs decay rate
            const needs = getCharacterNeeds(db, simCharAlice.lws_id);
            const nourishmentNeed = needs.find(n => n.need_name === 'nourishment');
            expect(nourishmentNeed).toBeDefined();
            expect(nourishmentNeed.decay_rate).toBe(150);
        });

        test('Case 9 (Positive): director override intervention applies valid character development', () => {
            const db = getDb();

            const devEvent = commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
                actor_character_id: simCharAlice.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    target: 'character_development',
                    development_record: {
                        dimension_category: 'disposition_shift',
                        dimension_key: 'paranoia',
                        previous_value: 0,
                        new_value: 85,
                        trigger_category: 'director_override',
                        stability: 90,
                    },
                },
                provenance: 'director',
            }, { isAdmin: true });

            const records = listCharacterDevelopmentRecords(db, sim.lws_id, simCharAlice.lws_id);
            expect(records).toHaveLength(1);
            expect(records[0].dimension_category).toBe('disposition_shift');
            expect(records[0].new_value).toBe(85);
        });

        // --- 6 Negative Causality Cases ---

        test('Case 1 (Negative): rejects development shift without causal event IDs (non-director)', () => {
            expect(() => {
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
                                new_value: 50,
                                trigger_category: 'acute_trauma',
                                causal_event_ids: [], // Empty causal events!
                                stability: 50,
                            },
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/causal_event_ids/);
        });

        test('Case 2 (Negative): rejects causal event non-existent in simulation', () => {
            expect(() => {
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
                                new_value: 50,
                                trigger_category: 'acute_trauma',
                                causal_event_ids: ['00000000-0000-0000-0000-999999999999'], // Non-existent event!
                                stability: 50,
                            },
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/Causal event.*not found in simulation/);
        });

        test('Case 3 (Negative): rejects causal event type unrelated to claimed development trigger', () => {
            // REST event is not a valid basis for acute_trauma trigger
            const restEvent = commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.REST,
                actor_character_id: simCharAlice.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { duration: 3600 },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            expect(() => {
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
                                new_value: 50,
                                trigger_category: 'acute_trauma', // REST is not acute trauma!
                                causal_event_ids: [restEvent.lws_id],
                                stability: 50,
                            },
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/unrelated to trigger category/);
        });

        test('Case 4 (Negative): rejects development when character was not involved in causal event', () => {
            // Combat between Alice and Bob at Town Square
            const combatEvent = commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMBAT_ACTION,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { action: 'attack' },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            // Create a third character elsewhere at a distant location
            const distantLoc = createLocation(world.lws_id, { name: 'Distant Forest' });
            const charCharlie = createCharacter(world.lws_id, { name: 'Charlie' });
            const simCharCharlie = addSimulationCharacter(sim.lws_id, { character_id: charCharlie.lws_id, initial_location_id: distantLoc.lws_id });

            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                    actor_character_id: simCharCharlie.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_state: {
                            development_record: {
                                dimension_category: 'value_shift',
                                dimension_key: 'trauma',
                                previous_value: 0,
                                new_value: 50,
                                trigger_category: 'acute_trauma',
                                causal_event_ids: [combatEvent.lws_id], // Charlie was not involved!
                                stability: 50,
                            },
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/not involved in causal event/);
        });

        test('Case 5 (Negative): rejects stability score out of bounds (< 1 or > 100)', () => {
            const combatEvent = commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMBAT_ACTION,
                actor_character_id: simCharBob.lws_id,
                target_character_id: simCharAlice.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { action: 'attack' },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                    actor_character_id: simCharAlice.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_state: {
                            development_record: {
                                dimension_category: 'value_shift',
                                dimension_key: 'fear',
                                previous_value: 0,
                                new_value: 50,
                                trigger_category: 'acute_trauma',
                                causal_event_ids: [combatEvent.lws_id],
                                stability: 150, // Out of bounds (> 100)
                            },
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/stability/);
        });

        test('Case 6 (Negative): rejects invalid dimension category or invalid trigger category', () => {
            const combatEvent = commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMBAT_ACTION,
                actor_character_id: simCharBob.lws_id,
                target_character_id: simCharAlice.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { action: 'attack' },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                    actor_character_id: simCharAlice.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_state: {
                            development_record: {
                                dimension_category: 'magical_telepathy_shift', // Invalid category!
                                dimension_key: 'magic',
                                previous_value: 0,
                                new_value: 50,
                                trigger_category: 'acute_trauma',
                                causal_event_ids: [combatEvent.lws_id],
                                stability: 50,
                            },
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/dimension_category/);
        });
    });
});
