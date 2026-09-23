/**
 * Living World Simulator (LWS) - Migration 001: Initial Metadata Schema
 *
 * Establishes Phase 1 metadata storage for the LWS subsystem.
 * Future phases will add domain-specific tables (authored worlds, characters, runtime state, etc.).
 *
 * @param {import('better-sqlite3').Database} db
 */
export function up(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS lws_meta (
            key   TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );
        INSERT OR REPLACE INTO lws_meta (key, value)
        VALUES ('initialized_at', datetime('now'));
    `);
}
