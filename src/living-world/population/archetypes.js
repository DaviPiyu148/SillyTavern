/**
 * Living World Simulator (LWS) - Authored Ambient Archetypes Service
 */

import { generateUuid } from '../authored/common.js';
import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import { ENTITY_KINDS } from './common.js';

/**
 * Formats raw archetype database row.
 *
 * @param {object} row
 * @returns {object}
 */
export function formatArchetypeRow(row) {
    if (!row) return null;

    let namePool = [];
    let defaultActivities = [];
    let locationTags = [];
    let timeWindows = ['morning', 'afternoon', 'evening'];
    let weatherCompat = null;

    try {
        namePool = typeof row.name_pool === 'string' ? JSON.parse(row.name_pool) : (row.name_pool || []);
    } catch { namePool = []; }

    try {
        defaultActivities = typeof row.default_activities === 'string' ? JSON.parse(row.default_activities) : (row.default_activities || []);
    } catch { defaultActivities = []; }

    try {
        locationTags = typeof row.location_tags === 'string' ? JSON.parse(row.location_tags) : (row.location_tags || []);
    } catch { locationTags = []; }

    try {
        timeWindows = typeof row.time_windows === 'string' ? JSON.parse(row.time_windows) : (row.time_windows || []);
    } catch { timeWindows = ['morning', 'afternoon', 'evening']; }

    if (row.weather_compat) {
        try {
            weatherCompat = typeof row.weather_compat === 'string' ? JSON.parse(row.weather_compat) : row.weather_compat;
        } catch { weatherCompat = null; }
    }

    return {
        id: row.id,
        lws_id: row.lws_id,
        world_id: row.world_id,
        archetype_key: row.archetype_key,
        entity_kind: row.entity_kind,
        role_title: row.role_title,
        name: row.role_title,
        name_pool: namePool,
        description_template: row.description_template,
        description: row.description_template,
        default_activities: defaultActivities,
        activity_pool: defaultActivities,
        location_tags: locationTags,
        location_filter_tags: locationTags,
        time_windows: timeWindows,
        time_filter_buckets: timeWindows,
        weather_compat: weatherCompat,
        spawn_weight: row.spawn_weight,
        weight: row.spawn_weight,
        max_concurrent_instances: row.max_concurrent_instances,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
    };
}

/**
 * Creates an authored ambient archetype in a world.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number|string} worldId
 * @param {object} data
 * @returns {object}
 */
