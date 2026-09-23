import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    createWorld,
    createCharacter,
    updateCharacter,
    deleteWorld,
    createLocation,
    createFaction,
    createScenario,
    createWorldRule,
    createPromptConfig,
} from '../../src/living-world/index.js';

describe('Authored Domain Invariants and Persistence Boundary Enforcement', () => {
    let worldA;
    let worldB;

    beforeEach(() => {
        openDb(':memory:');
        worldA = createWorld({ name: 'World A' });
        worldB = createWorld({ name: 'World B' });
    });

    afterEach(() => {
        closeDb();
    });

    test('invariant: lws_id is stable and immutable across multiple updates', () => {
        const char = createCharacter(worldA.lws_id, { name: 'Initial', description: 'V1' });
        const originalLwsId = char.lws_id;

        const update1 = updateCharacter(worldA.lws_id, originalLwsId, { name: 'Second' });
        expect(update1.lws_id).toBe(originalLwsId);

        const update2 = updateCharacter(worldA.lws_id, originalLwsId, { name: 'Third', personality: 'Bold' });
        expect(update2.lws_id).toBe(originalLwsId);
    });

    test('invariant: updating Character A does not alter Character B (authored independence)', () => {
        const charA = createCharacter(worldA.lws_id, {
            name: 'Hero A',
            personality: 'Brave',
            scenario: 'Quest A',
        });
        const charB = createCharacter(worldA.lws_id, {
            name: 'Hero B',
            personality: 'Cautious',
            scenario: 'Quest B',
        });

        updateCharacter(worldA.lws_id, charA.lws_id, {
            name: 'Hero A Prime',
            personality: 'Reckless',
        });

        const db = openDb(':memory:');
        const bFromDb = db.prepare('SELECT * FROM lws_characters WHERE lws_id = ?').get(charB.lws_id);
        expect(bFromDb.name).toBe('Hero B');
        expect(bFromDb.personality).toBe('Cautious');
        expect(bFromDb.scenario_context).toBe('Quest B');
    });

    test('persistence boundary: world_id is immutable on all 6 child tables via triggers', () => {
        const db = openDb(':memory:');

        // Setup one entity in each child table under World A
        const char = createCharacter(worldA.lws_id, { name: 'Char' });
        const loc = createLocation(worldA.lws_id, { name: 'Loc' });
        const faction = createFaction(worldA.lws_id, { name: 'Faction' });
        const rule = createWorldRule(worldA.lws_id, { body: 'Rule' });
        const scenario = createScenario(worldA.lws_id, { name: 'Scenario' });
        const prompt = createPromptConfig(worldA.lws_id, { style_notes: 'Notes' });

        const rawWorldB = db.prepare('SELECT id FROM lws_worlds WHERE lws_id = ?').get(worldB.lws_id);

        // 1. Character world_id update trigger
        expect(() => {
            db.prepare('UPDATE lws_characters SET world_id = ? WHERE lws_id = ?').run(rawWorldB.id, char.lws_id);
        }).toThrow(/world_id is immutable/);

        // 2. Location world_id update trigger
        expect(() => {
            db.prepare('UPDATE lws_locations SET world_id = ? WHERE lws_id = ?').run(rawWorldB.id, loc.lws_id);
        }).toThrow(/world_id is immutable/);

        // 3. Faction world_id update trigger
        expect(() => {
            db.prepare('UPDATE lws_factions SET world_id = ? WHERE lws_id = ?').run(rawWorldB.id, faction.lws_id);
        }).toThrow(/world_id is immutable/);

        // 4. WorldRule world_id update trigger
        expect(() => {
            db.prepare('UPDATE lws_world_rules SET world_id = ? WHERE lws_id = ?').run(rawWorldB.id, rule.lws_id);
        }).toThrow(/world_id is immutable/);

        // 5. Scenario world_id update trigger
        expect(() => {
            db.prepare('UPDATE lws_scenarios SET world_id = ? WHERE lws_id = ?').run(rawWorldB.id, scenario.lws_id);
        }).toThrow(/world_id is immutable/);

        // 6. AuthoredPromptConfig world_id update trigger
        expect(() => {
            db.prepare('UPDATE lws_authored_prompt_configs SET world_id = ? WHERE lws_id = ?').run(rawWorldB.id, prompt.lws_id);
        }).toThrow(/world_id is immutable/);
    });

    test('persistence boundary: cross-world character_factions rejected on INSERT and UPDATE bypass', () => {
        const db = openDb(':memory:');
        const charA = createCharacter(worldA.lws_id, { name: 'Char A' });
        const factionA = createFaction(worldA.lws_id, { name: 'Faction A' });
        const factionB = createFaction(worldB.lws_id, { name: 'Faction B' });

        const rawCharA = db.prepare('SELECT id FROM lws_characters WHERE lws_id = ?').get(charA.lws_id);
        const rawFactionA = db.prepare('SELECT id FROM lws_factions WHERE lws_id = ?').get(factionA.lws_id);
        const rawFactionB = db.prepare('SELECT id FROM lws_factions WHERE lws_id = ?').get(factionB.lws_id);

        // Cross-world direct INSERT bypass must fail
        expect(() => {
            db.prepare('INSERT INTO lws_character_factions (character_id, faction_id, role) VALUES (?, ?, ?)').run(
                rawCharA.id,
                rawFactionB.id,
                'Spy',
            );
        }).toThrow(/character and faction must belong to the same world/);

        // Valid INSERT in World A
        db.prepare('INSERT INTO lws_character_factions (character_id, faction_id, role) VALUES (?, ?, ?)').run(
            rawCharA.id,
            rawFactionA.id,
            'Member',
        );

        // Cross-world direct UPDATE bypass must fail
        expect(() => {
            db.prepare('UPDATE lws_character_factions SET faction_id = ? WHERE character_id = ?').run(
                rawFactionB.id,
                rawCharA.id,
            );
        }).toThrow(/character and faction must belong to the same world/);
    });

    test('persistence boundary: cross-world scenario starting_location rejected on INSERT and UPDATE bypass', () => {
        const db = openDb(':memory:');
        const locB = createLocation(worldB.lws_id, { name: 'Location in World B' });
        const locA = createLocation(worldA.lws_id, { name: 'Location in World A' });
        const rawLocB = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ?').get(locB.lws_id);
        const rawLocA = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ?').get(locA.lws_id);
        const rawWorldA = db.prepare('SELECT id FROM lws_worlds WHERE lws_id = ?').get(worldA.lws_id);

        // Direct INSERT with cross-world starting_location_id must fail via trigger
        expect(() => {
            db.prepare(`
                INSERT INTO lws_scenarios (
                    lws_id, world_id, name, starting_location_id, created_at, updated_at
                ) VALUES ('10000000-0000-0000-0000-000000000001', ?, 'Bad Scenario', ?, '2026-01-01', '2026-01-01')
            `).run(rawWorldA.id, rawLocB.id);
        }).toThrow(/starting_location_id must belong to the same world as the scenario/);

        // Valid scenario in World A
        db.prepare(`
            INSERT INTO lws_scenarios (
                lws_id, world_id, name, starting_location_id, created_at, updated_at
            ) VALUES ('10000000-0000-0000-0000-000000000002', ?, 'Good Scenario', ?, '2026-01-01', '2026-01-01')
        `).run(rawWorldA.id, rawLocA.id);

        // Direct UPDATE with cross-world starting_location_id must fail via trigger
        expect(() => {
            db.prepare(`
                UPDATE lws_scenarios SET starting_location_id = ?
                WHERE lws_id = '10000000-0000-0000-0000-000000000002'
            `).run(rawLocB.id);
        }).toThrow(/starting_location_id must belong to the same world as the scenario/);
    });

    test('persistence boundary: cross-world scenario_characters rejected on INSERT and UPDATE bypass', () => {
        const db = openDb(':memory:');
        const scenarioA = createScenario(worldA.lws_id, { name: 'Scenario A' });
        const charA = createCharacter(worldA.lws_id, { name: 'Char A' });
        const charB = createCharacter(worldB.lws_id, { name: 'Char B' });

        const rawScenarioA = db.prepare('SELECT id FROM lws_scenarios WHERE lws_id = ?').get(scenarioA.lws_id);
        const rawCharA = db.prepare('SELECT id FROM lws_characters WHERE lws_id = ?').get(charA.lws_id);
        const rawCharB = db.prepare('SELECT id FROM lws_characters WHERE lws_id = ?').get(charB.lws_id);

        // Direct cross-world INSERT bypass
        expect(() => {
            db.prepare('INSERT INTO lws_scenario_characters (scenario_id, character_id, role) VALUES (?, ?, ?)').run(
                rawScenarioA.id,
                rawCharB.id,
                'Intruder',
            );
        }).toThrow(/character must belong to the same world as the scenario/);

        // Valid INSERT in World A
        db.prepare('INSERT INTO lws_scenario_characters (scenario_id, character_id, role) VALUES (?, ?, ?)').run(
            rawScenarioA.id,
            rawCharA.id,
            'Actor',
        );

        // Direct cross-world UPDATE bypass
        expect(() => {
            db.prepare('UPDATE lws_scenario_characters SET character_id = ? WHERE scenario_id = ?').run(
                rawCharB.id,
                rawScenarioA.id,
            );
        }).toThrow(/character must belong to the same world as the scenario/);
    });

    test('soft-delete of World does NOT physically delete descendant rows (FK integrity preserved)', () => {
        const char = createCharacter(worldA.lws_id, { name: 'Child Char' });
        const loc = createLocation(worldA.lws_id, { name: 'Child Loc' });
        const faction = createFaction(worldA.lws_id, { name: 'Child Faction' });

        deleteWorld(worldA.lws_id);

        // Raw SQLite inspection confirms children are still physically present
        const db = openDb(':memory:');
        const charRow = db.prepare('SELECT * FROM lws_characters WHERE lws_id = ?').get(char.lws_id);
        const locRow = db.prepare('SELECT * FROM lws_locations WHERE lws_id = ?').get(loc.lws_id);
        const factionRow = db.prepare('SELECT * FROM lws_factions WHERE lws_id = ?').get(faction.lws_id);

        expect(charRow).toBeDefined();
        expect(locRow).toBeDefined();
        expect(factionRow).toBeDefined();
    });

    test('runtime simulation and event tables exist while Phase 5 tick tables do not', () => {
        const db = openDb(':memory:');
        const tables = db.prepare('SELECT name FROM sqlite_master WHERE type=\'table\'').all();
        const names = tables.map(t => t.name);

        expect(names).toContain('lws_simulations');
        expect(names).toContain('lws_simulation_characters');
        expect(names).toContain('lws_events');
        expect(names).toContain('lws_narrative_turns');
        expect(names).not.toContain('lws_ticks');
    });
});
