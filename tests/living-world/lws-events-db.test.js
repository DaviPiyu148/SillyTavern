import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { createTestDb, closeTestDb } from './fixtures/test-db.js';
import { MIGRATIONS, runMigrations } from '../../src/living-world/migrations/index.js';

describe('LWS Migration 004: Events Ledger and Narrative Turns Database Integrity', () => {
    let db;

    beforeEach(() => {
        db = createTestDb(4);
    });

    afterEach(() => {
        closeTestDb(db);
    });

    test('applies migration 004 and elevates PRAGMA user_version to 4', () => {
        const version = Number(db.pragma('user_version', { simple: true }));
        expect(version).toBe(4);
    });

    test('migrates an existing database from version 3 to version 4', () => {
        const legacyDb = new Database(':memory:');
        legacyDb.pragma('foreign_keys = ON');

        // Apply migrations 001, 002, 003
        for (const migration of MIGRATIONS.filter(m => m.version <= 3)) {
            migration.up(legacyDb);
            legacyDb.pragma(`user_version = ${migration.version}`);
        }
        expect(Number(legacyDb.pragma('user_version', { simple: true }))).toBe(3);

        // Run migrations to apply migration 004
        const updatedVersion = runMigrations(legacyDb, 4);
        expect(updatedVersion).toBe(4);
        expect(Number(legacyDb.pragma('user_version', { simple: true }))).toBe(4);

        const tables = legacyDb.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name IN ('lws_narrative_turns', 'lws_events')
            ORDER BY name ASC
        `).all();
        expect(tables.map(t => t.name)).toEqual(['lws_events', 'lws_narrative_turns']);
        legacyDb.close();
    });

    test('creates lws_narrative_turns and lws_events tables', () => {
        const tables = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name IN ('lws_narrative_turns', 'lws_events')
            ORDER BY name ASC
        `).all();

        expect(tables.map(t => t.name)).toEqual(['lws_events', 'lws_narrative_turns']);
    });

    test('creates exactly 16 Phase 4 database triggers', () => {
        const triggers = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'trigger' AND (
                name LIKE 'trg_lws_events_%' OR name LIKE 'trg_lws_narrative_turns_%'
            )
            ORDER BY name ASC
        `).all();

        const triggerNames = triggers.map(t => t.name);
        expect(triggerNames).toHaveLength(16);

        // Events triggers (12)
        expect(triggerNames).toContain('trg_lws_events_immutable_all');
        expect(triggerNames).toContain('trg_lws_events_no_delete');
        expect(triggerNames).toContain('trg_lws_events_same_sim_actor');
        expect(triggerNames).toContain('trg_lws_events_same_sim_target');
        expect(triggerNames).toContain('trg_lws_events_same_world_authored');
        expect(triggerNames).toContain('trg_lws_events_same_world_location');
        expect(triggerNames).toContain('trg_lws_events_fictional_time_matches_sim');
        expect(triggerNames).toContain('trg_lws_events_causal_integrity');
        expect(triggerNames).toContain('trg_lws_events_same_sim_turn');
        expect(triggerNames).toContain('trg_lws_events_char_actor_required');
        expect(triggerNames).toContain('trg_lws_events_start_actor_prohibited');
        expect(triggerNames).toContain('trg_lws_events_join_authored_required');

        // Narrative turns triggers (4)
        expect(triggerNames).toContain('trg_lws_narrative_turns_sim_immutable');
        expect(triggerNames).toContain('trg_lws_narrative_turns_turn_num_immutable');
        expect(triggerNames).toContain('trg_lws_narrative_turns_terminal_immutable');
        expect(triggerNames).toContain('trg_lws_narrative_turns_no_delete');
    });

    test('creates exactly 7 Phase 4 database indexes', () => {
        const indexes = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'index' AND (
                name LIKE 'idx_lws_events_%' OR name LIKE 'idx_lws_narrative_turns_%'
            )
            ORDER BY name ASC
        `).all();

        const indexNames = indexes.map(i => i.name);
        expect(indexNames).toHaveLength(7);
        expect(indexNames).toContain('idx_lws_events_sim_seq');
        expect(indexNames).toContain('idx_lws_events_sim_time');
        expect(indexNames).toContain('idx_lws_events_actor');
        expect(indexNames).toContain('idx_lws_events_authored_char');
        expect(indexNames).toContain('idx_lws_events_idempotency');
        expect(indexNames).toContain('idx_lws_events_turn');
        expect(indexNames).toContain('idx_lws_narrative_turns_sim_turn');
    });

    describe('Direct Trigger Enforcement', () => {
        let worldId;
        let simId;
        let charId;
        let locId;
        let simCharId;

        beforeEach(() => {
            // Seed world, simulation, character, location, and simulation character
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

        test('trg_lws_events_immutable_all rejects direct UPDATE on lws_events', () => {
            db.prepare(`
                INSERT INTO lws_events (
                    lws_id, simulation_id, sequence_number, event_type, fictional_time,
                    provenance, created_at
                ) VALUES ('e-11111111-1111-1111-1111-111111111111', ?, 1, 'SIMULATION_START', '2026-06-01T12:00:00Z', 'system', '2026-01-01')
            `).run(simId);

            expect(() => {
                db.prepare(`
                    UPDATE lws_events SET event_type = 'REST'
                    WHERE lws_id = 'e-11111111-1111-1111-1111-111111111111'
                `).run();
            }).toThrow(/lws_events rows are strictly immutable/);
        });

        test('trg_lws_events_no_delete rejects direct DELETE on lws_events', () => {
            db.prepare(`
                INSERT INTO lws_events (
                    lws_id, simulation_id, sequence_number, event_type, fictional_time,
                    provenance, created_at
                ) VALUES ('e-11111111-1111-1111-1111-111111111111', ?, 1, 'SIMULATION_START', '2026-06-01T12:00:00Z', 'system', '2026-01-01')
            `).run(simId);

            expect(() => {
                db.prepare('DELETE FROM lws_events WHERE lws_id = \'e-11111111-1111-1111-1111-111111111111\'').run();
            }).toThrow(/lws_events rows cannot be deleted/);
        });

        test('trg_lws_events_fictional_time_matches_sim rejects mismatching clock', () => {
            expect(() => {
                db.prepare(`
                    INSERT INTO lws_events (
                        lws_id, simulation_id, sequence_number, event_type, fictional_time,
                        provenance, created_at
                    ) VALUES ('e-bad-time', ?, 1, 'SIMULATION_START', '2099-01-01T00:00:00Z', 'system', '2026-01-01')
                `).run(simId);
            }).toThrow(/event fictional_time must match simulation current_fictional_time/);
        });

        test('trg_lws_events_same_sim_actor rejects actor from a different simulation', () => {
            // Create second simulation
            db.prepare(`
                INSERT INTO lws_simulations (lws_id, world_id, name, status, current_fictional_time, created_at, updated_at)
                VALUES ('s-22222222-2222-2222-2222-222222222222', ?, 'Sim 2', 'active', '2026-06-01T12:00:00Z', '2026-01-01', '2026-01-01')
            `).run(worldId);
            const sim2Id = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = \'s-22222222-2222-2222-2222-222222222222\'').get().id;

            expect(() => {
                db.prepare(`
                    INSERT INTO lws_events (
                        lws_id, simulation_id, sequence_number, event_type, fictional_time,
                        actor_character_id, provenance, created_at
                    ) VALUES ('e-bad-actor', ?, 1, 'REST', '2026-06-01T12:00:00Z', ?, 'user', '2026-01-01')
                `).run(sim2Id, simCharId); // simCharId belongs to sim1, not sim2
            }).toThrow(/actor character must belong to the same simulation/);
        });

        test('trg_lws_events_causal_integrity enforces simulation match and sequence precedence', () => {
            db.prepare(`
                INSERT INTO lws_events (
                    lws_id, simulation_id, sequence_number, event_type, fictional_time,
                    actor_character_id, provenance, created_at
                ) VALUES ('e-parent', ?, 2, 'REST', '2026-06-01T12:00:00Z', ?, 'user', '2026-01-01')
            `).run(simId, simCharId);
            const parentEventId = db.prepare('SELECT id FROM lws_events WHERE lws_id = \'e-parent\'').get().id;

            // Fails if sequence_number is <= causal event
            expect(() => {
                db.prepare(`
                    INSERT INTO lws_events (
                        lws_id, simulation_id, sequence_number, event_type, fictional_time,
                        actor_character_id, causal_event_id, provenance, created_at
                    ) VALUES ('e-child-fail', ?, 1, 'REST', '2026-06-01T12:00:00Z', ?, ?, 'user', '2026-01-01')
                `).run(simId, simCharId, parentEventId);
            }).toThrow(/causal_event sequence_number must precede event sequence_number/);
        });

        test('trg_lws_events_start_actor_prohibited prevents actor on SIMULATION_START', () => {
            expect(() => {
                db.prepare(`
                    INSERT INTO lws_events (
                        lws_id, simulation_id, sequence_number, event_type, fictional_time,
                        actor_character_id, provenance, created_at
                    ) VALUES ('e-bad-start', ?, 1, 'SIMULATION_START', '2026-06-01T12:00:00Z', ?, 'system', '2026-01-01')
                `).run(simId, simCharId);
            }).toThrow(/SIMULATION_START cannot have actor or target character/);
        });

        test('trg_lws_events_join_authored_required enforces authored_character_id on CHARACTER_JOIN', () => {
            expect(() => {
                db.prepare(`
                    INSERT INTO lws_events (
                        lws_id, simulation_id, sequence_number, event_type, fictional_time,
                        provenance, created_at
                    ) VALUES ('e-bad-join', ?, 1, 'CHARACTER_JOIN', '2026-06-01T12:00:00Z', 'user', '2026-01-01')
                `).run(simId);
            }).toThrow(/authored_character_id is required for CHARACTER_JOIN/);
        });

        test('trg_lws_narrative_turns immutability guards', () => {
            db.prepare(`
                INSERT INTO lws_narrative_turns (
                    lws_id, simulation_id, turn_number, status, created_at, updated_at
                ) VALUES ('t-11111111-1111-1111-1111-111111111111', ?, 1, 'pending', '2026-01-01', '2026-01-01')
            `).run(simId);

            // Cannot update simulation_id
            expect(() => {
                db.prepare(`
                    UPDATE lws_narrative_turns SET simulation_id = 99999
                    WHERE lws_id = 't-11111111-1111-1111-1111-111111111111'
                `).run();
            }).toThrow(/simulation_id is immutable on lws_narrative_turns/);

            // Cannot update turn_number
            expect(() => {
                db.prepare(`
                    UPDATE lws_narrative_turns SET turn_number = 99
                    WHERE lws_id = 't-11111111-1111-1111-1111-111111111111'
                `).run();
            }).toThrow(/turn_number is immutable on lws_narrative_turns/);

            // Cannot delete turn row
            expect(() => {
                db.prepare('DELETE FROM lws_narrative_turns WHERE lws_id = \'t-11111111-1111-1111-1111-111111111111\'').run();
            }).toThrow(/narrative turn rows cannot be deleted/);

            // Move to terminal status 'committed'
            db.prepare(`
                UPDATE lws_narrative_turns SET status = 'committed'
                WHERE lws_id = 't-11111111-1111-1111-1111-111111111111'
            `).run();

            // Terminal status makes entire row immutable
            expect(() => {
                db.prepare(`
                    UPDATE lws_narrative_turns SET user_input = 'Tampered'
                    WHERE lws_id = 't-11111111-1111-1111-1111-111111111111'
                `).run();
            }).toThrow(/terminal narrative turn rows are immutable/);
        });
    });
});
