import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import { isValidUuid, generateDeterministicUuid, isoNow } from '../authored/common.js';

export const VALID_SOURCE_CHANNELS = Object.freeze([
    'perception',
    'communication',
    'evidence',
    'backstory',
    'director_injection',
    'inference',
]);

/**
 * Validates source channel against closed enum.
 * @param {string} channel
 * @returns {string}
 */
export function validateSourceChannel(channel) {
    if (!VALID_SOURCE_CHANNELS.includes(channel)) {
        throw new LwsValidationError(
            `Invalid source_channel: '${channel}'. Must be one of: ${VALID_SOURCE_CHANNELS.join(', ')}`,
            ['source_channel'],
        );
    }
    return channel;
}

/**
 * Formats a knowledge database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
function formatKnowledge(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        fact_key: row.fact_key,
        content: row.content,
        source_channel: row.source_channel,
        source_character_lws_id: row.source_character_lws_id ?? null,
        source_event_lws_id: row.source_event_lws_id ?? null,
        fictional_time_acquired: row.fictional_time_acquired,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Lists active knowledge facts for a character in a simulation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} charLwsId
 * @param {object} [options]
 * @returns {Array<object>}
 */
export function listCharacterKnowledge(db, charLwsId, options = {}) {
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }

    const char = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ? AND deleted_at IS NULL').get(charLwsId);
    if (!char) {
        throw new LwsNotFoundError('Character not found');
    }

    let query = `
        SELECT
            k.*,
            sc_src.lws_id AS source_character_lws_id,
            e_src.lws_id AS source_event_lws_id
        FROM lws_character_knowledge k
        LEFT JOIN lws_simulation_characters sc_src ON k.source_character_id = sc_src.id
        LEFT JOIN lws_events e_src ON k.source_event_id = e_src.id
        WHERE k.simulation_character_id = ? AND k.deleted_at IS NULL
    `;
    const params = [char.id];

    if (options.source_channel) {
        query += ' AND k.source_channel = ?';
        params.push(options.source_channel);
    }

    if (options.fact_key) {
        query += ' AND k.fact_key = ?';
        params.push(options.fact_key);
    }

    query += ' ORDER BY k.fictional_time_acquired DESC, k.id ASC';

    if (options.limit) {
        query += ' LIMIT ?';
        params.push(Number(options.limit));
    }

    const rows = db.prepare(query).all(...params);
    return rows.map(formatKnowledge);
}

/**
 * Retrieves a single fact by key for a character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} charLwsId
 * @param {string} factKey
 * @returns {object}
 */
export function getCharacterFact(db, charLwsId, factKey) {
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }
    if (!factKey || typeof factKey !== 'string') {
        throw new LwsValidationError('factKey is required', ['factKey']);
    }

    const char = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ? AND deleted_at IS NULL').get(charLwsId);
    if (!char) {
        throw new LwsNotFoundError('Character not found');
    }

    const row = db.prepare(`
        SELECT
            k.*,
            sc_src.lws_id AS source_character_lws_id,
            e_src.lws_id AS source_event_lws_id
        FROM lws_character_knowledge k
        LEFT JOIN lws_simulation_characters sc_src ON k.source_character_id = sc_src.id
        LEFT JOIN lws_events e_src ON k.source_event_id = e_src.id
        WHERE k.simulation_character_id = ? AND k.fact_key = ? AND k.deleted_at IS NULL
    `).get(char.id, factKey.trim());

    if (!row) {
        throw new LwsNotFoundError(`Fact '${factKey}' not found for character`);
    }

    return formatKnowledge(row);
}

/**
 * Upserts a knowledge fact for a simulation character.
 * Uses deterministic SHA-256 derived UUID from (charLwsId, factKey).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} factData
 * @returns {object}
 */
export function upsertCharacterKnowledge(db, {
    simulation_id,
    simulation_character_id,
    char_lws_id,
    fact_key,
    content,
    source_channel,
    source_character_id = null,
    source_event_id = null,
    fictional_time_acquired,
    created_at = isoNow(),
    updated_at = isoNow(),
}) {
    validateSourceChannel(source_channel);
    const key = fact_key.trim();
    const lwsId = generateDeterministicUuid('knowledge', char_lws_id, key);

    const stmt = db.prepare(`
        INSERT INTO lws_character_knowledge (
            lws_id, simulation_id, simulation_character_id, fact_key, content,
            source_channel, source_character_id, source_event_id,
            fictional_time_acquired, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(simulation_character_id, fact_key) DO UPDATE SET
            content = excluded.content,
            source_channel = excluded.source_channel,
            source_character_id = excluded.source_character_id,
            source_event_id = excluded.source_event_id,
            fictional_time_acquired = excluded.fictional_time_acquired,
            updated_at = excluded.updated_at,
            deleted_at = NULL
    `);

    stmt.run(
        lwsId,
        simulation_id,
        simulation_character_id,
        key,
        content,
        source_channel,
        source_character_id,
        source_event_id,
        fictional_time_acquired,
        created_at,
        updated_at,
    );

    return getCharacterFact(db, char_lws_id, key);
}

/**
 * Soft-deletes a fact from character knowledge.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} charLwsId
 * @param {string} factKey
 * @param {string} [deletedAt=isoNow()]
 */
export function softDeleteCharacterKnowledge(db, charLwsId, factKey, deletedAt = isoNow()) {
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }
    const char = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ? AND deleted_at IS NULL').get(charLwsId);
    if (!char) {
        throw new LwsNotFoundError('Character not found');
    }

    db.prepare(`
        UPDATE lws_character_knowledge
        SET deleted_at = ?, updated_at = ?
        WHERE simulation_character_id = ? AND fact_key = ? AND deleted_at IS NULL
    `).run(deletedAt, deletedAt, char.id, factKey.trim());
}
