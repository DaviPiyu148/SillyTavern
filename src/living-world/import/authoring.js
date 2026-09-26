import { getDb } from '../db.js';
import { LwsValidationError, LwsNotFoundError, LwsConflictError } from '../errors.js';
import {
    generateUuid,
    isoNow,
    safeJsonParse,
} from '../authored/common.js';
import {
    normalizeUnicode,
    sanitizePrototype,
    hashObject,
    computePreviewStateHash,
    generatePreviewToken,
    verifyPreviewToken,
    createProvenance,
    appendMergeHistory,
} from './common.js';
import {
    detectCollisions,
    generateDisambiguatedName,
    mergeTags,
    mergeExtensions,
    CONFLICT_POLICIES,
} from './conflicts.js';
import { validateWorldManifest } from './manifest-importer.js';

/**
 * Generates an advisory preview for an import payload without modifying database state.
 *
 * @param {object} params
 * @param {object} params.candidate_entities Candidate entity graph
 * @param {string | null} [params.target_world_lws_id=null] Target world UUID (or null for new world)
 * @param {string} [params.conflict_policy='reject']
 * @returns {object} Preview result with signed preview_token, conflicts, and summary
 */
export function previewImport({
    candidate_entities,
    target_world_lws_id = null,
    conflict_policy = CONFLICT_POLICIES.REJECT,
}) {
    if (!candidate_entities || typeof candidate_entities !== 'object') {
        throw new LwsValidationError('candidate_entities is required for preview', ['candidate_entities']);
    }

    const db = getDb();
    const cleanCandidates = sanitizePrototype(candidate_entities);

    let targetWorld = null;
    if (target_world_lws_id) {
        targetWorld = db.prepare('SELECT id, lws_id, name FROM lws_worlds WHERE lws_id = ? AND deleted_at IS NULL').get(target_world_lws_id);
        if (!targetWorld) {
            throw new LwsNotFoundError(`Target world '${target_world_lws_id}' not found`);
        }
    }

    const previewStateHash = computePreviewStateHash(db, targetWorld ? targetWorld.id : null);
    const candidateHash = hashObject(cleanCandidates);

    const conflicts = detectCollisions(db, targetWorld ? targetWorld.lws_id : null, cleanCandidates);

    const previewToken = generatePreviewToken({
        target_world_lws_id: targetWorld ? targetWorld.lws_id : null,
        candidate_hash: candidateHash,
        preview_state_hash: previewStateHash,
        conflict_policy,
    });

    const summary = {
        world_name: cleanCandidates.world?.name || (targetWorld ? targetWorld.name : 'New World'),
        characters: Array.isArray(cleanCandidates.characters) ? cleanCandidates.characters.length : 0,
        locations: Array.isArray(cleanCandidates.locations) ? cleanCandidates.locations.length : 0,
        factions: Array.isArray(cleanCandidates.factions) ? cleanCandidates.factions.length : 0,
        world_rules: Array.isArray(cleanCandidates.world_rules) ? cleanCandidates.world_rules.length : 0,
        scenarios: Array.isArray(cleanCandidates.scenarios) ? cleanCandidates.scenarios.length : 0,
        ambient_archetypes: Array.isArray(cleanCandidates.ambient_archetypes) ? cleanCandidates.ambient_archetypes.length : 0,
        lore_entries: Array.isArray(cleanCandidates.lore_entries) ? cleanCandidates.lore_entries.length : 0,
        total_conflicts: conflicts.length,
    };

    return {
        success: true,
        preview_token: previewToken,
        target_world_lws_id: targetWorld ? targetWorld.lws_id : null,
        candidate_entities: cleanCandidates,
        summary,
        conflicts,
        valid: true,
    };
}

/**
 * Executes an atomic SQLite transaction committing candidate entities into authored tables.
 * Enforces TOCTOU validation against the preview token.
 *
 * @param {object} params
 * @param {string} params.preview_token Signed preview token
 * @param {object} params.candidate_entities Normalized candidate graph
 * @param {string | null} [params.target_world_lws_id=null]
 * @param {string} [params.conflict_policy='reject'] ('reject' | 'rename' | 'replace' | 'merge')
 * @param {boolean} [params.preserve_ids=false]
 * @returns {object} Commit result with imported world and created entity counts
 */
