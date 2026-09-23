import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createTestDb, closeTestDb } from './fixtures/test-db.js';

describe('LWS Migration 003: Simulation Runtime Database and Integrity', () => {
    let db;

    beforeEach(() => {
        db = createTestDb();
    });

    afterEach(() => {
        closeTestDb(db);
    });

    test('applies migration 003 and elevates PRAGMA user_version to 3', () => {
        const version = Number(db.pragma('user_version', { simple: true }));
        expect(version).toBe(3);
    });

    test('creates lws_simulations and lws_simulation_characters tables', () => {
        const tables = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name IN ('lws_simulations', 'lws_simulation_characters')
            ORDER BY name ASC
        `).all();

        expect(tables.map(t => t.name)).toEqual(['lws_simulation_characters', 'lws_simulations']);
    });

    test('creates all 10 Phase 3 database triggers', () => {
        const triggers = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'trigger' AND (
                name LIKE 'trg_lws_simulations_%' OR name LIKE 'trg_lws_sim_chars_%'
            )
            ORDER BY name ASC
        `).all();

        const triggerNames = triggers.map(t => t.name);
        expect(triggerNames).toHaveLength(10);
        expect(triggerNames).toContain('trg_lws_simulations_world_id_immutable');
        expect(triggerNames).toContain('trg_lws_simulations_scenario_id_immutable');
        expect(triggerNames).toContain('trg_lws_simulations_scenario_same_world_insert');
        expect(triggerNames).toContain('trg_lws_simulations_status_transition');
        expect(triggerNames).toContain('trg_lws_sim_chars_simulation_id_immutable');
        expect(triggerNames).toContain('trg_lws_sim_chars_character_id_immutable');
        expect(triggerNames).toContain('trg_lws_sim_chars_authored_snapshot_immutable');
        expect(triggerNames).toContain('trg_lws_sim_chars_same_world_insert');
        expect(triggerNames).toContain('trg_lws_sim_chars_location_insert');
        expect(triggerNames).toContain('trg_lws_sim_chars_location_update');
    });

    test('creates all 5 Phase 3 indexes', () => {
        const indexes = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'index' AND (
                name LIKE 'idx_lws_simulations_%' OR name LIKE 'idx_lws_sim_chars_%'
            )
            ORDER BY name ASC
        `).all();

        const indexNames = indexes.map(i => i.name);
        expect(indexNames).toContain('idx_lws_simulations_world');
        expect(indexNames).toContain('idx_lws_simulations_name_active');
        expect(indexNames).toContain('idx_lws_sim_chars_sim');
        expect(indexNames).toContain('idx_lws_sim_chars_unique_active');
        expect(indexNames).toContain('idx_lws_sim_chars_location');
    });

    test('enforces world_id immutability on lws_simulations via trigger', () => {
        db.prepare(`
            INSERT INTO lws_worlds (lws_id, name, created_at, updated_at)
            VALUES ('w-1', 'World 1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                   ('w-2', 'World 2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_simulations (lws_id, world_id, name, current_fictional_time, created_at, updated_at)
            VALUES ('s-1', 1, 'Sim 1', '2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        expect(() => {
            db.prepare('UPDATE lws_simulations SET world_id = 2 WHERE lws_id = ?').run('s-1');
        }).toThrow(/world_id is immutable/);
    });

    test('enforces scenario_id immutability on lws_simulations via trigger', () => {
        db.prepare(`
            INSERT INTO lws_worlds (lws_id, name, created_at, updated_at)
            VALUES ('w-1', 'World 1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_scenarios (lws_id, world_id, name, created_at, updated_at)
            VALUES ('sc-1', 1, 'Scenario 1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                   ('sc-2', 1, 'Scenario 2', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_simulations (lws_id, world_id, scenario_id, name, current_fictional_time, created_at, updated_at)
            VALUES ('s-1', 1, 1, 'Sim 1', '2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        expect(() => {
            db.prepare('UPDATE lws_simulations SET scenario_id = 2 WHERE lws_id = ?').run('s-1');
        }).toThrow(/scenario_id is immutable/);

        expect(() => {
            db.prepare('UPDATE lws_simulations SET scenario_id = NULL WHERE lws_id = ?').run('s-1');
        }).toThrow(/scenario_id is immutable/);
    });

    test('enforces status transition trigger on lws_simulations', () => {
        db.prepare(`
            INSERT INTO lws_worlds (lws_id, name, created_at, updated_at)
            VALUES ('w-1', 'World 1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_simulations (lws_id, world_id, name, status, current_fictional_time, created_at, updated_at)
            VALUES ('s-1', 1, 'Sim 1', 'active', '2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        // active -> paused succeeds
        db.prepare('UPDATE lws_simulations SET status = \'paused\' WHERE lws_id = ?').run('s-1');
        let row = db.prepare('SELECT status FROM lws_simulations WHERE lws_id = ?').get('s-1');
        expect(row.status).toBe('paused');

        // paused -> archived succeeds
        db.prepare('UPDATE lws_simulations SET status = \'archived\' WHERE lws_id = ?').run('s-1');
        row = db.prepare('SELECT status FROM lws_simulations WHERE lws_id = ?').get('s-1');
        expect(row.status).toBe('archived');

        // archived -> active is aborted by trigger
        expect(() => {
            db.prepare('UPDATE lws_simulations SET status = \'active\' WHERE lws_id = ?').run('s-1');
        }).toThrow(/invalid simulation status transition/);

        // archived -> paused is aborted by trigger
        expect(() => {
            db.prepare('UPDATE lws_simulations SET status = \'paused\' WHERE lws_id = ?').run('s-1');
        }).toThrow(/invalid simulation status transition/);
    });

    test('enforces simulation_id, character_id, and authored_snapshot immutability on lws_simulation_characters', () => {
        db.prepare(`
            INSERT INTO lws_worlds (lws_id, name, created_at, updated_at)
            VALUES ('w-1', 'World 1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_characters (lws_id, world_id, name, created_at, updated_at)
            VALUES ('c-1', 1, 'Dave', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                   ('c-2', 1, 'John', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_simulations (lws_id, world_id, name, current_fictional_time, created_at, updated_at)
            VALUES ('s-1', 1, 'Sim 1', '2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                   ('s-2', 1, 'Sim 2', '2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_simulation_characters (lws_id, simulation_id, character_id, authored_snapshot, created_at, updated_at)
            VALUES ('sc-1', 1, 1, '{"name":"Dave"}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        // Mutating simulation_id is aborted
        expect(() => {
            db.prepare('UPDATE lws_simulation_characters SET simulation_id = 2 WHERE lws_id = ?').run('sc-1');
        }).toThrow(/simulation_id is immutable/);

        // Mutating character_id is aborted
        expect(() => {
            db.prepare('UPDATE lws_simulation_characters SET character_id = 2 WHERE lws_id = ?').run('sc-1');
        }).toThrow(/character_id is immutable/);

        // Mutating authored_snapshot is aborted
        expect(() => {
            db.prepare('UPDATE lws_simulation_characters SET authored_snapshot = ? WHERE lws_id = ?')
                .run('{"name":"Super Dave"}', 'sc-1');
        }).toThrow(/authored_snapshot is immutable/);
    });

    test('enforces soft-deleted location assignment guards while preserving existing references', () => {
        db.prepare(`
            INSERT INTO lws_worlds (lws_id, name, created_at, updated_at)
            VALUES ('w-1', 'World 1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_characters (lws_id, world_id, name, created_at, updated_at)
            VALUES ('c-1', 1, 'Dave', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
                   ('c-2', 1, 'Sarah', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_locations (lws_id, world_id, name, created_at, updated_at, deleted_at)
            VALUES ('loc-active', 1, 'Active Loc', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL),
                   ('loc-deleted', 1, 'Deleted Loc', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z')
        `).run();

        db.prepare(`
            INSERT INTO lws_simulations (lws_id, world_id, name, current_fictional_time, created_at, updated_at)
            VALUES ('s-1', 1, 'Sim 1', '2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        // 1. Direct INSERT with soft-deleted location is aborted by trigger
        expect(() => {
            db.prepare(`
                INSERT INTO lws_simulation_characters (lws_id, simulation_id, character_id, current_location_id, created_at, updated_at)
                VALUES ('sc-bad', 1, 1, 2, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
            `).run();
        }).toThrow(/cannot newly assign a soft-deleted location/);

        // 2. Direct INSERT with active location succeeds
        db.prepare(`
            INSERT INTO lws_simulation_characters (lws_id, simulation_id, character_id, current_location_id, activity, created_at, updated_at)
            VALUES ('sc-good', 1, 1, 1, 'idle', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
        `).run();

        // 3. Direct UPDATE newly assigning soft-deleted location is aborted
        expect(() => {
            db.prepare('UPDATE lws_simulation_characters SET current_location_id = 2 WHERE lws_id = ?').run('sc-good');
        }).toThrow(/cannot newly assign a soft-deleted location/);

        // 4. Soft-delete the location that character is currently at
        db.prepare('UPDATE lws_locations SET deleted_at = \'2026-01-03T00:00:00Z\' WHERE id = 1').run();

        // 5. Updating activity or physical_condition while preserving the existing location succeeds!
        expect(() => {
            db.prepare('UPDATE lws_simulation_characters SET activity = \'sleeping\' WHERE lws_id = ?').run('sc-good');
        }).not.toThrow();

        const updated = db.prepare('SELECT activity, current_location_id FROM lws_simulation_characters WHERE lws_id = ?').get('sc-good');
        expect(updated.activity).toBe('sleeping');
        expect(updated.current_location_id).toBe(1);
    });
});
