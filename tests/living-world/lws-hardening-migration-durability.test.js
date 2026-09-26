import Database from 'better-sqlite3';
import { runMigrations, MIGRATIONS } from '../../src/living-world/migrations/index.js';

describe('LWS Phase 13 Hardening — Migration Durability & Schema Catalog Verification', () => {
    let db;

    beforeEach(() => {
        db = new Database(':memory:');
        db.pragma('foreign_keys = ON');
    });

    afterEach(() => {
        if (db) db.close();
    });

    test('executes migrations sequentially from 001 to 009 reaching schema version 9', () => {
        expect(MIGRATIONS).toHaveLength(9);
        const finalVersion = runMigrations(db);
        expect(finalVersion).toBe(9);
        expect(Number(db.pragma('user_version', { simple: true }))).toBe(9);
    });

    test('verifies exact schema catalog counts: 36 user tables, 106 triggers, 61 user indexes', () => {
        runMigrations(db);

        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
        expect(tables).toHaveLength(36);

        const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
        expect(triggers).toHaveLength(106);

        const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
        expect(indexes).toHaveLength(61);
    });

    test('verifies complete idempotency when running migrations repeatedly on v9 database', () => {
        runMigrations(db);
        expect(Number(db.pragma('user_version', { simple: true }))).toBe(9);

        // Re-run migrations 3 times
        const vAgain1 = runMigrations(db);
        expect(vAgain1).toBe(9);

        const vAgain2 = runMigrations(db);
        expect(vAgain2).toBe(9);

        // Catalog counts remain strictly unchanged
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
        expect(tables).toHaveLength(36);

        const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all();
        expect(triggers).toHaveLength(106);
    });

    test('supports step-wise target version migration execution (0 -> 5 -> 9)', () => {
        const v5 = runMigrations(db, 5);
        expect(v5).toBe(5);
        expect(Number(db.pragma('user_version', { simple: true }))).toBe(5);

        const tablesV5 = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
        expect(tablesV5).toHaveLength(16);

        const v9 = runMigrations(db, 9);
        expect(v9).toBe(9);
        expect(Number(db.pragma('user_version', { simple: true }))).toBe(9);

        const tablesV9 = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
        expect(tablesV9).toHaveLength(36);
    });
});
