import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import {
    DEVELOPMENT_CATEGORIES,
    TRIGGER_CATEGORIES,
    clamp,
    formatDevelopmentRecord,
    generateDeterministicUuid,
    isValidUuid,
    safeJsonParse,
} from './common.js';
import { updateCharacterValue } from '../cognition/values.js';

const TRIGGER_EVENT_TYPES = Object.freeze({
    acute_trauma: ['COMBAT_ACTION', 'UPDATE_PHYSICAL_CONDITION'],
    sustained_experience: ['TIME_ADVANCE', 'REST', 'WORK', 'CONSUME_ITEM'],
    social_reinforcement: ['COMMUNICATE', 'TRANSFER_ITEM', 'COMBAT_ACTION', 'GENERAL_ACTION'],
    cognitive_dissonance: ['OBSERVE', 'COMMUNICATE', 'INTERACT_OBJECT'],
    director_override: null,
});

/**
 * Validates development causality rules against the event ledger.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {object} devData
 * @param {object} [event]
 * @param {object} [charRow]
 * @returns {string[]} Validated causal event UUID array
 */
export function validateDevelopmentCausality(db, simId, devData = {}, event = null, charRow = null) {
    if (!devData || typeof devData !== 'object') {
        throw new LwsValidationError('Development payload must be an object', ['development']);
    }

    const triggerCategory = devData.trigger_category;
    if (!TRIGGER_CATEGORIES.includes(triggerCategory)) {
        throw new LwsValidationError(`Invalid trigger_category '${triggerCategory}'`, ['trigger_category']);
    }

    const dimensionCategory = devData.dimension_category;
    if (!DEVELOPMENT_CATEGORIES.includes(dimensionCategory)) {
        throw new LwsValidationError(`Invalid dimension_category '${dimensionCategory}'`, ['dimension_category']);
    }

    if (!devData.dimension_key || typeof devData.dimension_key !== 'string') {
        throw new LwsValidationError('dimension_key is required', ['dimension_key']);
    }

    const stability = Number(devData.stability ?? 50);
    if (!Number.isInteger(stability) || stability < 1 || stability > 100) {
        throw new LwsValidationError('stability must be an integer between 1 and 100', ['stability']);
    }

    // Parse causal_event_ids
    let causalUuids = [];
    if (Array.isArray(devData.causal_event_ids)) {
        causalUuids = devData.causal_event_ids;
    } else if (typeof devData.causal_event_ids === 'string') {
        try {
            causalUuids = JSON.parse(devData.causal_event_ids);
            if (!Array.isArray(causalUuids)) {
                throw new Error('Not an array');
            }
        } catch {
            throw new LwsValidationError('causal_event_ids must be a valid JSON array', ['causal_event_ids']);
        }
    } else if (triggerCategory === 'director_override' && (event?.lws_id || devData.causal_event_id)) {
        causalUuids = [event?.lws_id || String(devData.causal_event_id)];
    }

    // Rule 1: Non-director overrides MUST have non-empty causal_event_ids (>= 1)
    if (triggerCategory !== 'director_override') {
        if (!Array.isArray(causalUuids) || causalUuids.length === 0) {
            throw new LwsValidationError('causal_event_ids cannot be empty for non-director development', ['causal_event_ids']);
        }
    } else if (causalUuids.length === 0 && event?.lws_id) {
        causalUuids = [event.lws_id];
    }

    const recordTime = devData.fictional_time || event?.fictional_time;

    // Rule 2: Verify each referenced event exists, belongs to same sim, and is chronological
    for (const evUuid of causalUuids) {
        if (!isValidUuid(evUuid)) {
            throw new LwsValidationError(`Invalid event UUID '${evUuid}' in causal_event_ids`, ['causal_event_ids']);
        }

        const evRow = db.prepare('SELECT id, lws_id, simulation_id, event_type, actor_character_id, target_character_id, location_id, fictional_time FROM lws_events WHERE lws_id = ?').get(evUuid);
        if (!evRow) {
            throw new LwsValidationError(`Causal event '${evUuid}' not found in simulation`, ['causal_event_ids']);
        }
        if (evRow.simulation_id !== simId) {
            throw new LwsValidationError(`Referenced causal event '${evUuid}' belongs to a different simulation`, ['causal_event_ids']);
        }
        if (recordTime && evRow.fictional_time > recordTime) {
            throw new LwsValidationError(`Referenced causal event '${evUuid}' occurred after development record time`, ['causal_event_ids']);
        }

        if (triggerCategory !== 'director_override') {
            const allowedTypes = TRIGGER_EVENT_TYPES[triggerCategory];
            if (allowedTypes && !allowedTypes.includes(evRow.event_type)) {
                throw new LwsValidationError(`Referenced causal event type '${evRow.event_type}' is unrelated to trigger category '${triggerCategory}'`, ['causal_event_ids']);
            }

            if (charRow) {
                const isActor = evRow.actor_character_id === charRow.id;
                const isTarget = evRow.target_character_id === charRow.id;
                const isLocation = evRow.location_id && charRow.current_location_id && (evRow.location_id === charRow.current_location_id);
                const isGlobal = evRow.event_type === 'TIME_ADVANCE';

                if (!isActor && !isTarget && !isLocation && !isGlobal) {
                    throw new LwsValidationError(`Character was not involved in causal event '${evUuid}'`, ['causal_event_ids']);
                }
            }
        }
    }

    return causalUuids;
}

/**
 * Records a developmental change into the audit ledger and projects it onto runtime entities.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @param {object} [event]
 * @returns {object} Created DevelopmentRecord
 */
