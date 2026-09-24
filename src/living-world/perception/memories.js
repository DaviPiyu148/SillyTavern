import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import { isValidUuid, generateDeterministicUuid, isoNow, safeJsonParse } from '../authored/common.js';
import { validateSourceChannel } from './knowledge.js';

export const VALID_MEMORY_TYPES = Object.freeze(['episodic', 'semantic', 'backstory']);
export const VALID_MEMORY_STATUSES = Object.freeze(['vivid', 'fading', 'consolidated', 'distorted']);

/**
 * Formats a memory database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
export function formatMemory(row) {
    if (!row) return null;
    const tags = safeJsonParse(row.tags, []);
    return {
        lws_id: row.lws_id,
        character_lws_id: row.character_lws_id ?? undefined,
        summary: row.summary,
        description: row.summary,
        details: row.details,
        reflection_notes: row.details,
        memory_type: row.memory_type,
        event_lws_id: row.event_lws_id ?? null,
        fictional_time: row.fictional_time,
        fictional_time_recorded: row.fictional_time,
        emotional_salience: row.emotional_salience,
        salience: row.emotional_salience / 100.0,
        importance: row.importance / 100.0,
        confidence: row.confidence,
        status: row.status,
        tags,
        sentiment_tags: tags,
        source_channel: row.source_channel,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at ?? null,
    };
}

/**
 * Lists active memories for a character with optional filters.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} charLwsId
 * @param {object} [options]
 * @returns {Array<object>}
 */
