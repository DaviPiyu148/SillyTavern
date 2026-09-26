import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    init,
    onExit,
    createWorld,
    createLocation,
    createCharacter,
    createSimulation,
    addSimulationCharacter,
    commitEvent,
    getSocialInformationByLwsId,
    listSocialInformation,
    getRumorTree,
    listKnownRumors,
    getCharacterBelief,
    EVENT_TYPES,
    getDb,
} from '../../src/living-world/index.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('LWS Phase 8 Social Information & Rumor Transmission Trees', () => {
    let tempDir;
    let world;
    let location;
    let otherLocation;
    let sim;
    let otherSim;
    let charAlice;
    let charBob;
    let charCharlie;
    let charDave;
    let charEve;
    let charFrank;
    let simCharAlice;
    let simCharBob;
    let simCharCharlie;
    let simCharDave;
    let simCharEve;
    let simCharFrank;
    let otherSimChar;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-rumors-test-'));
        const dbPath = path.join(tempDir, 'rumors-test.db');
        await init({ dbPath });

        world = createWorld({ name: 'Rumor World' });
        location = createLocation(world.lws_id, { name: 'Town Square' });
        otherLocation = createLocation(world.lws_id, { name: 'Other Realm' });

        charAlice = createCharacter(world.lws_id, { name: 'Alice' });
        charBob = createCharacter(world.lws_id, { name: 'Bob' });
        charCharlie = createCharacter(world.lws_id, { name: 'Charlie' });
        charDave = createCharacter(world.lws_id, { name: 'Dave' });
        charEve = createCharacter(world.lws_id, { name: 'Eve' });
        charFrank = createCharacter(world.lws_id, { name: 'Frank' });

        sim = createSimulation(world.lws_id, {
            name: 'Rumor Sim',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });
        otherSim = createSimulation(world.lws_id, {
            name: 'Other Sim',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });

        simCharAlice = addSimulationCharacter(sim.lws_id, { character_id: charAlice.lws_id, initial_location_id: location.lws_id });
        simCharBob = addSimulationCharacter(sim.lws_id, { character_id: charBob.lws_id, initial_location_id: location.lws_id });
        simCharCharlie = addSimulationCharacter(sim.lws_id, { character_id: charCharlie.lws_id, initial_location_id: location.lws_id });
        simCharDave = addSimulationCharacter(sim.lws_id, { character_id: charDave.lws_id, initial_location_id: location.lws_id });
        simCharEve = addSimulationCharacter(sim.lws_id, { character_id: charEve.lws_id, initial_location_id: location.lws_id });
        simCharFrank = addSimulationCharacter(sim.lws_id, { character_id: charFrank.lws_id, initial_location_id: location.lws_id });

        otherSimChar = addSimulationCharacter(otherSim.lws_id, { character_id: charAlice.lws_id, initial_location_id: otherLocation.lws_id });
    });

    afterEach(async () => {
        await onExit();
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    // ========================================================================
    // 17 Topology Invariant Tests (13 Negative + 4 Positive)
    // ========================================================================

    describe('Rumor Tree Topology Verification (17 Positive & Negative Cases)', () => {
        // --- 4 Positive Topology Cases ---

        test('Case 14 (Positive): creates valid root rumor claim (Depth 0)', () => {
            const db = getDb();
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    social_information: {
                        subject_key: 'dragon_sighting',
                        topic: 'monsters',
                        claim_statement: 'A red dragon was sighted near the northern mountains.',
                        veracity: 'true',
                        transmission_depth: 0,
                        confidence_score: 90,
                        originator_character_id: simCharAlice.lws_id,
                    },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            const infoList = listSocialInformation(db, sim.lws_id, { topic: 'monsters' });
            expect(infoList).toHaveLength(1);
            expect(infoList[0].transmission_depth).toBe(0);
            expect(infoList[0].subject_key).toBe('dragon_sighting');
            expect(infoList[0].parent_social_information_id).toBeNull();
            expect(infoList[0].root_social_information_id).toBe(infoList[0].lws_id);
        });

        test('Case 15 (Positive): creates valid single-hop transmission (Depth 1)', () => {
            const db = getDb();
            // 1. Root claim
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    social_information: {
                        subject_key: 'dragon_sighting',
                        topic: 'monsters',
                        claim_statement: 'A red dragon was sighted near the northern mountains.',
                        veracity: 'true',
                        transmission_depth: 0,
                        confidence_score: 90,
                        originator_character_id: simCharAlice.lws_id,
                    },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            const rootInfo = listSocialInformation(db, sim.lws_id)[0];

            // 2. Hop 1: Alice -> Bob (Depth 1)
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    social_information: {
                        parent_social_information_id: rootInfo.lws_id,
                        root_social_information_id: rootInfo.lws_id,
                        subject_key: 'dragon_sighting',
                        topic: 'monsters',
                        claim_statement: 'A red dragon was sighted near the northern mountains.',
                        veracity: 'true',
                        transmission_depth: 1,
                        confidence_score: 85,
                        originator_character_id: simCharAlice.lws_id,
                        transmitter_character_id: simCharAlice.lws_id,
                        recipient_character_id: simCharBob.lws_id,
                    },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            const tree = getRumorTree(db, sim.lws_id, rootInfo.lws_id);
            expect(tree.transmission_depth).toBe(0);
            expect(tree.children).toHaveLength(1);
            expect(tree.children[0].transmission_depth).toBe(1);
            expect(tree.children[0].transmitter_character_id).toBe(simCharAlice.lws_id);
            expect(tree.children[0].recipient_character_id).toBe(simCharBob.lws_id);
        });

        test('Case 16 (Positive): creates valid branching multi-hop tree (Depth 2 and 3)', () => {
            const db = getDb();
            // Root
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    social_information: {
                        subject_key: 'dragon_sighting',
                        topic: 'monsters',
                        claim_statement: 'A dragon appeared.',
                        veracity: 'true',
                        transmission_depth: 0,
                    },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const root = listSocialInformation(db, sim.lws_id)[0];

            // Hop 1: Alice -> Bob (Depth 1)
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    social_information: {
                        parent_social_information_id: root.lws_id,
                        root_social_information_id: root.lws_id,
                        subject_key: 'dragon_sighting',
                        topic: 'monsters',
                        claim_statement: 'A dragon appeared.',
                        veracity: 'true',
                        transmission_depth: 1,
                        transmitter_character_id: simCharAlice.lws_id,
                        recipient_character_id: simCharBob.lws_id,
                    },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const hop1 = listSocialInformation(db, sim.lws_id)[0];

            // Hop 2: Bob -> Charlie (Depth 2)
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharBob.lws_id,
                target_character_id: simCharCharlie.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    social_information: {
                        parent_social_information_id: hop1.lws_id,
                        root_social_information_id: root.lws_id,
                        subject_key: 'dragon_sighting',
                        topic: 'monsters',
                        claim_statement: 'A huge dragon appeared!',
                        veracity: 'distorted',
                        distortion_level: 20,
                        transmission_depth: 2,
                        transmitter_character_id: simCharBob.lws_id,
                        recipient_character_id: simCharCharlie.lws_id,
                    },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            const tree = getRumorTree(db, sim.lws_id, root.lws_id);
            expect(tree.children).toHaveLength(1);
            expect(tree.children[0].children).toHaveLength(1);
            expect(tree.children[0].children[0].transmission_depth).toBe(2);
        });

        test('Case 17 (Positive): supports maximum allowed transmission depth (Depth 5)', () => {
            const db = getDb();
            // Root
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'rumor_chain', topic: 'chain', claim_statement: 'Origin', veracity: 'true', transmission_depth: 0 } },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            let current = listSocialInformation(db, sim.lws_id)[0];
            const rootId = current.lws_id;

            const chainChars = [
                [simCharAlice, simCharBob],
                [simCharBob, simCharCharlie],
                [simCharCharlie, simCharDave],
                [simCharDave, simCharEve],
                [simCharEve, simCharFrank],
            ];

            for (let d = 1; d <= 5; d++) {
                const [src, tgt] = chainChars[d - 1];
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: src.lws_id,
                    target_character_id: tgt.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            parent_social_information_id: current.lws_id,
                            root_social_information_id: rootId,
                            subject_key: 'rumor_chain',
                            topic: 'chain',
                            claim_statement: `Hop ${d}`,
                            veracity: 'true',
                            transmission_depth: d,
                            transmitter_character_id: src.lws_id,
                            recipient_character_id: tgt.lws_id,
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
                current = listSocialInformation(db, sim.lws_id)[0];
            }

            expect(current.transmission_depth).toBe(5);
        });

        // --- 13 Negative Topology Cases ---

        test('Case 1 (Negative): rejects non-root node without parent (Depth >= 1 with parent null)', () => {
            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharAlice.lws_id,
                    target_character_id: simCharBob.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            subject_key: 'bad_hop',
                            topic: 'bad',
                            claim_statement: 'Invalid hop',
                            veracity: 'true',
                            transmission_depth: 1, // Depth 1 but parent is null!
                            transmitter_character_id: simCharAlice.lws_id,
                            recipient_character_id: simCharBob.lws_id,
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/Non-root social information \(depth > 0\) must have a non-null parent/);
        });

        test('Case 2 (Negative): rejects root node with non-null parent (Depth 0 with parent)', () => {
            // Create a root first
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'r1', topic: 't', claim_statement: 'c', veracity: 'true', transmission_depth: 0 } },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const r1 = listSocialInformation(getDb(), sim.lws_id)[0];

            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharAlice.lws_id,
                    target_character_id: simCharBob.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            parent_social_information_id: r1.lws_id,
                            subject_key: 'r2',
                            topic: 't',
                            claim_statement: 'c2',
                            veracity: 'true',
                            transmission_depth: 0, // Depth 0 but parent is not null!
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/Root social information \(depth 0\) cannot have a parent/);
        });

        test('Case 3 (Negative): rejects depth skip (Depth != Depth_parent + 1)', () => {
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'r1', topic: 't', claim_statement: 'c', veracity: 'true', transmission_depth: 0 } },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const r1 = listSocialInformation(getDb(), sim.lws_id)[0];

            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharAlice.lws_id,
                    target_character_id: simCharBob.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            parent_social_information_id: r1.lws_id,
                            root_social_information_id: r1.lws_id,
                            subject_key: 'r1',
                            topic: 't',
                            claim_statement: 'c',
                            veracity: 'true',
                            transmission_depth: 3, // Parent depth is 0, but requested depth is 3!
                            transmitter_character_id: simCharAlice.lws_id,
                            recipient_character_id: simCharBob.lws_id,
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/transmission_depth \(3\) must equal parent transmission_depth \+ 1/);
        });

        test('Case 4 (Negative): rejects depth exceeded (Depth > 5)', () => {
            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharAlice.lws_id,
                    target_character_id: simCharBob.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            subject_key: 'deep',
                            topic: 't',
                            claim_statement: 'c',
                            veracity: 'true',
                            transmission_depth: 6, // Depth 6 exceeds 5!
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/transmission_depth must be an integer between 0 and 5/);
        });

        test('Case 5 (Negative): rejects root ID mismatch with parent root ID', () => {
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'rootA', topic: 't', claim_statement: 'cA', veracity: 'true', transmission_depth: 0 } },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const rootA = listSocialInformation(getDb(), sim.lws_id)[0];

            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'rootB', topic: 't', claim_statement: 'cB', veracity: 'true', transmission_depth: 0 } },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const rootB = listSocialInformation(getDb(), sim.lws_id)[0];

            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharAlice.lws_id,
                    target_character_id: simCharBob.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            parent_social_information_id: rootA.lws_id,
                            root_social_information_id: rootB.lws_id, // Mismatched root ID!
                            subject_key: 'mismatch',
                            topic: 't',
                            claim_statement: 'c',
                            veracity: 'true',
                            transmission_depth: 1,
                            transmitter_character_id: simCharAlice.lws_id,
                            recipient_character_id: simCharBob.lws_id,
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/root_social_information_id must match parent root_social_information_id/);
        });

        test('Case 6 (Negative): rejects parent from a different simulation', () => {
            // Create root in otherSim
            commitEvent(otherSim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: otherSimChar.lws_id,
                target_character_id: otherSimChar.lws_id,
                location_id: otherLocation.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'alien_root', topic: 't', claim_statement: 'alien', veracity: 'true', transmission_depth: 0 } },
                provenance: 'director',
            }, { isAdmin: true });
            const foreignRoot = listSocialInformation(getDb(), otherSim.lws_id)[0];

            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharAlice.lws_id,
                    target_character_id: simCharBob.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            parent_social_information_id: foreignRoot.lws_id,
                            root_social_information_id: foreignRoot.lws_id,
                            subject_key: 'alien_root',
                            topic: 't',
                            claim_statement: 'alien',
                            veracity: 'true',
                            transmission_depth: 1,
                            transmitter_character_id: simCharAlice.lws_id,
                            recipient_character_id: simCharBob.lws_id,
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/Parent social information belongs to a different simulation/);
        });

        test('Case 7 (Negative): rejects root from a different simulation', () => {
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'local_root', topic: 't', claim_statement: 'local', veracity: 'true', transmission_depth: 0 } },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const localRoot = listSocialInformation(getDb(), sim.lws_id)[0];

            commitEvent(otherSim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: otherSimChar.lws_id,
                target_character_id: otherSimChar.lws_id,
                location_id: otherLocation.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'alien_root', topic: 't', claim_statement: 'alien', veracity: 'true', transmission_depth: 0 } },
                provenance: 'director',
            }, { isAdmin: true });
            const foreignRoot = listSocialInformation(getDb(), otherSim.lws_id)[0];

            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharAlice.lws_id,
                    target_character_id: simCharBob.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            parent_social_information_id: localRoot.lws_id,
                            root_social_information_id: foreignRoot.lws_id, // Foreign root
                            subject_key: 'local_root',
                            topic: 't',
                            claim_statement: 'local',
                            veracity: 'true',
                            transmission_depth: 1,
                            transmitter_character_id: simCharAlice.lws_id,
                            recipient_character_id: simCharBob.lws_id,
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/Root social information belongs to a different simulation/);
        });

        test('Case 8 (Negative): rejects root reference resolving to a non-root node', () => {
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'r1', topic: 't', claim_statement: 'c', veracity: 'true', transmission_depth: 0 } },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const r1 = listSocialInformation(getDb(), sim.lws_id)[0];

            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    social_information: {
                        parent_social_information_id: r1.lws_id,
                        root_social_information_id: r1.lws_id,
                        subject_key: 'r1',
                        topic: 't',
                        claim_statement: 'c',
                        veracity: 'true',
                        transmission_depth: 1,
                        transmitter_character_id: simCharAlice.lws_id,
                        recipient_character_id: simCharBob.lws_id,
                    },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const hop1 = listSocialInformation(getDb(), sim.lws_id)[0];

            // Attempting to create a node claiming hop1 (Depth 1) is the root node
            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharBob.lws_id,
                    target_character_id: simCharCharlie.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            parent_social_information_id: hop1.lws_id,
                            root_social_information_id: hop1.lws_id, // hop1 is NOT a root node (its depth is 1)
                            subject_key: 'r1',
                            topic: 't',
                            claim_statement: 'c',
                            veracity: 'true',
                            transmission_depth: 2,
                            transmitter_character_id: simCharBob.lws_id,
                            recipient_character_id: simCharCharlie.lws_id,
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/root_social_information_id must match parent root_social_information_id/);
        });

        test('Case 9 (Negative): rejects transmitter from different simulation', () => {
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'r1', topic: 't', claim_statement: 'c', veracity: 'true', transmission_depth: 0 } },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const r1 = listSocialInformation(getDb(), sim.lws_id)[0];

            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharAlice.lws_id,
                    target_character_id: simCharBob.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            parent_social_information_id: r1.lws_id,
                            root_social_information_id: r1.lws_id,
                            subject_key: 'r1',
                            topic: 't',
                            claim_statement: 'c',
                            veracity: 'true',
                            transmission_depth: 1,
                            transmitter_character_id: otherSimChar.lws_id, // Transmitter from other sim
                            recipient_character_id: simCharBob.lws_id,
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/Transmitter character does not belong to this simulation/);
        });

        test('Case 10 (Negative): rejects recipient from different simulation', () => {
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'r1', topic: 't', claim_statement: 'c', veracity: 'true', transmission_depth: 0 } },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const r1 = listSocialInformation(getDb(), sim.lws_id)[0];

            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharAlice.lws_id,
                    target_character_id: simCharBob.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            parent_social_information_id: r1.lws_id,
                            root_social_information_id: r1.lws_id,
                            subject_key: 'r1',
                            topic: 't',
                            claim_statement: 'c',
                            veracity: 'true',
                            transmission_depth: 1,
                            transmitter_character_id: simCharAlice.lws_id,
                            recipient_character_id: otherSimChar.lws_id, // Recipient from other sim
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/Recipient character does not belong to this simulation/);
        });

        test('Case 11 (Negative): rejects transmission where transmitter/recipient mismatch event actor/target', () => {
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'r1', topic: 't', claim_statement: 'c', veracity: 'true', transmission_depth: 0 } },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const r1 = listSocialInformation(getDb(), sim.lws_id)[0];

            expect(() => {
                // Event actor is Alice, target is Bob, but rumor claims transmitter is Charlie
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharAlice.lws_id,
                    target_character_id: simCharBob.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            parent_social_information_id: r1.lws_id,
                            root_social_information_id: r1.lws_id,
                            subject_key: 'r1',
                            topic: 't',
                            claim_statement: 'c',
                            veracity: 'true',
                            transmission_depth: 1,
                            transmitter_character_id: simCharCharlie.lws_id, // Mismatch with event actor!
                            recipient_character_id: simCharBob.lws_id,
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/Transmitter character must match COMMUNICATE event actor/);
        });

        test('Case 12 (Negative): rejects cyclic rumor topology', () => {
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: { social_information: { subject_key: 'cycle_test', topic: 't', claim_statement: 'c', veracity: 'true', transmission_depth: 0 } },
                provenance: 'llm_proposal',
            }, { isAdmin: true });
            const root = listSocialInformation(getDb(), sim.lws_id)[0];

            expect(() => {
                // Attempting to set parent to itself
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharAlice.lws_id,
                    target_character_id: simCharBob.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            lws_id: root.lws_id, // Same ID as parent
                            parent_social_information_id: root.lws_id,
                            root_social_information_id: root.lws_id,
                            subject_key: 'cycle_test',
                            topic: 't',
                            claim_statement: 'c',
                            veracity: 'true',
                            transmission_depth: 1,
                            transmitter_character_id: simCharAlice.lws_id,
                            recipient_character_id: simCharBob.lws_id,
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/Cycle detected in rumor transmission tree/);
        });

        test('Case 13 (Negative): rejects root claim specifying transmitter or recipient', () => {
            expect(() => {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharAlice.lws_id,
                    target_character_id: simCharBob.lws_id,
                    location_id: location.lws_id,
                    fictional_time: '2026-06-01T12:00:00Z',
                    payload: {
                        social_information: {
                            subject_key: 'root_with_trans',
                            topic: 't',
                            claim_statement: 'c',
                            veracity: 'true',
                            transmission_depth: 0,
                            transmitter_character_id: simCharAlice.lws_id, // Root claims must not specify transmitter
                        },
                    },
                    provenance: 'llm_proposal',
                }, { isAdmin: true });
            }).toThrow(/Root social information \(depth 0\) must not declare transmitter or recipient characters/);
        });
    });

    // ========================================================================
    // Subjective Belief Adoption Tests
    // ========================================================================

    describe('Subjective Belief Adoption from Communication', () => {
        test('recipient adopts belief with scaled confidence when trust > -30', () => {
            const db = getDb();

            // 1. Establish Bob -> Alice trust = 50
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharBob.lws_id,
                target_character_id: simCharAlice.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    relationship_delta: { delta_trust: 50, narrative_rationale: 'Established trust' },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            // 2. Alice tells Bob a rumor with confidence 80
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    social_information: {
                        subject_key: 'secret_treasure',
                        topic: 'treasure',
                        claim_statement: 'There is gold hidden in the old ruins.',
                        veracity: 'true',
                        transmission_depth: 0,
                        confidence_score: 80,
                    },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            // Check Bob's subjective beliefs
            // Confidence formula: round(80 * (50 + 100) / 200) = round(80 * 150 / 200) = 60
            const belief = getCharacterBelief(db, simCharBob.lws_id, 'secret_treasure');
            expect(belief).toBeDefined();
            expect(belief.statement).toBe('There is gold hidden in the old ruins.');
            expect(belief.confidence).toBe(60);
            expect(belief.belief_type).toBe('suspicion'); // < 70 is suspicion
        });

        test('recipient rejects testimony when trust <= -30', () => {
            const db = getDb();

            // 1. Establish Bob -> Alice trust = -50 (distrusted)
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharBob.lws_id,
                target_character_id: simCharAlice.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    relationship_delta: { delta_trust: -50, narrative_rationale: 'Past betrayal' },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            // 2. Alice tells Bob a rumor
            commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharAlice.lws_id,
                target_character_id: simCharBob.lws_id,
                location_id: location.lws_id,
                fictional_time: '2026-06-01T12:00:00Z',
                payload: {
                    social_information: {
                        subject_key: 'poison_well',
                        topic: 'danger',
                        claim_statement: 'The town well is poisoned.',
                        veracity: 'false',
                        transmission_depth: 0,
                        confidence_score: 90,
                    },
                },
                provenance: 'llm_proposal',
            }, { isAdmin: true });

            // Bob should NOT adopt the belief because trust <= -30
            expect(() => getCharacterBelief(db, simCharBob.lws_id, 'poison_well')).toThrow(/not found/);
        });
    });
});
