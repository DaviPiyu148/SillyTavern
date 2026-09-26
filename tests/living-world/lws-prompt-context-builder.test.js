import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    getDb,
    createWorld,
    createCharacter,
    createLocation,
    createSimulation,
    createWorldRule,
    createPromptConfig,
    commitEvent,
    EVENT_TYPES,
    GENERATION_MODES,
    PROMPT_LAYERS,
    OUTPUT_CONTRACT_TYPES,
    buildPromptContext,
} from '../../src/living-world/index.js';

describe('Phase 10 - 12-Layer Dynamic Context Builder', () => {
    let world, charA, charB, locA, locB, sim;

    beforeEach(() => {
        openDb(':memory:');
        const db = getDb();

        world = createWorld({
            name: 'Aethelgard',
            description: 'A fantasy realm of mystery and magic.',
            premise: 'Magic is declining, ancient powers are awakening.',
        });

        createWorldRule(world.lws_id, {
            title: 'magic_limit',
            body: 'Spells require physical catalysts and drain endurance.',
        });

        createPromptConfig(world.lws_id, {
            style_notes: 'Atmospheric third-person limited with sensory richness.',
            tone_notes: 'Grounded, contemplative, slightly somber.',
            format_notes: 'Include evocative descriptions of light and temperature.',
        });

        charA = createCharacter(world.lws_id, {
            name: 'Kaelen',
            personality: 'Cautious, observant, deeply loyal to comrades.',
            description: 'A former scout who survived the frontier wars.',
            scenario_context: 'Investigating strange occurrences in the lower ward.',
            tags: ['scout', 'veteran'],
        });

        charB = createCharacter(world.lws_id, {
            name: 'Lyra',
            personality: 'Curious, outspoken, adept with mechanical devices.',
            description: 'An apprentice artificer seeking lost relics.',
        });

        locA = createLocation(world.lws_id, {
            name: 'The Rusty Lantern Tavern',
            description: 'A dimly lit watering hole filled with dockworkers and wanderers.',
            location_type: 'indoor',
        });

        locB = createLocation(world.lws_id, {
            name: 'Clockwork Alley',
            description: 'A narrow street lined with watchmakers and tinkers.',
            location_type: 'outdoor',
        });

        sim = createSimulation(world.lws_id, {
            name: 'Aethelgard Sim 1',
            initial_fictional_time: '1000-01-01T12:00:00Z',
        });

        // Add characters to simulation
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            actor_character_id: charA.lws_id,
            location_id: locA.lws_id,
            fictional_time: '1000-01-01T12:00:00Z',
            payload: {
                character_id: charA.lws_id,
                activity: 'studying maps',
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
                activity: 'repairing a compass',
                physical_condition: 'healthy',
                tier: 'core',
            },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });
    });

    afterEach(() => {
        closeDb();
    });

    it('builds full 12-layer context for a character perspective', () => {
        const context = buildPromptContext(sim.lws_id, {
            character_lws_id: charA.lws_id,
            generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
            user_input: 'What do you make of the stranger in the corner?',
            user_system_prompt: 'Keep replies concise and focused on immediate threats.',
        });

        expect(context).toBeDefined();
        expect(context.simulation_id).toBe(sim.lws_id);
        expect(context.authored_character_id).toBe(charA.lws_id);
        expect(context.character_id).toBeDefined();
        expect(context.character_name).toBe('Kaelen');
        expect(context.generation_mode).toBe('character_dialogue');
        expect(context.output_contract_type).toBe(OUTPUT_CONTRACT_TYPES.DUAL_BLOCK);

        // Verify layer presence
        const layers = context.layers;
        expect(layers[PROMPT_LAYERS.LWS_SYSTEM_CONTRACT]).toBeDefined();
        expect(layers[PROMPT_LAYERS.LWS_SYSTEM_CONTRACT].content).toContain('[LWS PROTECTED SIMULATION CONTRACT]');

        expect(layers[PROMPT_LAYERS.SIMULATION_STATE]).toBeDefined();
        expect(layers[PROMPT_LAYERS.SIMULATION_STATE].content).toContain('The Rusty Lantern Tavern');

        expect(layers[PROMPT_LAYERS.WORLD_PREMISE_RULES]).toBeDefined();
        expect(layers[PROMPT_LAYERS.WORLD_PREMISE_RULES].content).toContain('magic_limit');

        expect(layers[PROMPT_LAYERS.STYLE_AND_AUTHOR_INSTRUCTIONS]).toBeDefined();
        expect(layers[PROMPT_LAYERS.STYLE_AND_AUTHOR_INSTRUCTIONS].content).toContain('Atmospheric third-person');
        expect(layers[PROMPT_LAYERS.STYLE_AND_AUTHOR_INSTRUCTIONS].content).toContain('Keep replies concise');

        expect(layers[PROMPT_LAYERS.CHARACTER_AUTHORED_PROFILE]).toBeDefined();
        expect(layers[PROMPT_LAYERS.CHARACTER_AUTHORED_PROFILE].content).toContain('Kaelen');
        expect(layers[PROMPT_LAYERS.CHARACTER_AUTHORED_PROFILE].content).toContain('scout');

        expect(layers[PROMPT_LAYERS.CHARACTER_MIND_STATE]).toBeDefined();
        expect(layers[PROMPT_LAYERS.CHARACTER_MIND_STATE].content).toContain('studying maps');

        expect(layers[PROMPT_LAYERS.PERMITTED_RELATIONSHIPS]).toBeDefined();

        expect(layers[PROMPT_LAYERS.PERMITTED_PERCEPTION_SCENE]).toBeDefined();
        expect(layers[PROMPT_LAYERS.PERMITTED_PERCEPTION_SCENE].content).toContain('Lyra');

        expect(layers[PROMPT_LAYERS.DIRECTOR_INSTRUCTION_OR_USER_PROMPT]).toBeDefined();
        expect(layers[PROMPT_LAYERS.DIRECTOR_INSTRUCTION_OR_USER_PROMPT].content).toContain('stranger in the corner');

        expect(layers[PROMPT_LAYERS.OUTPUT_CONTRACT]).toBeDefined();
        expect(layers[PROMPT_LAYERS.OUTPUT_CONTRACT].content).toContain('<lws_proposal>');

        // System prompt and messages assembly
        expect(context.system_prompt).toContain('[LWS PROTECTED SIMULATION CONTRACT]');
        expect(context.messages).toHaveLength(2);
        expect(context.messages[0].role).toBe('system');
        expect(context.messages[1].role).toBe('user');
    });

    it('adapts output contract to generation mode', () => {
        const decisionContext = buildPromptContext(sim.lws_id, {
            character_lws_id: charA.lws_id,
            generation_mode: GENERATION_MODES.CHARACTER_DECISION,
        });
        expect(decisionContext.output_contract_type).toBe(OUTPUT_CONTRACT_TYPES.STRUCTURED_PROPOSAL);
        expect(decisionContext.layers[PROMPT_LAYERS.OUTPUT_CONTRACT].content).toContain('[OUTPUT CONTRACT: STRUCTURED PROPOSAL]');

        const worldContext = buildPromptContext(sim.lws_id, {
            generation_mode: GENERATION_MODES.WORLD_NARRATION,
        });
        expect(worldContext.output_contract_type).toBe(OUTPUT_CONTRACT_TYPES.NARRATIVE_PROSE);
        expect(worldContext.layers[PROMPT_LAYERS.OUTPUT_CONTRACT].content).toContain('[OUTPUT CONTRACT: NARRATIVE PROSE]');

        const directorContext = buildPromptContext(sim.lws_id, {
            generation_mode: GENERATION_MODES.DIRECTOR_QUERY,
        });
        expect(directorContext.output_contract_type).toBe(OUTPUT_CONTRACT_TYPES.DIRECTOR_REPORT);
        expect(directorContext.layers[PROMPT_LAYERS.OUTPUT_CONTRACT].content).toContain('[OUTPUT CONTRACT: DIRECTOR REPORT]');
    });

    it('rejects invalid generation mode or missing character', () => {
        expect(() => {
            buildPromptContext(sim.lws_id, { generation_mode: 'invalid_mode' });
        }).toThrow(/Invalid generation mode/);

        expect(() => {
            buildPromptContext(sim.lws_id, { character_lws_id: '00000000-0000-0000-0000-000000000000' });
        }).toThrow(/not found in this simulation/);
    });
});
