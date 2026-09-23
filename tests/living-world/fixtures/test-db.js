import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import Database from 'better-sqlite3';
import { runMigrations } from '../../../src/living-world/migrations/index.js';

/**
 * Creates an in-memory SQLite database instance with migrations applied.
 * Useful for fast domain/schema tests where WAL persistence is not required.
 *
 * @returns {Database.Database}
 */
export function createInMemoryTestDb() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    runMigrations(db);
    return db;
}

/**
 * Convenient alias for createInMemoryTestDb.
 * @returns {Database.Database}
 */
export function createTestDb() {
    return createInMemoryTestDb();
}

/**
 * Closes an open database connection safely.
 * @param {Database.Database} db
 */
export function closeTestDb(db) {
    if (db && db.open) {
        db.close();
    }
}

/**
 * Creates a temporary file-backed SQLite database instance with migrations applied.
 * Essential for testing WAL mode, file durability, and process restart scenarios.
 *
 * @param {string} [prefix='lws-test-db-']
 * @returns {{ db: Database.Database, dirPath: string, dbPath: string, cleanup: () => void }}
 */
export function createFileTestDb(prefix = 'lws-test-db-') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const dbPath = path.join(tmpDir, 'test-lws.db');

    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    runMigrations(db);

    const cleanup = () => {
        try {
            if (db.open) {
                db.close();
            }
        } catch (err) {
            void err;
        }
        try {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (err) {
            void err;
        }
    };

    return { db, dirPath: tmpDir, dbPath, cleanup };
}
