import { getDb } from '../db.js';
import { LwsConflictError, LwsNotFoundError } from '../errors.js';
import {
    generateUuid,
    isoNow,
    validateTextField,
    validateExtensions,
    ensureActiveWorld,
    safeJsonParse,
} from './common.js';

/**
 * Formats a database row for public presentation.
 * @param {object} row
 * @returns {object}
 */
function formatPromptConfig(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        style_notes: row.style_notes,
        tone_notes: row.tone_notes,
        format_notes: row.format_notes,
        extensions: safeJsonParse(row.extensions, {}),
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Creates and persists an AuthoredPromptConfig for a World.
 * Enforces 1:1 relationship with World (throws LwsConflictError if already exists).
 * @param {string} worldLwsId
 * @param {object} input
 * @returns {object}
 */
export function createPromptConfig(worldLwsId, input = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    // Check if configuration already exists
    const existing = db.prepare(`
        SELECT id FROM lws_authored_prompt_configs WHERE world_id = ?
    `).get(world.id);

    if (existing) {
        throw new LwsConflictError('Prompt configuration already exists for this world');
    }

    const styleNotes = validateTextField(input.style_notes, 'style_notes');
    const toneNotes = validateTextField(input.tone_notes, 'tone_notes');
    const formatNotes = validateTextField(input.format_notes, 'format_notes');
    const extensions = validateExtensions(input.extensions);

    const lwsId = generateUuid();
    const now = isoNow();

    const stmt = db.prepare(`
        INSERT INTO lws_authored_prompt_configs (
            lws_id, world_id, style_notes, tone_notes, format_notes,
            extensions, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(lwsId, world.id, styleNotes, toneNotes, formatNotes, JSON.stringify(extensions), now, now);

    return getPromptConfig(worldLwsId);
}

/**
 * Retrieves the AuthoredPromptConfig for a World.
 * @param {string} worldLwsId
 * @returns {object}
 */
export function getPromptConfig(worldLwsId) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const row = db.prepare(`
        SELECT * FROM lws_authored_prompt_configs WHERE world_id = ?
    `).get(world.id);

    if (!row) {
        throw new LwsNotFoundError('Prompt configuration not found');
    }

    return formatPromptConfig(row);
}

/**
 * Updates an existing AuthoredPromptConfig for a World.
 * @param {string} worldLwsId
 * @param {object} patch
 * @returns {object}
 */
export function updatePromptConfig(worldLwsId, patch = {}) {
    const db = getDb();
    const world = ensureActiveWorld(db, worldLwsId);

    const current = db.prepare(`
        SELECT * FROM lws_authored_prompt_configs WHERE world_id = ?
    `).get(world.id);

    if (!current) {
        throw new LwsNotFoundError('Prompt configuration not found');
    }

    const styleNotes = patch.style_notes !== undefined ? validateTextField(patch.style_notes, 'style_notes') : current.style_notes;
    const toneNotes = patch.tone_notes !== undefined ? validateTextField(patch.tone_notes, 'tone_notes') : current.tone_notes;
    const formatNotes = patch.format_notes !== undefined ? validateTextField(patch.format_notes, 'format_notes') : current.format_notes;
    const extensions = patch.extensions !== undefined ? validateExtensions(patch.extensions) : safeJsonParse(current.extensions, {});
    const now = isoNow();

    const stmt = db.prepare(`
        UPDATE lws_authored_prompt_configs
        SET style_notes = ?, tone_notes = ?, format_notes = ?, extensions = ?, updated_at = ?
        WHERE world_id = ?
    `);

    stmt.run(styleNotes, toneNotes, formatNotes, JSON.stringify(extensions), now, world.id);

    return getPromptConfig(worldLwsId);
}
