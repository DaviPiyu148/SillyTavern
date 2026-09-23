import { getDb } from '../db.js';
import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import {
    generateUuid,
    isValidUuid,
    isoNow,
    validateName,
    validateTextField,
    validateTags,
    validateExtensions,
    safeJsonParse,
} from './common.js';

/**
 * Formats a database row for public presentation.
 * Strips internal id and deleted_at.
 * @param {object} row
 * @returns {object}
 */
function formatWorld(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        name: row.name,
        description: row.description,
        tags: safeJsonParse(row.tags, []),
        extensions: safeJsonParse(row.extensions, {}),
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Creates and persists a new World entity.
 * @param {object} input
 * @param {string} input.name
 * @param {string} [input.description='']
 * @param {string[]} [input.tags=[]]
 * @param {Record<string, unknown>} [input.extensions={}]
 * @returns {object} The created World
 */
export function createWorld(input = {}) {
    const db = getDb();
    const name = validateName(input.name, 'name');
    const description = validateTextField(input.description, 'description');
    const tags = validateTags(input.tags);
    const extensions = validateExtensions(input.extensions);

    const lwsId = generateUuid();
    const now = isoNow();

    const stmt = db.prepare(`
        INSERT INTO lws_worlds (lws_id, name, description, tags, extensions, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(lwsId, name, description, JSON.stringify(tags), JSON.stringify(extensions), now, now);

    return getWorldByLwsId(lwsId);
}

/**
 * Retrieves a World by its UUID.
 * @param {string} lwsId
 * @returns {object}
 */
export function getWorldByLwsId(lwsId) {
    const db = getDb();
    if (!isValidUuid(lwsId)) {
        throw new LwsValidationError('Invalid UUID format', ['lwsId']);
    }

    const row = db.prepare(
        'SELECT * FROM lws_worlds WHERE lws_id = ? AND deleted_at IS NULL',
    ).get(lwsId);

    if (!row) {
        throw new LwsNotFoundError('World not found');
    }

    return formatWorld(row);
}

/**
 * Lists all non-deleted Worlds.
 * @param {object} [options]
 * @param {boolean} [options.includeDeleted=false]
 * @returns {object[]}
 */
export function listWorlds(options = {}) {
    const db = getDb();
    const sql = options.includeDeleted
        ? 'SELECT * FROM lws_worlds ORDER BY name ASC'
        : 'SELECT * FROM lws_worlds WHERE deleted_at IS NULL ORDER BY name ASC';

    const rows = db.prepare(sql).all();
    return rows.map(formatWorld);
}

/**
 * Updates a World's editable fields.
 * lws_id and created_at are immutable.
 * @param {string} lwsId
 * @param {object} patch
 * @returns {object} The updated World
 */
export function updateWorld(lwsId, patch = {}) {
    const db = getDb();
    if (!isValidUuid(lwsId)) {
        throw new LwsValidationError('Invalid UUID format', ['lwsId']);
    }

    // Ensure world exists and is active
    const current = db.prepare(
        'SELECT * FROM lws_worlds WHERE lws_id = ? AND deleted_at IS NULL',
    ).get(lwsId);

    if (!current) {
        throw new LwsNotFoundError('World not found');
    }

    const name = patch.name !== undefined ? validateName(patch.name, 'name') : current.name;
    const description = patch.description !== undefined ? validateTextField(patch.description, 'description') : current.description;
    const tags = patch.tags !== undefined ? validateTags(patch.tags) : safeJsonParse(current.tags, []);
    const extensions = patch.extensions !== undefined ? validateExtensions(patch.extensions) : safeJsonParse(current.extensions, {});
    const now = isoNow();

    const stmt = db.prepare(`
        UPDATE lws_worlds
        SET name = ?, description = ?, tags = ?, extensions = ?, updated_at = ?
        WHERE lws_id = ? AND deleted_at IS NULL
    `);

    stmt.run(name, description, JSON.stringify(tags), JSON.stringify(extensions), now, lwsId);

    return getWorldByLwsId(lwsId);
}

/**
 * Soft-deletes a World by setting deleted_at.
 * Does not physically delete child records.
 * @param {string} lwsId
 * @returns {boolean} True if deleted
 */
export function deleteWorld(lwsId) {
    const db = getDb();
    if (!isValidUuid(lwsId)) {
        throw new LwsValidationError('Invalid UUID format', ['lwsId']);
    }

    const row = db.prepare(
        'SELECT id FROM lws_worlds WHERE lws_id = ? AND deleted_at IS NULL',
    ).get(lwsId);

    if (!row) {
        throw new LwsNotFoundError('World not found');
    }

    const now = isoNow();
    const result = db.prepare(
        'UPDATE lws_worlds SET deleted_at = ?, updated_at = ? WHERE id = ?',
    ).run(now, now, row.id);

    return result.changes > 0;
}
