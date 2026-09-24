import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { createTestDb, closeTestDb } from './fixtures/test-db.js';
import { MIGRATIONS, runMigrations } from '../../src/living-world/migrations/index.js';

describe('LWS Migration 005: Time, Schedules, and Routines Database Integrity', () => {
    let db;

    beforeEach(() => {
        db = createTestDb();
    });

    afterEach(() => {
        closeTestDb(db);
    });

    test('applies migration 005 and elevates PRAGMA user_version to 5', () => {
        const version = Number(db.pragma('user_version', { simple: true }));
        expect(version).toBe(5);
    });

    test('migrates an existing database from version 4 to version 5', () => {
        const legacyDb = new Database(':memory:');
        legacyDb.pragma('foreign_keys = ON');

        // Apply migrations 001 through 004
        for (const migration of MIGRATIONS.filter(m => m.version <= 4)) {
            migration.up(legacyDb);
            legacyDb.pragma(`user_version = ${migration.version}`);
        }
        expect(Number(legacyDb.pragma('user_version', { simple: true }))).toBe(4);

        // Run migrations to apply migration 005
        const updatedVersion = runMigrations(legacyDb);
        expect(updatedVersion).toBe(5);
        expect(Number(legacyDb.pragma('user_version', { simple: true }))).toBe(5);

        const tables = legacyDb.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name IN ('lws_simulation_character_routines', 'lws_scheduled_events')
            ORDER BY name ASC
        `).all();
        expect(tables.map(t => t.name)).toEqual(['lws_scheduled_events', 'lws_simulation_character_routines']);
        legacyDb.close();
    });

    test('creates lws_simulation_character_routines and lws_scheduled_events tables', () => {
        const tables = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name IN ('lws_simulation_character_routines', 'lws_scheduled_events')
            ORDER BY name ASC
        `).all();

        expect(tables.map(t => t.name)).toEqual(['lws_scheduled_events', 'lws_simulation_character_routines']);
    });

    test('verifies exact trigger inventory on Phase 4 and 5 tables (exactly 24 cumulative)', () => {
        const triggers = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'trigger' AND (
                name LIKE 'trg_lws_events_%' OR
                name LIKE 'trg_lws_narrative_turns_%' OR
                name LIKE 'trg_lws_routines_%' OR
                name LIKE 'trg_lws_sched_events_%'
            )
            ORDER BY name ASC
        `).all();

        const triggerNames = triggers.map(t => t.name);
        expect(triggerNames).toHaveLength(24);

        // Evolved Events trigger replaces static clock trigger
        expect(triggerNames).toContain('trg_lws_events_monotonic_and_sequence');
        expect(triggerNames).not.toContain('trg_lws_events_fictional_time_matches_sim');

        // 4 Routine triggers
        expect(triggerNames).toContain('trg_lws_routines_sim_immutable');
        expect(triggerNames).toContain('trg_lws_routines_char_same_sim');
        expect(triggerNames).toContain('trg_lws_routines_same_world_loc');
        expect(triggerNames).toContain('trg_lws_routines_no_delete');

        // 4 Scheduled event triggers
        expect(triggerNames).toContain('trg_lws_sched_events_sim_immutable');
        expect(triggerNames).toContain('trg_lws_sched_events_terminal_immutable');
        expect(triggerNames).toContain('trg_lws_sched_events_integrity');
        expect(triggerNames).toContain('trg_lws_sched_events_no_delete');
    });

    test('verifies exact index inventory on Phase 4 and 5 tables (exactly 11 cumulative)', () => {
        const indexes = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'index' AND (
                name LIKE 'idx_lws_events_%' OR
                name LIKE 'idx_lws_narrative_turns_%' OR
                name LIKE 'idx_lws_routines_%' OR
                name LIKE 'idx_lws_sched_events_%'
            )
            ORDER BY name ASC
        `).all();

        const indexNames = indexes.map(i => i.name);
        expect(indexNames).toHaveLength(11);

        // 7 Retained Phase 4 indexes
        expect(indexNames).toContain('idx_lws_events_sim_seq');
        expect(indexNames).toContain('idx_lws_events_sim_time');
        expect(indexNames).toContain('idx_lws_events_actor');
        expect(indexNames).toContain('idx_lws_events_authored_char');
        expect(indexNames).toContain('idx_lws_events_idempotency');
        expect(indexNames).toContain('idx_lws_events_turn');
        expect(indexNames).toContain('idx_lws_narrative_turns_sim_turn');

        // 4 Phase 5 indexes
        expect(indexNames).toContain('idx_lws_routines_sim_char');
        expect(indexNames).toContain('idx_lws_routines_lookup');
        expect(indexNames).toContain('idx_lws_sched_events_sim_time');
        expect(indexNames).toContain('idx_lws_sched_events_sim_status');
    });

    describe('Direct Trigger Enforcement', () => {
        let worldId;
        let simId;
        let charId;
        let locId;
        let simCharId;

        beforeEach(() => {
            db.prepare(`
                INSERT INTO lws_worlds (lws_id, name, created_at, updated_at)
                VALUES ('w-11111111-1111-1111-1111-111111111111', 'Test World', '2026-01-01', '2026-01-01')
            `).run();
            worldId = db.prepare('SELECT id FROM lws_worlds WHERE lws_id = \'w-11111111-1111-1111-1111-111111111111\'').get().id;

            db.prepare(`
                INSERT INTO lws_simulations (lws_id, world_id, name, status, current_fictional_time, created_at, updated_at)
                VALUES ('s-11111111-1111-1111-1111-111111111111', ?, 'Sim 1', 'active', '2026-06-01T12:00:00Z', '2026-01-01', '2026-01-01')
            `).run(worldId);
            simId = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = \'s-11111111-1111-1111-1111-111111111111\'').get().id;

            db.prepare(`
                INSERT INTO lws_characters (lws_id, world_id, name, created_at, updated_at)
                VALUES ('c-11111111-1111-1111-1111-111111111111', ?, 'Alice', '2026-01-01', '2026-01-01')
            `).run(worldId);
            charId = db.prepare('SELECT id FROM lws_characters WHERE lws_id = \'c-11111111-1111-1111-1111-111111111111\'').get().id;

            db.prepare(`
                INSERT INTO lws_locations (lws_id, world_id, name, created_at, updated_at)
                VALUES ('l-11111111-1111-1111-1111-111111111111', ?, 'Tavern', '2026-01-01', '2026-01-01')
            `).run(worldId);
            locId = db.prepare('SELECT id FROM lws_locations WHERE lws_id = \'l-11111111-1111-1111-1111-111111111111\'').get().id;

            db.prepare(`
                INSERT INTO lws_simulation_characters (lws_id, simulation_id, character_id, current_location_id, created_at, updated_at)
                VALUES ('sc-11111111-1111-1111-1111-111111111111', ?, ?, ?, '2026-01-01', '2026-01-01')
            `).run(simId, charId, locId);
            simCharId = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = \'sc-11111111-1111-1111-1111-111111111111\'').get().id;
        });

        test('trg_lws_events_monotonic_and_sequence enforces clock >= sim time and sequence gap elimination', () => {
            // Rejects event preceding simulation current fictional time
            expect(() => {
                db.prepare(`
                    INSERT INTO lws_events (
                        lws_id, simulation_id, sequence_number, event_type, fictional_time,
                        provenance, created_at
                    ) VALUES ('e-past', ?, 1, 'SIMULATION_START', '2025-01-01T00:00:00Z', 'system', '2026-01-01')
                `).run(simId);
            }).toThrow(/event fictional_time cannot precede simulation current_fictional_time/);

            // Rejects sequence gap (e.g. sequence 2 before sequence 1)
            expect(() => {
                db.prepare(`
                    INSERT INTO lws_events (
                        lws_id, simulation_id, sequence_number, event_type, fictional_time,
                        provenance, created_at
                    ) VALUES ('e-gap', ?, 2, 'SIMULATION_START', '2026-06-01T12:00:00Z', 'system', '2026-01-01')
                `).run(simId);
            }).toThrow(/event sequence_number must equal next expected sequence number/);

            // Sequence 1 succeeds with time 15:00
            db.prepare(`
                INSERT INTO lws_events (
                    lws_id, simulation_id, sequence_number, event_type, fictional_time,
                    provenance, created_at
                ) VALUES ('e-1', ?, 1, 'SIMULATION_START', '2026-06-01T15:00:00Z', 'system', '2026-01-01')
            `).run(simId);

            // Sequence 2 cannot have fictional_time < sequence 1 fictional_time (14:00 < 15:00)
            expect(() => {
                db.prepare(`
                    INSERT INTO lws_events (
                        lws_id, simulation_id, sequence_number, event_type, fictional_time,
                        actor_character_id, provenance, created_at
                    ) VALUES ('e-non-monotonic', ?, 2, 'REST', '2026-06-01T14:00:00Z', ?, 'user', '2026-01-01')
                `).run(simId, simCharId);
            }).toThrow(/event fictional_time cannot precede preceding sequence event fictional_time/);
        });

        test('trg_lws_routines_sim_immutable protects simulation_id on update', () => {
            db.prepare(`
                INSERT INTO lws_simulation_character_routines (
                    lws_id, simulation_id, simulation_character_id, block_id, day_of_week,
                    start_time, end_time, activity, target_location_id, created_at, updated_at
                ) VALUES ('r-1', ?, ?, 'morning_rest', 'daily', '08:00:00', '10:00:00', 'resting', ?, '2026-01-01', '2026-01-01')
            `).run(simId, simCharId, locId);

            // Cannot change simulation_id
            expect(() => {
                db.prepare('UPDATE lws_simulation_character_routines SET simulation_id = 9999 WHERE lws_id = \'r-1\'').run();
            }).toThrow(/simulation_id is immutable/);
        });

        test('trg_lws_routines_no_delete rejects physical DELETE', () => {
            db.prepare(`
                INSERT INTO lws_simulation_character_routines (
                    lws_id, simulation_id, simulation_character_id, block_id, day_of_week,
                    start_time, end_time, activity, target_location_id, created_at, updated_at
                ) VALUES ('r-del', ?, ?, 'morning_rest', 'daily', '08:00:00', '10:00:00', 'resting', ?, '2026-01-01', '2026-01-01')
            `).run(simId, simCharId, locId);

            expect(() => {
                db.prepare('DELETE FROM lws_simulation_character_routines WHERE lws_id = \'r-del\'').run();
            }).toThrow(/routine rows cannot be physically deleted/);
        });

        test('trg_lws_routines_same_world_loc guards location validity on insert', () => {
            // Soft-delete location
            db.prepare('UPDATE lws_locations SET deleted_at = \'2026-01-01\' WHERE id = ?').run(locId);

            expect(() => {
                db.prepare(`
                    INSERT INTO lws_simulation_character_routines (
                        lws_id, simulation_id, simulation_character_id, block_id, day_of_week,
                        start_time, end_time, activity, target_location_id, created_at, updated_at
                    ) VALUES ('r-bad-loc', ?, ?, 'morning_rest', 'daily', '08:00:00', '10:00:00', 'resting', ?, '2026-01-01', '2026-01-01')
                `).run(simId, simCharId, locId);
            }).toThrow(/routine target location must belong to simulation world and not be soft-deleted/);
        });

        test('trg_lws_sched_events reciprocal supersession and terminal immutability', () => {
            // Insert predecessor
            db.prepare(`
                INSERT INTO lws_scheduled_events (
                    lws_id, simulation_id, scheduled_fictional_time, title, created_at, updated_at
                ) VALUES ('se-pred', ?, '2026-06-01T14:00:00Z', 'Market Fair', '2026-01-01', '2026-01-01')
            `).run(simId);
            const predId = db.prepare('SELECT id FROM lws_scheduled_events WHERE lws_id = \'se-pred\'').get().id;

            // Insert successor referencing predecessor
            const succRes = db.prepare(`
                INSERT INTO lws_scheduled_events (
                    lws_id, simulation_id, scheduled_fictional_time, title, supersedes_event_id, created_at, updated_at
                ) VALUES ('se-succ', ?, '2026-06-01T16:00:00Z', 'Rescheduled Fair', ?, '2026-01-01', '2026-01-01')
            `).run(simId, predId);
            const succId = succRes.lastInsertRowid;

            // Complete reciprocal supersession on predecessor
            db.prepare(`
                UPDATE lws_scheduled_events
                SET status = 'superseded', superseded_by_event_id = ?
                WHERE id = ?
            `).run(succId, predId);

            // Terminal status makes row immutable
            expect(() => {
                db.prepare('UPDATE lws_scheduled_events SET title = \'Hacked Fair\' WHERE id = ?').run(predId);
            }).toThrow(/terminal scheduled event rows are immutable/);

            // Cannot physically delete scheduled events
            expect(() => {
                db.prepare('DELETE FROM lws_scheduled_events WHERE id = ?').run(succId);
            }).toThrow(/scheduled event rows cannot be physically deleted/);
        });
    });
});
