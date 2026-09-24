import { LwsValidationError, LwsNotFoundError } from '../errors.js';
import { isValidUuid, safeJsonParse } from '../authored/common.js';
import { validateFictionalTimestamp } from '../simulations/common.js';

/**
 * Validates a scheduled event's input parameters.
 *
 * @param {object} input
 * @param {string} currentFictionalTime
 * @returns {object} Normalized input
 */
export function validateScheduledEventInput(input, currentFictionalTime) {
    if (!input || typeof input !== 'object') {
        throw new LwsValidationError('Scheduled event input must be an object', ['input']);
    }

    if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) {
        throw new LwsValidationError('Title is required and must not exceed 200 characters', ['title']);
    }
    const title = input.title.trim();

    const scheduledTime = validateFictionalTimestamp(input.scheduled_fictional_time, 'scheduled_fictional_time');
    if (scheduledTime < currentFictionalTime) {
        throw new LwsValidationError(
            `scheduled_fictional_time (${scheduledTime}) cannot precede simulation current fictional time (${currentFictionalTime})`,
            ['scheduled_fictional_time'],
        );
    }

    const description = typeof input.description === 'string' ? input.description.trim() : '';

    let payload = {};
    if (input.payload !== undefined) {
        if (typeof input.payload === 'object' && input.payload !== null && !Array.isArray(input.payload)) {
            payload = input.payload;
        } else {
            throw new LwsValidationError('Payload must be a JSON object', ['payload']);
        }
    }

    const targetLocationLwsId = input.target_location_id || null;
    if (targetLocationLwsId && !isValidUuid(targetLocationLwsId)) {
        throw new LwsValidationError('target_location_id must be a valid UUID', ['target_location_id']);
    }

    return {
        title,
        scheduled_fictional_time: scheduledTime,
        description,
        target_location_id: targetLocationLwsId,
        payload,
    };
}

/**
 * Retrieves scheduled events for a simulation with public UUIDs.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {object} [filter]
 * @returns {Array<object>}
 */
export function getScheduledEvents(db, simId, filter = {}) {
    let sql = `
        SELECT se.*,
               loc.lws_id AS target_location_lws_id,
               pred.lws_id AS supersedes_event_lws_id,
               succ.lws_id AS superseded_by_event_lws_id,
               trg_ev.lws_id AS trigger_event_lws_id,
               can_ev.lws_id AS cancel_event_lws_id
        FROM lws_scheduled_events se
        LEFT JOIN lws_locations loc ON se.target_location_id = loc.id
        LEFT JOIN lws_scheduled_events pred ON se.supersedes_event_id = pred.id
        LEFT JOIN lws_scheduled_events succ ON se.superseded_by_event_id = succ.id
        LEFT JOIN lws_events trg_ev ON se.trigger_event_id = trg_ev.id
        LEFT JOIN lws_events can_ev ON se.cancel_event_id = can_ev.id
        WHERE se.simulation_id = ?
    `;
    const params = [simId];

    if (filter.status) {
        sql += ' AND se.status = ?';
        params.push(filter.status);
    }

    if (filter.fromTime) {
        sql += ' AND se.scheduled_fictional_time >= ?';
        params.push(filter.fromTime);
    }

    if (filter.toTime) {
        sql += ' AND se.scheduled_fictional_time <= ?';
        params.push(filter.toTime);
    }

    sql += ' ORDER BY se.scheduled_fictional_time ASC, se.title ASC, se.id ASC';

    const rows = db.prepare(sql).all(...params);
    return rows.map(formatScheduledEventRow);
}

/**
 * Retrieves a single scheduled event by lws_id.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {string} eventLwsId
 * @returns {object}
 */
export function getScheduledEventByLwsId(db, simId, eventLwsId) {
    if (!isValidUuid(eventLwsId)) {
        throw new LwsValidationError('Invalid scheduled event UUID format', ['eventLwsId']);
    }

    const row = db.prepare(`
        SELECT se.*,
               loc.lws_id AS target_location_lws_id,
               pred.lws_id AS supersedes_event_lws_id,
               succ.lws_id AS superseded_by_event_lws_id,
               trg_ev.lws_id AS trigger_event_lws_id,
               can_ev.lws_id AS cancel_event_lws_id
        FROM lws_scheduled_events se
        LEFT JOIN lws_locations loc ON se.target_location_id = loc.id
        LEFT JOIN lws_scheduled_events pred ON se.supersedes_event_id = pred.id
        LEFT JOIN lws_scheduled_events succ ON se.superseded_by_event_id = succ.id
        LEFT JOIN lws_events trg_ev ON se.trigger_event_id = trg_ev.id
        LEFT JOIN lws_events can_ev ON se.cancel_event_id = can_ev.id
        WHERE se.simulation_id = ? AND se.lws_id = ?
    `).get(simId, eventLwsId);

    if (!row) {
        throw new LwsNotFoundError(`Scheduled event '${eventLwsId}' not found`);
    }

    return formatScheduledEventRow(row);
}

/**
 * Formats a raw database row into an external DTO with JSON payload and public UUIDs.
 *
 * @param {object} row
 * @returns {object}
 */
export function formatScheduledEventRow(row) {
    return {
        lws_id: row.lws_id,
        scheduled_fictional_time: row.scheduled_fictional_time,
        title: row.title,
        description: row.description,
        target_location_id: row.target_location_lws_id || null,
        payload: safeJsonParse(row.payload, {}),
        status: row.status,
        supersedes_event_id: row.supersedes_event_lws_id || null,
        superseded_by_event_id: row.superseded_by_event_lws_id || null,
        trigger_event_id: row.trigger_event_lws_id || null,
        cancel_event_id: row.cancel_event_lws_id || null,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}
