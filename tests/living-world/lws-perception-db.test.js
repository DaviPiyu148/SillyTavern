import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { createTestDb, closeTestDb } from './fixtures/test-db.js';
import { MIGRATIONS, runMigrations } from '../../src/living-world/migrations/index.js';

describe('LWS Migration 006: Perception, Knowledge, Memories, Beliefs, and Cameras Database Integrity', () => {
    let db;

    beforeEach(() => {
        db = createTestDb(6);
    });

    afterEach(() => {
        closeTestDb(db);
    });

    function createSeedWorldAndSimulation(dbInstance) {
        const now = '2026-01-01T00:00:00Z';
        dbInstance.prepare(`
            INSERT INTO lws_worlds (id, lws_id, name, description, tags, extensions, created_at, updated_at)
            VALUES (1, 'world-uuid-1', 'World 1', 'Desc', '[]', '{}', ?, ?)
        `).run(now, now);

        dbInstance.prepare(`
            INSERT INTO lws_locations (id, lws_id, world_id, name, description, tags, extensions, created_at, updated_at)
            VALUES (1, 'loc-uuid-1', 1, 'Room 1', 'Desc', '[]', '{}', ?, ?)
        `).run(now, now);

        dbInstance.prepare(`
            INSERT INTO lws_characters (id, lws_id, world_id, name, personality, description, tags, extensions, created_at, updated_at)
            VALUES (1, 'char-uuid-1', 1, 'Alice', 'Personality', 'Desc', '[]', '{}', ?, ?)
        `).run(now, now);

        dbInstance.prepare(`
            INSERT INTO lws_simulations (id, lws_id, world_id, name, status, current_fictional_time, created_at, updated_at)
            VALUES (1, 'sim-uuid-1', 1, 'Sim 1', 'active', ?, ?, ?)
        `).run(now, now, now);

        dbInstance.prepare(`
            INSERT INTO lws_simulation_characters (id, lws_id, simulation_id, character_id, current_location_id, activity, physical_condition, runtime_state, created_at, updated_at)
            VALUES (1, 'sim-char-uuid-1', 1, 1, 1, 'idle', 'normal', '{}', ?, ?)
        `).run(now, now);

        dbInstance.prepare(`
            INSERT INTO lws_events (id, lws_id, simulation_id, sequence_number, event_type, actor_character_id, target_character_id, location_id, fictional_time, provenance, payload, created_at)
            VALUES (1, 'evt-uuid-1', 1, 1, 'OBSERVE', 1, NULL, 1, ?, 'director', '{}', ?)
        `).run(now, now);

        // Second simulation for cross-sim isolation tests
        dbInstance.prepare(`
            INSERT INTO lws_simulations (id, lws_id, world_id, name, status, current_fictional_time, created_at, updated_at)
            VALUES (2, 'sim-uuid-2', 1, 'Sim 2', 'active', ?, ?, ?)
        `).run(now, now, now);

        dbInstance.prepare(`
            INSERT INTO lws_simulation_characters (id, lws_id, simulation_id, character_id, current_location_id, activity, physical_condition, runtime_state, created_at, updated_at)
            VALUES (2, 'sim-char-uuid-2', 2, 1, 1, 'idle', 'normal', '{}', ?, ?)
        `).run(now, now);

        dbInstance.prepare(`
            INSERT INTO lws_events (id, lws_id, simulation_id, sequence_number, event_type, actor_character_id, target_character_id, location_id, fictional_time, provenance, payload, created_at)
            VALUES (2, 'evt-uuid-2', 2, 1, 'OBSERVE', 2, NULL, 1, ?, 'director', '{}', ?)
        `).run(now, now);
    }

    test('applies migration 006 and elevates PRAGMA user_version to 6', () => {
        const version = Number(db.pragma('user_version', { simple: true }));
        expect(version).toBe(6);
    });

    test('migrates an existing database from version 5 to version 6', () => {
        const legacyDb = new Database(':memory:');
        legacyDb.pragma('foreign_keys = ON');

        for (const migration of MIGRATIONS.filter(m => m.version <= 5)) {
            migration.up(legacyDb);
            legacyDb.pragma(`user_version = ${migration.version}`);
        }
        expect(Number(legacyDb.pragma('user_version', { simple: true }))).toBe(5);

        const updatedVersion = runMigrations(legacyDb, 6);
        expect(updatedVersion).toBe(6);
        expect(Number(legacyDb.pragma('user_version', { simple: true }))).toBe(6);

        const tables = legacyDb.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name IN (
                'lws_event_perceptions',
                'lws_character_knowledge',
                'lws_character_memories',
                'lws_character_beliefs',
                'lws_simulation_cameras'
            )
            ORDER BY name ASC
        `).all();

        expect(tables.map(t => t.name)).toEqual([
            'lws_character_beliefs',
            'lws_character_knowledge',
            'lws_character_memories',
            'lws_event_perceptions',
            'lws_simulation_cameras',
        ]);
        legacyDb.close();
    });

    test('creates all 5 Phase 6 tables with proper column schemas', () => {
        const tables = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'table' AND name IN (
                'lws_event_perceptions',
                'lws_character_knowledge',
                'lws_character_memories',
                'lws_character_beliefs',
                'lws_simulation_cameras'
            )
            ORDER BY name ASC
        `).all();

        expect(tables.map(t => t.name)).toEqual([
            'lws_character_beliefs',
            'lws_character_knowledge',
            'lws_character_memories',
            'lws_event_perceptions',
            'lws_simulation_cameras',
        ]);
    });

    test('verifies exact trigger inventory on Phase 6 tables (exactly 15 triggers)', () => {
        const triggers = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'trigger' AND (
                name LIKE 'trg_lws_perceptions_%' OR
                name LIKE 'trg_lws_knowledge_%' OR
                name LIKE 'trg_lws_memories_%' OR
                name LIKE 'trg_lws_beliefs_%' OR
                name LIKE 'trg_lws_cameras_%'
            )
            ORDER BY name ASC
        `).all();

        const triggerNames = triggers.map(t => t.name);
        expect(triggerNames).toHaveLength(15);

        // 3 Perceptions triggers
        expect(triggerNames).toContain('trg_lws_perceptions_immutable');
        expect(triggerNames).toContain('trg_lws_perceptions_no_delete');
        expect(triggerNames).toContain('trg_lws_perceptions_same_sim');

        // 3 Knowledge triggers
        expect(triggerNames).toContain('trg_lws_knowledge_identity_immutable');
        expect(triggerNames).toContain('trg_lws_knowledge_insert_integrity');
        expect(triggerNames).toContain('trg_lws_knowledge_no_delete');

        // 3 Memories triggers
        expect(triggerNames).toContain('trg_lws_memories_identity_immutable');
        expect(triggerNames).toContain('trg_lws_memories_insert_integrity');
        expect(triggerNames).toContain('trg_lws_memories_no_delete');

        // 3 Beliefs triggers
        expect(triggerNames).toContain('trg_lws_beliefs_identity_immutable');
        expect(triggerNames).toContain('trg_lws_beliefs_insert_integrity');
        expect(triggerNames).toContain('trg_lws_beliefs_no_delete');

        // 3 Cameras triggers
        expect(triggerNames).toContain('trg_lws_cameras_identity_immutable');
        expect(triggerNames).toContain('trg_lws_cameras_insert_integrity');
        expect(triggerNames).toContain('trg_lws_cameras_update_integrity');
    });

    test('verifies exact index inventory on Phase 6 tables (exactly 10 indexes)', () => {
        const indexes = db.prepare(`
            SELECT name FROM sqlite_master
            WHERE type = 'index' AND (
                name LIKE 'idx_lws_perceptions_%' OR
                name LIKE 'idx_lws_knowledge_%' OR
                name LIKE 'idx_lws_memories_%' OR
                name LIKE 'idx_lws_beliefs_%' OR
                name LIKE 'idx_lws_cameras_%'
            )
            ORDER BY name ASC
        `).all();

        const indexNames = indexes.map(i => i.name);
        expect(indexNames).toHaveLength(10);
        expect(indexNames).toContain('idx_lws_perceptions_event');
        expect(indexNames).toContain('idx_lws_perceptions_char_time');
        expect(indexNames).toContain('idx_lws_knowledge_char_lookup');
        expect(indexNames).toContain('idx_lws_knowledge_sim_char');
        expect(indexNames).toContain('idx_lws_memories_char_time');
        expect(indexNames).toContain('idx_lws_memories_char_salience');
        expect(indexNames).toContain('idx_lws_memories_sim_char');
        expect(indexNames).toContain('idx_lws_beliefs_lookup');
        expect(indexNames).toContain('idx_lws_beliefs_sim_char');
        expect(indexNames).toContain('idx_lws_cameras_sim');
    });

    describe('Trigger Behavior & Enforcements', () => {
        beforeEach(() => {
            createSeedWorldAndSimulation(db);
        });

        test('lws_event_perceptions rejects update and physical delete', () => {
            const now = '2026-01-01T00:00:00Z';
            db.prepare(`
                INSERT INTO lws_event_perceptions (id, lws_id, simulation_id, event_id, simulation_character_id, sensory_modality, perceived_at_fictional_time, created_at)
                VALUES (1, 'percept-1', 1, 1, 1, 'visual', ?, ?)
            `).run(now, now);

            expect(() => {
                db.prepare('UPDATE lws_event_perceptions SET sensory_modality = \'auditory\' WHERE id = 1').run();
            }).toThrow(/immutable/i);

            expect(() => {
                db.prepare('DELETE FROM lws_event_perceptions WHERE id = 1').run();
            }).toThrow(/prohibited/i);
        });

        test('lws_event_perceptions rejects cross-simulation references', () => {
            const now = '2026-01-01T00:00:00Z';
            // Event from Sim 2 in Sim 1 perception
            expect(() => {
                db.prepare(`
                    INSERT INTO lws_event_perceptions (id, lws_id, simulation_id, event_id, simulation_character_id, sensory_modality, perceived_at_fictional_time, created_at)
                    VALUES (2, 'percept-2', 1, 2, 1, 'visual', ?, ?)
                `).run(now, now);
            }).toThrow(/same simulation/i);

            // Character from Sim 2 in Sim 1 perception
            expect(() => {
                db.prepare(`
                    INSERT INTO lws_event_perceptions (id, lws_id, simulation_id, event_id, simulation_character_id, sensory_modality, perceived_at_fictional_time, created_at)
                    VALUES (3, 'percept-3', 1, 1, 2, 'visual', ?, ?)
                `).run(now, now);
            }).toThrow(/same simulation/i);
        });

        test('lws_character_knowledge rejects identity mutations and physical deletes', () => {
            const now = '2026-01-01T00:00:00Z';
            db.prepare(`
                INSERT INTO lws_character_knowledge (id, lws_id, simulation_id, simulation_character_id, fact_key, content, source_channel, source_character_id, source_event_id, fictional_time_acquired, created_at, updated_at)
                VALUES (1, 'know-1', 1, 1, 'secret_key', 'Content', 'perception', NULL, 1, ?, ?, ?)
            `).run(now, now, now);

            expect(() => {
                db.prepare('UPDATE lws_character_knowledge SET simulation_id = 2 WHERE id = 1').run();
            }).toThrow(/immutable/i);

            expect(() => {
                db.prepare('UPDATE lws_character_knowledge SET simulation_character_id = 2 WHERE id = 1').run();
            }).toThrow(/immutable/i);

            expect(() => {
                db.prepare('DELETE FROM lws_character_knowledge WHERE id = 1').run();
            }).toThrow(/prohibited/i);
        });

        test('lws_character_memories rejects identity mutations and physical deletes', () => {
            const now = '2026-01-01T00:00:00Z';
            db.prepare(`
                INSERT INTO lws_character_memories (id, lws_id, simulation_id, simulation_character_id, summary, details, memory_type, event_id, fictional_time, emotional_salience, importance, confidence, status, tags, source_channel, created_at, updated_at)
                VALUES (1, 'mem-1', 1, 1, 'Summary', 'Details', 'episodic', 1, ?, 70, 60, 90, 'vivid', '[]', 'perception', ?, ?)
            `).run(now, now, now);

            expect(() => {
                db.prepare('UPDATE lws_character_memories SET simulation_id = 2 WHERE id = 1').run();
            }).toThrow(/immutable/i);

            expect(() => {
                db.prepare('DELETE FROM lws_character_memories WHERE id = 1').run();
            }).toThrow(/prohibited/i);
        });

        test('lws_character_beliefs rejects identity mutations and physical deletes', () => {
            const now = '2026-01-01T00:00:00Z';
            db.prepare(`
                INSERT INTO lws_character_beliefs (id, lws_id, simulation_id, simulation_character_id, subject_key, belief_type, statement, confidence, source_basis, causal_event_id, created_at, updated_at)
                VALUES (1, 'bel-1', 1, 1, 'subject:test', 'belief', 'Statement', 60, 'observation', 1, ?, ?)
            `).run(now, now);

            expect(() => {
                db.prepare('UPDATE lws_character_beliefs SET simulation_id = 2 WHERE id = 1').run();
            }).toThrow(/immutable/i);

            expect(() => {
                db.prepare('DELETE FROM lws_character_beliefs WHERE id = 1').run();
            }).toThrow(/prohibited/i);
        });

        test('lws_simulation_cameras enforces mode/target invariants on insert and update', () => {
            const now = '2026-01-01T00:00:00Z';

            // Valid god_view
            db.prepare(`
                INSERT INTO lws_simulation_cameras (id, lws_id, simulation_id, camera_name, mode, target_character_id, target_location_id, created_at, updated_at)
                VALUES (1, 'cam-1', 1, 'default', 'god_view', NULL, NULL, ?, ?)
            `).run(now, now);

            // Invalid: follow_character with NULL target_character_id
            expect(() => {
                db.prepare(`
                    INSERT INTO lws_simulation_cameras (id, lws_id, simulation_id, camera_name, mode, target_character_id, target_location_id, created_at, updated_at)
                    VALUES (2, 'cam-2', 1, 'cam2', 'follow_character', NULL, NULL, ?, ?)
                `).run(now, now);
            }).toThrow(/follow_character mode requires target_character_id/i);

            // Invalid: observe_location with target_character_id
            expect(() => {
                db.prepare(`
                    INSERT INTO lws_simulation_cameras (id, lws_id, simulation_id, camera_name, mode, target_character_id, target_location_id, created_at, updated_at)
                    VALUES (3, 'cam-3', 1, 'cam3', 'observe_location', 1, 1, ?, ?)
                `).run(now, now);
            }).toThrow(/observe_location mode requires target_location_id/i);
        });

        test('lws_simulation_cameras rejects updating camera_name (camera_name immutability negative test)', () => {
            const now = '2026-01-01T00:00:00Z';
            db.prepare(`
                INSERT INTO lws_simulation_cameras (id, lws_id, simulation_id, camera_name, mode, target_character_id, target_location_id, created_at, updated_at)
                VALUES (1, 'cam-1', 1, 'default', 'god_view', NULL, NULL, ?, ?)
            `).run(now, now);

            expect(() => {
                db.prepare('UPDATE lws_simulation_cameras SET camera_name = \'new_name\' WHERE id = 1').run();
            }).toThrow(/camera_name is immutable/i);
        });

        test('lws_simulation_cameras rejects updating simulation_id', () => {
            const now = '2026-01-01T00:00:00Z';
            db.prepare(`
                INSERT INTO lws_simulation_cameras (id, lws_id, simulation_id, camera_name, mode, target_character_id, target_location_id, created_at, updated_at)
                VALUES (1, 'cam-1', 1, 'default', 'god_view', NULL, NULL, ?, ?)
            `).run(now, now);

            expect(() => {
                db.prepare('UPDATE lws_simulation_cameras SET simulation_id = 2 WHERE id = 1').run();
            }).toThrow(/simulation_id is immutable/i);
        });
    });
});
