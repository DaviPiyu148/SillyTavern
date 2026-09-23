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

    test('applies migration 001 and sets PRAGMA user_version to 1', () => {
        const userVersion = memoryDb.pragma('user_version', { simple: true });
        expect(userVersion).toBe(1);
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

    test('migrations are idempotent and do not fail or alter version when re-executed', () => {
        const versionBefore = memoryDb.pragma('user_version', { simple: true });
        expect(versionBefore).toBe(1);

        const versionAfter = runMigrations(memoryDb);
        expect(versionAfter).toBe(1);

        const count = memoryDb.prepare('SELECT COUNT(*) as cnt FROM lws_meta').get();
        expect(count.cnt).toBe(1);
    });

    test('enforces PRAGMA foreign_keys = ON', () => {
        const fk = memoryDb.pragma('foreign_keys', { simple: true });
        expect(fk).toBe(1);

        // Verify foreign key enforcement behavior
        memoryDb.exec(`
            CREATE TABLE parent (id INTEGER PRIMARY KEY);
            CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id));
        `);

        expect(() => {
            memoryDb.prepare('INSERT INTO child (id, parent_id) VALUES (1, 999)').run();
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
            expect(userVersion).toBe(1);

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
        expect(tableNames).not.toContain('chats');
        expect(tableNames).not.toContain('characters');
        expect(tableNames).not.toContain('settings');
        expect(tableNames).not.toContain('groups');
        expect(tableNames).not.toContain('worldinfo');
    });
});
