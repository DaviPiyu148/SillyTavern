import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import {
    FACTION_MEMBERSHIP_STATUSES,
    clamp,
    formatFactionMembership,
    generateDeterministicUuid,
    isValidUuid,
} from './common.js';

/**
 * Initializes runtime faction memberships for a character on CHARACTER_JOIN / SIMULATION_START.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {number} simCharId
 * @param {string} simLwsId
 * @param {string} charLwsId
 * @param {number} authoredCharId
 * @param {string} fictionalTime
 * @param {string} createdAt
 */
export function initCharacterFactionMemberships(
    db,
    simId,
    simCharId,
    simLwsId,
    charLwsId,
    authoredCharId,
    fictionalTime,
    createdAt,
) {
    const authoredMemberships = db.prepare(`
        SELECT cf.*, f.lws_id AS faction_lws_id
        FROM lws_character_factions cf
        JOIN lws_factions f ON cf.faction_id = f.id
        WHERE cf.character_id = ? AND f.deleted_at IS NULL
    `).all(authoredCharId);

    const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO lws_character_faction_memberships (
            lws_id, simulation_id, simulation_character_id, faction_id,
            rank_role, standing, loyalty_score, membership_status,
            joined_fictional_time, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 0, 50, 'active', ?, ?, ?)
    `);

    for (const am of authoredMemberships) {
        const memLwsId = generateDeterministicUuid(
            'faction_membership',
            simLwsId,
            charLwsId,
            am.faction_lws_id,
        );
        insertStmt.run(
            memLwsId,
            simId,
            simCharId,
            am.faction_id,
            am.role || 'member',
            fictionalTime,
            createdAt,
            createdAt,
        );
    }
}

/**
 * Retrieves a single faction membership row by UUID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {string} memLwsId
 * @returns {object}
 */
export function getFactionMembership(db, simId, memLwsId) {
    if (!isValidUuid(memLwsId)) {
        throw new LwsValidationError('Invalid faction membership UUID format', ['memLwsId']);
    }

    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) throw new LwsNotFoundError('Simulation not found');
        resolvedSimId = s.id;
    }

    const row = db.prepare(`
        SELECT fm.*,
               s.lws_id AS simulation_lws_id,
               sc.lws_id AS simulation_character_lws_id,
               f.lws_id AS faction_lws_id,
               f.name AS faction_name
        FROM lws_character_faction_memberships fm
        JOIN lws_simulations s ON fm.simulation_id = s.id
        JOIN lws_simulation_characters sc ON fm.simulation_character_id = sc.id
        JOIN lws_factions f ON fm.faction_id = f.id
        WHERE fm.lws_id = ? AND fm.simulation_id = ? AND fm.deleted_at IS NULL
    `).get(memLwsId, resolvedSimId);

    if (!row) {
        throw new LwsNotFoundError('Faction membership not found');
    }

    return formatFactionMembership(row);
}

/**
 * Retrieves all active faction memberships for a simulation character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {number | string} simChar
 * @returns {object[]}
 */
export function getCharacterFactionMemberships(db, simId, simChar) {
    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) return [];
        resolvedSimId = s.id;
    }

    const charRow = typeof simChar === 'string'
        ? db.prepare('SELECT id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(simChar, simChar, resolvedSimId)
        : db.prepare('SELECT id FROM lws_simulation_characters WHERE id = ? AND simulation_id = ?').get(simChar, resolvedSimId);

    if (!charRow) return [];

    const rows = db.prepare(`
        SELECT fm.*,
               s.lws_id AS simulation_lws_id,
               sc.lws_id AS simulation_character_lws_id,
               f.lws_id AS faction_lws_id,
               f.name AS faction_name
        FROM lws_character_faction_memberships fm
        JOIN lws_simulations s ON fm.simulation_id = s.id
        JOIN lws_simulation_characters sc ON fm.simulation_character_id = sc.id
        JOIN lws_factions f ON fm.faction_id = f.id
        WHERE fm.simulation_id = ? AND fm.simulation_character_id = ? AND fm.deleted_at IS NULL
        ORDER BY fm.id ASC
    `).all(resolvedSimId, charRow.id);

    return rows.map(formatFactionMembership);
}

/**
 * Lists all faction memberships across the entire simulation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @returns {object[]}
 */
export function listSimulationFactionMemberships(db, simId, options = {}) {
    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) return [];
        resolvedSimId = s.id;
    }

    let sql = `
        SELECT fm.*,
               s.lws_id AS simulation_lws_id,
               sc.lws_id AS simulation_character_lws_id,
               f.lws_id AS faction_lws_id,
               f.name AS faction_name
        FROM lws_character_faction_memberships fm
        JOIN lws_simulations s ON fm.simulation_id = s.id
        JOIN lws_simulation_characters sc ON fm.simulation_character_id = sc.id
        JOIN lws_factions f ON fm.faction_id = f.id
        WHERE fm.simulation_id = ? AND fm.deleted_at IS NULL
    `;
    const params = [resolvedSimId];

    if (options && options.faction_id !== undefined) {
        const factRow = typeof options.faction_id === 'string'
            ? db.prepare('SELECT id FROM lws_factions WHERE (lws_id = ? OR id = ?)').get(options.faction_id, options.faction_id)
            : db.prepare('SELECT id FROM lws_factions WHERE id = ?').get(options.faction_id);
        if (factRow) {
            sql += ' AND fm.faction_id = ?';
            params.push(factRow.id);
        } else {
            return [];
        }
    }

    sql += ' ORDER BY f.id ASC, sc.id ASC';

    const rows = db.prepare(sql).all(...params);

    return rows.map(formatFactionMembership);
}

/**
 * Updates a character's faction standing, loyalty, role, or membership status.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {number | string} simChar
 * @param {number | string} faction
 * @param {object} patch
 * @param {string} eventCreatedAt
 * @returns {object} Updated membership
 */
export function updateFactionMembership(db, simId, simChar, faction, patch = {}, eventCreatedAt) {
    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) throw new LwsNotFoundError('Simulation not found');
        resolvedSimId = s.id;
    }

    const charRow = typeof simChar === 'string'
        ? db.prepare('SELECT id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(simChar, simChar, resolvedSimId)
        : db.prepare('SELECT id FROM lws_simulation_characters WHERE id = ? AND simulation_id = ?').get(simChar, resolvedSimId);

    const factRow = typeof faction === 'string'
        ? db.prepare('SELECT id FROM lws_factions WHERE lws_id = ?').get(faction)
        : db.prepare('SELECT id FROM lws_factions WHERE id = ?').get(faction);

    if (!charRow || !factRow) {
        throw new LwsNotFoundError('Character or Faction not found');
    }

    const existing = db.prepare(`
        SELECT * FROM lws_character_faction_memberships
        WHERE simulation_id = ? AND simulation_character_id = ? AND faction_id = ? AND deleted_at IS NULL
    `).get(resolvedSimId, charRow.id, factRow.id);

    if (!existing) {
        throw new LwsNotFoundError('Faction membership not found');
    }

    let nextRank = patch.rank_role !== undefined ? String(patch.rank_role) : existing.rank_role;
    let nextStanding = patch.standing !== undefined ? clamp(Math.round(patch.standing), -100, 100) : existing.standing;
    let nextLoyalty = patch.loyalty_score !== undefined ? clamp(Math.round(patch.loyalty_score), -100, 100) : existing.loyalty_score;
    let nextStatus = patch.membership_status !== undefined ? patch.membership_status : existing.membership_status;

    if (patch.delta_standing !== undefined) {
        nextStanding = clamp(existing.standing + Math.round(patch.delta_standing), -100, 100);
    }
    if (patch.delta_loyalty !== undefined) {
        nextLoyalty = clamp(existing.loyalty_score + Math.round(patch.delta_loyalty), -100, 100);
    }

    if (!FACTION_MEMBERSHIP_STATUSES.includes(nextStatus)) {
        throw new LwsValidationError(`Invalid membership_status '${nextStatus}'`, ['membership_status']);
    }

    db.prepare(`
        UPDATE lws_character_faction_memberships
        SET rank_role = ?, standing = ?, loyalty_score = ?, membership_status = ?, updated_at = ?
        WHERE id = ?
    `).run(nextRank, nextStanding, nextLoyalty, nextStatus, eventCreatedAt, existing.id);

    return getFactionMembership(db, simId, existing.lws_id);
}
