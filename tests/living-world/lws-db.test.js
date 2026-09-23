import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import Database from 'better-sqlite3';
import { createInMemoryTestDb, createFileTestDb } from './fixtures/test-db.js';
import { runMigrations } from '../../src/living-world/migrations/index.js';

describe('LWS Database Foundation and Migrations', () => {
    let memoryDb;

    beforeEach(() => {
        memoryDb = createInMemoryTestDb();
    });

    afterEach(() => {
        if (memoryDb && memoryDb.open) {
            memoryDb.close();
        }
    });

    test('applies migrations 001 and 002 and sets PRAGMA user_version to 2', () => {
        const userVersion = memoryDb.pragma('user_version', { simple: true });
        expect(userVersion).toBe(2);
    });

    test('creates lws_meta table and stores initialized_at metadata', () => {
        const tableCheck = memoryDb.prepare(
            'SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'lws_meta\'',
        ).get();
        expect(tableCheck).toBeDefined();
        expect(tableCheck.name).toBe('lws_meta');

        const row = memoryDb.prepare('SELECT value FROM lws_meta WHERE key = ?').get('initialized_at');
        expect(row).toBeDefined();
        expect(typeof row.value).toBe('string');
        expect(row.value.length).toBeGreaterThan(0);
    });

    test('creates all 9 Phase 2 authored tables', () => {
        const tables = memoryDb.prepare('SELECT name FROM sqlite_master WHERE type=\'table\'').all();
        const tableNames = tables.map(t => t.name);

        const expectedTables = [
            'lws_meta',
            'lws_worlds',
            'lws_characters',
            'lws_locations',
            'lws_factions',
            'lws_character_factions',
            'lws_world_rules',
            'lws_scenarios',
            'lws_scenario_characters',
            'lws_authored_prompt_configs',
        ];

        for (const t of expectedTables) {
            expect(tableNames).toContain(t);
        }
    });

    test('creates all 12 Phase 2 database triggers', () => {
        const triggers = memoryDb.prepare('SELECT name FROM sqlite_master WHERE type=\'trigger\'').all();
        const triggerNames = triggers.map(t => t.name);

        const expectedTriggers = [
            'trg_lws_character_factions_same_world_insert',
            'trg_lws_character_factions_same_world_update',
            'trg_lws_scenarios_location_same_world_insert',
            'trg_lws_scenarios_location_same_world_update',
            'trg_lws_scenario_characters_same_world_insert',
            'trg_lws_scenario_characters_same_world_update',
            'trg_lws_characters_world_id_immutable',
            'trg_lws_locations_world_id_immutable',
            'trg_lws_factions_world_id_immutable',
            'trg_lws_world_rules_world_id_immutable',
            'trg_lws_scenarios_world_id_immutable',
            'trg_lws_prompt_configs_world_id_immutable',
        ];

        expect(triggerNames).toHaveLength(expectedTriggers.length);
        for (const trg of expectedTriggers) {
            expect(triggerNames).toContain(trg);
        }
    });

    test('migrations are idempotent and do not fail or alter version when re-executed', () => {
        const versionBefore = memoryDb.pragma('user_version', { simple: true });
        expect(versionBefore).toBe(2);

        const versionAfter = runMigrations(memoryDb);
        expect(versionAfter).toBe(2);

        const count = memoryDb.prepare('SELECT COUNT(*) as cnt FROM lws_meta').get();
        expect(count.cnt).toBe(1);
    });

    test('enforces PRAGMA foreign_keys = ON on authored tables', () => {
        const fk = memoryDb.pragma('foreign_keys', { simple: true });
        expect(fk).toBe(1);

        // Attempting to insert a character referencing a non-existent world must fail
        expect(() => {
            memoryDb.prepare(`
                INSERT INTO lws_characters (
                    lws_id, world_id, name, created_at, updated_at
                ) VALUES ('00000000-0000-0000-0000-000000000001', 99999, 'Orphan', '2026-01-01', '2026-01-01')
            `).run();
        }).toThrow(/FOREIGN KEY constraint failed/);
    });

    test('enables WAL journal mode on file-backed database', () => {
        const { db, cleanup } = createFileTestDb('lws-wal-test-');
        try {
            const journalMode = db.pragma('journal_mode', { simple: true });
            expect(String(journalMode).toLowerCase()).toBe('wal');
        } finally {
            cleanup();
        }
    });

    test('persists schema and data across restart on file-backed database', () => {
        const { db, dbPath, cleanup } = createFileTestDb('lws-restart-test-');
        try {
            db.prepare('INSERT INTO lws_meta (key, value) VALUES (\'test_key\', \'test_val\')').run();
            db.close();

            // Reopen the same file
            const reopenedDb = new Database(dbPath);
            const userVersion = reopenedDb.pragma('user_version', { simple: true });
            expect(userVersion).toBe(2);

            const row = reopenedDb.prepare('SELECT value FROM lws_meta WHERE key = ?').get('test_key');
            expect(row?.value).toBe('test_val');
            reopenedDb.close();
        } finally {
            cleanup();
        }
    });

    test('LWS database contains only LWS tables and is strictly isolated from ST chat storage', () => {
        const tables = memoryDb.prepare('SELECT name FROM sqlite_master WHERE type=\'table\'').all();
        const tableNames = tables.map(t => t.name);

        expect(tableNames).toContain('lws_meta');
        expect(tableNames).toContain('lws_worlds');
        expect(tableNames).toContain('lws_characters');
        expect(tableNames).not.toContain('chats');
        expect(tableNames).not.toContain('characters');
        expect(tableNames).not.toContain('settings');
        expect(tableNames).not.toContain('groups');
        expect(tableNames).not.toContain('worldinfo');
    });
});
