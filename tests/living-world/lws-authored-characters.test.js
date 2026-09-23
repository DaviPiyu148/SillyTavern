import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    createWorld,
    deleteWorld,
    createCharacter,
    getCharacterByLwsId,
    listCharacters,
    updateCharacter,
    deleteCharacter,
    LwsValidationError,
    LwsNotFoundError,
} from '../../src/living-world/index.js';
import { createFileTestDb } from './fixtures/test-db.js';

describe('Authored Character Service', () => {
    let world;

    beforeEach(() => {
        openDb(':memory:');
        world = createWorld({ name: 'Test World' });
    });

    afterEach(() => {
        closeDb();
    });

    test('creates character with full supported mapped ST V2 subset', () => {
        const char = createCharacter(world.lws_id, {
            name: '  Seraphina  ',
            description: 'A wandering knight seeking redemption.',
            personality: 'Stoic, disciplined, fiercely loyal.',
            scenario: 'You meet Seraphina at the crossroads tavern during a storm.',
            mes_example: '<START>\n{{char}}: Stand back, traveler.\n{{user}}: Who are you?',
            creator_notes: 'Created for the Valdor campaign.',
            system_prompt: 'Stay in character as Seraphina.',
            character_version: '2.1.0',
            tags: ['knight', 'wandering', 'heroic'],
            extensions: { voice_id: 'seraphina_v1' },
        });

        expect(char).toBeDefined();
        expect(char.lws_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(char.name).toBe('Seraphina');
        expect(char.description).toBe('A wandering knight seeking redemption.');
        expect(char.personality).toBe('Stoic, disciplined, fiercely loyal.');
        // Confirms scenario maps to scenario_context
        expect(char.scenario_context).toBe('You meet Seraphina at the crossroads tavern during a storm.');
        expect(char.mes_example).toBe('<START>\n{{char}}: Stand back, traveler.\n{{user}}: Who are you?');
        expect(char.author_notes).toBe('Created for the Valdor campaign.');
        expect(char.system_prompt_override).toBe('Stay in character as Seraphina.');
        expect(char.source_version).toBe('2.1.0');
        expect(char.tags).toEqual(['knight', 'wandering', 'heroic']);
        expect(char.extensions).toEqual({ voice_id: 'seraphina_v1' });
        expect(char.id).toBeUndefined();
        expect(char.world_id).toBeUndefined();
        expect(char.deleted_at).toBeUndefined();
    });

    test('character scenario_context does NOT create or mutate any LWS Scenario record', () => {
        const char = createCharacter(world.lws_id, {
            name: 'Mage',
            scenario: 'Duel at the arcane tower',
        });
        expect(char.scenario_context).toBe('Duel at the arcane tower');

        // Check raw DB to prove lws_scenarios has 0 rows
        const db = openDb(':memory:');
        const count = db.prepare('SELECT COUNT(*) AS cnt FROM lws_scenarios').get();
        expect(count.cnt).toBe(0);
    });

    test('rejects character creation when world does not exist or is soft-deleted', () => {
        expect(() => {
            createCharacter('00000000-0000-0000-0000-000000000000', { name: 'Hero' });
        }).toThrow(LwsNotFoundError);

        deleteWorld(world.lws_id);

        expect(() => {
            createCharacter(world.lws_id, { name: 'Hero' });
        }).toThrow(LwsNotFoundError);
    });

    test('rejects missing or empty character name', () => {
        expect(() => createCharacter(world.lws_id, { name: '' })).toThrow(LwsValidationError);
        expect(() => createCharacter(world.lws_id, { name: '   ' })).toThrow(LwsValidationError);
        expect(() => createCharacter(world.lws_id, {})).toThrow(LwsValidationError);
    });

    test('lists active characters in a world, ordered by name', () => {
        createCharacter(world.lws_id, { name: 'Zane' });
        createCharacter(world.lws_id, { name: 'Alice' });
        const bob = createCharacter(world.lws_id, { name: 'Bob' });

        deleteCharacter(world.lws_id, bob.lws_id);

        const list = listCharacters(world.lws_id);
        expect(list).toHaveLength(2);
        expect(list[0].name).toBe('Alice');
        expect(list[1].name).toBe('Zane');

        const all = listCharacters(world.lws_id, { includeDeleted: true });
        expect(all).toHaveLength(3);
    });

    test('updates character fields while preserving lws_id and created_at', async () => {
        const char = createCharacter(world.lws_id, {
            name: 'Original Name',
            personality: 'Shy',
        });
        const originalLwsId = char.lws_id;
        const originalCreatedAt = char.created_at;

        await new Promise(r => setTimeout(r, 2));

        const updated = updateCharacter(world.lws_id, char.lws_id, {
            name: 'Updated Name',
            personality: 'Confident',
            scenario_context: 'New context',
        });

        expect(updated.lws_id).toBe(originalLwsId);
        expect(updated.created_at).toBe(originalCreatedAt);
        expect(updated.name).toBe('Updated Name');
        expect(updated.personality).toBe('Confident');
        expect(updated.scenario_context).toBe('New context');
        expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(originalCreatedAt));
    });

    test('soft-deletes character and subsequent reads throw 404', () => {
        const char = createCharacter(world.lws_id, { name: 'Doomed' });
        expect(deleteCharacter(world.lws_id, char.lws_id)).toBe(true);

        expect(() => getCharacterByLwsId(world.lws_id, char.lws_id)).toThrow(LwsNotFoundError);
        expect(() => updateCharacter(world.lws_id, char.lws_id, { name: 'Resurrect' })).toThrow(LwsNotFoundError);
        expect(() => deleteCharacter(world.lws_id, char.lws_id)).toThrow(LwsNotFoundError);
    });

    test('persists character across process restart on file-backed database', () => {
        closeDb();
        const { dbPath, cleanup } = createFileTestDb('lws-char-durability-');

        try {
            openDb(dbPath);
            const w = createWorld({ name: 'Durability World' });
            const char = createCharacter(w.lws_id, {
                name: 'Elena',
                description: 'Scholar of ancient runes',
                personality: 'Inquisitive',
                scenario: 'Researching in the grand library',
            });
            const charLwsId = char.lws_id;
            const worldLwsId = w.lws_id;
            closeDb();

            // Reopen
            openDb(dbPath);
            const retrieved = getCharacterByLwsId(worldLwsId, charLwsId);
            expect(retrieved.name).toBe('Elena');
            expect(retrieved.description).toBe('Scholar of ancient runes');
            expect(retrieved.personality).toBe('Inquisitive');
            expect(retrieved.scenario_context).toBe('Researching in the grand library');
            closeDb();
        } finally {
            cleanup();
        }
    });
});
