import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    createWorld,
    createLocation,
    deleteLocation,
    createCharacter,
    deleteCharacter,
    createScenario,
    getScenarioByLwsId,
    listScenarios,
    updateScenario,
    deleteScenario,
    addScenarioCharacter,
    removeScenarioCharacter,
    listScenarioCharacters,
    LwsNotFoundError,
    LwsValidationError,
} from '../../src/living-world/index.js';

describe('Authored Scenario and Roster Service', () => {
    let world;

    beforeEach(() => {
        openDb(':memory:');
        world = createWorld({ name: 'Scenario Test World' });
    });

    afterEach(() => {
        closeDb();
    });

    test('creates and retrieves a scenario with starting location', () => {
        const location = createLocation(world.lws_id, { name: 'Crossroads Inn' });
        const scenario = createScenario(world.lws_id, {
            name: 'The Gathering Storm',
            description: 'Tensions rise as travelers seek shelter from an unnatural blizzard.',
            starting_location_lws_id: location.lws_id,
            tags: ['mystery', 'survival'],
        });

        expect(scenario.lws_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(scenario.name).toBe('The Gathering Storm');
        expect(scenario.starting_location_lws_id).toBe(location.lws_id);

        const fetched = getScenarioByLwsId(world.lws_id, scenario.lws_id);
        expect(fetched.name).toBe('The Gathering Storm');
        expect(fetched.starting_location_lws_id).toBe(location.lws_id);
    });

    test('rejects blank scenario name with LwsValidationError', () => {
        expect(() => createScenario(world.lws_id, { name: '' })).toThrow(LwsValidationError);
        expect(() => createScenario(world.lws_id, {})).toThrow(LwsValidationError);
    });

    test('lists active scenarios in a world', () => {
        createScenario(world.lws_id, { name: 'Scenario B' });
        createScenario(world.lws_id, { name: 'Scenario A' });
        const list = listScenarios(world.lws_id);
        expect(list).toHaveLength(2);
        expect(list[0].name).toBe('Scenario A');
        expect(list[1].name).toBe('Scenario B');
    });

    test('updates an active scenario', () => {
        const scenario = createScenario(world.lws_id, { name: 'Initial Scenario' });
        const updated = updateScenario(world.lws_id, scenario.lws_id, {
            name: 'Updated Scenario',
            description: 'New premise',
        });
        expect(updated.name).toBe('Updated Scenario');
        expect(updated.description).toBe('New premise');
    });

    test('rejects setting starting_location to a non-existent or soft-deleted location', () => {
        expect(() => {
            createScenario(world.lws_id, {
                name: 'Bad Scenario',
                starting_location_lws_id: '00000000-0000-0000-0000-000000000000',
            });
        }).toThrow(LwsNotFoundError);

        const loc = createLocation(world.lws_id, { name: 'Doomed Town' });
        deleteLocation(world.lws_id, loc.lws_id);

        expect(() => {
            createScenario(world.lws_id, {
                name: 'Bad Scenario 2',
                starting_location_lws_id: loc.lws_id,
            });
        }).toThrow(LwsNotFoundError);
    });

    test('adds and lists characters in scenario roster', () => {
        const scenario = createScenario(world.lws_id, { name: 'Ambush at Dawn' });
        const hero = createCharacter(world.lws_id, { name: 'Arthur' });
        const guide = createCharacter(world.lws_id, { name: 'Robin' });

        addScenarioCharacter(world.lws_id, scenario.lws_id, {
            character_lws_id: hero.lws_id,
            role: 'protagonist',
        });
        addScenarioCharacter(world.lws_id, scenario.lws_id, {
            character_lws_id: guide.lws_id,
            role: 'scout',
        });

        const roster = listScenarioCharacters(world.lws_id, scenario.lws_id);
        expect(roster).toHaveLength(2);
        expect(roster[0].name).toBe('Arthur');
        expect(roster[0].role).toBe('protagonist');
        expect(roster[1].name).toBe('Robin');
        expect(roster[1].role).toBe('scout');
    });

    test('disallows adding a soft-deleted character to a scenario roster', () => {
        const scenario = createScenario(world.lws_id, { name: 'Raid' });
        const char = createCharacter(world.lws_id, { name: 'Fallen Hero' });
        deleteCharacter(world.lws_id, char.lws_id);

        expect(() => {
            addScenarioCharacter(world.lws_id, scenario.lws_id, {
                character_lws_id: char.lws_id,
                role: 'leader',
            });
        }).toThrow(LwsNotFoundError);
    });

    test('soft-deleting a character hides them from scenario roster query while preserving raw SQLite join row', () => {
        const scenario = createScenario(world.lws_id, { name: 'Siege' });
        const c1 = createCharacter(world.lws_id, { name: 'Defender' });
        const c2 = createCharacter(world.lws_id, { name: 'Retreated' });

        addScenarioCharacter(world.lws_id, scenario.lws_id, { character_lws_id: c1.lws_id, role: 'guard' });
        addScenarioCharacter(world.lws_id, scenario.lws_id, { character_lws_id: c2.lws_id, role: 'scout' });

        deleteCharacter(world.lws_id, c2.lws_id);

        const activeRoster = listScenarioCharacters(world.lws_id, scenario.lws_id);
        expect(activeRoster).toHaveLength(1);
        expect(activeRoster[0].character_lws_id).toBe(c1.lws_id);

        // Raw row remains in SQLite join table
        const db = openDb(':memory:');
        const rawRow = db.prepare(`
            SELECT sc.* FROM lws_scenario_characters sc
            JOIN lws_characters c ON sc.character_id = c.id
            WHERE c.lws_id = ?
        `).get(c2.lws_id);
        expect(rawRow).toBeDefined();
    });

    test('removing a soft-deleted character from scenario roster succeeds', () => {
        const scenario = createScenario(world.lws_id, { name: 'Skirmish' });
        const char = createCharacter(world.lws_id, { name: 'Departed' });

        addScenarioCharacter(world.lws_id, scenario.lws_id, { character_lws_id: char.lws_id, role: 'warrior' });
        deleteCharacter(world.lws_id, char.lws_id);

        expect(removeScenarioCharacter(world.lws_id, scenario.lws_id, char.lws_id)).toBe(true);
    });

    test('soft-deletes scenario and hides it from listings and roster operations', () => {
        const scenario = createScenario(world.lws_id, { name: 'Temporary Scenario' });
        const char = createCharacter(world.lws_id, { name: 'Hero' });
        addScenarioCharacter(world.lws_id, scenario.lws_id, { character_lws_id: char.lws_id, role: 'lead' });

        deleteScenario(world.lws_id, scenario.lws_id);

        expect(() => getScenarioByLwsId(world.lws_id, scenario.lws_id)).toThrow(LwsNotFoundError);
        expect(() => listScenarioCharacters(world.lws_id, scenario.lws_id)).toThrow(LwsNotFoundError);
        expect(() => addScenarioCharacter(world.lws_id, scenario.lws_id, {
            character_lws_id: char.lws_id,
            role: 'lead',
        })).toThrow(LwsNotFoundError);
    });
});
