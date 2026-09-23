import { up as migration001Up } from './001_initial.js';

/**
 * Ordered list of all LWS migrations.
 * Each entry has:
 * - version: strictly increasing integer (matching SQLite PRAGMA user_version)
 * - name: human-readable migration identifier
 * - up: function(db) executing the migration DDL/DML
 */
export const MIGRATIONS = Object.freeze([
    {
        version: 1,
        name: '001_initial',
        up: migration001Up,
    },
]);

/**
 * Runs all pending migrations against the given database.
 * Executes each migration within an atomic transaction.
 * PRAGMA user_version is updated only after the migration succeeds.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {number} The current schema version after migrations
 */
export function runMigrations(db) {
    const currentVersion = Number(db.pragma('user_version', { simple: true }) ?? 0);

    for (const migration of MIGRATIONS) {
        if (migration.version > currentVersion) {
            const applyMigration = db.transaction(() => {
                migration.up(db);
                db.pragma(`user_version = ${migration.version}`);
            });

            applyMigration();
            console.log(`[LWS] Applied migration ${migration.name} (version ${migration.version})`);
        }
    }

    return Number(db.pragma('user_version', { simple: true }) ?? 0);
}
