import { up as migration001Up } from './001_initial.js';
import { up as migration002Up } from './002_authored_model.js';
import { up as migration003Up } from './003_simulation_runtime.js';
import { up as migration004Up } from './004_events_and_authority.js';
import { up as migration005Up } from './005_time_and_schedules.js';

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
    {
        version: 2,
        name: '002_authored_model',
        up: migration002Up,
    },
    {
        version: 3,
        name: '003_simulation_runtime',
        up: migration003Up,
    },
    {
        version: 4,
        name: '004_events_and_authority',
        up: migration004Up,
    },
    {
        version: 5,
        name: '005_time_and_schedules',
        up: migration005Up,
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
export function runMigrations(db, targetVersion = undefined) {
    const currentVersion = Number(db.pragma('user_version', { simple: true }) ?? 0);

    for (const migration of MIGRATIONS) {
        if (targetVersion !== undefined && migration.version > targetVersion) {
            break;
        }
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
