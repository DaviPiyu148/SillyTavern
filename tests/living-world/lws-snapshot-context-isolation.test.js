import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    getDb,
    createWorld,
    createCharacter,
    updateCharacter,
    createLocation,
    createSimulation,
    commitEvent,
    EVENT_TYPES,
    GENERATION_MODES,
    PROMPT_LAYERS,
    buildPromptContext,
    LwsInvalidStateTransitionError,
} from '../../src/living-world/index.js';

describe('Phase 10 Prerequisite - Authored Snapshot Context Isolation & Fail-Closed Behavior', () => {
    let world, charA, charB, locA, sim;

    beforeEach(() => {
        openDb(':memory:');

        world = createWorld({ name: 'Isolation Test World' });

        charA = createCharacter(world.lws_id, {
            name: 'Original Kaelen',
            personality: 'Brave and honest warrior.',
            description: 'A veteran soldier of the northern guard.',
            scenario_context: 'Protecting the northern frontier.',
            tags: ['warrior', 'veteran'],
        });

        charB = createCharacter(world.lws_id, {
            name: 'Original Lyra',
            personality: 'Artificer with keen intellect.',
            description: 'A scholar of ancient technology.',
            tags: ['scholar', 'artificer'],
        });

        locA = createLocation(world.lws_id, {
            name: 'Highland Outpost',
            description: 'A fortified outpost overlooking the pass.',
        });

        sim = createSimulation(world.lws_id, {
            name: 'Snapshot Isolation Sim',
            initial_fictional_time: '1000-01-01T12:00:00Z',
        });

        // Add characters to simulation (which generates their immutable authored_snapshot)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            actor_character_id: charA.lws_id,
            location_id: locA.lws_id,
            fictional_time: '1000-01-01T12:00:00Z',
            payload: {
                character_id: charA.lws_id,
                activity: 'standing guard',
                physical_condition: 'healthy',
                tier: 'core',
            },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });

        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            actor_character_id: charB.lws_id,
            location_id: locA.lws_id,
            fictional_time: '1000-01-01T12:00:00Z',
            payload: {
                character_id: charB.lws_id,
                activity: 'reading documents',
                physical_condition: 'healthy',
                tier: 'core',
            },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });
    });

    afterEach(() => {
        closeDb();
    });

    it('builds Layer 5 character profile strictly from frozen authored_snapshot', () => {
        const context = buildPromptContext(sim.lws_id, {
            character_lws_id: charA.lws_id,
            generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
        });

        expect(context.layers[PROMPT_LAYERS.CHARACTER_AUTHORED_PROFILE]).toBeDefined();
        const content = context.layers[PROMPT_LAYERS.CHARACTER_AUTHORED_PROFILE].content;
        expect(content).toContain('[CHARACTER PROFILE: Original Kaelen]');
        expect(content).toContain('Personality: Brave and honest warrior.');
        expect(content).toContain('Description: A veteran soldier of the northern guard.');
        expect(content).toContain('Scenario Context: Protecting the northern frontier.');
        expect(content).toContain('Tags: warrior, veteran');
        expect(context.character_name).toBe('Original Kaelen');
    });

    it('remains 100% frozen when authored character in lws_characters is mutated after simulation join', () => {
        // Mutate authored character in lws_characters table
        updateCharacter(world.lws_id, charA.lws_id, {
            name: 'MUTATED Corrupted Kaelen',
            personality: 'Cowardly and deceitful traitor.',
            description: 'A deserter who betrayed the northern guard.',
            scenario_context: 'Fleeing from the authorities.',
            tags: ['traitor', 'deserter'],
        });

        // Re-build prompt context for the active simulation character
        const context = buildPromptContext(sim.lws_id, {
            character_lws_id: charA.lws_id,
            generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
        });

        const content = context.layers[PROMPT_LAYERS.CHARACTER_AUTHORED_PROFILE].content;

        // Must still contain the original snapshot content
        expect(content).toContain('[CHARACTER PROFILE: Original Kaelen]');
        expect(content).toContain('Personality: Brave and honest warrior.');
        expect(content).toContain('Description: A veteran soldier of the northern guard.');
        expect(content).toContain('Scenario Context: Protecting the northern frontier.');
        expect(content).toContain('Tags: warrior, veteran');
        expect(context.character_name).toBe('Original Kaelen');

        // Must NOT contain any mutated authored fields
        expect(content).not.toContain('MUTATED');
        expect(content).not.toContain('Cowardly and deceitful traitor');
        expect(content).not.toContain('deserter');
    });

    it('fails closed and throws LwsInvalidStateTransitionError when authored_snapshot is corrupt or empty (never falls back to live table)', () => {
        const db = getDb();

        const charCorrupt = createCharacter(world.lws_id, {
            name: 'Corrupt Character',
            personality: 'Test personality',
        });

        // Insert a simulation character row with corrupt authored_snapshot
        const corruptSimCharId = '99999999-9999-4999-8999-999999999999';
        db.prepare(`
            INSERT INTO lws_simulation_characters (
                lws_id, simulation_id, character_id, current_location_id,
                activity, physical_condition, runtime_state, authored_snapshot,
                created_at, updated_at, deleted_at
            ) VALUES (?, (SELECT id FROM lws_simulations WHERE lws_id = ?), (SELECT id FROM lws_characters WHERE lws_id = ?), NULL, 'idle', 'normal', '{}', 'INVALID_JSON_CORRUPT', '1000-01-01T12:00:00Z', '1000-01-01T12:00:00Z', NULL)
        `).run(corruptSimCharId, sim.lws_id, charCorrupt.lws_id);

        expect(() => {
            buildPromptContext(sim.lws_id, {
                character_lws_id: corruptSimCharId,
                generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
            });
        }).toThrow(LwsInvalidStateTransitionError);

        expect(() => {
            buildPromptContext(sim.lws_id, {
                character_lws_id: corruptSimCharId,
                generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
            });
        }).toThrow(/corrupt authored_snapshot/i);
    });

    it('resolves co-located character names from their respective snapshots without live table joins', () => {
        // Mutate authored CharB in lws_characters table
        updateCharacter(world.lws_id, charB.lws_id, {
            name: 'MUTATED CharB Name',
        });

        // Build context for CharA who is co-located with CharB at locA
        const context = buildPromptContext(sim.lws_id, {
            character_lws_id: charA.lws_id,
            generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
        });

        const sceneContent = context.layers[PROMPT_LAYERS.PERMITTED_PERCEPTION_SCENE].content;

        // Visible present characters must show Original Lyra from CharB's snapshot, not the mutated name
        expect(sceneContent).toContain('Original Lyra');
        expect(sceneContent).not.toContain('MUTATED CharB Name');
    });
});
