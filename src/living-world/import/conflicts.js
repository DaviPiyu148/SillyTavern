import { createHash } from 'node:crypto';
import { LwsConflictError, LwsValidationError } from '../errors.js';
import {
    normalizeUnicode,
    sanitizePrototype,
} from './common.js';
import { safeJsonParse, generateUuid, isoNow } from '../authored/common.js';

export const CONFLICT_TYPES = Object.freeze({
    IDENTITY_COLLISION_ACTIVE_NAME: 'IDENTITY_COLLISION_ACTIVE_NAME',
    IDENTITY_COLLISION_KEY: 'IDENTITY_COLLISION_KEY',
    IDENTITY_COLLISION_UUID: 'IDENTITY_COLLISION_UUID',
    IDENTITY_COLLISION_RELATIONSHIP: 'IDENTITY_COLLISION_RELATIONSHIP',
    SEMANTIC_CONTRADICTION_FACT: 'SEMANTIC_CONTRADICTION_FACT',
    SEMANTIC_CONTRADICTION_TOPOLOGY: 'SEMANTIC_CONTRADICTION_TOPOLOGY',
    CLASSIFICATION_AMBIGUITY: 'CLASSIFICATION_AMBIGUITY',
    UNRESOLVED_FOREIGN_KEY: 'UNRESOLVED_FOREIGN_KEY',
});

export const CONFLICT_POLICIES = Object.freeze({
    REJECT: 'reject',
    RENAME: 'rename',
    REPLACE: 'replace',
    MERGE: 'merge',
});

/**
 * Derives a canonical conflict ID.
 *
 * @param {string} worldLwsId
 * @param {string} conflictType
 * @param {string} candidateId
 * @param {string} targetIdentifier
 * @returns {string} SHA-256 hex digest
 */
export function deriveConflictId(worldLwsId, conflictType, candidateId, targetIdentifier) {
    const raw = `${worldLwsId || 'global'}:${conflictType}:${candidateId || 'candidate'}:${targetIdentifier}`;
    return createHash('sha256').update(raw).digest('hex');
}

/**
 * Creates a standardized conflict object adhering to Section 7.1.
 *
 * @param {object} params
 * @returns {object} ConflictObject
 */
export function createConflictObject({
    world_lws_id,
    conflict_type,
    candidate_id,
    target_identifier,
    source_ref = null,
    severity = 'blocking_error',
    colliding_entity = null,
    available_resolutions = ['REJECT', 'RENAME', 'REPLACE', 'MERGE'],
}) {
    const conflictId = deriveConflictId(world_lws_id, conflict_type, candidate_id, target_identifier);
    const blocking = severity === 'blocking_error';

    return {
        conflict_id: conflictId,
        candidate_id: candidate_id || generateUuid(),
        conflict_type,
        source_ref: source_ref || { file: 'import_payload' },
        severity,
        blocking,
        colliding_entity,
        available_resolutions,
        resolution_provenance: null,
    };
}

/**
 * Detects all active collisions between candidate entities and existing active database records for a target world.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number | string | null} worldIdentifier
 * @param {object} candidateEntities
 * @returns {object[]} List of ConflictObject
 */
