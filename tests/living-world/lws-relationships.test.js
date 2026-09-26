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
    advanceFictionalTime,
    getRelationship,
    getRelationshipByCharacters,
    listCharacterRelationships,
    listRelationshipEvidence,
    exportSocialGraph,
    EVENT_TYPES,
    getDb,
} from '../../src/living-world/index.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('LWS Phase 8 Character Relationships & Evidence Ledger', () => {
    let tempDir;
    let world;
    let location;
    let sim;
    let charAlice;
    let charBob;
    let simCharAlice;
    let simCharBob;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-rel-test-'));
        const dbPath = path.join(tempDir, 'rel-test.db');
        await init({ dbPath });

        world = createWorld({ name: 'Social World' });
        location = createLocation(world.lws_id, { name: 'Town Square' });
        charAlice = createCharacter(world.lws_id, { name: 'Alice' });
        charBob = createCharacter(world.lws_id, { name: 'Bob' });

        sim = createSimulation(world.lws_id, {
            name: 'Social Sim',
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

    test('maintains directional asymmetry: Alice -> Bob does not alter Bob -> Alice', () => {
        const db = getDb();

        // 1. Commit COMMUNICATE event where Alice builds trust toward Bob
        const event = commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: simCharAlice.lws_id,
            target_character_id: simCharBob.lws_id,
            location_id: location.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                message: 'Hello Bob, nice to meet you.',
                relationship_delta: {
                    delta_trust: 25,
                    delta_affection: 15,
                    delta_familiarity: 30,
                    delta_respect: 10,
                    delta_loyalty: 5,
                    narrative_rationale: 'Friendly first meeting',
                },
            },
            provenance: 'llm_proposal',
        }, { isAdmin: true });

        expect(event).toBeDefined();

        // Check Alice -> Bob relationship
        const relAliceToBob = getRelationshipByCharacters(db, sim.lws_id, simCharAlice.lws_id, simCharBob.lws_id);
        expect(relAliceToBob).toBeDefined();
        expect(relAliceToBob.trust).toBe(25);
        expect(relAliceToBob.affection).toBe(15);
        expect(relAliceToBob.familiarity).toBe(30);
        expect(relAliceToBob.respect).toBe(10);
        expect(relAliceToBob.loyalty).toBe(5);

        // Check Bob -> Alice relationship (should be null or unmutated)
        const relBobToAlice = getRelationshipByCharacters(db, sim.lws_id, simCharBob.lws_id, simCharAlice.lws_id);
        expect(relBobToAlice).toBeNull();
    });

    test('clamps relationship dimensions to frozen boundaries', () => {
        const db = getDb();

        // Commit event with extreme positive deltas (> 100)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: simCharAlice.lws_id,
            target_character_id: simCharBob.lws_id,
            location_id: location.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                message: 'Overwhelming praise',
                relationship_delta: {
                    delta_trust: 150,
                    delta_affection: 200,
                    delta_familiarity: 180,
                    delta_respect: 300,
                    delta_loyalty: 500,
                },
            },
            provenance: 'llm_proposal',
        }, { isAdmin: true });

        const rel = getRelationshipByCharacters(db, sim.lws_id, simCharAlice.lws_id, simCharBob.lws_id);
        expect(rel.trust).toBe(100);
        expect(rel.affection).toBe(100);
        expect(rel.familiarity).toBe(100);
        expect(rel.respect).toBe(100);
        expect(rel.loyalty).toBe(100);

        // Commit event with extreme negative deltas (< -100)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: simCharAlice.lws_id,
            target_character_id: simCharBob.lws_id,
            location_id: location.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                message: 'Total betrayal',
                relationship_delta: {
                    delta_trust: -300,
                    delta_affection: -300,
                    delta_familiarity: -200,
                    delta_respect: -300,
                    delta_loyalty: -300,
                },
            },
            provenance: 'llm_proposal',
        }, { isAdmin: true });

        const relAfter = getRelationshipByCharacters(db, sim.lws_id, simCharAlice.lws_id, simCharBob.lws_id);
        expect(relAfter.trust).toBe(-100);
        expect(relAfter.affection).toBe(-100);
        expect(relAfter.familiarity).toBe(0); // Familiarity min is 0
        expect(relAfter.respect).toBe(-100);
        expect(relAfter.loyalty).toBe(-100);
    });

    test('logs relationship evidence with causal event linkage and narrative rationale', () => {
        const db = getDb();

        const event = commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: simCharAlice.lws_id,
            target_character_id: simCharBob.lws_id,
            location_id: location.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                message: 'Here is a gift for you',
                relationship_delta: {
                    delta_trust: 10,
                    delta_affection: 20,
                    delta_familiarity: 15,
                    narrative_rationale: 'Shared a token of appreciation',
                },
            },
            provenance: 'llm_proposal',
        }, { isAdmin: true });

        const rel = getRelationshipByCharacters(db, sim.lws_id, simCharAlice.lws_id, simCharBob.lws_id);
        const evidenceList = listRelationshipEvidence(db, sim.lws_id, rel.lws_id);

        expect(evidenceList).toHaveLength(1);
        const evidence = evidenceList[0];
        expect(evidence.source_character_id).toBe(simCharAlice.lws_id);
        expect(evidence.target_character_id).toBe(simCharBob.lws_id);
        expect(evidence.causal_event_id).toBe(event.lws_id);
        expect(evidence.delta_trust).toBe(10);
        expect(evidence.delta_affection).toBe(20);
        expect(evidence.delta_familiarity).toBe(15);
        expect(evidence.narrative_rationale).toBe('Shared a token of appreciation');
    });

    test('evaluates familiarity decay when fictional time advances past 7 days without interaction', async () => {
        const db = getDb();

        // 1. Establish familiarity = 80 at Day 0 (2026-06-01)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: simCharAlice.lws_id,
            target_character_id: simCharBob.lws_id,
            location_id: location.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                relationship_delta: { delta_familiarity: 80, narrative_rationale: 'Initial bond' },
            },
            provenance: 'llm_proposal',
        }, { isAdmin: true });

        let rel = getRelationshipByCharacters(db, sim.lws_id, simCharAlice.lws_id, simCharBob.lws_id);
        expect(rel.familiarity).toBe(80);

        // 2. Advance time by 14 days (2026-06-15) via advanceFictionalTime
        await advanceFictionalTime(db, {
            simLwsId: sim.lws_id,
            durationSeconds: 14 * 86400,
            provenance: 'user',
        });

        rel = getRelationshipByCharacters(db, sim.lws_id, simCharAlice.lws_id, simCharBob.lws_id);
        // Formula: round(80 * exp(-(14 - 7) / 30)) = round(80 * exp(-7/30)) = 63
        expect(rel.familiarity).toBe(63);

        // Verify temporal_decay evidence logged
        const evidenceList = listRelationshipEvidence(db, sim.lws_id, rel.lws_id);
        const decayEvidence = evidenceList.find(e => e.interaction_type === 'temporal_decay');
        expect(decayEvidence).toBeDefined();
        expect(decayEvidence.delta_familiarity).toBe(-17);
    });

    test('exports complete social graph with characters and directional edges', () => {
        const db = getDb();

        // Establish Alice -> Bob and Bob -> Alice relationships
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: simCharAlice.lws_id,
            target_character_id: simCharBob.lws_id,
            location_id: location.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                relationship_delta: {
                    delta_trust: 40,
                    delta_familiarity: 50,
                    reverse: { delta_trust: 20, delta_familiarity: 30 },
                },
            },
            provenance: 'llm_proposal',
        }, { isAdmin: true });

        const graph = exportSocialGraph(db, sim.lws_id);
        expect(graph.characters).toHaveLength(2);
        expect(graph.edges).toHaveLength(2);

        const edgeAliceToBob = graph.edges.find(e => e.source_character_id === simCharAlice.lws_id);
        expect(edgeAliceToBob).toBeDefined();
        expect(edgeAliceToBob.trust).toBe(40);
        expect(edgeAliceToBob.familiarity).toBe(50);

        const edgeBobToAlice = graph.edges.find(e => e.source_character_id === simCharBob.lws_id);
        expect(edgeBobToAlice).toBeDefined();
        expect(edgeBobToAlice.trust).toBe(20);
        expect(edgeBobToAlice.familiarity).toBe(30);
    });
});
