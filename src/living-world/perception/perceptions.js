import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import { isValidUuid } from '../authored/common.js';

/**
 * Retrieves all perception records for a given event.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} eventLwsId
 * @returns {Array<object>}
 */
export function getEventPerceptions(db, eventLwsId) {
    if (!isValidUuid(eventLwsId)) {
        throw new LwsValidationError('Invalid event UUID format', ['eventLwsId']);
    }

    const event = db.prepare('SELECT id FROM lws_events WHERE lws_id = ?').get(eventLwsId);
    if (!event) {
        throw new LwsNotFoundError('Event not found');
    }

    const rows = db.prepare(`
        SELECT
            p.lws_id,
            p.sensory_modality,
            p.perceived_at_fictional_time,
            p.created_at,
            sc.lws_id AS character_lws_id,
            c.name AS character_name
        FROM lws_event_perceptions p
        JOIN lws_simulation_characters sc ON p.simulation_character_id = sc.id
        JOIN lws_characters c ON sc.character_id = c.id
        WHERE p.event_id = ?
        ORDER BY p.id ASC
    `).all(event.id);

    return rows.map(r => ({
        lws_id: r.lws_id,
        character_lws_id: r.character_lws_id,
        character_name: r.character_name,
        sensory_modality: r.sensory_modality,
        perceived_at_fictional_time: r.perceived_at_fictional_time,
        created_at: r.created_at,
    }));
}

/**
 * Retrieves historical perceptions for a specific character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} charLwsId
 * @param {object} [options]
 * @param {number} [options.limit=50]
 * @param {string} [options.sinceTime]
 * @returns {Array<object>}
 */
export function getCharacterPerceptions(db, charLwsId, options = {}) {
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }

    const char = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ? AND deleted_at IS NULL').get(charLwsId);
    if (!char) {
        throw new LwsNotFoundError('Character not found');
    }

    const limit = Math.min(Math.max(1, Number(options.limit) || 50), 200);

    let query = `
        SELECT
            p.lws_id,
            p.sensory_modality,
            p.perceived_at_fictional_time,
            p.created_at,
            e.lws_id AS event_lws_id,
            e.event_type,
            e.payload
        FROM lws_event_perceptions p
        JOIN lws_events e ON p.event_id = e.id
        WHERE p.simulation_character_id = ?
    `;
    const params = [char.id];

    if (options.sinceTime) {
        query += ' AND p.perceived_at_fictional_time >= ?';
        params.push(options.sinceTime);
    }

    query += ' ORDER BY p.perceived_at_fictional_time DESC, p.id DESC LIMIT ?';
    params.push(limit);

    const rows = db.prepare(query).all(...params);

    return rows.map(r => ({
        lws_id: r.lws_id,
        event_lws_id: r.event_lws_id,
        event_type: r.event_type,
        sensory_modality: r.sensory_modality,
        perceived_at_fictional_time: r.perceived_at_fictional_time,
        created_at: r.created_at,
    }));
}