export function detectCollisions(db, worldIdentifier, candidateEntities) {
    if (!db || typeof db.prepare !== 'function') {
        return [];
    }

    const conflicts = [];
    if (!candidateEntities || typeof candidateEntities !== 'object') {
        return conflicts;
    }

    let worldId = null;
    let worldLwsId = null;

    if (worldIdentifier) {
        let worldRow;
        if (typeof worldIdentifier === 'number') {
            worldRow = db.prepare('SELECT id, lws_id, name FROM lws_worlds WHERE id = ? AND deleted_at IS NULL').get(worldIdentifier);
        } else {
            worldRow = db.prepare('SELECT id, lws_id, name FROM lws_worlds WHERE lws_id = ? AND deleted_at IS NULL').get(worldIdentifier);
        }
        if (worldRow) {
            worldId = worldRow.id;
            worldLwsId = worldRow.lws_id;
        }
    }

    // 1. World Root collision (if creating a new world or candidate includes world)
    if (candidateEntities.world?.name) {
        const normWorldName = normalizeUnicode(candidateEntities.world.name.trim());
        const existingWorld = db.prepare(`
            SELECT id, lws_id, name, updated_at FROM lws_worlds
            WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL
        `).get(normWorldName);

        if (existingWorld && (!worldId || existingWorld.id !== worldId)) {
            conflicts.push(createConflictObject({
                world_lws_id: existingWorld.lws_id,
                conflict_type: CONFLICT_TYPES.IDENTITY_COLLISION_ACTIVE_NAME,
                candidate_id: candidateEntities.world.lws_id || 'world_candidate',
                target_identifier: `global:name:world:${normWorldName.toLowerCase()}`,
                colliding_entity: {
                    id: existingWorld.id,
                    lws_id: existingWorld.lws_id,
                    name: existingWorld.name,
                    type: 'world',
                    updated_at: existingWorld.updated_at,
                },
            }));
        }
    }

    if (!worldId) {
        return conflicts;
    }

    // 2. Character collisions
    if (Array.isArray(candidateEntities.characters)) {
        for (const char of candidateEntities.characters) {
            if (!char.name) continue;
            const normName = normalizeUnicode(char.name.trim());

            const existingChar = db.prepare(`
                SELECT id, lws_id, name, updated_at FROM lws_characters
                WHERE world_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL
            `).get(worldId, normName);

            if (existingChar) {
                conflicts.push(createConflictObject({
                    world_lws_id: worldLwsId,
                    conflict_type: CONFLICT_TYPES.IDENTITY_COLLISION_ACTIVE_NAME,
                    candidate_id: char.lws_id || generateUuid(),
                    target_identifier: `${worldLwsId}:name:character:${normName.toLowerCase()}`,
                    colliding_entity: {
                        id: existingChar.id,
                        lws_id: existingChar.lws_id,
                        name: existingChar.name,
                        type: 'character',
                        updated_at: existingChar.updated_at,
                    },
                }));
            }
        }
    }

    // 3. Location collisions
    if (Array.isArray(candidateEntities.locations)) {
        for (const loc of candidateEntities.locations) {
            if (!loc.name) continue;
            const normName = normalizeUnicode(loc.name.trim());

            const existingLoc = db.prepare(`
                SELECT id, lws_id, name, updated_at FROM lws_locations
                WHERE world_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL
            `).get(worldId, normName);

            if (existingLoc) {
                conflicts.push(createConflictObject({
                    world_lws_id: worldLwsId,
                    conflict_type: CONFLICT_TYPES.IDENTITY_COLLISION_ACTIVE_NAME,
                    candidate_id: loc.lws_id || generateUuid(),
                    target_identifier: `${worldLwsId}:name:location:${normName.toLowerCase()}`,
                    colliding_entity: {
                        id: existingLoc.id,
                        lws_id: existingLoc.lws_id,
                        name: existingLoc.name,
                        type: 'location',
                        updated_at: existingLoc.updated_at,
                    },
                }));
            }
        }
    }

    // 4. Faction collisions
    if (Array.isArray(candidateEntities.factions)) {
        for (const fac of candidateEntities.factions) {
            if (!fac.name) continue;
            const normName = normalizeUnicode(fac.name.trim());

            const existingFac = db.prepare(`
                SELECT id, lws_id, name, updated_at FROM lws_factions
                WHERE world_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL
            `).get(worldId, normName);

            if (existingFac) {
                conflicts.push(createConflictObject({
                    world_lws_id: worldLwsId,
                    conflict_type: CONFLICT_TYPES.IDENTITY_COLLISION_ACTIVE_NAME,
                    candidate_id: fac.lws_id || generateUuid(),
                    target_identifier: `${worldLwsId}:name:faction:${normName.toLowerCase()}`,
                    colliding_entity: {
                        id: existingFac.id,
                        lws_id: existingFac.lws_id,
                        name: existingFac.name,
                        type: 'faction',
                        updated_at: existingFac.updated_at,
                    },
                }));
            }
        }
    }

    // 5. Scenario collisions
    if (Array.isArray(candidateEntities.scenarios)) {
        for (const scen of candidateEntities.scenarios) {
            if (!scen.name) continue;
            const normName = normalizeUnicode(scen.name.trim());

            const existingScen = db.prepare(`
                SELECT id, lws_id, name, updated_at FROM lws_scenarios
                WHERE world_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL
            `).get(worldId, normName);

            if (existingScen) {
                conflicts.push(createConflictObject({
                    world_lws_id: worldLwsId,
                    conflict_type: CONFLICT_TYPES.IDENTITY_COLLISION_ACTIVE_NAME,
                    candidate_id: scen.lws_id || generateUuid(),
                    target_identifier: `${worldLwsId}:name:scenario:${normName.toLowerCase()}`,
                    colliding_entity: {
                        id: existingScen.id,
                        lws_id: existingScen.lws_id,
                        name: existingScen.name,
                        type: 'scenario',
                        updated_at: existingScen.updated_at,
                    },
                }));
            }
        }
    }

    // 6. Ambient Archetype key collisions
    if (Array.isArray(candidateEntities.ambient_archetypes)) {
        for (const arch of candidateEntities.ambient_archetypes) {
            if (!arch.archetype_key) continue;
            const normKey = normalizeUnicode(arch.archetype_key.trim());

            const existingArch = db.prepare(`
                SELECT id, lws_id, archetype_key, role_title, updated_at FROM lws_ambient_archetypes
                WHERE world_id = ? AND archetype_key = ? AND deleted_at IS NULL
            `).get(worldId, normKey);

            if (existingArch) {
                conflicts.push(createConflictObject({
                    world_lws_id: worldLwsId,
                    conflict_type: CONFLICT_TYPES.IDENTITY_COLLISION_KEY,
                    candidate_id: arch.lws_id || generateUuid(),
                    target_identifier: `${worldLwsId}:key:${normKey.toLowerCase()}`,
                    colliding_entity: {
                        id: existingArch.id,
                        lws_id: existingArch.lws_id,
                        name: existingArch.role_title || existingArch.archetype_key,
                        type: 'ambient_archetype',
                        updated_at: existingArch.updated_at,
                    },
                }));
            }
        }
    }

    return conflicts;
}

