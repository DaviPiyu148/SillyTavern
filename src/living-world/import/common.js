import { createHash, createHmac, randomBytes } from 'node:crypto';
import { LwsValidationError, LwsConflictError } from '../errors.js';
import { isoNow } from '../authored/common.js';

// Internal session secret for preview token signing (regenerated per process lifetime if not configured)
let tokenSigningSecret = randomBytes(32).toString('hex');

/**
 * Sets the HMAC secret used for signing preview tokens (useful for testing or clustering).
 * @param {string} secret
 */
export function setTokenSigningSecret(secret) {
    if (typeof secret === 'string' && secret.length > 0) {
        tokenSigningSecret = secret;
    }
}

/**
 * Gets the current HMAC token signing secret.
 * @returns {string}
 */
export function getTokenSigningSecret() {
    return tokenSigningSecret;
}

/**
 * Normalizes strings to Unicode NFC. If given an object or array, recursively normalizes all string values.
 * @param {unknown} val
 * @returns {unknown}
 */
export function normalizeUnicode(val) {
    if (typeof val === 'string') {
        return val.normalize('NFC');
    }
    if (Array.isArray(val)) {
        return val.map(item => normalizeUnicode(item));
    }
    if (val !== null && typeof val === 'object' && !(val instanceof Uint8Array) && !(val instanceof Buffer)) {
        const result = {};
        for (const [k, v] of Object.entries(val)) {
            const normKey = typeof k === 'string' ? k.normalize('NFC') : k;
            result[normKey] = normalizeUnicode(v);
        }
        return result;
    }
    return val;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Strips dangerous prototype pollution keys (__proto__, constructor, prototype) recursively.
 * Returns a clean, safe deep clone of the object or array.
 * @param {unknown} val
 * @param {number} [depth=0]
 * @param {number} [maxDepth=50]
 * @returns {unknown}
 */
export function sanitizePrototype(val, depth = 0, maxDepth = 50) {
    if (depth > maxDepth) {
        return null;
    }
    if (val === null || typeof val !== 'object') {
        return val;
    }
    if (val instanceof Uint8Array || val instanceof Buffer) {
        return val;
    }
    if (Array.isArray(val)) {
        return val.map(item => sanitizePrototype(item, depth + 1, maxDepth));
    }
    const clean = Object.create(null);
    for (const key of Object.keys(val)) {
        if (!DANGEROUS_KEYS.has(key)) {
            clean[key] = sanitizePrototype(val[key], depth + 1, maxDepth);
        }
    }
    return { ...clean };
}

/**
 * Deterministically stringifies an object following RFC 8785 Canonical JSON principles
 * (keys sorted lexicographically, recursive normalization).
 * @param {unknown} val
 * @returns {string}
 */
export function canonicalJsonStringify(val) {
    if (val === undefined) {
        return 'null';
    }
    if (val === null || typeof val === 'number' || typeof val === 'boolean') {
        return JSON.stringify(val);
    }
    if (typeof val === 'string') {
        return JSON.stringify(val.normalize('NFC'));
    }
    if (Array.isArray(val)) {
        return `[${val.map(item => canonicalJsonStringify(item)).join(',')}]`;
    }
    if (typeof val === 'object') {
        const sortedKeys = Object.keys(val).filter(k => !DANGEROUS_KEYS.has(k)).sort();
        const entries = [];
        for (const key of sortedKeys) {
            const v = val[key];
            if (v !== undefined) {
                entries.push(`${JSON.stringify(key.normalize('NFC'))}:${canonicalJsonStringify(v)}`);
            }
        }
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(val);
}

/**
 * Computes SHA-256 hash of a string.
 * @param {string} str
 * @param {string} [algorithm='sha256']
 * @returns {string} Hex digest
 */
export function hashString(str, algorithm = 'sha256') {
    const norm = typeof str === 'string' ? str.normalize('NFC') : '';
    return createHash(algorithm).update(norm, 'utf8').digest('hex');
}

/**
 * Computes SHA-256 hash of a Buffer.
 * @param {Buffer | Uint8Array} buf
 * @param {string} [algorithm='sha256']
 * @returns {string} Hex digest
 */
export function hashBuffer(buf, algorithm = 'sha256') {
    return createHash(algorithm).update(buf).digest('hex');
}

/**
 * Computes deterministic SHA-256 hash of an object or data structure.
 * @param {unknown} obj
 * @param {string} [algorithm='sha256']
 * @returns {string} Hex digest
 */
export function hashObject(obj, algorithm = 'sha256') {
    const canonical = canonicalJsonStringify(sanitizePrototype(obj));
    return hashString(canonical, algorithm);
}

/**
 * Computes a deterministic canonical state hash representing all active authored records in a World.
 * Covers all 10 authored tables:
 * - lws_worlds
 * - lws_characters
 * - lws_locations
 * - lws_factions
 * - lws_scenarios
 * - lws_world_rules
 * - lws_authored_prompt_configs
 * - lws_ambient_archetypes
 * - lws_character_factions
 * - lws_scenario_characters
 *
 * Excludes internal auto-increment primary keys and tracks relational topology via stable public UUIDs.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number | string | null} [worldIdentifier=null] Integer ID or UUID of target world, or null for new world preview
 * @returns {string} Canonical state hash hex digest
 */
export function computePreviewStateHash(db, worldIdentifier = null) {
    if (!db || typeof db.prepare !== 'function') {
        return hashString('__NO_DB__');
    }

    if (!worldIdentifier) {
        // Global preview state hash for new world creation (captures existing active world names/lws_ids)
        const worlds = db.prepare(
            'SELECT lws_id, name FROM lws_worlds WHERE deleted_at IS NULL ORDER BY name ASC, lws_id ASC'
        ).all();
        return hashObject({ type: 'global_worlds_state', worlds });
    }

    // Resolve integer world_id
    let worldRow;
    if (typeof worldIdentifier === 'number') {
        worldRow = db.prepare(
            'SELECT id, lws_id, name, description, tags, extensions FROM lws_worlds WHERE id = ? AND deleted_at IS NULL'
        ).get(worldIdentifier);
    } else {
        worldRow = db.prepare(
            'SELECT id, lws_id, name, description, tags, extensions FROM lws_worlds WHERE lws_id = ? AND deleted_at IS NULL'
        ).get(worldIdentifier);
    }

    if (!worldRow) {
        return hashString(`__WORLD_NOT_FOUND_${worldIdentifier}__`);
    }

    const worldId = worldRow.id;
    const world = {
        lws_id: worldRow.lws_id,
        name: worldRow.name,
        description: worldRow.description,
        tags: worldRow.tags,
        extensions: worldRow.extensions,
    };

    // 2. Characters
    const characters = db.prepare(`
        SELECT lws_id, name, description, personality, scenario_context, mes_example,
               author_notes, system_prompt_override, source_version, tags, extensions
        FROM lws_characters
        WHERE world_id = ? AND deleted_at IS NULL
        ORDER BY name ASC, lws_id ASC
    `).all(worldId);

    // 3. Locations
    const locations = db.prepare(`
        SELECT lws_id, name, description, tags, extensions
        FROM lws_locations
        WHERE world_id = ? AND deleted_at IS NULL
        ORDER BY name ASC, lws_id ASC
    `).all(worldId);

    // 4. Factions
    const factions = db.prepare(`
        SELECT lws_id, name, description, tags, extensions
        FROM lws_factions
        WHERE world_id = ? AND deleted_at IS NULL
        ORDER BY name ASC, lws_id ASC
    `).all(worldId);

    // 5. Scenarios (with starting_location_lws_id)
    const scenarios = db.prepare(`
        SELECT s.lws_id, s.name, s.description, s.tags, s.extensions,
               loc.lws_id AS starting_location_lws_id
        FROM lws_scenarios s
        LEFT JOIN lws_locations loc ON s.starting_location_id = loc.id
        WHERE s.world_id = ? AND s.deleted_at IS NULL
        ORDER BY s.name ASC, s.lws_id ASC
    `).all(worldId);

    // 6. World Rules
    const worldRules = db.prepare(`
        SELECT lws_id, sort_order, title, body
        FROM lws_world_rules
        WHERE world_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC
    `).all(worldId);

    // 7. Authored Prompt Config
    const promptConfig = db.prepare(`
        SELECT lws_id, style_notes, tone_notes, format_notes, extensions
        FROM lws_authored_prompt_configs
        WHERE world_id = ?
    `).get(worldId) || null;

    // 8. Ambient Archetypes
    const ambientArchetypes = db.prepare(`
        SELECT lws_id, archetype_key, entity_kind, role_title, name_pool,
               description_template, default_activities, location_tags, time_windows,
               weather_compat, spawn_weight, max_concurrent_instances
        FROM lws_ambient_archetypes
        WHERE world_id = ? AND deleted_at IS NULL
        ORDER BY archetype_key ASC, lws_id ASC
    `).all(worldId);

    // 9. Character Factions (Join Table using public UUIDs)
    const characterFactions = db.prepare(`
        SELECT c.lws_id AS character_lws_id, f.lws_id AS faction_lws_id, cf.role
        FROM lws_character_factions cf
        JOIN lws_characters c ON cf.character_id = c.id
        JOIN lws_factions f ON cf.faction_id = f.id
        WHERE c.world_id = ? AND c.deleted_at IS NULL AND f.deleted_at IS NULL
        ORDER BY c.lws_id ASC, f.lws_id ASC
    `).all(worldId);

    // 10. Scenario Characters (Join Table using public UUIDs)
    const scenarioCharacters = db.prepare(`
        SELECT s.lws_id AS scenario_lws_id, c.lws_id AS character_lws_id, sc.role
        FROM lws_scenario_characters sc
        JOIN lws_scenarios s ON sc.scenario_id = s.id
        JOIN lws_characters c ON sc.character_id = c.id
        WHERE s.world_id = ? AND s.deleted_at IS NULL AND c.deleted_at IS NULL
        ORDER BY s.lws_id ASC, c.lws_id ASC
    `).all(worldId);

    const canonicalState = {
        world,
        characters,
        locations,
        factions,
        scenarios,
        worldRules,
        promptConfig,
        ambientArchetypes,
        characterFactions,
        scenarioCharacters,
    };

    return hashObject(canonicalState);
}

/**
 * 15 minutes TTL default in milliseconds for preview tokens.
 */
export const DEFAULT_PREVIEW_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * Generates an HMAC-SHA256 signed preview token binding target world, candidate hash, preview state hash, and conflict policy.
 *
 * @param {object} params
 * @param {string | null} [params.target_world_lws_id=null]
 * @param {string} params.candidate_hash SHA-256 hash of candidate entities
 * @param {string} params.preview_state_hash State hash of DB at preview time
 * @param {string} [params.conflict_policy='reject']
 * @param {number} [params.ttlMs=DEFAULT_PREVIEW_TOKEN_TTL_MS]
 * @param {string} [params.secret]
 * @returns {string} Base64url-encoded signed token
 */
export function generatePreviewToken({
    target_world_lws_id = null,
    candidate_hash,
    preview_state_hash,
    conflict_policy = 'reject',
    ttlMs = DEFAULT_PREVIEW_TOKEN_TTL_MS,
    secret = tokenSigningSecret,
}) {
    if (!candidate_hash || typeof candidate_hash !== 'string') {
        throw new LwsValidationError('candidate_hash is required to generate preview token', ['candidate_hash']);
    }
    if (!preview_state_hash || typeof preview_state_hash !== 'string') {
        throw new LwsValidationError('preview_state_hash is required to generate preview token', ['preview_state_hash']);
    }

    const now = Date.now();
    const ttl = typeof ttlMs === 'number' ? ttlMs : DEFAULT_PREVIEW_TOKEN_TTL_MS;
    const payload = {
        target_world_lws_id: target_world_lws_id || null,
        candidate_hash,
        preview_state_hash,
        conflict_policy: conflict_policy || 'reject',
        created_at: now,
        expires_at: now + ttl,
    };

    const payloadJson = canonicalJsonStringify(payload);
    const payloadB64 = Buffer.from(payloadJson, 'utf8').toString('base64url');
    const signature = createHmac('sha256', secret).update(payloadB64).digest('hex');

    return `${payloadB64}.${signature}`;
}

/**
 * Decodes and verifies an HMAC preview token.
 *
 * @param {string} token
 * @param {object} [options]
 * @param {string | null} [options.expected_world_lws_id]
 * @param {string} [options.expected_candidate_hash]
 * @param {string} [options.current_state_hash]
 * @param {string} [options.secret]
 * @returns {{ valid: boolean, payload: object, error?: string, code?: string }}
 */
export function verifyPreviewToken(token, options = {}) {
    if (!token || typeof token !== 'string') {
        return { valid: false, payload: null, error: 'Preview token is missing or malformed', code: 'LWS_PREVIEW_TOKEN_MISMATCH' };
    }

    const parts = token.split('.');
    if (parts.length !== 2) {
        return { valid: false, payload: null, error: 'Preview token structure is invalid', code: 'LWS_PREVIEW_TOKEN_MISMATCH' };
    }

    const [payloadB64, signature] = parts;
    const secret = options.secret || tokenSigningSecret;
    const expectedSig = createHmac('sha256', secret).update(payloadB64).digest('hex');

    if (signature !== expectedSig) {
        return { valid: false, payload: null, error: 'Preview token signature verification failed', code: 'LWS_PREVIEW_TOKEN_MISMATCH' };
    }

    let payload;
    try {
        const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
        payload = JSON.parse(payloadJson);
    } catch {
        return { valid: false, payload: null, error: 'Preview token payload cannot be parsed', code: 'LWS_PREVIEW_TOKEN_MISMATCH' };
    }

    // Check expiration
    if (typeof payload.expires_at !== 'number' || Date.now() > payload.expires_at) {
        return { valid: false, payload, error: 'Preview token has expired', code: 'LWS_PREVIEW_TOKEN_EXPIRED' };
    }

    // Check expected world
    if (options.expected_world_lws_id !== undefined) {
        const expectedWorld = options.expected_world_lws_id || null;
        if (payload.target_world_lws_id !== expectedWorld) {
            return {
                valid: false,
                payload,
                error: `Preview token bound to world '${payload.target_world_lws_id}', expected '${expectedWorld}'`,
                code: 'LWS_PREVIEW_TOKEN_MISMATCH',
            };
        }
    }

    // Check expected candidate hash
    if (options.expected_candidate_hash !== undefined) {
        if (payload.candidate_hash !== options.expected_candidate_hash) {
            return {
                valid: false,
                payload,
                error: 'Candidate payload hash does not match preview token',
                code: 'LWS_PREVIEW_TOKEN_MISMATCH',
            };
        }
    }

    // Check state hash if provided for TOCTOU stale check
    if (options.current_state_hash !== undefined) {
        if (payload.preview_state_hash !== options.current_state_hash) {
            return {
                valid: false,
                payload,
                error: 'Authoritative world state changed since preview generation. Stale preview detected.',
                code: 'LWS_STALE_PREVIEW',
            };
        }
    }

    return { valid: true, payload };
}

/**
 * Factory for creating standardized provenance objects adhering to ADR-009 / ADR-019.
 *
 * @param {object} params
 * @param {string} params.source_format ('png' | 'json' | 'yaml' | 'text' | 'sillytavern_card_v1' | 'sillytavern_card_v2' | 'sillytavern_card_v3' | 'worldinfo_v1' | 'lws_world_manifest_v1' | 'freeform')
 * @param {string} [params.source_file_hash]
 * @param {string} [params.source_filename]
 * @param {string} [params.source_version]
 * @param {string} [params.canonical_object_hash]
 * @param {string} [params.extracted_payload_hash]
 * @param {string} [params.secondary_chunk_hash]
 * @param {object} [params.field_mappings]
 * @param {object} [params.unmapped_fields]
 * @param {string[]} [params.inferred_fields]
 * @param {string[]} [params.warnings]
 * @param {object} [params.imported_components]
 * @returns {object} Standardized provenance object
 */
export function createProvenance({
    source_format,
    source_file_hash = null,
    source_filename = null,
    source_version = null,
    canonical_object_hash = null,
    extracted_payload_hash = null,
    secondary_chunk_hash = null,
    field_mappings = {},
    unmapped_fields = {},
    inferred_fields = [],
    warnings = [],
    imported_components = null,
} = {}) {
    const prov = {
        source_format: normalizeUnicode(source_format || 'unknown'),
        source_file_hash: source_file_hash || null,
        source_filename: normalizeUnicode(source_filename || null),
        source_version: normalizeUnicode(source_version || null),
        canonical_object_hash: canonical_object_hash || null,
        extracted_payload_hash: extracted_payload_hash || null,
        secondary_chunk_hash: secondary_chunk_hash || null,
        imported_at: isoNow(),
        field_mappings: sanitizePrototype(field_mappings || {}),
        unmapped_fields: sanitizePrototype(unmapped_fields || {}),
        inferred_fields: Array.isArray(inferred_fields) ? inferred_fields.map(f => normalizeUnicode(f)) : [],
        warnings: Array.isArray(warnings) ? warnings.map(w => normalizeUnicode(w)) : [],
        import_history: [
            {
                action: 'create',
                imported_at: isoNow(),
                source_format: source_format || 'unknown',
            },
        ],
    };

    if (imported_components && typeof imported_components === 'object') {
        prov.imported_components = sanitizePrototype(imported_components);
    }

    return prov;
}

/**
 * Appends a merge action to an existing entity's provenance history.
 *
 * @param {object} existingProvenance
 * @param {object} mergeDetails
 * @returns {object} Updated provenance object
 */
export function appendMergeHistory(existingProvenance, mergeDetails = {}) {
    const prov = sanitizePrototype(existingProvenance || createProvenance({ source_format: 'merge' }));
    if (!Array.isArray(prov.import_history)) {
        prov.import_history = [];
    }

    prov.import_history.push({
        action: 'merge',
        merged_at: isoNow(),
        source_format: mergeDetails.source_format || null,
        source_hash: mergeDetails.source_hash || null,
        updated_fields: Array.isArray(mergeDetails.updated_fields) ? mergeDetails.updated_fields : [],
    });

    if (mergeDetails.unmapped_fields && typeof mergeDetails.unmapped_fields === 'object') {
        prov.unmapped_fields = {
            ...(prov.unmapped_fields || {}),
            ...sanitizePrototype(mergeDetails.unmapped_fields),
        };
    }

    return prov;
}

/**
 * Detects format of raw content / buffer.
 *
 * @param {Buffer | string | object} content
 * @param {string} [filename='']
 * @returns {'png' | 'json' | 'yaml' | 'text'}
 */
export function detectRawFormat(content, filename = '') {
    if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
        // Check PNG signature: 89 50 4E 47 0D 0A 1A 0A
        if (content.length >= 8 &&
            content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e && content[3] === 0x47 &&
            content[4] === 0x0d && content[5] === 0x0a && content[6] === 0x1a && content[7] === 0x0a) {
            return 'png';
        }
        // Try decoding as utf-8 string
        try {
            const str = content.toString('utf8').trim();
            if (str.startsWith('{') || str.startsWith('[')) {
                return 'json';
            }
        } catch {
            // ignore
        }
    }

    if (typeof content === 'object' && content !== null) {
        return 'json';
    }

    if (typeof content === 'string') {
        const trimmed = content.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            return 'json';
        }
        if (filename.endsWith('.yaml') || filename.endsWith('.yml')) {
            return 'yaml';
        }
        return 'text';
    }

    return 'text';
}
