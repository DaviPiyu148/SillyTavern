import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    getDb,
    createWorld,
    createCharacter,
    createLocation,
    createSimulation,
    commitEvent,
    EVENT_TYPES,
    GENERATION_MODES,
    PROMPT_LAYERS,
    buildPromptContext,
} from '../../src/living-world/index.js';

describe('Phase 10 - Strict Perspective Isolation & Anti-Omniscience', () => {
    let world, charA, charB, charC, locA, locB, sim;

    beforeEach(() => {
        openDb(':memory:');
        const db = getDb();

        world = createWorld({ name: 'Shadow Realm' });

        charA = createCharacter(world.lws_id, { name: 'Alice', personality: 'Observant' });
        charB = createCharacter(world.lws_id, { name: 'Bob', personality: 'Secretive' });
        charC = createCharacter(world.lws_id, { name: 'Charlie', personality: 'Distant' });

        locA = createLocation(world.lws_id, { name: 'Castle Library', location_type: 'indoor' });
        locB = createLocation(world.lws_id, { name: 'Dungeon Crypt', location_type: 'indoor' });

        sim = createSimulation(world.lws_id, {
            name: 'Isolation Sim',
            initial_fictional_time: '1000-01-01T10:00:00Z',
        });

        // Alice and Bob in Castle Library
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            actor_character_id: charA.lws_id,
            location_id: locA.lws_id,
            fictional_time: '1000-01-01T10:00:00Z',
            payload: { character_id: charA.lws_id, activity: 'reading' },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });

        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            actor_character_id: charB.lws_id,
            location_id: locA.lws_id,
            fictional_time: '1000-01-01T10:00:00Z',
            payload: { character_id: charB.lws_id, activity: 'whispering' },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });

        // Charlie in Dungeon Crypt (different location)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            actor_character_id: charC.lws_id,
            location_id: locB.lws_id,
            fictional_time: '1000-01-01T10:00:00Z',
            payload: { character_id: charC.lws_id, activity: 'hiding a treasure chest' },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });

        // Add private belief for Bob
        const simId = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id).id;
        const simCharB = db.prepare('SELECT id FROM lws_simulation_characters WHERE simulation_id = ? AND character_id = (SELECT id FROM lws_characters WHERE lws_id = ?)').get(simId, charB.lws_id);
        db.prepare(`
            INSERT INTO lws_character_beliefs (lws_id, simulation_id, simulation_character_id, subject_key, statement, confidence, created_at, updated_at)
            VALUES (?, ?, ?, 'secret_treasure', 'I know where the king hid the jewels', 90, datetime('now'), datetime('now'))
        `).run('belief-bob-1', simId, simCharB.id);

        // Add relationship Bob -> Charlie
        const simCharC = db.prepare('SELECT id FROM lws_simulation_characters WHERE simulation_id = ? AND character_id = (SELECT id FROM lws_characters WHERE lws_id = ?)').get(simId, charC.lws_id);
        db.prepare(`
            INSERT INTO lws_character_relationships (lws_id, simulation_id, source_character_id, target_character_id, trust, affection, familiarity, respect, loyalty, created_at, updated_at)
            VALUES (?, ?, ?, ?, 80, 70, 60, 50, 40, datetime('now'), datetime('now'))
        `).run('rel-bob-charlie', simId, simCharB.id, simCharC.id);
    });

    afterEach(() => {
        closeDb();
    });

    it('excludes distant characters from visible scene perception', () => {
        const contextA = buildPromptContext(sim.lws_id, {
            character_lws_id: charA.lws_id,
            generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
        });

        const sceneLayer = contextA.layers[PROMPT_LAYERS.PERMITTED_PERCEPTION_SCENE]?.content;
        expect(sceneLayer).toBeDefined();
        // Alice sees Bob (co-located in Castle Library)
        expect(sceneLayer).toContain('Bob');
        // Alice CANNOT see Charlie (in Dungeon Crypt)
        expect(sceneLayer).not.toContain('Charlie');
        expect(sceneLayer).not.toContain('Dungeon Crypt');
        expect(sceneLayer).not.toContain('hiding a treasure chest');
    });

    it('excludes private beliefs of other characters from prompt context', () => {
        const contextA = buildPromptContext(sim.lws_id, {
            character_lws_id: charA.lws_id,
            generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
        });

        // Check full user and system prompt text
        expect(contextA.user_prompt).not.toContain('secret_treasure');
        expect(contextA.user_prompt).not.toContain('king hid the jewels');
        expect(contextA.system_prompt).not.toContain('king hid the jewels');
    });

    it('excludes third-party relationship matrices (outgoing only)', () => {
        const contextA = buildPromptContext(sim.lws_id, {
            character_lws_id: charA.lws_id,
            generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
        });

        const relLayer = contextA.layers[PROMPT_LAYERS.PERMITTED_RELATIONSHIPS]?.content;
        // Alice has no relationship to Charlie; Bob's relationship with Charlie must NOT leak into Alice's prompt
        expect(relLayer).not.toContain('rel-bob-charlie');
        expect(relLayer).not.toContain('Charlie');
    });

    it('modulates environment perception with sensory clarity score', () => {
        const contextA = buildPromptContext(sim.lws_id, {
            character_lws_id: charA.lws_id,
            generation_mode: GENERATION_MODES.CHARACTER_DIALOGUE,
        });

        expect(contextA.metadata.sensory_clarity).toBeGreaterThanOrEqual(0);
        expect(contextA.metadata.sensory_clarity).toBeLessThanOrEqual(100);
        expect(contextA.layers[PROMPT_LAYERS.SIMULATION_STATE].content).toContain('Sensory Clarity:');
    });
});