/**
 * Generates an incremental disambiguation name (e.g. "Name (Import 2)", "Name (Import 3)").
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} tableName
 * @param {number} worldId
 * @param {string} baseName
 * @returns {string} Disambiguated unique name
 */
export function generateDisambiguatedName(db, tableName, worldIdentifier, baseName) {
    const cleanBase = baseName.replace(/\s*\(Import\s+\d+\)$/i, '').trim();
    let counter = 2;
    let candidateName = `${cleanBase} (Import ${counter})`;

    let numericWorldId = worldIdentifier;
    if (typeof worldIdentifier === 'string' && tableName !== 'lws_worlds') {
        const w = db.prepare('SELECT id FROM lws_worlds WHERE lws_id = ? AND deleted_at IS NULL').get(worldIdentifier);
        if (w) numericWorldId = w.id;
    }

    const whereClause = tableName === 'lws_worlds' ? 'LOWER(name) = LOWER(?) AND deleted_at IS NULL' : 'world_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL';

    while (true) {
        const stmt = db.prepare(`SELECT id FROM ${tableName} WHERE ${whereClause}`);
        const existing = tableName === 'lws_worlds' ? stmt.get(candidateName) : stmt.get(numericWorldId, candidateName);

        if (!existing) {
            return candidateName;
        }
        counter++;
        candidateName = `${cleanBase} (Import ${counter})`;
    }
}

/**
 * Merges two arrays of tags into a unified unique array.
 *
 * @param {string[]} existingTags
 * @param {string[]} incomingTags
 * @returns {string[]}
 */
export function mergeTags(existingTags, incomingTags) {
    const set = new Set();
    if (Array.isArray(existingTags)) {
        existingTags.forEach(t => typeof t === 'string' && set.add(normalizeUnicode(t.trim())));
    }
    if (Array.isArray(incomingTags)) {
        incomingTags.forEach(t => typeof t === 'string' && set.add(normalizeUnicode(t.trim())));
    }
    return Array.from(set).filter(Boolean);
}

/**
 * Deep merges extensions objects, stripping prototype pollution.
 *
 * @param {object} existingExt
 * @param {object} incomingExt
 * @returns {object}
 */
export function mergeExtensions(existingExt, incomingExt) {
    const cleanExisting = sanitizePrototype(existingExt || {});
    const cleanIncoming = sanitizePrototype(incomingExt || {});

    const merged = { ...cleanExisting };
    for (const [key, val] of Object.entries(cleanIncoming)) {
        if (val !== null && typeof val === 'object' && !Array.isArray(val) && typeof merged[key] === 'object' && !Array.isArray(merged[key])) {
            merged[key] = mergeExtensions(merged[key], val);
        } else {
            merged[key] = val;
        }
    }
    return merged;
}
