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
    ensureActiveWorld,
    safeJsonParse,
} from './common.js';

/**
 * Formats a database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
function formatLocation(row) {
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
 * Creates and persists an authored Location in a World.
 * @param {string} worldLwsId
 * @param {object} input
 * @returns {object} The created Location
 */
export function createLocation(worldLwsId, input = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const name = validateName(input.name, 'name');
    const description = validateTextField(input.description, 'description');
    const tags = validateTags(input.tags);
    const extensions = validateExtensions(input.extensions);

    const lwsId = generateUuid();
    const now = isoNow();

    const stmt = db.prepare(`
        INSERT INTO lws_locations (lws_id, world_id, name, description, tags, extensions, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(lwsId, world.id, name, description, JSON.stringify(tags), JSON.stringify(extensions), now, now);

    return getLocationByLwsId(worldLwsId, lwsId);
}

/**
 * Retrieves an active Location by UUID within an active World.
 * @param {string} worldLwsId
 * @param {string} locLwsId
 * @returns {object}
 */
export function getLocationByLwsId(worldLwsId, locLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(locLwsId)) {
        throw new LwsValidationError('Invalid location UUID format', ['locLwsId']);
    }

    const row = db.prepare(`
        SELECT * FROM lws_locations
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(locLwsId, world.id);

    if (!row) {
        throw new LwsNotFoundError('Location not found');
    }

    return formatLocation(row);
}

/**
 * Lists active Locations in a World.
 * @param {string} worldLwsId
 * @param {object} [options]
 * @param {boolean} [options.includeDeleted=false]
 * @returns {object[]}
 */
export function listLocations(worldLwsId, options = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const sql = options.includeDeleted
        ? 'SELECT * FROM lws_locations WHERE world_id = ? ORDER BY name ASC'
        : 'SELECT * FROM lws_locations WHERE world_id = ? AND deleted_at IS NULL ORDER BY name ASC';

    const rows = db.prepare(sql).all(world.id);
    return rows.map(formatLocation);
}

/**
 * Updates an active Location.
 * @param {string} worldLwsId
 * @param {string} locLwsId
 * @param {object} patch
 * @returns {object} The updated Location
 */
export function updateLocation(worldLwsId, locLwsId, patch = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(locLwsId)) {
        throw new LwsValidationError('Invalid location UUID format', ['locLwsId']);
    }

    const current = db.prepare(`
        SELECT * FROM lws_locations
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(locLwsId, world.id);

    if (!current) {
        throw new LwsNotFoundError('Location not found');
    }

    const name = patch.name !== undefined ? validateName(patch.name, 'name') : current.name;
    const description = patch.description !== undefined ? validateTextField(patch.description, 'description') : current.description;
    const tags = patch.tags !== undefined ? validateTags(patch.tags) : safeJsonParse(current.tags, []);
    const extensions = patch.extensions !== undefined ? validateExtensions(patch.extensions) : safeJsonParse(current.extensions, {});
    const now = isoNow();

    const stmt = db.prepare(`
        UPDATE lws_locations
        SET name = ?, description = ?, tags = ?, extensions = ?, updated_at = ?
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `);

    stmt.run(name, description, JSON.stringify(tags), JSON.stringify(extensions), now, locLwsId, world.id);

    return getLocationByLwsId(worldLwsId, locLwsId);
}

/**
 * Soft-deletes a Location.
 * @param {string} worldLwsId
 * @param {string} locLwsId
 * @returns {boolean}
 */
export function deleteLocation(worldLwsId, locLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(locLwsId)) {
        throw new LwsValidationError('Invalid location UUID format', ['locLwsId']);
    }

    const row = db.prepare(`
        SELECT id FROM lws_locations
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(locLwsId, world.id);

    if (!row) {
        throw new LwsNotFoundError('Location not found');
    }

    const now = isoNow();
    const result = db.prepare(`
        UPDATE lws_locations SET deleted_at = ?, updated_at = ?
        WHERE id = ?
    `).run(now, now, row.id);

    return result.changes > 0;
}
