import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import { isValidUuid, generateDeterministicUuid, isoNow } from '../authored/common.js';

export const VALID_BELIEF_TYPES = Object.freeze(['belief', 'suspicion', 'hypothesis']);
export const VALID_SOURCE_BASES = Object.freeze([
    'observation',
    'hearsay',
    'deduction',
    'intuition',
    'deception',
    'backstory',
    'director_injection',
]);

/**
 * Validates belief type against closed enum.
 * @param {string} beliefType
 * @returns {string}
 */
export function validateBeliefType(beliefType) {
    if (!VALID_BELIEF_TYPES.includes(beliefType)) {
        throw new LwsValidationError(
            `Invalid belief_type: '${beliefType}'. Must be one of: ${VALID_BELIEF_TYPES.join(', ')}`,
            ['belief_type'],
        );
    }
    return beliefType;
}

/**
 * Validates source basis against closed enum.
 * @param {string} sourceBasis
 * @returns {string}
 */
export function validateSourceBasis(sourceBasis) {
    if (!VALID_SOURCE_BASES.includes(sourceBasis)) {
        throw new LwsValidationError(
            `Invalid source_basis: '${sourceBasis}'. Must be one of: ${VALID_SOURCE_BASES.join(', ')}`,
            ['source_basis'],
        );
    }
    return sourceBasis;
}

/**
 * Validates belief confidence integer range (1..100).
 * @param {number} confidence
 * @returns {number}
 */
export function validateConfidence(confidence) {
    if (confidence === undefined || confidence === null) {
        return 50;
    }
    const num = Number(confidence);
    if (!Number.isInteger(num) || num < 1 || num > 100) {
        throw new LwsValidationError(
            `confidence must be an integer between 1 and 100, received '${confidence}'`,
            ['confidence'],
        );
    }
    return num;
}

/**
 * Formats a belief database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
export function formatBelief(row) {
    if (!row) return null;
    let subject = row.subject_key;
    let predicate = row.subject_key;
    if (row.subject_key.includes(':')) {
        const parts = row.subject_key.split(':');
        subject = parts[0];
        predicate = parts.slice(1).join(':');
    }
    return {
        lws_id: row.lws_id,
        character_lws_id: row.character_lws_id ?? undefined,
        subject_key: row.subject_key,
        subject,
        predicate,
        belief_type: row.belief_type,
        statement: row.statement,
        object_value: row.statement,
        confidence: row.confidence,
        source_basis: row.source_basis,
        causal_event_lws_id: row.causal_event_lws_id ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at ?? null,
    };
}

/**
 * Lists active beliefs and suspicions for a character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} charLwsId
 * @param {object} [options]
 * @returns {Array<object>}
 */
export function listCharacterBeliefs(db, charLwsId, options = {}) {
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }

    const char = db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE lws_id = ? AND deleted_at IS NULL').get(charLwsId);
    if (!char) {
        throw new LwsNotFoundError('Character not found');
    }

    const includeDeleted = Boolean(options.includeDeleted || options.include_deleted);
    let query = `
        SELECT
            b.*,
            sc.lws_id AS character_lws_id,
            e.lws_id AS causal_event_lws_id
        FROM lws_character_beliefs b
        JOIN lws_simulation_characters sc ON b.simulation_character_id = sc.id
        LEFT JOIN lws_events e ON b.causal_event_id = e.id
        WHERE b.simulation_character_id = ?
    `;
    if (!includeDeleted) {
        query += ' AND b.deleted_at IS NULL';
    }
    const params = [char.id];

    if (options.belief_type) {
        query += ' AND b.belief_type = ?';
        params.push(options.belief_type);
    }

    query += ' ORDER BY b.updated_at DESC, b.id ASC';

    if (options.limit) {
        query += ' LIMIT ?';
        params.push(Math.min(Math.max(1, Number(options.limit)), 100));
    }

    const rows = db.prepare(query).all(...params);
    return rows.map(formatBelief);
}

/**
 * Retrieves a single belief by subject_key or (subject, predicate) for a character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} charLwsId
 * @param {string} arg2
 * @param {string} [arg3]
 * @returns {object}
 */
