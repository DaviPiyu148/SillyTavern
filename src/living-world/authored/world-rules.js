import { getDb } from '../db.js';
import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import {
    generateUuid,
    isValidUuid,
    isoNow,
    validateTextField,
    validateInteger,
    ensureActiveWorld,
} from './common.js';

/**
 * Formats a database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
function formatWorldRule(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        sort_order: row.sort_order,
        title: row.title,
        body: row.body,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Creates and persists an authored WorldRule in a World.
 * @param {string} worldLwsId
 * @param {object} input
 * @param {string} [input.title='']
 * @param {string} input.body
 * @param {number} [input.sort_order=0]
 * @returns {object} The created WorldRule
 */
export function createWorldRule(worldLwsId, input = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const title = validateTextField(input.title, 'title', 255);
    const body = validateTextField(input.body, 'body', 65535, true);
    if (!body.trim()) {
        throw new LwsValidationError('body cannot be blank', ['body']);
    }
    const sortOrder = validateInteger(input.sort_order, 'sort_order', 0);

    const lwsId = generateUuid();
    const now = isoNow();

    const stmt = db.prepare(`
        INSERT INTO lws_world_rules (lws_id, world_id, sort_order, title, body, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(lwsId, world.id, sortOrder, title, body, now, now);

    return getWorldRuleByLwsId(worldLwsId, lwsId);
}

/**
 * Retrieves an active WorldRule by UUID within an active World.
 * @param {string} worldLwsId
 * @param {string} ruleLwsId
 * @returns {object}
 */
export function getWorldRuleByLwsId(worldLwsId, ruleLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(ruleLwsId)) {
        throw new LwsValidationError('Invalid world rule UUID format', ['ruleLwsId']);
    }

    const row = db.prepare(`
        SELECT * FROM lws_world_rules
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(ruleLwsId, world.id);

    if (!row) {
        throw new LwsNotFoundError('World rule not found');
    }

    return formatWorldRule(row);
}

/**
 * Lists active WorldRules in a World, ordered by sort_order ASC, id ASC.
 * @param {string} worldLwsId
 * @param {object} [options]
 * @param {boolean} [options.includeDeleted=false]
 * @returns {object[]}
 */
export function listWorldRules(worldLwsId, options = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const sql = options.includeDeleted
        ? 'SELECT * FROM lws_world_rules WHERE world_id = ? ORDER BY sort_order ASC, id ASC'
        : 'SELECT * FROM lws_world_rules WHERE world_id = ? AND deleted_at IS NULL ORDER BY sort_order ASC, id ASC';

    const rows = db.prepare(sql).all(world.id);
    return rows.map(formatWorldRule);
}

/**
 * Updates an active WorldRule.
 * @param {string} worldLwsId
 * @param {string} ruleLwsId
 * @param {object} patch
 * @returns {object} The updated WorldRule
 */
export function updateWorldRule(worldLwsId, ruleLwsId, patch = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(ruleLwsId)) {
        throw new LwsValidationError('Invalid world rule UUID format', ['ruleLwsId']);
    }

    const current = db.prepare(`
        SELECT * FROM lws_world_rules
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(ruleLwsId, world.id);

    if (!current) {
        throw new LwsNotFoundError('World rule not found');
    }

    const title = patch.title !== undefined ? validateTextField(patch.title, 'title', 255) : current.title;
    let body = current.body;
    if (patch.body !== undefined) {
        body = validateTextField(patch.body, 'body', 65535, true);
        if (!body.trim()) {
            throw new LwsValidationError('body cannot be blank', ['body']);
        }
    }
    const sortOrder = patch.sort_order !== undefined ? validateInteger(patch.sort_order, 'sort_order', 0) : current.sort_order;
    const now = isoNow();

    const stmt = db.prepare(`
        UPDATE lws_world_rules
        SET title = ?, body = ?, sort_order = ?, updated_at = ?
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `);

    stmt.run(title, body, sortOrder, now, ruleLwsId, world.id);

    return getWorldRuleByLwsId(worldLwsId, ruleLwsId);
}

/**
 * Soft-deletes a WorldRule.
 * @param {string} worldLwsId
 * @param {string} ruleLwsId
 * @returns {boolean}
 */
export function deleteWorldRule(worldLwsId, ruleLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(ruleLwsId)) {
        throw new LwsValidationError('Invalid world rule UUID format', ['ruleLwsId']);
    }

    const row = db.prepare(`
        SELECT id FROM lws_world_rules
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(ruleLwsId, world.id);

    if (!row) {
        throw new LwsNotFoundError('World rule not found');
    }

    const now = isoNow();
    const result = db.prepare(`
        UPDATE lws_world_rules SET deleted_at = ?, updated_at = ?
        WHERE id = ?
    `).run(now, now, row.id);

    return result.changes > 0;
}
