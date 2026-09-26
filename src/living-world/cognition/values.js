import { generateDeterministicUuid } from './common.js';
import { LwsValidationError } from '../errors.js';

export const VALUE_DIMENSIONS = Object.freeze([
    'honesty',
    'courage',
    'compassion',
    'ambition',
    'loyalty',
    'curiosity',
]);

/**
 * 7.4 Complete ValueMatch Matrix (11 x 6 = 66 cells)
 * All unspecified cells are strictly 0.0.
 */
export const VALUE_MATCH_MATRIX = Object.freeze({
    DECEPTIVE_COMMUNICATION: { honesty: -1.0, courage: 0.0, compassion: 0.0, ambition: 0.0, loyalty: -0.5, curiosity: 0.0 },
    TRUTHFUL_COMMUNICATION: { honesty: 1.0, courage: 0.0, compassion: 0.0, ambition: 0.0, loyalty: 0.2, curiosity: 0.0 },
    COMBAT_AGGRESSION: { honesty: 0.0, courage: 1.0, compassion: -0.8, ambition: 0.2, loyalty: 0.0, curiosity: 0.0 },
    FLEEING: { honesty: 0.0, courage: -1.0, compassion: 0.0, ambition: -0.2, loyalty: -0.4, curiosity: 0.0 },
    AID_COMFORT: { honesty: 0.0, courage: 0.0, compassion: 1.0, ambition: 0.0, loyalty: 0.8, curiosity: 0.0 },
    TRANSFER_ITEM: { honesty: 0.2, courage: 0.0, compassion: 0.8, ambition: 0.0, loyalty: 0.6, curiosity: 0.0 },
    WORK: { honesty: 0.0, courage: 0.0, compassion: 0.0, ambition: 1.0, loyalty: 0.3, curiosity: 0.0 },
    AUTONOMOUS_GOAL_PURSUIT: { honesty: 0.0, courage: 0.2, compassion: 0.0, ambition: 0.8, loyalty: 0.2, curiosity: 0.2 },
    OBSERVE: { honesty: 0.0, courage: 0.0, compassion: 0.0, ambition: 0.0, loyalty: 0.0, curiosity: 0.8 },
    INTERACT_OBJECT: { honesty: 0.0, courage: 0.0, compassion: 0.0, ambition: 0.0, loyalty: 0.0, curiosity: 0.7 },
    IDLE_LEISURE: { honesty: 0.0, courage: 0.0, compassion: 0.0, ambition: -0.8, loyalty: 0.0, curiosity: -0.2 },
});

/**
 * Calculates value match score A_value across all 6 dimensions.
 * Formula: A_value = 1/6 * sum_{v in V} [ (strength_v / 100) * ValueMatch(v, ActionClass) * 100 ]
 * Which simplifies to: 1/6 * sum_{v in V} [ strength_v * ValueMatch(v, ActionClass) ] in [-100, 100]
 *
 * @param {object | object[]} values Map of dimension -> strength, or array of value rows
 * @param {string} actionClass
 * @returns {number} Value in [-100, 100]
 */
export function calculateValueScore(values, actionClass) {
    const valuesMap = {};
    if (Array.isArray(values)) {
        for (const row of values) {
            valuesMap[row.dimension] = row.strength;
        }
    } else if (values && typeof values === 'object') {
        Object.assign(valuesMap, values);
    }

    const row = VALUE_MATCH_MATRIX[actionClass];
    if (!row) return 0.0;

    let sum = 0.0;
    for (const dim of VALUE_DIMENSIONS) {
        const strength = Number(valuesMap[dim] ?? 0);
        const match = row[dim] ?? 0.0;
        sum += strength * match;
    }

    return sum / 6.0;
}

/**
 * Checks for Moral Veto.
 * If action is DECEPTIVE_COMMUNICATION and strength('honesty') >= +75 -> true (hard veto).
 *
 * @param {object | object[]} values
 * @param {string} actionClass
 * @returns {boolean}
 */
export function hasMoralVeto(values, actionClass) {
    if (actionClass !== 'DECEPTIVE_COMMUNICATION') return false;

    let honesty = 0;
    if (Array.isArray(values)) {
        const row = values.find(v => v.dimension === 'honesty');
        if (row) honesty = row.strength;
    } else if (values && typeof values === 'object') {
        honesty = values.honesty ?? 0;
    }

    return honesty >= 75;
}

/**
 * Initializes the 6 value dimensions for a character in SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {number} simCharId
 * @param {string} simLwsId
 * @param {string} charLwsId
 * @param {string} createdAt
 */
export function initCharacterValues(db, simId, simCharId, simLwsId, charLwsId, createdAt) {
    const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO lws_character_values (
            lws_id, simulation_id, simulation_character_id, dimension,
            strength, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?)
    `);

    for (const dim of VALUE_DIMENSIONS) {
        const valLwsId = generateDeterministicUuid('value', simLwsId, charLwsId, dim);
        insertStmt.run(valLwsId, simId, simCharId, dim, createdAt, createdAt);
    }
}

/**
 * Retrieves all 6 values for a character from SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simCharId
 * @returns {object[]}
 */
export function getCharacterValues(db, simCharId) {
    let charId = simCharId;
    if (typeof simCharId === 'string') {
        const c = db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(simCharId);
        if (!c) return [];
        charId = c.id;
    }
    return db.prepare(`
        SELECT * FROM lws_character_values
        WHERE simulation_character_id = ?
        ORDER BY CASE dimension
            WHEN 'honesty' THEN 1
            WHEN 'courage' THEN 2
            WHEN 'compassion' THEN 3
            WHEN 'ambition' THEN 4
            WHEN 'loyalty' THEN 5
            WHEN 'curiosity' THEN 6
            ELSE 7
        END
    `).all(charId);
}


/**
 * Updates a specific character value dimension in SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simCharId
 * @param {string} dimension
 * @param {number} strength
 * @param {string} updatedAt
 */
export function updateCharacterValue(db, simCharId, dimension, strength, updatedAt) {
    if (!VALUE_DIMENSIONS.includes(dimension)) {
        throw new LwsValidationError(`Invalid value dimension: ${dimension}`, ['dimension']);
    }
    const clampedStrength = Math.max(-100, Math.min(100, Math.round(strength)));

    db.prepare(`
        UPDATE lws_character_values
        SET strength = ?, updated_at = ?
        WHERE simulation_character_id = ? AND dimension = ?
    `).run(clampedStrength, updatedAt, simCharId, dimension);
}