export function recordCharacterDevelopment(db, data, event = null) {
    const simId = data.simulation_id;
    const simLwsId = data.sim_lws_id;

    const charRow = typeof data.simulation_character_id === 'number'
        ? db.prepare('SELECT id, lws_id, current_location_id, runtime_state FROM lws_simulation_characters WHERE id = ? AND simulation_id = ?').get(data.simulation_character_id, simId)
        : db.prepare('SELECT id, lws_id, current_location_id, runtime_state FROM lws_simulation_characters WHERE lws_id = ? AND simulation_id = ?').get(data.simulation_character_id, simId);

    if (!charRow) {
        throw new LwsNotFoundError('Simulation character not found');
    }

    const validatedUuids = validateDevelopmentCausality(db, simId, data, event, charRow);

    const prevVal = Number(data.previous_value ?? 0);
    const newVal = Number(data.new_value ?? 0);
    const delta = data.delta !== undefined ? Number(data.delta) : (newVal - prevVal);
    const stability = clamp(Number(data.stability ?? 50), 1, 100);
    const fictionalTime = data.fictional_time || event?.fictional_time;
    const createdAt = data.created_at || new Date().toISOString();

    const lwsId = data.lws_id || generateDeterministicUuid(
        'dev_record',
        simLwsId,
        charRow.lws_id,
        data.dimension_key,
        validatedUuids[0] || fictionalTime,
    );

    // 1. Insert into immutable audit ledger
    const stmt = db.prepare(`
        INSERT INTO lws_character_development_records (
            lws_id, simulation_id, simulation_character_id, dimension_category,
            dimension_key, previous_value, new_value, delta, trigger_category,
            causal_event_ids, stability, fictional_time, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        lwsId,
        simId,
        charRow.id,
        data.dimension_category,
        data.dimension_key,
        prevVal,
        newVal,
        delta,
        data.trigger_category,
        JSON.stringify(validatedUuids),
        stability,
        fictionalTime,
        createdAt,
    );

    // 2. Dual-store projection
    if (data.dimension_category === 'value_shift') {
        updateCharacterValue(db, charRow.id, data.dimension_key, Math.round(newVal), createdAt);
    } else if (data.dimension_category === 'baseline_need_shift') {
        db.prepare(`
            UPDATE lws_character_needs
            SET decay_rate = ?, updated_at = ?
            WHERE simulation_character_id = ? AND need_name = ?
        `).run(Math.round(newVal), createdAt, charRow.id, data.dimension_key);
    } else if (data.dimension_category === 'disposition_shift' || data.dimension_category === 'habit_shift') {
        const currentRuntime = safeJsonParse(charRow.runtime_state, {});
        const propName = data.dimension_category === 'disposition_shift' ? 'dispositions' : 'habits';
        const currentSection = currentRuntime[propName] || {};
        currentSection[data.dimension_key] = newVal;
        currentRuntime[propName] = currentSection;

        db.prepare(`
            UPDATE lws_simulation_characters
            SET runtime_state = ?, updated_at = ?
            WHERE id = ?
        `).run(JSON.stringify(currentRuntime), createdAt, charRow.id);
    }

    return getDevelopmentRecord(db, simId, lwsId);
}

/**
 * Retrieves a single development record row by UUID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {string} devLwsId
 * @returns {object}
 */
export function getDevelopmentRecord(db, simId, devLwsId) {
    if (!isValidUuid(devLwsId)) {
        throw new LwsValidationError('Invalid development record UUID format', ['devLwsId']);
    }

    const row = db.prepare(`
        SELECT dr.*,
               s.lws_id AS simulation_lws_id,
               sc.lws_id AS simulation_character_lws_id
        FROM lws_character_development_records dr
        JOIN lws_simulations s ON dr.simulation_id = s.id
        JOIN lws_simulation_characters sc ON dr.simulation_character_id = sc.id
        WHERE dr.lws_id = ? AND dr.simulation_id = ?
    `).get(devLwsId, simId);

    if (!row) {
        throw new LwsNotFoundError('Development record not found');
    }

    return formatDevelopmentRecord(row);
}

/**
 * Lists all development records for a character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {number | string} simChar
 * @param {object} [options]
 * @returns {object[]}
 */
export function listCharacterDevelopmentRecords(db, simId, simChar, options = {}) {
    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) return [];
        resolvedSimId = s.id;
    }

    const charRow = typeof simChar === 'string'
        ? db.prepare('SELECT id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(simChar, simChar, resolvedSimId)
        : db.prepare('SELECT id FROM lws_simulation_characters WHERE id = ? AND simulation_id = ?').get(simChar, resolvedSimId);

    if (!charRow) return [];

    let sql = `
        SELECT dr.*,
               s.lws_id AS simulation_lws_id,
               sc.lws_id AS simulation_character_lws_id
        FROM lws_character_development_records dr
        JOIN lws_simulations s ON dr.simulation_id = s.id
        JOIN lws_simulation_characters sc ON dr.simulation_character_id = sc.id
        WHERE dr.simulation_id = ? AND dr.simulation_character_id = ?
    `;
    const params = [resolvedSimId, charRow.id];

    if (options.dimension_category) {
        sql += ' AND dr.dimension_category = ?';
        params.push(options.dimension_category);
    }

    sql += ' ORDER BY dr.fictional_time DESC, dr.id DESC';

    if (options.limit !== undefined) {
        sql += ' LIMIT ?';
        params.push(Number(options.limit));
        if (options.offset !== undefined) {
            sql += ' OFFSET ?';
            params.push(Number(options.offset));
        }
    }

    const rows = db.prepare(sql).all(...params);
    return rows.map(formatDevelopmentRecord);
}

export const listCharacterDevelopmentHistory = listCharacterDevelopmentRecords;

