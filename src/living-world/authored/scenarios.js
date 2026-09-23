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
 * Resolves starting_location_id to starting_location_lws_id.
 * @param {object} row
 * @returns {object}
 */
function formatScenario(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        name: row.name,
        description: row.description,
        starting_location_lws_id: row.starting_location_lws_id ?? null,
        tags: safeJsonParse(row.tags, []),
        extensions: safeJsonParse(row.extensions, {}),
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Resolves an active location by UUID within a world.
 * Returns the internal integer id.
 * @param {import('better-sqlite3').Database} db
 * @param {number} worldId
 * @param {string|null} locLwsId
 * @returns {number|null}
 */
function resolveStartingLocationId(db, worldId, locLwsId) {
    if (!locLwsId) return null;
    if (!isValidUuid(locLwsId)) {
        throw new LwsValidationError('Invalid location UUID format', ['starting_location_lws_id']);
    }

    const loc = db.prepare(`
        SELECT id, world_id FROM lws_locations
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(locLwsId, worldId);

    if (!loc) {
        throw new LwsNotFoundError('Location not found');
    }

    return loc.id;
}

/**
 * Creates and persists an authored Scenario in a World.
 * @param {string} worldLwsId
 * @param {object} input
 * @returns {object} The created Scenario
 */
export function createScenario(worldLwsId, input = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const name = validateName(input.name, 'name');
    const description = validateTextField(input.description, 'description');
    const tags = validateTags(input.tags);
    const extensions = validateExtensions(input.extensions);
    const startingLocationId = resolveStartingLocationId(
        db,
        world.id,
        input.starting_location_lws_id ?? null,
    );

    const lwsId = generateUuid();
    const now = isoNow();

    const stmt = db.prepare(`
        INSERT INTO lws_scenarios (
            lws_id, world_id, name, description, starting_location_id,
            tags, extensions, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        lwsId,
        world.id,
        name,
        description,
        startingLocationId,
        JSON.stringify(tags),
        JSON.stringify(extensions),
        now,
        now,
    );

    return getScenarioByLwsId(worldLwsId, lwsId);
}

/**
 * Retrieves an active Scenario by UUID within an active World.
 * @param {string} worldLwsId
 * @param {string} scenarioLwsId
 * @returns {object}
 */
export function getScenarioByLwsId(worldLwsId, scenarioLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(scenarioLwsId)) {
        throw new LwsValidationError('Invalid scenario UUID format', ['scenarioLwsId']);
    }

    const row = db.prepare(`
        SELECT s.*, loc.lws_id AS starting_location_lws_id
        FROM lws_scenarios s
        LEFT JOIN lws_locations loc ON s.starting_location_id = loc.id
        WHERE s.lws_id = ? AND s.world_id = ? AND s.deleted_at IS NULL
    `).get(scenarioLwsId, world.id);

    if (!row) {
        throw new LwsNotFoundError('Scenario not found');
    }

    return formatScenario(row);
}

/**
 * Lists active Scenarios in a World.
 * @param {string} worldLwsId
 * @param {object} [options]
 * @param {boolean} [options.includeDeleted=false]
 * @returns {object[]}
 */
export function listScenarios(worldLwsId, options = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const sql = options.includeDeleted
        ? `SELECT s.*, loc.lws_id AS starting_location_lws_id
           FROM lws_scenarios s
           LEFT JOIN lws_locations loc ON s.starting_location_id = loc.id
           WHERE s.world_id = ?
           ORDER BY s.name ASC`
        : `SELECT s.*, loc.lws_id AS starting_location_lws_id
           FROM lws_scenarios s
           LEFT JOIN lws_locations loc ON s.starting_location_id = loc.id
           WHERE s.world_id = ? AND s.deleted_at IS NULL
           ORDER BY s.name ASC`;

    const rows = db.prepare(sql).all(world.id);
    return rows.map(formatScenario);
}

/**
 * Updates an active Scenario.
 * @param {string} worldLwsId
 * @param {string} scenarioLwsId
 * @param {object} patch
 * @returns {object} The updated Scenario
 */
export function updateScenario(worldLwsId, scenarioLwsId, patch = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(scenarioLwsId)) {
        throw new LwsValidationError('Invalid scenario UUID format', ['scenarioLwsId']);
    }

    const current = db.prepare(`
        SELECT * FROM lws_scenarios
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(scenarioLwsId, world.id);

    if (!current) {
        throw new LwsNotFoundError('Scenario not found');
    }

    const name = patch.name !== undefined ? validateName(patch.name, 'name') : current.name;
    const description = patch.description !== undefined ? validateTextField(patch.description, 'description') : current.description;
    const tags = patch.tags !== undefined ? validateTags(patch.tags) : safeJsonParse(current.tags, []);
    const extensions = patch.extensions !== undefined ? validateExtensions(patch.extensions) : safeJsonParse(current.extensions, {});

    let startingLocationId = current.starting_location_id;
    if (patch.starting_location_lws_id !== undefined) {
        startingLocationId = resolveStartingLocationId(db, world.id, patch.starting_location_lws_id);
    }

    const now = isoNow();

    const stmt = db.prepare(`
        UPDATE lws_scenarios
        SET name = ?, description = ?, starting_location_id = ?, tags = ?, extensions = ?, updated_at = ?
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `);

    stmt.run(
        name,
        description,
        startingLocationId,
        JSON.stringify(tags),
        JSON.stringify(extensions),
        now,
        scenarioLwsId,
        world.id,
    );

    return getScenarioByLwsId(worldLwsId, scenarioLwsId);
}

/**
 * Soft-deletes a Scenario.
 * @param {string} worldLwsId
 * @param {string} scenarioLwsId
 * @returns {boolean}
 */
export function deleteScenario(worldLwsId, scenarioLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(scenarioLwsId)) {
        throw new LwsValidationError('Invalid scenario UUID format', ['scenarioLwsId']);
    }

    const row = db.prepare(`
        SELECT id FROM lws_scenarios
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(scenarioLwsId, world.id);

    if (!row) {
        throw new LwsNotFoundError('Scenario not found');
    }

    const now = isoNow();
    const result = db.prepare(`
        UPDATE lws_scenarios SET deleted_at = ?, updated_at = ?
        WHERE id = ?
    `).run(now, now, row.id);

    return result.changes > 0;
}

/**
 * Adds an active Character to an active Scenario's roster.
 * Disallows adding a soft-deleted Character.
 * @param {string} worldLwsId
 * @param {string} scenarioLwsId
 * @param {object} input
 * @param {string} input.character_lws_id
 * @param {string} [input.role='']
 * @returns {object}
 */
export function addScenarioCharacter(worldLwsId, scenarioLwsId, input = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(scenarioLwsId)) {
        throw new LwsValidationError('Invalid scenario UUID format', ['scenarioLwsId']);
    }

    const scenario = db.prepare(`
        SELECT id, world_id FROM lws_scenarios
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(scenarioLwsId, world.id);

    if (!scenario) {
        throw new LwsNotFoundError('Scenario not found');
    }

    const charLwsId = input.character_lws_id;
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['character_lws_id']);
    }

    // Must be active (non-deleted) character in same world
    const character = db.prepare(`
        SELECT id, world_id FROM lws_characters
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(charLwsId, world.id);

    if (!character) {
        throw new LwsNotFoundError('Character not found');
    }

    const role = validateTextField(input.role, 'role', 255);

    const stmt = db.prepare(`
        INSERT INTO lws_scenario_characters (scenario_id, character_id, role)
        VALUES (?, ?, ?)
        ON CONFLICT(scenario_id, character_id) DO UPDATE SET role = excluded.role
    `);

    stmt.run(scenario.id, character.id, role);

    return {
        scenario_lws_id: scenarioLwsId,
        character_lws_id: charLwsId,
        role,
    };
}

/**
 * Removes a Character from a Scenario's roster.
 * Succeeds even if the character was soft-deleted (allowing reference cleanup).
 * @param {string} worldLwsId
 * @param {string} scenarioLwsId
 * @param {string} charLwsId
 * @returns {boolean}
 */
export function removeScenarioCharacter(worldLwsId, scenarioLwsId, charLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(scenarioLwsId)) {
        throw new LwsValidationError('Invalid scenario UUID format', ['scenarioLwsId']);
    }
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }

    const scenario = db.prepare(`
        SELECT id FROM lws_scenarios
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(scenarioLwsId, world.id);

    if (!scenario) {
        throw new LwsNotFoundError('Scenario not found');
    }

    const character = db.prepare(`
        SELECT id FROM lws_characters
        WHERE lws_id = ? AND world_id = ?
    `).get(charLwsId, world.id);

    if (!character) {
        throw new LwsNotFoundError('Character not found');
    }

    const result = db.prepare(`
        DELETE FROM lws_scenario_characters
        WHERE scenario_id = ? AND character_id = ?
    `).run(scenario.id, character.id);

    if (result.changes === 0) {
        throw new LwsNotFoundError('Roster entry not found');
    }

    return true;
}

/**
 * Lists active characters in a Scenario's roster.
 * Automatically filters out any character whose row is soft-deleted.
 * @param {string} worldLwsId
 * @param {string} scenarioLwsId
 * @returns {object[]}
 */
export function listScenarioCharacters(worldLwsId, scenarioLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(scenarioLwsId)) {
        throw new LwsValidationError('Invalid scenario UUID format', ['scenarioLwsId']);
    }

    const scenario = db.prepare(`
        SELECT id FROM lws_scenarios
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(scenarioLwsId, world.id);

    if (!scenario) {
        throw new LwsNotFoundError('Scenario not found');
    }

    const rows = db.prepare(`
        SELECT c.lws_id AS character_lws_id, c.name, sc.role
        FROM lws_scenario_characters sc
        JOIN lws_characters c ON sc.character_id = c.id
        WHERE sc.scenario_id = ? AND c.deleted_at IS NULL
        ORDER BY c.name ASC
    `).all(scenario.id);

    return rows;
}
