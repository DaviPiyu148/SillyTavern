import path from 'node:path';
import fs from 'node:fs';
import process from 'node:process';
import Database from 'better-sqlite3';
import { runMigrations } from './migrations/index.js';
import { LwsNotInitializedError } from './errors.js';

export const LWS_DATA_SUBDIR = 'living-world';
export const LWS_DB_FILENAME = 'lws.db';

/** @type {Database.Database | null} */
let db = null;
let isAvailable = false;
let lastError = null;

/**
 * Resolves the default absolute path to the LWS SQLite database file.
 * Stored under DATA_ROOT/living-world/lws.db.
 * @returns {string}
 */
export function getDefaultDbPath() {
    const dataRoot = globalThis.DATA_ROOT || path.join(process.cwd(), 'data');
    return path.join(dataRoot, LWS_DATA_SUBDIR, LWS_DB_FILENAME);
}

/**
 * Opens and initializes the LWS SQLite database.
 * If opening or configuration fails, any partially opened handle is safely closed,
 * LWS is marked unavailable, and the error is recorded.
 *
 * @param {string} [customPath] Optional explicit database path (e.g. for testing)
 * @returns {Database.Database} The opened and migrated database handle
 */
export function openDb(customPath = null) {
    if (db && isAvailable) {
        return db;
    }

    const dbPath = customPath || getDefaultDbPath();
    const isMemory = dbPath === ':memory:';

    if (!isMemory) {
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }

    let candidateDb = null;
    try {
        candidateDb = new Database(dbPath);

        // Configure SQLite pragmas
        if (!isMemory) {
            candidateDb.pragma('journal_mode = WAL');
        }
        candidateDb.pragma('foreign_keys = ON');

        // Execute migrations
        runMigrations(candidateDb);

        db = candidateDb;
        isAvailable = true;
        lastError = null;
        return db;
    } catch (err) {
        if (candidateDb) {
            try {
                candidateDb.close();
            } catch (_) {
                // Ignore cleanup errors during failure handling
            }
        }
        db = null;
        isAvailable = false;
        lastError = err;
        console.error('[LWS] Failed to initialize database:', err);
        throw err;
    }
}

/**
 * Closes the LWS database connection cleanly and releases the handle.
 */
export function closeDb() {
    if (db) {
        try {
            db.close();
        } catch (err) {
            console.error('[LWS] Error during database close:', err);
        } finally {
            db = null;
            isAvailable = false;
        }
    }
}

/**
 * Returns the active SQLite database instance.
 * Throws LwsNotInitializedError if the subsystem is unavailable.
 *
 * @returns {Database.Database}
 */
export function getDb() {
    if (!db || !isAvailable) {
        throw new LwsNotInitializedError();
    }
    return db;
}

/**
 * Returns the current schema version, or null if unavailable.
 * @returns {number | null}
 */
export function getDbVersion() {
    if (!db || !isAvailable) {
        return null;
    }
    return Number(db.pragma('user_version', { simple: true }) ?? 0);
}

/**
 * Returns true if the database is open, migrated, and ready for queries.
 * @returns {boolean}
 */
export function isDbAvailable() {
    return isAvailable && db !== null;
}

/**
 * Returns the last initialization error, if any.
 * @returns {Error | null}
 */
export function getLastError() {
    return lastError;
}
