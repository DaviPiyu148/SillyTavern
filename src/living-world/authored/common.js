import { randomUUID } from 'node:crypto';
import { LwsValidationError, LwsNotFoundError } from '../errors.js';

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates whether a given string is a valid RFC 4122 UUID.
 * @param {unknown} val
 * @returns {boolean}
 */
export function isValidUuid(val) {
    return typeof val === 'string' && UUID_REGEX.test(val);
}

/**
 * Generates a new RFC 4122 UUID.
 * @returns {string}
 */
export function generateUuid() {
    return randomUUID();
}

/**
 * Returns current ISO 8601 UTC timestamp.
 * @returns {string}
 */
export function isoNow() {
    return new Date().toISOString();
}

/**
 * Validates entity name: string, trimmed, 1-255 characters.
 * @param {unknown} name
 * @param {string} [fieldName='name']
 * @returns {string} Trimmed name
 */
export function validateName(name, fieldName = 'name') {
    if (typeof name !== 'string') {
        throw new LwsValidationError(`${fieldName} must be a string`, [fieldName]);
    }
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 255) {
        throw new LwsValidationError(`${fieldName} must be between 1 and 255 characters`, [fieldName]);
    }
    return trimmed;
}

/**
 * Validates text fields (e.g. description, personality).
 * @param {unknown} val
 * @param {string} fieldName
 * @param {number} [maxLen=65535]
 * @param {boolean} [required=false]
 * @returns {string}
 */
export function validateTextField(val, fieldName, maxLen = 65535, required = false) {
    if (val === undefined || val === null) {
        if (required) {
            throw new LwsValidationError(`${fieldName} is required`, [fieldName]);
        }
        return '';
    }
    if (typeof val !== 'string') {
        throw new LwsValidationError(`${fieldName} must be a string`, [fieldName]);
    }
    if (val.length > maxLen) {
        throw new LwsValidationError(`${fieldName} exceeds maximum length of ${maxLen}`, [fieldName]);
    }
    return val;
}

/**
 * Validates tags array: array of non-empty strings, max 100 items, each <= 64 chars.
 * @param {unknown} tags
 * @returns {string[]}
 */
export function validateTags(tags) {
    if (tags === undefined || tags === null) {
        return [];
    }
    if (!Array.isArray(tags)) {
        throw new LwsValidationError('tags must be an array of strings', ['tags']);
    }
    if (tags.length > 100) {
        throw new LwsValidationError('tags cannot exceed 100 items', ['tags']);
    }
    const validated = [];
    for (let i = 0; i < tags.length; i++) {
        const item = tags[i];
        if (typeof item !== 'string') {
            throw new LwsValidationError(`tag at index ${i} must be a string`, ['tags']);
        }
        const trimmed = item.trim();
        if (trimmed.length === 0 || trimmed.length > 64) {
            throw new LwsValidationError(`tag at index ${i} must be between 1 and 64 characters`, ['tags']);
        }
        validated.push(trimmed);
    }
    return validated;
}

/**
 * Validates extensions object: must be a plain object, serializable to JSON.
 * @param {unknown} extensions
 * @returns {Record<string, unknown>}
 */
export function validateExtensions(extensions) {
    if (extensions === undefined || extensions === null) {
        return {};
    }
    if (typeof extensions !== 'object' || Array.isArray(extensions)) {
        throw new LwsValidationError('extensions must be a JSON object', ['extensions']);
    }
    try {
        // Ensure no functions or circular references
        const serialized = JSON.stringify(extensions);
        return JSON.parse(serialized);
    } catch (_) {
        throw new LwsValidationError('extensions must be valid serializable JSON', ['extensions']);
    }
}

/**
 * Validates integer field.
 * @param {unknown} val
 * @param {string} fieldName
 * @param {number} [defaultVal=0]
 * @returns {number}
 */
export function validateInteger(val, fieldName, defaultVal = 0) {
    if (val === undefined || val === null) {
        return defaultVal;
    }
    const num = Number(val);
    if (!Number.isInteger(num)) {
        throw new LwsValidationError(`${fieldName} must be an integer`, [fieldName]);
    }
    return num;
}

/**
 * Looks up an active World by lws_id. Throws LwsNotFoundError if missing or soft-deleted.
 * @param {import('better-sqlite3').Database} db
 * @param {string} worldLwsId
 * @returns {{ id: number, lws_id: string, name: string }}
 */
export function ensureActiveWorld(db, worldLwsId) {
    if (!isValidUuid(worldLwsId)) {
        throw new LwsValidationError('Invalid world UUID format', ['worldLwsId']);
    }
    const row = db.prepare(
        'SELECT id, lws_id, name FROM lws_worlds WHERE lws_id = ? AND deleted_at IS NULL',
    ).get(worldLwsId);

    if (!row) {
        throw new LwsNotFoundError('World not found');
    }
    return row;
}

/**
 * Safely parses a JSON string or returns fallback.
 * @param {string} val
 * @param {unknown} fallback
 * @returns {unknown}
 */
export function safeJsonParse(val, fallback) {
    try {
        return JSON.parse(val);
    } catch (_) {
        return fallback;
    }
}