export function createAmbientArchetype(db, worldId, data) {
    if (!data.archetype_key || typeof data.archetype_key !== 'string') {
        throw new LwsValidationError('archetype_key is required and must be a string', ['archetype_key']);
    }

    let numericWorldId = worldId;
    if (typeof worldId === 'string') {
        const w = db.prepare('SELECT id FROM lws_worlds WHERE lws_id = ?').get(worldId);
        if (w) numericWorldId = w.id;
    }

    const roleTitle = data.role_title || data.name || (Array.isArray(data.roles) && data.roles[0]) || data.archetype_key;
    const descTemplate = data.description_template || data.description || `${roleTitle} in the world`;
    const spawnWeight = data.spawn_weight ?? data.weight ?? 50;
    const maxInstances = data.max_concurrent_instances ?? 1;

    if (data.entity_kind && !ENTITY_KINDS.includes(data.entity_kind)) {
        throw new LwsValidationError(`Invalid entity_kind: ${data.entity_kind}`, ['entity_kind']);
    }
    if (typeof spawnWeight !== 'number' || spawnWeight < 1 || spawnWeight > 100) {
        throw new LwsValidationError('spawn_weight must be an integer between 1 and 100', ['spawn_weight']);
    }
    if (typeof maxInstances !== 'number' || maxInstances < 1) {
        throw new LwsValidationError('max_concurrent_instances must be an integer >= 1', ['max_concurrent_instances']);
    }

    const lwsId = generateUuid();
    const entityKind = data.entity_kind || 'person';
    const namePool = JSON.stringify(data.name_pool || []);
    const defaultActivities = JSON.stringify(data.default_activities || data.activity_pool || []);
    const locationTags = JSON.stringify(data.location_tags || data.location_filter_tags || []);
    const timeWindows = JSON.stringify(data.time_windows || data.time_filter_buckets || ['morning', 'afternoon', 'evening']);
    const weatherCompat = data.weather_compat ? JSON.stringify(data.weather_compat) : null;
    const now = new Date().toISOString();

    db.prepare(`
        INSERT INTO lws_ambient_archetypes (
            lws_id, world_id, archetype_key, entity_kind, role_title,
            name_pool, description_template, default_activities,
            location_tags, time_windows, weather_compat, spawn_weight,
            max_concurrent_instances, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        lwsId,
        numericWorldId,
        data.archetype_key,
        entityKind,
        roleTitle,
        namePool,
        descTemplate,
        defaultActivities,
        locationTags,
        timeWindows,
        weatherCompat,
        spawnWeight,
        maxInstances,
        now,
        now,
    );

    const row = db.prepare('SELECT * FROM lws_ambient_archetypes WHERE lws_id = ?').get(lwsId);
    return formatArchetypeRow(row);
}

/**
 * Gets an ambient archetype by LWS ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} lwsId
 * @returns {object}
 */
export function getAmbientArchetypeByLwsId(db, lwsId) {
    const row = db.prepare(`
        SELECT * FROM lws_ambient_archetypes
        WHERE lws_id = ? AND deleted_at IS NULL
    `).get(String(lwsId));

    if (!row) {
        throw new LwsNotFoundError(`Ambient archetype '${lwsId}' not found`);
    }

    return formatArchetypeRow(row);
}

/**
 * Gets an ambient archetype by key or ID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number|string} worldId
 * @param {string|number} [keyOrId]
 * @returns {object}
 */
export function getAmbientArchetype(db, worldId, keyOrId) {
    if (keyOrId === undefined) {
        return getAmbientArchetypeByLwsId(db, worldId);
    }

    let numericWorldId = worldId;
    if (typeof worldId === 'string') {
        const w = db.prepare('SELECT id FROM lws_worlds WHERE lws_id = ?').get(worldId);
        if (w) {
            numericWorldId = w.id;
        } else {
            throw new LwsNotFoundError(`World '${worldId}' not found`);
        }
    }

    let row;
    if (typeof keyOrId === 'number' || /^\d+$/.test(String(keyOrId))) {
        row = db.prepare(`
            SELECT * FROM lws_ambient_archetypes
            WHERE id = ? AND world_id = ? AND deleted_at IS NULL
        `).get(Number(keyOrId), numericWorldId);
    } else if (String(keyOrId).includes('-')) {
        row = db.prepare(`
            SELECT * FROM lws_ambient_archetypes
            WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
        `).get(String(keyOrId), numericWorldId);
    } else {
        row = db.prepare(`
            SELECT * FROM lws_ambient_archetypes
            WHERE archetype_key = ? AND world_id = ? AND deleted_at IS NULL
        `).get(String(keyOrId), numericWorldId);
    }

    if (!row) {
        throw new LwsNotFoundError(`Ambient archetype '${keyOrId}' not found in world ${worldId}`);
    }

    return formatArchetypeRow(row);
}

/**
 * Lists ambient archetypes in a world.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number|string} worldId
 * @param {object} [filter={}]
 * @returns {object[]}
 */
export function listAmbientArchetypes(db, worldId, filter = {}) {
    let numericWorldId = worldId;
    if (typeof worldId === 'string') {
        const w = db.prepare('SELECT id FROM lws_worlds WHERE lws_id = ?').get(worldId);
        if (w) numericWorldId = w.id;
    }

    let sql = 'SELECT * FROM lws_ambient_archetypes WHERE world_id = ? AND deleted_at IS NULL';
    const params = [numericWorldId];

    if (filter.entity_kind) {
        sql += ' AND entity_kind = ?';
        params.push(filter.entity_kind);
    }

    sql += ' ORDER BY spawn_weight DESC, id ASC';

    const rows = db.prepare(sql).all(...params);
    return rows.map(formatArchetypeRow);
}

/**
 * Updates an ambient archetype.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number|string} worldIdOrLwsId
 * @param {string|number|object} keyOrIdOrUpdates
 * @param {object} [maybeUpdates]
 * @returns {object}
 */
export function updateAmbientArchetype(db, worldIdOrLwsId, keyOrIdOrUpdates, maybeUpdates = {}) {
    let existing;
    let updates;
    if (typeof keyOrIdOrUpdates === 'string') {
        existing = getAmbientArchetype(db, worldIdOrLwsId, keyOrIdOrUpdates);
        updates = maybeUpdates || {};
    } else if (typeof keyOrIdOrUpdates === 'object' && keyOrIdOrUpdates !== null) {
        existing = getAmbientArchetypeByLwsId(db, worldIdOrLwsId);
        updates = keyOrIdOrUpdates;
    } else {
        existing = getAmbientArchetypeByLwsId(db, worldIdOrLwsId);
        updates = maybeUpdates || {};
    }

    const entityKind = updates.entity_kind ?? existing.entity_kind ?? 'person';
    const roleTitle = updates.role_title ?? updates.name ?? (Array.isArray(updates.roles) ? updates.roles[0] : undefined) ?? existing.role_title ?? 'Unnamed';
    const descTemplate = updates.description_template ?? updates.description ?? existing.description_template ?? '';
    const namePool = Array.isArray(updates.name_pool)
        ? JSON.stringify(updates.name_pool)
        : (Array.isArray(existing.name_pool) ? JSON.stringify(existing.name_pool) : '[]');
    const defaultActivities = Array.isArray(updates.default_activities || updates.activity_pool)
        ? JSON.stringify(updates.default_activities || updates.activity_pool)
        : (Array.isArray(existing.default_activities) ? JSON.stringify(existing.default_activities) : '[]');
    const locationTags = Array.isArray(updates.location_tags || updates.location_filter_tags)
        ? JSON.stringify(updates.location_tags || updates.location_filter_tags)
        : (Array.isArray(existing.location_tags) ? JSON.stringify(existing.location_tags) : '[]');
    const timeWindows = Array.isArray(updates.time_windows || updates.time_filter_buckets)
        ? JSON.stringify(updates.time_windows || updates.time_filter_buckets)
        : (Array.isArray(existing.time_windows) ? JSON.stringify(existing.time_windows) : '["morning","afternoon","evening"]');
    const weatherCompat = updates.weather_compat !== undefined
        ? (updates.weather_compat ? JSON.stringify(updates.weather_compat) : null)
        : (existing.weather_compat ? JSON.stringify(existing.weather_compat) : null);
    const spawnWeight = updates.spawn_weight ?? updates.weight ?? existing.spawn_weight ?? 50;
    const maxInstances = updates.max_concurrent_instances ?? existing.max_concurrent_instances ?? 1;
    const now = new Date().toISOString();

    db.prepare(`
        UPDATE lws_ambient_archetypes
        SET entity_kind = ?,
            role_title = ?,
            description_template = ?,
            name_pool = ?,
            default_activities = ?,
            location_tags = ?,
            time_windows = ?,
            weather_compat = ?,
            spawn_weight = ?,
            max_concurrent_instances = ?,
            updated_at = ?
        WHERE id = ?
    `).run(
        entityKind,
        roleTitle,
        descTemplate,
        namePool,
        defaultActivities,
        locationTags,
        timeWindows,
        weatherCompat,
        spawnWeight,
        maxInstances,
        now,
        existing.id,
    );

    const updated = db.prepare('SELECT * FROM lws_ambient_archetypes WHERE id = ?').get(existing.id);
    return formatArchetypeRow(updated);
}

/**
 * Soft deletes an ambient archetype.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number|string} worldIdOrLwsId
 * @param {string|number} [maybeKeyOrId]
 */
export function deleteAmbientArchetype(db, worldIdOrLwsId, maybeKeyOrId) {
    let existing;
    if (maybeKeyOrId === undefined) {
        existing = getAmbientArchetypeByLwsId(db, worldIdOrLwsId);
    } else {
        existing = getAmbientArchetype(db, worldIdOrLwsId, maybeKeyOrId);
    }
    const now = new Date().toISOString();

    db.prepare(`
        UPDATE lws_ambient_archetypes
        SET deleted_at = ?, updated_at = ?
        WHERE id = ?
    `).run(now, now, existing.id);
}