export function listCharacterMemories(db, charLwsId, options = {}) {
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
            m.*,
            sc.lws_id AS character_lws_id,
            e.lws_id AS event_lws_id
        FROM lws_character_memories m
        JOIN lws_simulation_characters sc ON m.simulation_character_id = sc.id
        LEFT JOIN lws_events e ON m.event_id = e.id
        WHERE m.simulation_character_id = ?
    `;
    if (!includeDeleted) {
        query += ' AND m.deleted_at IS NULL';
    }
    const params = [char.id];

    if (options.min_salience !== undefined) {
        query += ' AND m.emotional_salience >= ?';
        params.push(Number(options.min_salience));
    }

    if (options.memory_type) {
        query += ' AND m.memory_type = ?';
        params.push(options.memory_type);
    }

    if (options.status) {
        query += ' AND m.status = ?';
        params.push(options.status);
    }

    query += ' ORDER BY m.fictional_time DESC, m.id DESC';

    if (options.limit) {
        query += ' LIMIT ?';
        params.push(Math.min(Math.max(1, Number(options.limit)), 100));
    }

    const rows = db.prepare(query).all(...params);
    return rows.map(formatMemory);
}

/**
 * Creates and persists a character memory.
 * Uses deterministic UUID when event_lws_id is supplied.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} params
 * @returns {object}
 */
export function createCharacterMemory(db, {
    simulation_id,
    simulation_character_id,
    char_lws_id,
    simulation_character_lws_id,
    summary,
    description,
    details = '',
    memory_type = 'episodic',
    event_id = null,
    event_lws_id = null,
    fictional_time,
    fictional_time_recorded,
    emotional_salience,
    salience,
    importance,
    confidence = 100,
    status = 'vivid',
    tags,
    sentiment_tags,
    source_channel = 'perception',
    slot_index = 0,
    created_at = isoNow(),
    updated_at = isoNow(),
    explicit_lws_id = null,
}) {
    validateSourceChannel(source_channel);

    const charLws = char_lws_id || simulation_character_lws_id;
    if (!simulation_character_id && charLws) {
        const charRow = db.prepare('SELECT id, simulation_id, lws_id FROM lws_simulation_characters WHERE lws_id = ?').get(charLws);
        if (charRow) {
            simulation_character_id = charRow.id;
            simulation_id = simulation_id || charRow.simulation_id;
            char_lws_id = charRow.lws_id;
        }
    }

    if (!simulation_id || !simulation_character_id) {
        throw new LwsValidationError('simulation_id and simulation_character_id are required', ['simulation_character_id']);
    }

    if (!VALID_MEMORY_TYPES.includes(memory_type)) {
        throw new LwsValidationError(`Invalid memory_type: ${memory_type}`, ['memory_type']);
    }
    if (!VALID_MEMORY_STATUSES.includes(status)) {
        throw new LwsValidationError(`Invalid memory status: ${status}`, ['status']);
    }

    const effectiveSummary = summary || description || '';
    const effectiveFictionalTime = fictional_time || fictional_time_recorded || isoNow();

    let effSalience = 50;
    if (emotional_salience !== undefined) {
        effSalience = Number(emotional_salience);
    } else if (salience !== undefined) {
        effSalience = salience <= 1 && salience > 0 ? Math.round(salience * 100) : Number(salience);
    }
    effSalience = Math.min(100, Math.max(1, effSalience || 50));

    let effImportance = 50;
    if (importance !== undefined) {
        effImportance = importance <= 1 && importance > 0 ? Math.round(importance * 100) : Number(importance);
    }
    effImportance = Math.min(100, Math.max(1, effImportance || 50));

    const lwsId = explicit_lws_id || (event_lws_id
        ? generateDeterministicUuid('memory', event_lws_id, char_lws_id, String(slot_index))
        : generateDeterministicUuid('memory', char_lws_id, effectiveFictionalTime, effectiveSummary.slice(0, 32)));

    const tagArray = Array.isArray(tags) ? tags : (Array.isArray(sentiment_tags) ? sentiment_tags : []);

    const stmt = db.prepare(`
        INSERT INTO lws_character_memories (
            lws_id, simulation_id, simulation_character_id, summary, details,
            memory_type, event_id, fictional_time, emotional_salience, importance,
            confidence, status, tags, source_channel, created_at, updated_at, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `);

    stmt.run(
        lwsId,
        simulation_id,
        simulation_character_id,
        effectiveSummary,
        details,
        memory_type,
        event_id,
        effectiveFictionalTime,
        effSalience,
        effImportance,
        Math.min(100, Math.max(1, Number(confidence) || 100)),
        status,
        JSON.stringify(tagArray),
        source_channel,
        created_at,
        updated_at,
    );

    const inserted = db.prepare(`
        SELECT m.*, sc.lws_id AS character_lws_id, e.lws_id AS event_lws_id
        FROM lws_character_memories m
        JOIN lws_simulation_characters sc ON m.simulation_character_id = sc.id
        LEFT JOIN lws_events e ON m.event_id = e.id
        WHERE m.lws_id = ?
    `).get(lwsId);

    return formatMemory(inserted);
}

const IMMUTABLE_MEMORY_FIELDS = Object.freeze([
    'lws_id', 'simulation_id', 'simulation_character_id', 'event_id', 'event_lws_id',
    'causal_event_id', 'fictional_time', 'fictional_time_recorded', 'source_channel', 'created_at',
]);

/**
 * Patches mutable fields of a character memory via DIRECTOR_MODIFY_STATE.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} arg1 memoryLwsId or charLwsId
 * @param {string|object} arg2 patch or memoryLwsId
 * @param {object} [arg3] patch if 4 args
 * @param {string} [arg4] updatedAt
 * @returns {object}
 */
export function patchCharacterMemory(db, arg1, arg2, arg3, arg4) {
    let memoryLwsId = arg1;
    let patch = arg2;
    let updatedAt = isoNow();

    if (typeof arg2 === 'string' && typeof arg3 === 'object') {
        memoryLwsId = arg2;
        patch = arg3;
        updatedAt = arg4 || isoNow();
    } else if (typeof arg3 === 'string') {
        updatedAt = arg3;
    }

    if (!isValidUuid(memoryLwsId)) {
        throw new LwsValidationError('Invalid memory UUID format', ['memoryLwsId']);
    }

    for (const field of IMMUTABLE_MEMORY_FIELDS) {
        if (patch && patch[field] !== undefined) {
            throw new LwsValidationError(`Cannot modify immutable memory field '${field}'`, [field]);
        }
    }

    const current = db.prepare('SELECT * FROM lws_character_memories WHERE lws_id = ?').get(memoryLwsId);
    if (!current) {
        throw new LwsNotFoundError('Memory not found');
    }

    const nextSummary = patch.summary !== undefined ? String(patch.summary) : (patch.description !== undefined ? String(patch.description) : current.summary);
    const nextDetails = patch.details !== undefined ? String(patch.details) : (patch.reflection_notes !== undefined ? String(patch.reflection_notes) : current.details);

    let nextSalience = current.emotional_salience;
    if (patch.emotional_salience !== undefined) {
        nextSalience = Math.min(100, Math.max(1, Number(patch.emotional_salience)));
    } else if (patch.salience !== undefined) {
        nextSalience = patch.salience <= 1 && patch.salience > 0 ? Math.round(patch.salience * 100) : Number(patch.salience);
        nextSalience = Math.min(100, Math.max(1, nextSalience));
    }

    let nextImportance = current.importance;
    if (patch.importance !== undefined) {
        nextImportance = patch.importance <= 1 && patch.importance > 0 ? Math.round(patch.importance * 100) : Number(patch.importance);
        nextImportance = Math.min(100, Math.max(1, nextImportance));
    }

    const nextConfidence = patch.confidence !== undefined
        ? Math.min(100, Math.max(1, Number(patch.confidence)))
        : current.confidence;
    const nextStatus = patch.status !== undefined ? String(patch.status) : current.status;
    const nextTags = patch.tags !== undefined ? JSON.stringify(patch.tags) : (patch.sentiment_tags !== undefined ? JSON.stringify(patch.sentiment_tags) : current.tags);

    let nextDeletedAt = current.deleted_at;
    if (patch.deleted_at !== undefined) {
        nextDeletedAt = patch.deleted_at;
    }

    db.prepare(`
        UPDATE lws_character_memories
        SET summary = ?, details = ?, emotional_salience = ?, importance = ?,
            confidence = ?, status = ?, tags = ?, deleted_at = ?, updated_at = ?
        WHERE id = ?
    `).run(
        nextSummary,
        nextDetails,
        nextSalience,
        nextImportance,
        nextConfidence,
        nextStatus,
        nextTags,
        nextDeletedAt,
        updatedAt,
        current.id,
    );

    const updated = db.prepare(`
        SELECT m.*, sc.lws_id AS character_lws_id, e.lws_id AS event_lws_id
        FROM lws_character_memories m
        JOIN lws_simulation_characters sc ON m.simulation_character_id = sc.id
        LEFT JOIN lws_events e ON m.event_id = e.id
        WHERE m.id = ?
    `).get(current.id);

    const formatted = formatMemory(updated);
    if (updated.deleted_at) {
        formatted.is_deleted = 1;
    }
    return formatted;
}
