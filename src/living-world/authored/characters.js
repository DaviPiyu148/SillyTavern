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
 * Excludes internal id, world_id, and deleted_at.
 * @param {object} row
 * @returns {object}
 */
function formatCharacter(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        name: row.name,
        description: row.description,
        personality: row.personality,
        scenario_context: row.scenario_context,
        mes_example: row.mes_example,
        author_notes: row.author_notes,
        system_prompt_override: row.system_prompt_override,
        source_version: row.source_version,
        tags: safeJsonParse(row.tags, []),
        extensions: safeJsonParse(row.extensions, {}),
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Creates and persists an authored Character in a World.
 * Holds the supported mapped V2 subset of ST character cards.
 * @param {string} worldLwsId
 * @param {object} input
 * @returns {object} The created Character
 */
export function createCharacter(worldLwsId, input = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const name = validateName(input.name, 'name');
    const description = validateTextField(input.description, 'description');
    const personality = validateTextField(input.personality, 'personality');
    const scenarioContext = validateTextField(input.scenario_context ?? input.scenario, 'scenario_context');
    const mesExample = validateTextField(input.mes_example, 'mes_example');
    const authorNotes = validateTextField(input.author_notes ?? input.creator_notes, 'author_notes');
    const systemPromptOverride = validateTextField(input.system_prompt_override ?? input.system_prompt, 'system_prompt_override');
    const sourceVersion = validateTextField(input.source_version ?? input.character_version, 'source_version', 255);
    const tags = validateTags(input.tags);
    const extensions = validateExtensions(input.extensions);

    const lwsId = generateUuid();
    const now = isoNow();

    const stmt = db.prepare(`
        INSERT INTO lws_characters (
            lws_id, world_id, name, description, personality,
            scenario_context, mes_example, author_notes, system_prompt_override,
            source_version, tags, extensions, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        lwsId,
        world.id,
        name,
        description,
        personality,
        scenarioContext,
        mesExample,
        authorNotes,
        systemPromptOverride,
        sourceVersion,
        JSON.stringify(tags),
        JSON.stringify(extensions),
        now,
        now,
    );

    return getCharacterByLwsId(worldLwsId, lwsId);
}

/**
 * Retrieves an active Character by UUID within an active World.
 * @param {string} worldLwsId
 * @param {string} charLwsId
 * @returns {object}
 */
export function getCharacterByLwsId(worldLwsId, charLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }

    const row = db.prepare(`
        SELECT * FROM lws_characters
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(charLwsId, world.id);

    if (!row) {
        throw new LwsNotFoundError('Character not found');
    }

    return formatCharacter(row);
}

/**
 * Lists active Characters in a World.
 * @param {string} worldLwsId
 * @param {object} [options]
 * @param {boolean} [options.includeDeleted=false]
 * @returns {object[]}
 */
export function listCharacters(worldLwsId, options = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const sql = options.includeDeleted
        ? 'SELECT * FROM lws_characters WHERE world_id = ? ORDER BY name ASC'
        : 'SELECT * FROM lws_characters WHERE world_id = ? AND deleted_at IS NULL ORDER BY name ASC';

    const rows = db.prepare(sql).all(world.id);
    return rows.map(formatCharacter);
}

/**
 * Updates an active Character's editable authored fields.
 * lws_id, world_id, and created_at are immutable.
 * @param {string} worldLwsId
 * @param {string} charLwsId
 * @param {object} patch
 * @returns {object} The updated Character
 */
export function updateCharacter(worldLwsId, charLwsId, patch = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }

    const current = db.prepare(`
        SELECT * FROM lws_characters
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(charLwsId, world.id);

    if (!current) {
        throw new LwsNotFoundError('Character not found');
    }

    const name = patch.name !== undefined ? validateName(patch.name, 'name') : current.name;
    const description = patch.description !== undefined ? validateTextField(patch.description, 'description') : current.description;
    const personality = patch.personality !== undefined ? validateTextField(patch.personality, 'personality') : current.personality;
    const scenarioContext = patch.scenario_context !== undefined
        ? validateTextField(patch.scenario_context, 'scenario_context')
        : (patch.scenario !== undefined ? validateTextField(patch.scenario, 'scenario_context') : current.scenario_context);
    const mesExample = patch.mes_example !== undefined ? validateTextField(patch.mes_example, 'mes_example') : current.mes_example;
    const authorNotes = patch.author_notes !== undefined
        ? validateTextField(patch.author_notes, 'author_notes')
        : (patch.creator_notes !== undefined ? validateTextField(patch.creator_notes, 'author_notes') : current.author_notes);
    const systemPromptOverride = patch.system_prompt_override !== undefined
        ? validateTextField(patch.system_prompt_override, 'system_prompt_override')
        : (patch.system_prompt !== undefined ? validateTextField(patch.system_prompt, 'system_prompt_override') : current.system_prompt_override);
    const sourceVersion = patch.source_version !== undefined
        ? validateTextField(patch.source_version, 'source_version', 255)
        : (patch.character_version !== undefined ? validateTextField(patch.character_version, 'source_version', 255) : current.source_version);
    const tags = patch.tags !== undefined ? validateTags(patch.tags) : safeJsonParse(current.tags, []);
    const extensions = patch.extensions !== undefined ? validateExtensions(patch.extensions) : safeJsonParse(current.extensions, {});
    const now = isoNow();

    const stmt = db.prepare(`
        UPDATE lws_characters
        SET name = ?, description = ?, personality = ?, scenario_context = ?,
            mes_example = ?, author_notes = ?, system_prompt_override = ?,
            source_version = ?, tags = ?, extensions = ?, updated_at = ?
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `);

    stmt.run(
        name,
        description,
        personality,
        scenarioContext,
        mesExample,
        authorNotes,
        systemPromptOverride,
        sourceVersion,
        JSON.stringify(tags),
        JSON.stringify(extensions),
        now,
        charLwsId,
        world.id,
    );

    return getCharacterByLwsId(worldLwsId, charLwsId);
}

/**
 * Soft-deletes a Character by setting deleted_at.
 * Does not mutate or drop relationship rows in join tables.
 * @param {string} worldLwsId
 * @param {string} charLwsId
 * @returns {boolean} True if deleted
 */
export function deleteCharacter(worldLwsId, charLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }

    const row = db.prepare(`
        SELECT id FROM lws_characters
        WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL
    `).get(charLwsId, world.id);

    if (!row) {
        throw new LwsNotFoundError('Character not found');
    }

    const now = isoNow();
    const result = db.prepare(`
        UPDATE lws_characters SET deleted_at = ?, updated_at = ?
        WHERE id = ?
    `).run(now, now, row.id);

    return result.changes > 0;
}
