import { getDb } from '../db.js';

/**
 * Executes administrative system diagnostics against the active LWS SQLite database.
 * Restricted to administrative access context.
 *
 * @param {import('better-sqlite3').Database} [customDb]
 * @returns {object} System diagnostic results
 */
export function getSystemDiagnostics(customDb = null) {
    const db = customDb || getDb();

    // 1. Structural SQLite Integrity Check
    const integrityRows = db.pragma('integrity_check');
    const integrityOk = integrityRows.length === 1 && (integrityRows[0].integrity_check === 'ok' || integrityRows[0] === 'ok');

    // 2. Referential Foreign Key Check
    const fkErrors = db.pragma('foreign_key_check');
    const foreignKeysOk = Array.isArray(fkErrors) && fkErrors.length === 0;

    // 3. Active Triggers Inventory
    const triggers = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();

    // 4. User Tables Inventory and Row Counts
    const userTables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const tableCounts = {};
    for (const t of userTables) {
        try {
            const countRow = db.prepare(`SELECT COUNT(*) AS total FROM ${t.name}`).get();
            tableCounts[t.name] = countRow?.total ?? 0;
        } catch (err) {
            tableCounts[t.name] = -1;
        }
    }

    // 5. User-Created Indexes Inventory
    const userIndexes = db.prepare("SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();

    // 6. Targeted Orphan Referential Integrity Checks
    const orphanResults = {
        orphaned_sim_characters: 0,
        orphaned_events: 0,
        orphaned_faction_memberships: 0,
        orphaned_relationships: 0,
    };

    try {
        orphanResults.orphaned_sim_characters = db.prepare(`
            SELECT COUNT(*) AS total FROM lws_simulation_characters sc
            LEFT JOIN lws_simulations s ON sc.simulation_id = s.id
            WHERE s.id IS NULL
        `).get().total;

        orphanResults.orphaned_events = db.prepare(`
            SELECT COUNT(*) AS total FROM lws_events e
            LEFT JOIN lws_simulations s ON e.simulation_id = s.id
            WHERE s.id IS NULL
        `).get().total;

        orphanResults.orphaned_faction_memberships = db.prepare(`
            SELECT COUNT(*) AS total FROM lws_character_faction_memberships fm
            LEFT JOIN lws_simulations s ON fm.simulation_id = s.id
            WHERE s.id IS NULL
        `).get().total;

        orphanResults.orphaned_relationships = db.prepare(`
            SELECT COUNT(*) AS total FROM lws_character_relationships r
            LEFT JOIN lws_simulations s ON r.simulation_id = s.id
            WHERE s.id IS NULL
        `).get().total;
    } catch (_) {
        // Safe fallback if partial tables exist
    }

    const schemaVersion = Number(db.pragma('user_version', { simple: true }) ?? 0);

    return {
        integrity_ok: integrityOk,
        integrity_details: integrityOk ? ['ok'] : integrityRows.map(r => r.integrity_check || String(r)),
        foreign_keys_ok: foreignKeysOk,
        foreign_key_errors_count: fkErrors.length,
        schema_version: schemaVersion,
        triggers_active: triggers.length,
        triggers_list: triggers.map(t => t.name),
        user_tables_count: userTables.length,
        tables: tableCounts,
        user_indexes_count: userIndexes.length,
        orphan_checks: orphanResults,
        timestamp: new Date().toISOString(),
    };
}