export function commitImport({
    preview_token,
    candidate_entities,
    target_world_lws_id = null,
    conflict_policy = CONFLICT_POLICIES.REJECT,
    preserve_ids = false,
}) {
    if (!preview_token || typeof preview_token !== 'string') {
        throw new LwsValidationError('preview_token is required for commit', ['preview_token']);
    }
    if (!candidate_entities || typeof candidate_entities !== 'object') {
        throw new LwsValidationError('candidate_entities is required for commit', ['candidate_entities']);
    }

    const db = getDb();
    const cleanCandidates = sanitizePrototype(candidate_entities);
    const candidateHash = hashObject(cleanCandidates);

    const policy = (conflict_policy || CONFLICT_POLICIES.REJECT).toLowerCase();

    // Execute atomic SQLite transaction with EXCLUSIVE lock to prevent race conditions
    const txn = db.transaction(() => {
        let worldRow = null;
        if (target_world_lws_id) {
            worldRow = db.prepare('SELECT id, lws_id, name, description, tags, extensions FROM lws_worlds WHERE lws_id = ? AND deleted_at IS NULL').get(target_world_lws_id);
            if (!worldRow) {
                throw new LwsNotFoundError(`Target world '${target_world_lws_id}' not found`);
            }
        }

        // 1. TOCTOU Token Verification
        const currentStateHash = computePreviewStateHash(db, worldRow ? worldRow.id : null);
        const tokenVerification = verifyPreviewToken(preview_token, {
            expected_world_lws_id: target_world_lws_id || null,
            expected_candidate_hash: candidateHash,
            current_state_hash: currentStateHash,
        });

        if (!tokenVerification.valid) {
            if (tokenVerification.code === 'LWS_STALE_PREVIEW') {
                const err = new LwsConflictError('Authoritative world state changed since preview generation. Stale preview detected.');
                err.code = 'LWS_STALE_PREVIEW';
                throw err;
            }
            const err = new LwsValidationError(`Preview token verification failed: ${tokenVerification.error}`, ['preview_token']);
            err.code = tokenVerification.code || 'LWS_PREVIEW_TOKEN_MISMATCH';
            throw err;
        }

        // 2. Active Conflict Check under Policy
        const conflicts = detectCollisions(db, worldRow ? worldRow.lws_id : null, cleanCandidates);
        if (conflicts.length > 0 && policy === CONFLICT_POLICIES.REJECT) {
            const err = new LwsConflictError(`Cannot commit import: ${conflicts.length} active entity collision(s) detected with policy 'reject'.`);
            err.code = 'LWS_CONFLICT';
            err.conflicts = conflicts;
            throw err;
        }

        const now = isoNow();
        const idMap = new Map(); // sourceLwsId -> committedLwsId
        const counts = {
            characters: 0,
            locations: 0,
            factions: 0,
            world_rules: 0,
            scenarios: 0,
            ambient_archetypes: 0,
        };
        const entities = {
            characters: [],
            locations: [],
            factions: [],
            world_rules: [],
            scenarios: [],
            ambient_archetypes: [],
        };

        // 3. World Root Processing
        let targetWorldId;
        let targetWorldLwsId;

        if (worldRow) {
            targetWorldId = worldRow.id;
            targetWorldLwsId = worldRow.lws_id;

            if (cleanCandidates.world) {
                const incomingWorld = cleanCandidates.world;
                if (policy === CONFLICT_POLICIES.MERGE) {
                    const mergedDesc = incomingWorld.description ? incomingWorld.description : worldRow.description;
                    const existingTags = safeJsonParse(worldRow.tags, []);
                    const mergedTags = mergeTags(existingTags, incomingWorld.tags || []);
                    const existingExt = safeJsonParse(worldRow.extensions, {});
                    const mergedExt = mergeExtensions(existingExt, incomingWorld.extensions || {});

                    db.prepare(`
                        UPDATE lws_worlds SET description = ?, tags = ?, extensions = ?, updated_at = ?
                        WHERE id = ?
                    `).run(mergedDesc, JSON.stringify(mergedTags), JSON.stringify(mergedExt), now, targetWorldId);
                }
            }
        } else {
            // Create fresh world
            const rawName = cleanCandidates.world?.name || 'Imported World';
            let worldName = normalizeUnicode(rawName.trim());

            if (policy === CONFLICT_POLICIES.RENAME) {
                worldName = generateDisambiguatedName(db, 'lws_worlds', null, worldName);
            } else if (policy === CONFLICT_POLICIES.REPLACE) {
                const existing = db.prepare('SELECT id FROM lws_worlds WHERE LOWER(name) = LOWER(?) AND deleted_at IS NULL').get(worldName);
                if (existing) {
                    db.prepare('UPDATE lws_worlds SET deleted_at = ? WHERE id = ?').run(now, existing.id);
                }
            }

            const worldLwsId = (preserve_ids && cleanCandidates.world?.lws_id) ? cleanCandidates.world.lws_id : generateUuid();
            const desc = cleanCandidates.world?.description || '';
            const tags = cleanCandidates.world?.tags || [];
            const extensions = cleanCandidates.world?.extensions || {};

            db.prepare(`
                INSERT INTO lws_worlds (lws_id, name, description, tags, extensions, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(worldLwsId, worldName, desc, JSON.stringify(tags), JSON.stringify(extensions), now, now);

            const inserted = db.prepare('SELECT id, lws_id, name, description, tags, extensions, created_at, updated_at FROM lws_worlds WHERE lws_id = ?').get(worldLwsId);
            targetWorldId = inserted.id;
            targetWorldLwsId = inserted.lws_id;
            worldRow = inserted;
        }

        // 4. Locations Processing (Root to Leaf)
        if (Array.isArray(cleanCandidates.locations)) {
            for (const loc of cleanCandidates.locations) {
                if (!loc || !loc.name) continue;
                let locName = normalizeUnicode(loc.name.trim());
                let locLwsId = (preserve_ids && loc.lws_id) ? loc.lws_id : generateUuid();

                const existingLoc = db.prepare(`
                    SELECT id, lws_id, name, description, tags, extensions
                    FROM lws_locations
                    WHERE world_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL
                `).get(targetWorldId, locName);

                if (existingLoc) {
                    if (policy === CONFLICT_POLICIES.RENAME) {
                        locName = generateDisambiguatedName(db, 'lws_locations', targetWorldId, locName);
                        locLwsId = generateUuid();
                    } else if (policy === CONFLICT_POLICIES.REPLACE) {
                        db.prepare('UPDATE lws_locations SET deleted_at = ? WHERE id = ?').run(now, existingLoc.id);
                        locLwsId = generateUuid();
                    } else if (policy === CONFLICT_POLICIES.MERGE) {
                        const mergedDesc = loc.description ? loc.description : existingLoc.description;
                        const mergedTags = mergeTags(safeJsonParse(existingLoc.tags, []), loc.tags || []);
                        const mergedExt = mergeExtensions(safeJsonParse(existingLoc.extensions, {}), loc.extensions || {});

                        db.prepare(`
                            UPDATE lws_locations SET description = ?, tags = ?, extensions = ?, updated_at = ?
                            WHERE id = ?
                        `).run(mergedDesc, JSON.stringify(mergedTags), JSON.stringify(mergedExt), now, existingLoc.id);

                        idMap.set(loc.lws_id || locName, existingLoc.lws_id);
                        counts.locations++;
                        entities.locations.push({ id: existingLoc.id, lws_id: existingLoc.lws_id, name: locName });
                        continue;
                    }
                }

                const locExt = sanitizePrototype(loc.extensions || {});
                if (loc.parent_location_lws_id) {
                    locExt.parent_location_lws_id = idMap.get(loc.parent_location_lws_id) || loc.parent_location_lws_id;
                }

                db.prepare(`
                    INSERT INTO lws_locations (lws_id, world_id, name, description, tags, extensions, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(locLwsId, targetWorldId, locName, loc.description || '', JSON.stringify(loc.tags || []), JSON.stringify(locExt), now, now);

                const inserted = db.prepare('SELECT id, lws_id, name FROM lws_locations WHERE lws_id = ?').get(locLwsId);
                if (loc.lws_id) idMap.set(loc.lws_id, locLwsId);
                idMap.set(locName, locLwsId);
                counts.locations++;
                entities.locations.push(inserted);
            }
        }

        // 5. Factions Processing
        if (Array.isArray(cleanCandidates.factions)) {
            for (const fac of cleanCandidates.factions) {
                if (!fac || !fac.name) continue;
                let facName = normalizeUnicode(fac.name.trim());
                let facLwsId = (preserve_ids && fac.lws_id) ? fac.lws_id : generateUuid();

                const existingFac = db.prepare(`
                    SELECT id, lws_id, name, description, tags, extensions
                    FROM lws_factions
                    WHERE world_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL
                `).get(targetWorldId, facName);

                if (existingFac) {
                    if (policy === CONFLICT_POLICIES.RENAME) {
                        facName = generateDisambiguatedName(db, 'lws_factions', targetWorldId, facName);
                        facLwsId = generateUuid();
                    } else if (policy === CONFLICT_POLICIES.REPLACE) {
                        db.prepare('UPDATE lws_factions SET deleted_at = ? WHERE id = ?').run(now, existingFac.id);
                        facLwsId = generateUuid();
                    } else if (policy === CONFLICT_POLICIES.MERGE) {
                        const mergedDesc = fac.description ? fac.description : existingFac.description;
                        const mergedTags = mergeTags(safeJsonParse(existingFac.tags, []), fac.tags || []);
                        const mergedExt = mergeExtensions(safeJsonParse(existingFac.extensions, {}), fac.extensions || {});

                        db.prepare(`
                            UPDATE lws_factions SET description = ?, tags = ?, extensions = ?, updated_at = ?
                            WHERE id = ?
                        `).run(mergedDesc, JSON.stringify(mergedTags), JSON.stringify(mergedExt), now, existingFac.id);

                        idMap.set(fac.lws_id || facName, existingFac.lws_id);
                        counts.factions++;
                        entities.factions.push({ id: existingFac.id, lws_id: existingFac.lws_id, name: facName });
                        continue;
                    }
                }

                db.prepare(`
                    INSERT INTO lws_factions (lws_id, world_id, name, description, tags, extensions, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(facLwsId, targetWorldId, facName, fac.description || '', JSON.stringify(fac.tags || []), JSON.stringify(fac.extensions || {}), now, now);

                const inserted = db.prepare('SELECT id, lws_id, name FROM lws_factions WHERE lws_id = ?').get(facLwsId);
                if (fac.lws_id) idMap.set(fac.lws_id, facLwsId);
                idMap.set(facName, facLwsId);
                counts.factions++;
                entities.factions.push(inserted);
            }
        }

        // 6. Characters Processing
        if (Array.isArray(cleanCandidates.characters)) {
            for (const char of cleanCandidates.characters) {
                if (!char || !char.name) continue;
                let charName = normalizeUnicode(char.name.trim());
                let charLwsId = (preserve_ids && char.lws_id) ? char.lws_id : generateUuid();

                const existingChar = db.prepare(`
                    SELECT id, lws_id, name, description, personality, scenario_context, mes_example,
                           author_notes, system_prompt_override, source_version, tags, extensions
                    FROM lws_characters
                    WHERE world_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL
                `).get(targetWorldId, charName);

                if (existingChar) {
                    if (policy === CONFLICT_POLICIES.RENAME) {
                        charName = generateDisambiguatedName(db, 'lws_characters', targetWorldId, charName);
                        charLwsId = generateUuid();
                    } else if (policy === CONFLICT_POLICIES.REPLACE) {
                        db.prepare('UPDATE lws_characters SET deleted_at = ? WHERE id = ?').run(now, existingChar.id);
                        charLwsId = generateUuid();
                    } else if (policy === CONFLICT_POLICIES.MERGE) {
                        const updatedFields = [];
                        const desc = char.description ? (updatedFields.push('description'), char.description) : existingChar.description;
                        const pers = char.personality ? (updatedFields.push('personality'), char.personality) : existingChar.personality;
                        const scen = char.scenario_context ? (updatedFields.push('scenario_context'), char.scenario_context) : existingChar.scenario_context;
                        const mesEx = char.mes_example ? (updatedFields.push('mes_example'), char.mes_example) : existingChar.mes_example;
                        const authN = char.author_notes ? (updatedFields.push('author_notes'), char.author_notes) : existingChar.author_notes;
                        const sysP = char.system_prompt_override ? (updatedFields.push('system_prompt_override'), char.system_prompt_override) : existingChar.system_prompt_override;
                        const sVer = char.source_version ? (updatedFields.push('source_version'), char.source_version) : existingChar.source_version;
                        const tags = mergeTags(safeJsonParse(existingChar.tags, []), char.tags || []);
                        const ext = mergeExtensions(safeJsonParse(existingChar.extensions, {}), char.extensions || {});

                        ext.provenance = appendMergeHistory(ext.provenance, {
                            source_format: 'character_merge',
                            updated_fields: updatedFields,
                            unmapped_fields: char.extensions?.unmapped_fields,
                        });

                        db.prepare(`
                            UPDATE lws_characters
                            SET description = ?, personality = ?, scenario_context = ?, mes_example = ?,
                                author_notes = ?, system_prompt_override = ?, source_version = ?,
                                tags = ?, extensions = ?, updated_at = ?
                            WHERE id = ?
                        `).run(desc, pers, scen, mesEx, authN, sysP, sVer, JSON.stringify(tags), JSON.stringify(ext), now, existingChar.id);

                        idMap.set(char.lws_id || charName, existingChar.lws_id);
                        counts.characters++;
                        entities.characters.push({ id: existingChar.id, lws_id: existingChar.lws_id, name: charName });
                        continue;
                    }
                }

                db.prepare(`
                    INSERT INTO lws_characters (
                        lws_id, world_id, name, description, personality, scenario_context,
                        mes_example, author_notes, system_prompt_override, source_version,
                        tags, extensions, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    charLwsId,
                    targetWorldId,
                    charName,
                    char.description || '',
                    char.personality || '',
                    char.scenario_context || '',
                    char.mes_example || '',
                    char.author_notes || '',
                    char.system_prompt_override || '',
                    char.source_version || '',
                    JSON.stringify(char.tags || []),
                    JSON.stringify(char.extensions || {}),
                    now,
                    now
                );

                const inserted = db.prepare('SELECT id, lws_id, name FROM lws_characters WHERE lws_id = ?').get(charLwsId);
                if (char.lws_id) idMap.set(char.lws_id, charLwsId);
                idMap.set(charName, charLwsId);
                counts.characters++;
                entities.characters.push(inserted);
            }
        }

        // 7. Character Factions (Join Table)
        if (Array.isArray(cleanCandidates.character_factions)) {
            for (const cf of cleanCandidates.character_factions) {
                const charLwsId = idMap.get(cf.character_lws_id) || cf.character_lws_id;
                const facLwsId = idMap.get(cf.faction_lws_id) || cf.faction_lws_id;

                if (!charLwsId || !facLwsId) continue;

                const charRow = db.prepare('SELECT id FROM lws_characters WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL').get(charLwsId, targetWorldId);
                const facRow = db.prepare('SELECT id FROM lws_factions WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL').get(facLwsId, targetWorldId);

                if (charRow && facRow) {
                    const existingJoin = db.prepare('SELECT role FROM lws_character_factions WHERE character_id = ? AND faction_id = ?').get(charRow.id, facRow.id);
                    if (existingJoin) {
                        if (cf.role && cf.role !== existingJoin.role) {
                            db.prepare('UPDATE lws_character_factions SET role = ? WHERE character_id = ? AND faction_id = ?').run(cf.role, charRow.id, facRow.id);
                        }
                    } else {
                        db.prepare('INSERT INTO lws_character_factions (character_id, faction_id, role) VALUES (?, ?, ?)').run(charRow.id, facRow.id, cf.role || '');
                    }
                }
            }
        }

        // 8. World Rules Processing
        if (Array.isArray(cleanCandidates.world_rules)) {
            for (const rule of cleanCandidates.world_rules) {
                if (!rule || !rule.title) continue;
                const title = normalizeUnicode(rule.title.trim());
                const body = normalizeUnicode(rule.body || title);
                const sortOrder = typeof rule.sort_order === 'number' ? rule.sort_order : 1;
                const ruleLwsId = (preserve_ids && rule.lws_id) ? rule.lws_id : generateUuid();

                const existingRule = db.prepare(`
                    SELECT id, lws_id, title, body FROM lws_world_rules
                    WHERE world_id = ? AND LOWER(title) = LOWER(?) AND deleted_at IS NULL
                `).get(targetWorldId, title);

                if (existingRule) {
                    if (policy === CONFLICT_POLICIES.REPLACE) {
                        db.prepare('UPDATE lws_world_rules SET deleted_at = ? WHERE id = ?').run(now, existingRule.id);
                    } else if (policy === CONFLICT_POLICIES.MERGE) {
                        db.prepare('UPDATE lws_world_rules SET body = ?, updated_at = ? WHERE id = ?').run(body, now, existingRule.id);
                        counts.world_rules++;
                        entities.world_rules.push({ id: existingRule.id, lws_id: existingRule.lws_id, title });
                        continue;
                    }
                }

                db.prepare(`
                    INSERT INTO lws_world_rules (lws_id, world_id, sort_order, title, body, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `).run(ruleLwsId, targetWorldId, sortOrder, title, body, now, now);

                const inserted = db.prepare('SELECT id, lws_id, title FROM lws_world_rules WHERE lws_id = ?').get(ruleLwsId);
                counts.world_rules++;
                entities.world_rules.push(inserted);
            }
        }

        // 9. Scenarios Processing
        if (Array.isArray(cleanCandidates.scenarios)) {
            for (const scen of cleanCandidates.scenarios) {
                if (!scen || !scen.name) continue;
                let scenName = normalizeUnicode(scen.name.trim());
                let scenLwsId = (preserve_ids && scen.lws_id) ? scen.lws_id : generateUuid();

                let startingLocationId = null;
                if (scen.starting_location_lws_id) {
                    const resolvedLocLwsId = idMap.get(scen.starting_location_lws_id) || scen.starting_location_lws_id;
                    const locRow = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL').get(resolvedLocLwsId, targetWorldId);
                    if (locRow) startingLocationId = locRow.id;
                }

                const existingScen = db.prepare(`
                    SELECT id, lws_id, name, description, tags, extensions
                    FROM lws_scenarios
                    WHERE world_id = ? AND LOWER(name) = LOWER(?) AND deleted_at IS NULL
                `).get(targetWorldId, scenName);

                if (existingScen) {
                    if (policy === CONFLICT_POLICIES.RENAME) {
                        scenName = generateDisambiguatedName(db, 'lws_scenarios', targetWorldId, scenName);
                        scenLwsId = generateUuid();
                    } else if (policy === CONFLICT_POLICIES.REPLACE) {
                        db.prepare('UPDATE lws_scenarios SET deleted_at = ? WHERE id = ?').run(now, existingScen.id);
                        scenLwsId = generateUuid();
                    } else if (policy === CONFLICT_POLICIES.MERGE) {
                        const mergedDesc = scen.description ? scen.description : existingScen.description;
                        const mergedTags = mergeTags(safeJsonParse(existingScen.tags, []), scen.tags || []);
                        const mergedExt = mergeExtensions(safeJsonParse(existingScen.extensions, {}), scen.extensions || {});

                        db.prepare(`
                            UPDATE lws_scenarios SET description = ?, tags = ?, extensions = ?, updated_at = ?
                            WHERE id = ?
                        `).run(mergedDesc, JSON.stringify(mergedTags), JSON.stringify(mergedExt), now, existingScen.id);

                        idMap.set(scen.lws_id || scenName, existingScen.lws_id);
                        counts.scenarios++;
                        entities.scenarios.push({ id: existingScen.id, lws_id: existingScen.lws_id, name: scenName });
                        continue;
                    }
                }

                db.prepare(`
                    INSERT INTO lws_scenarios (lws_id, world_id, name, description, starting_location_id, tags, extensions, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    scenLwsId,
                    targetWorldId,
                    scenName,
                    scen.description || '',
                    startingLocationId,
                    JSON.stringify(scen.tags || []),
                    JSON.stringify(scen.extensions || {}),
                    now,
                    now
                );

                const inserted = db.prepare('SELECT id, lws_id, name FROM lws_scenarios WHERE lws_id = ?').get(scenLwsId);
                if (scen.lws_id) idMap.set(scen.lws_id, scenLwsId);
                idMap.set(scenName, scenLwsId);
                counts.scenarios++;
                entities.scenarios.push(inserted);
            }
        }

        // 10. Scenario Characters (Join Table)
        if (Array.isArray(cleanCandidates.scenario_characters)) {
            for (const sc of cleanCandidates.scenario_characters) {
                const scenLwsId = idMap.get(sc.scenario_lws_id) || sc.scenario_lws_id;
                const charLwsId = idMap.get(sc.character_lws_id) || sc.character_lws_id;

                if (!scenLwsId || !charLwsId) continue;

                const scenRow = db.prepare('SELECT id FROM lws_scenarios WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL').get(scenLwsId, targetWorldId);
                const charRow = db.prepare('SELECT id FROM lws_characters WHERE lws_id = ? AND world_id = ? AND deleted_at IS NULL').get(charLwsId, targetWorldId);

                if (scenRow && charRow) {
                    const existingJoin = db.prepare('SELECT role FROM lws_scenario_characters WHERE scenario_id = ? AND character_id = ?').get(scenRow.id, charRow.id);
                    if (existingJoin) {
                        if (sc.role && sc.role !== existingJoin.role) {
                            db.prepare('UPDATE lws_scenario_characters SET role = ? WHERE scenario_id = ? AND character_id = ?').run(sc.role, scenRow.id, charRow.id);
                        }
                    } else {
                        db.prepare('INSERT INTO lws_scenario_characters (scenario_id, character_id, role) VALUES (?, ?, ?)').run(scenRow.id, charRow.id, sc.role || '');
                    }
                }
            }
        }

        // 11. Ambient Archetypes Processing
        if (Array.isArray(cleanCandidates.ambient_archetypes)) {
            for (const arch of cleanCandidates.ambient_archetypes) {
                if (!arch || !arch.archetype_key) continue;
                const key = normalizeUnicode(arch.archetype_key.trim());
                const archLwsId = (preserve_ids && arch.lws_id) ? arch.lws_id : generateUuid();

                const existingArch = db.prepare(`
                    SELECT id, lws_id, archetype_key, role_title, name_pool, default_activities, location_tags, time_windows
                    FROM lws_ambient_archetypes
                    WHERE world_id = ? AND archetype_key = ? AND deleted_at IS NULL
                `).get(targetWorldId, key);

                if (existingArch) {
                    if (policy === CONFLICT_POLICIES.REPLACE) {
                        db.prepare('UPDATE lws_ambient_archetypes SET deleted_at = ? WHERE id = ?').run(now, existingArch.id);
                    } else if (policy === CONFLICT_POLICIES.MERGE) {
                        const roleTitle = arch.role_title || existingArch.role_title;
                        const namePool = mergeTags(safeJsonParse(existingArch.name_pool, []), arch.name_pool || []);
                        const defAct = mergeTags(safeJsonParse(existingArch.default_activities, []), arch.default_activities || []);
                        const locTags = mergeTags(safeJsonParse(existingArch.location_tags, []), arch.location_tags || []);

                        db.prepare(`
                            UPDATE lws_ambient_archetypes
                            SET role_title = ?, name_pool = ?, default_activities = ?, location_tags = ?, updated_at = ?
                            WHERE id = ?
                        `).run(roleTitle, JSON.stringify(namePool), JSON.stringify(defAct), JSON.stringify(locTags), now, existingArch.id);

                        counts.ambient_archetypes++;
                        entities.ambient_archetypes.push({ id: existingArch.id, lws_id: existingArch.lws_id, archetype_key: key });
                        continue;
                    }
                }

                db.prepare(`
                    INSERT INTO lws_ambient_archetypes (
                        lws_id, world_id, archetype_key, entity_kind, role_title, name_pool,
                        description_template, default_activities, location_tags, time_windows,
                        weather_compat, spawn_weight, max_concurrent_instances, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    archLwsId,
                    targetWorldId,
                    key,
                    arch.entity_kind || 'person',
                    arch.role_title || key,
                    JSON.stringify(arch.name_pool || [arch.role_title || key]),
                    arch.description_template || `${arch.role_title || key} in the world`,
                    JSON.stringify(arch.default_activities || ['wandering']),
                    JSON.stringify(arch.location_tags || []),
                    JSON.stringify(arch.time_windows || ['morning', 'afternoon', 'evening']),
                    JSON.stringify(arch.weather_compat || null),
                    arch.spawn_weight ?? 50,
                    arch.max_concurrent_instances ?? 5,
                    now,
                    now
                );

                const inserted = db.prepare('SELECT id, lws_id, archetype_key FROM lws_ambient_archetypes WHERE lws_id = ?').get(archLwsId);
                counts.ambient_archetypes++;
                entities.ambient_archetypes.push(inserted);
            }
        }

        // 12. Authored Prompt Config Processing
        if (cleanCandidates.prompt_config && typeof cleanCandidates.prompt_config === 'object') {
            const pc = cleanCandidates.prompt_config;
            const existingConfig = db.prepare('SELECT id FROM lws_authored_prompt_configs WHERE world_id = ?').get(targetWorldId);

            if (existingConfig) {
                db.prepare(`
                    UPDATE lws_authored_prompt_configs
                    SET style_notes = ?, tone_notes = ?, format_notes = ?, extensions = ?, updated_at = ?
                    WHERE world_id = ?
                `).run(pc.style_notes || '', pc.tone_notes || '', pc.format_notes || '', JSON.stringify(pc.extensions || {}), now, targetWorldId);
            } else {
                const pcLwsId = (preserve_ids && pc.lws_id) ? pc.lws_id : generateUuid();
                db.prepare(`
                    INSERT INTO lws_authored_prompt_configs (lws_id, world_id, style_notes, tone_notes, format_notes, extensions, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `).run(pcLwsId, targetWorldId, pc.style_notes || '', pc.tone_notes || '', pc.format_notes || '', JSON.stringify(pc.extensions || {}), now, now);
            }
        }

        // Update World Extensions Provenance Component Manifest
        const currentWorld = db.prepare('SELECT extensions FROM lws_worlds WHERE id = ?').get(targetWorldId);
        const worldExt = safeJsonParse(currentWorld.extensions, {});
        worldExt.provenance = worldExt.provenance || createProvenance({ source_format: 'authored_import_bundle' });
        worldExt.provenance.imported_components = worldExt.provenance.imported_components || {};

        worldExt.provenance.imported_components.world_rules = worldExt.provenance.imported_components.world_rules || {};
        for (const r of entities.world_rules) {
            worldExt.provenance.imported_components.world_rules[r.lws_id] = { title: r.title, imported_at: now };
        }

        worldExt.provenance.imported_components.ambient_archetypes = worldExt.provenance.imported_components.ambient_archetypes || {};
        for (const a of entities.ambient_archetypes) {
            worldExt.provenance.imported_components.ambient_archetypes[a.lws_id] = { archetype_key: a.archetype_key, imported_at: now };
        }

        db.prepare('UPDATE lws_worlds SET extensions = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(worldExt), now, targetWorldId);

        const finalWorld = db.prepare('SELECT id, lws_id, name, description, tags, extensions, created_at, updated_at FROM lws_worlds WHERE id = ?').get(targetWorldId);

        return {
            success: true,
            world: {
                id: finalWorld.id,
                lws_id: finalWorld.lws_id,
                name: finalWorld.name,
                description: finalWorld.description,
                tags: safeJsonParse(finalWorld.tags, []),
                extensions: safeJsonParse(finalWorld.extensions, {}),
                created_at: finalWorld.created_at,
                updated_at: finalWorld.updated_at,
            },
            imported_counts: counts,
            entities,
        };
    });

    return txn();
}
