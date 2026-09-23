import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    createWorld,
    createCharacter,
    deleteCharacter,
    createFaction,
    getFactionByLwsId,
    listFactions,
    updateFaction,
    deleteFaction,
    addFactionMember,
    removeFactionMember,
    listFactionMembers,
    LwsNotFoundError,
    LwsValidationError,
} from '../../src/living-world/index.js';

describe('Authored Faction and Membership Service', () => {
    let world;

    beforeEach(() => {
        openDb(':memory:');
        world = createWorld({ name: 'Faction Test World' });
    });

    afterEach(() => {
        closeDb();
    });

    test('creates and retrieves a faction', () => {
        const faction = createFaction(world.lws_id, {
            name: 'The Silver Vanguard',
            description: 'Elite knights guarding the border',
            tags: ['order', 'military'],
        });

        expect(faction.lws_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(faction.name).toBe('The Silver Vanguard');
        expect(faction.description).toBe('Elite knights guarding the border');

        const fetched = getFactionByLwsId(world.lws_id, faction.lws_id);
        expect(fetched.name).toBe('The Silver Vanguard');
    });

    test('rejects blank faction name with LwsValidationError', () => {
        expect(() => createFaction(world.lws_id, { name: '' })).toThrow(LwsValidationError);
        expect(() => createFaction(world.lws_id, {})).toThrow(LwsValidationError);
    });

    test('lists active factions in a world', () => {
        createFaction(world.lws_id, { name: 'Faction B' });
        createFaction(world.lws_id, { name: 'Faction A' });
        const list = listFactions(world.lws_id);
        expect(list).toHaveLength(2);
        expect(list[0].name).toBe('Faction A');
        expect(list[1].name).toBe('Faction B');
    });

    test('updates and soft-deletes a faction', () => {
        const faction = createFaction(world.lws_id, { name: 'Guild' });
        const updated = updateFaction(world.lws_id, faction.lws_id, { name: 'Trade Guild' });
        expect(updated.name).toBe('Trade Guild');

        deleteFaction(world.lws_id, faction.lws_id);
        expect(() => getFactionByLwsId(world.lws_id, faction.lws_id)).toThrow(LwsNotFoundError);
    });

    test('adds and lists faction members', () => {
        const faction = createFaction(world.lws_id, { name: 'Mage Circle' });
        const char1 = createCharacter(world.lws_id, { name: 'Merlin' });
        const char2 = createCharacter(world.lws_id, { name: 'Morgana' });

        const m1 = addFactionMember(world.lws_id, faction.lws_id, {
            character_lws_id: char1.lws_id,
            role: 'Grandmaster',
        });
        expect(m1.role).toBe('Grandmaster');

        addFactionMember(world.lws_id, faction.lws_id, {
            character_lws_id: char2.lws_id,
            role: 'Adept',
        });

        const members = listFactionMembers(world.lws_id, faction.lws_id);
        expect(members).toHaveLength(2);
        expect(members[0].name).toBe('Merlin');
        expect(members[0].role).toBe('Grandmaster');
        expect(members[1].name).toBe('Morgana');
        expect(members[1].role).toBe('Adept');
    });

    test('updating role on existing membership updates the role cleanly', () => {
        const faction = createFaction(world.lws_id, { name: 'Order' });
        const char = createCharacter(world.lws_id, { name: 'Lancelot' });

        addFactionMember(world.lws_id, faction.lws_id, { character_lws_id: char.lws_id, role: 'Initiate' });
        addFactionMember(world.lws_id, faction.lws_id, { character_lws_id: char.lws_id, role: 'Knight' });

        const members = listFactionMembers(world.lws_id, faction.lws_id);
        expect(members).toHaveLength(1);
        expect(members[0].role).toBe('Knight');
    });

    test('disallows adding a soft-deleted character to a faction', () => {
        const faction = createFaction(world.lws_id, { name: 'Brotherhood' });
        const char = createCharacter(world.lws_id, { name: 'Ghost' });
        deleteCharacter(world.lws_id, char.lws_id);

        expect(() => {
            addFactionMember(world.lws_id, faction.lws_id, { character_lws_id: char.lws_id, role: 'Member' });
        }).toThrow(LwsNotFoundError);
    });

    test('soft-deleting a character hides them from GET members list without dropping the join row', () => {
        const faction = createFaction(world.lws_id, { name: 'Guild' });
        const char1 = createCharacter(world.lws_id, { name: 'Active Member' });
        const char2 = createCharacter(world.lws_id, { name: 'Departed Member' });

        addFactionMember(world.lws_id, faction.lws_id, { character_lws_id: char1.lws_id, role: 'Member' });
        addFactionMember(world.lws_id, faction.lws_id, { character_lws_id: char2.lws_id, role: 'Member' });

        // Soft-delete char2
        deleteCharacter(world.lws_id, char2.lws_id);

        // GET members must exclude char2
        const activeMembers = listFactionMembers(world.lws_id, faction.lws_id);
        expect(activeMembers).toHaveLength(1);
        expect(activeMembers[0].character_lws_id).toBe(char1.lws_id);

        // Verify direct SQLite DB inspection confirms relationship row is still present
        const db = openDb(':memory:');
        const rawRow = db.prepare(`
            SELECT cf.* FROM lws_character_factions cf
            JOIN lws_characters c ON cf.character_id = c.id
            WHERE c.lws_id = ?
        `).get(char2.lws_id);
        expect(rawRow).toBeDefined();
    });

    test('removing a soft-deleted character from an active faction succeeds', () => {
        const faction = createFaction(world.lws_id, { name: 'Alliance' });
        const char = createCharacter(world.lws_id, { name: 'Fallen' });
        addFactionMember(world.lws_id, faction.lws_id, { character_lws_id: char.lws_id, role: 'Ally' });

        deleteCharacter(world.lws_id, char.lws_id);

        // Removing must succeed (204 / returns true)
        expect(removeFactionMember(world.lws_id, faction.lws_id, char.lws_id)).toBe(true);

        // Verify the raw join row is now removed
        const db = openDb(':memory:');
        const rawRow = db.prepare(`
            SELECT cf.* FROM lws_character_factions cf
            JOIN lws_characters c ON cf.character_id = c.id
            WHERE c.lws_id = ?
        `).get(char.lws_id);
        expect(rawRow).toBeUndefined();
    });
});