export function getCharacterBelief(db, charLwsId, arg2, arg3) {
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }
    const key = (arg3 !== undefined ? `${arg2}:${arg3}` : arg2);
    if (!key || typeof key !== 'string') {
        throw new LwsValidationError('subjectKey is required', ['subjectKey']);
    }

    const char = db.prepare('SELECT id, lws_id FROM lws_simulation_characters WHERE lws_id = ? AND deleted_at IS NULL').get(charLwsId);
    if (!char) {
        throw new LwsNotFoundError('Character not found');
    }

    const row = db.prepare(`
        SELECT
            b.*,
            sc.lws_id AS character_lws_id,
            e.lws_id AS causal_event_lws_id
        FROM lws_character_beliefs b
        JOIN lws_simulation_characters sc ON b.simulation_character_id = sc.id
        LEFT JOIN lws_events e ON b.causal_event_id = e.id
        WHERE b.simulation_character_id = ? AND b.subject_key = ? AND b.deleted_at IS NULL
    `).get(char.id, key.trim());

    if (!row) {
        throw new LwsNotFoundError(`Belief '${key}' not found for character`);
    }

    return formatBelief(row);
}

/**
 * Upserts a belief for a simulation character.
 * Uses deterministic SHA-256 derived UUID from (charLwsId, subjectKey).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} params
 * @returns {object}
 */
export function upsertCharacterBelief(db, {
    simulation_id,
    simulation_character_id,
    char_lws_id,
    subject_key,
    subject,
    predicate,
    statement,
    object_value,
    belief_type = 'belief',
    confidence = 50,
    source_basis = 'deduction',
    causal_event_id = null,
    created_at = isoNow(),
    updated_at = isoNow(),
}) {
    validateBeliefType(belief_type);
    validateSourceBasis(source_basis);
    const validConfidence = validateConfidence(confidence);

    const key = (subject_key || (predicate ? `${subject}:${predicate}` : subject) || '').trim();
    if (!key) {
        throw new LwsValidationError('subject_key is required', ['subject_key']);
    }
    const stmtText = statement !== undefined ? String(statement) : (object_value !== undefined ? String(object_value) : '');

    const lwsId = generateDeterministicUuid('belief', char_lws_id, key);

    const stmt = db.prepare(`
        INSERT INTO lws_character_beliefs (
            lws_id, simulation_id, simulation_character_id, subject_key, belief_type,
            statement, confidence, source_basis, causal_event_id, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(simulation_character_id, subject_key) DO UPDATE SET
            belief_type = excluded.belief_type,
            statement = excluded.statement,
            confidence = excluded.confidence,
            source_basis = excluded.source_basis,
            causal_event_id = excluded.causal_event_id,
            updated_at = excluded.updated_at,
            deleted_at = NULL
    `);

    stmt.run(
        lwsId,
        simulation_id,
        simulation_character_id,
        key,
        belief_type,
        stmtText,
        validConfidence,
        source_basis,
        causal_event_id,
        created_at,
        updated_at,
    );

    return getCharacterBelief(db, char_lws_id, key);
}

/**
 * Soft-deletes a belief for a character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} charLwsId
 * @param {string} arg2
 * @param {string} [arg3]
 * @param {string} [arg4]
 * @returns {boolean}
 */
export function softDeleteCharacterBelief(db, charLwsId, arg2, arg3, arg4) {
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }
    const char = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ? AND deleted_at IS NULL').get(charLwsId);
    if (!char) {
        throw new LwsNotFoundError('Character not found');
    }

    let key = arg2;
    let delTime = isoNow();

    if (typeof arg3 === 'string' && typeof arg4 === 'string') {
        key = `${arg2}:${arg3}`;
        delTime = arg4;
    } else if (typeof arg3 === 'string') {
        if (arg3.includes('T') || arg3.includes('-') && arg3.length > 10) {
            key = arg2;
            delTime = arg3;
        } else {
            key = `${arg2}:${arg3}`;
            delTime = isoNow();
        }
    }

    const info = db.prepare(`
        UPDATE lws_character_beliefs
        SET deleted_at = ?, updated_at = ?
        WHERE simulation_character_id = ? AND subject_key = ? AND deleted_at IS NULL
    `).run(delTime, delTime, char.id, key.trim());

    return info.changes > 0;
}
