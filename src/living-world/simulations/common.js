import { LwsValidationError, LwsNotFoundError } from '../errors.js';
import {
    generateUuid,
    generateDeterministicUuid,
    isValidUuid,
    isoNow,
    validateName,
    validateTextField,
    validateTags,
    validateExtensions,
    safeJsonParse,
    ensureActiveWorld,
} from '../authored/common.js';

export {
    generateUuid,
    generateDeterministicUuid,
    isValidUuid,
    isoNow,
    validateName,
    validateTextField,
    validateTags,
    validateExtensions,
    safeJsonParse,
    ensureActiveWorld,
};

/**
 * Validates that a string is a semantically valid ISO 8601 fictional timestamp in YYYY-MM-DDTHH:MM:SSZ format.
 * Checks both lexical syntax AND semantic calendar validity:
 * - month 1–12
 * - leap-year calculation: (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0)
 * - exact days in month
 * - hour 0–23, minute 0–59, second 0–59
 *
 * @param {any} value
 * @param {string} [fieldName='initial_fictional_time']
 * @returns {string} The validated canonical timestamp string
 */
export function validateFictionalTimestamp(value, fieldName = 'initial_fictional_time') {
    if (typeof value !== 'string' || !value.trim()) {
        throw new LwsValidationError(`${fieldName} is required`, [fieldName]);
    }

    const trimmed = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/.exec(trimmed);
    if (!match) {
        throw new LwsValidationError(
            `${fieldName} must be a valid ISO 8601 timestamp in YYYY-MM-DDTHH:MM:SSZ format`,
            [fieldName],
        );
    }

    const [, yearStr, monthStr, dayStr, hourStr, minStr, secStr] = match;
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const day = parseInt(dayStr, 10);
    const hour = parseInt(hourStr, 10);
    const minute = parseInt(minStr, 10);
    const second = parseInt(secStr, 10);

    if (month < 1 || month > 12) {
        throw new LwsValidationError(`${fieldName} has invalid month: ${monthStr}`, [fieldName]);
    }
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
        throw new LwsValidationError(`${fieldName} has invalid time components`, [fieldName]);
    }

    const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
    const daysInMonth = [0, 31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    if (day < 1 || day > daysInMonth[month]) {
        throw new LwsValidationError(
            `${fieldName} has invalid day ${dayStr} for month ${monthStr} in year ${yearStr}`,
            [fieldName],
        );
    }

    return trimmed;
}

export const VALID_SIMULATION_STATUSES = Object.freeze(['active', 'paused', 'archived']);

/**
 * Validates a simulation status transition against the explicit transition matrix:
 * - active -> active, paused, archived
 * - paused -> paused, active, archived
 * - archived -> archived
 *
 * @param {string} currentStatus
 * @param {string} targetStatus
 * @returns {string} The valid target status
 */
export function validateStatusTransition(currentStatus, targetStatus) {
    if (!VALID_SIMULATION_STATUSES.includes(targetStatus)) {
        throw new LwsValidationError(
            `Invalid simulation status '${targetStatus}'. Must be one of: ${VALID_SIMULATION_STATUSES.join(', ')}`,
            ['status'],
        );
    }

    if (currentStatus === targetStatus) {
        return targetStatus;
    }

    if (currentStatus === 'archived') {
        throw new LwsValidationError(
            `Cannot transition simulation from archived status to '${targetStatus}'`,
            ['status'],
        );
    }

    return targetStatus;
}

/**
 * Ensures an active simulation exists, belongs to an active world, and returns its row.
 * Handles deleted-World and deleted-Simulation gating.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} simLwsId
 * @returns {object} The simulation row
 */
export function ensureActiveSimulation(db, simLwsId) {
    if (!isValidUuid(simLwsId)) {
        throw new LwsValidationError('Invalid simulation UUID format', ['simLwsId']);
    }

    const row = db.prepare(`
        SELECT s.*, w.lws_id AS world_lws_id, w.deleted_at AS world_deleted_at
        FROM lws_simulations s
        JOIN lws_worlds w ON s.world_id = w.id
        WHERE s.lws_id = ? AND s.deleted_at IS NULL
    `).get(simLwsId);

    if (!row) {
        throw new LwsNotFoundError('Simulation not found');
    }

    if (row.world_deleted_at !== null) {
        throw new LwsNotFoundError('World not found');
    }

    return row;
}
