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
function formatFaction(row) {
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
 * Creates and persists an authored Faction in a World.
 * @param {string} worldLwsId
 * @param {object} input
 * @returns {object} The created Faction
 */
export function createFaction(worldLwsId, input = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const name = validateName(input.name, 'name');
    const description = validateTextField(input.description, 'description');
    const tags = validateTags(input.tags);
    const extensions = validateExtensions(input.extensions);

    const lwsId = generateUuid();
    const now = isoNow();

    const stmt = db.prepare(`
        INSERT INTO lws_factions (lws_id, world_id, name, description, tags, extensions, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(lwsId, world.id, name, description, JSON.stringify(tags), JSON.stringify(extensions), now, now);

    return getFactionByLwsId(worldLwsId, lwsId);
}

/**
 * Retrieves an active Faction by UUID within an active World.
 * @param {string} worldLwsId
 * @param {string} factionLwsId
 * @returns {object}
 */
export function getFactionByLwsId(worldLwsId, factionLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(factionLwsId)) {
        throw new LwsValidationError('Invalid faction UUID format', ['factionLwsId']);
    }

    const row = db.prepare(`
        SELECT * FROM lws_factions
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(factionLwsId, world.id);

    if (!row) {
        throw new LwsNotFoundError('Faction not found');
    }

    return formatFaction(row);
}

/**
 * Lists active Factions in a World.
 * @param {string} worldLwsId
 * @param {object} [options]
 * @param {boolean} [options.includeDeleted=false]
 * @returns {object[]}
 */
export function listFactions(worldLwsId, options = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const sql = options.includeDeleted
        ? 'SELECT * FROM lws_factions WHERE world_id = ? ORDER BY name ASC'
        : 'SELECT * FROM lws_factions WHERE world_id = ? AND deleted_at IS NULL ORDER BY name ASC';

    const rows = db.prepare(sql).all(world.id);
    return rows.map(formatFaction);
}

/**
 * Updates an active Faction.
 * @param {string} worldLwsId
 * @param {string} factionLwsId
 * @param {object} patch
 * @returns {object} The updated Faction
 */
export function updateFaction(worldLwsId, factionLwsId, patch = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(factionLwsId)) {
        throw new LwsValidationError('Invalid faction UUID format', ['factionLwsId']);
    }

    const current = db.prepare(`
        SELECT * FROM lws_factions
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(factionLwsId, world.id);

    if (!current) {
        throw new LwsNotFoundError('Faction not found');
    }

    const name = patch.name !== undefined ? validateName(patch.name, 'name') : current.name;
    const description = patch.description !== undefined ? validateTextField(patch.description, 'description') : current.description;
    const tags = patch.tags !== undefined ? validateTags(patch.tags) : safeJsonParse(current.tags, []);
    const extensions = patch.extensions !== undefined ? validateExtensions(patch.extensions) : safeJsonParse(current.extensions, {});
    const now = isoNow();

    const stmt = db.prepare(`
        UPDATE lws_factions
        SET name = ?, description = ?, tags = ?, extensions = ?, updated_at = ?
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `);

    stmt.run(name, description, JSON.stringify(tags), JSON.stringify(extensions), now, factionLwsId, world.id);

    return getFactionByLwsId(worldLwsId, factionLwsId);
}

/**
 * Soft-deletes a Faction.
 * @param {string} worldLwsId
 * @param {string} factionLwsId
 * @returns {boolean}
 */
export function deleteFaction(worldLwsId, factionLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(factionLwsId)) {
        throw new LwsValidationError('Invalid faction UUID format', ['factionLwsId']);
    }

    const row = db.prepare(`
        SELECT id FROM lws_factions
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(factionLwsId, world.id);

    if (!row) {
        throw new LwsNotFoundError('Faction not found');
    }

    const now = isoNow();
    const result = db.prepare(`
        UPDATE lws_factions SET deleted_at = ?, updated_at = ?
        WHERE id = ?
    `).run(now, now, row.id);

    return result.changes > 0;
}

/**
 * Adds an active Character as a member of an active Faction.
 * Disallows adding a soft-deleted Character.
 * @param {string} worldLwsId
 * @param {string} factionLwsId
 * @param {object} input
 * @param {string} input.character_lws_id
 * @param {string} [input.role='']
 * @returns {object}
 */
export function addFactionMember(worldLwsId, factionLwsId, input = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(factionLwsId)) {
        throw new LwsValidationError('Invalid faction UUID format', ['factionLwsId']);
    }

    const faction = db.prepare(`
        SELECT id, world_id FROM lws_factions
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(factionLwsId, world.id);

    if (!faction) {
        throw new LwsNotFoundError('Faction not found');
    }

    const charLwsId = input.character_lws_id;
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['character_lws_id']);
    }

    // Must be active (non-deleted) character in the same world
    const character = db.prepare(`
        SELECT id, world_id FROM lws_characters
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(charLwsId, world.id);

    if (!character) {
        throw new LwsNotFoundError('Character not found');
    }

    const role = validateTextField(input.role, 'role', 255);

    const stmt = db.prepare(`
        INSERT INTO lws_character_factions (character_id, faction_id, role)
        VALUES (?, ?, ?)
        ON CONFLICT(character_id, faction_id) DO UPDATE SET role = excluded.role
    `);

    stmt.run(character.id, faction.id, role);

    return {
        character_lws_id: charLwsId,
        faction_lws_id: factionLwsId,
        role,
    };
}

/**
 * Removes a Character from an active Faction.
 * Succeeds even if the character was soft-deleted (allowing reference cleanup).
 * @param {string} worldLwsId
 * @param {string} factionLwsId
 * @param {string} charLwsId
 * @returns {boolean}
 */
export function removeFactionMember(worldLwsId, factionLwsId, charLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(factionLwsId)) {
        throw new LwsValidationError('Invalid faction UUID format', ['factionLwsId']);
    }
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }

    const faction = db.prepare(`
        SELECT id FROM lws_factions
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(factionLwsId, world.id);

    if (!faction) {
        throw new LwsNotFoundError('Faction not found');
    }

    const character = db.prepare(`
        SELECT id FROM lws_characters
        WHERE lws_id = ? AND world_id = ?
    `).get(charLwsId, world.id);

    if (!character) {
        throw new LwsNotFoundError('Character not found');
    }

    const result = db.prepare(`
        DELETE FROM lws_character_factions
        WHERE character_id = ? AND faction_id = ?
    `).run(character.id, faction.id);

    if (result.changes === 0) {
        throw new LwsNotFoundError('Membership not found');
    }

    return true;
}

/**
 * Lists all active members of an active Faction.
 * Automatically filters out any members whose Character row is soft-deleted.
 * @param {string} worldLwsId
 * @param {string} factionLwsId
 * @returns {object[]}
 */
export function listFactionMembers(worldLwsId, factionLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(factionLwsId)) {
        throw new LwsValidationError('Invalid faction UUID format', ['factionLwsId']);
    }

    const faction = db.prepare(`
        SELECT id FROM lws_factions
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(factionLwsId, world.id);

    if (!faction) {
        throw new LwsNotFoundError('Faction not found');
    }

    const rows = db.prepare(`
        SELECT c.lws_id AS character_lws_id, c.name, cf.role
        FROM lws_character_factions cf
        JOIN lws_characters c ON cf.character_id = c.id
        WHERE cf.faction_id = ? AND c.deleted_at IS NULL
        ORDER BY c.name ASC
    `).all(faction.id);

    return rows;
}
