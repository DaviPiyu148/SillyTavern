import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import {
    VERACITY_TYPES,
    clamp,
    formatSocialInformation,
    generateDeterministicUuid,
    isValidUuid,
} from './common.js';
import { upsertCharacterBelief } from '../perception/beliefs.js';
import { getRelationshipByCharacters } from './relationships.js';

/**
 * Validates the 12 topological invariants of a rumor transmission tree node.
 * Fails closed with LwsValidationError on any invariant violation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {object} rumorData
 * @param {object} [event] Optional committed or in-flight COMMUNICATE event
 * @returns {object} Normalized and validated node attributes
 */
export function validateRumorTreeTopology(db, simId, rumorData = {}, event = null) {
    if (!rumorData || typeof rumorData !== 'object') {
        throw new LwsValidationError('Rumor payload must be an object', ['rumor']);
    }

    const depth = Number(rumorData.transmission_depth ?? 0);
    if (!Number.isInteger(depth) || depth < 0 || depth > 5) {
        throw new LwsValidationError('transmission_depth must be an integer between 0 and 5', ['transmission_depth']);
    }

    const distortionLevel = Number(rumorData.distortion_level ?? 0);
    if (!Number.isInteger(distortionLevel) || distortionLevel < 0 || distortionLevel > 100) {
        throw new LwsValidationError('distortion_level must be an integer between 0 and 100', ['distortion_level']);
    }

    const confidenceScore = Number(rumorData.confidence_score ?? 50);
    if (!Number.isInteger(confidenceScore) || confidenceScore < 1 || confidenceScore > 100) {
        throw new LwsValidationError('confidence_score must be an integer between 1 and 100', ['confidence_score']);
    }

    const veracity = rumorData.veracity || 'unknown';
    if (!VERACITY_TYPES.includes(veracity)) {
        throw new LwsValidationError(`Invalid veracity '${veracity}'`, ['veracity']);
    }

    if (!rumorData.subject_key || typeof rumorData.subject_key !== 'string') {
        throw new LwsValidationError('subject_key is required', ['subject_key']);
    }
    if (!rumorData.topic || typeof rumorData.topic !== 'string') {
        throw new LwsValidationError('topic is required', ['topic']);
    }
    if (!rumorData.claim_statement || typeof rumorData.claim_statement !== 'string') {
        throw new LwsValidationError('claim_statement is required', ['claim_statement']);
    }

    let parentRow = null;
    let rootRow = null;

    // Resolve parent if provided
    if (rumorData.parent_social_information_id) {
        const parentKey = rumorData.parent_social_information_id;
        parentRow = typeof parentKey === 'number'
            ? db.prepare('SELECT * FROM lws_social_information WHERE id = ?').get(parentKey)
            : db.prepare('SELECT * FROM lws_social_information WHERE lws_id = ?').get(parentKey);

        if (!parentRow) {
            throw new LwsValidationError('Referenced parent social information does not exist', ['parent_social_information_id']);
        }
        // Invariant 4: Same simulation
        if (parentRow.simulation_id !== simId) {
            throw new LwsValidationError('Parent social information belongs to a different simulation', ['parent_social_information_id']);
        }
    }

    // Resolve root if provided
    if (rumorData.root_social_information_id) {
        const rootKey = rumorData.root_social_information_id;
        rootRow = typeof rootKey === 'number'
            ? db.prepare('SELECT * FROM lws_social_information WHERE id = ?').get(rootKey)
            : db.prepare('SELECT * FROM lws_social_information WHERE lws_id = ?').get(rootKey);

        if (!rootRow) {
            throw new LwsValidationError('Referenced root social information does not exist', ['root_social_information_id']);
        }
        // Invariant 5: Same simulation
        if (rootRow.simulation_id !== simId) {
            throw new LwsValidationError('Root social information belongs to a different simulation', ['root_social_information_id']);
        }
    }

    // Invariant 2: Root Nodes (D = 0)
    if (depth === 0) {
        if (parentRow !== null) {
            throw new LwsValidationError('Root social information (depth 0) cannot have a parent', ['parent_social_information_id']);
        }
        if (rootRow !== null && rootRow.id !== rumorData.id && rootRow.lws_id !== rumorData.lws_id) {
            throw new LwsValidationError('Root social information must self-reference as root', ['root_social_information_id']);
        }
        // Invariant 10: Root claims are originator claims, not transmission hops
        if (rumorData.transmitter_character_id || rumorData.recipient_character_id) {
            throw new LwsValidationError('Root social information (depth 0) must not declare transmitter or recipient characters', ['transmitter_character_id']);
        }
    }

    // Invariant 3 & 6: Non-Root Nodes (D >= 1)
    if (depth > 0) {
        if (!parentRow) {
            throw new LwsValidationError('Non-root social information (depth > 0) must have a non-null parent', ['parent_social_information_id']);
        }
        if (depth !== parentRow.transmission_depth + 1) {
            throw new LwsValidationError(`transmission_depth (${depth}) must equal parent transmission_depth + 1 (${parentRow.transmission_depth + 1})`, ['transmission_depth']);
        }
        const expectedRootId = parentRow.root_social_information_id || parentRow.id;
        if (!rootRow) {
            // Inherit parent's root
            rootRow = db.prepare('SELECT * FROM lws_social_information WHERE id = ?').get(expectedRootId);
        }
        if (!rootRow || rootRow.id !== expectedRootId) {
            throw new LwsValidationError('root_social_information_id must match parent root_social_information_id', ['root_social_information_id']);
        }
        if (rootRow.parent_social_information_id !== null || rootRow.transmission_depth !== 0) {
            throw new LwsValidationError('Referenced root node is not a valid root (parent must be NULL and depth must be 0)', ['root_social_information_id']);
        }

        // Invariant 11: Acyclicity check (traversing up parent chain)
        let curr = parentRow;
        const visited = new Set();
        if (rumorData.id) visited.add(rumorData.id);
        if (rumorData.lws_id) visited.add(rumorData.lws_id);

        while (curr) {
            if (visited.has(curr.id) || (curr.lws_id && visited.has(curr.lws_id))) {
                throw new LwsValidationError('Cycle detected in rumor transmission tree', ['parent_social_information_id']);
            }
            visited.add(curr.id);
            if (curr.lws_id) visited.add(curr.lws_id);
            curr = curr.parent_social_information_id
                ? db.prepare('SELECT * FROM lws_social_information WHERE id = ?').get(curr.parent_social_information_id)
                : null;
        }
    }

    // Invariant 7: Transmitter and recipient character simulation integrity
    let transmitterRow = null;
    let recipientRow = null;

    if (rumorData.transmitter_character_id) {
        transmitterRow = typeof rumorData.transmitter_character_id === 'number'
            ? db.prepare('SELECT id, lws_id, simulation_id FROM lws_simulation_characters WHERE id = ?').get(rumorData.transmitter_character_id)
            : db.prepare('SELECT id, lws_id, simulation_id FROM lws_simulation_characters WHERE lws_id = ?').get(rumorData.transmitter_character_id);

        if (!transmitterRow || transmitterRow.simulation_id !== simId) {
            throw new LwsValidationError('Transmitter character does not belong to this simulation', ['transmitter_character_id']);
        }
    }

    if (rumorData.recipient_character_id) {
        recipientRow = typeof rumorData.recipient_character_id === 'number'
            ? db.prepare('SELECT id, lws_id, simulation_id FROM lws_simulation_characters WHERE id = ?').get(rumorData.recipient_character_id)
            : db.prepare('SELECT id, lws_id, simulation_id FROM lws_simulation_characters WHERE lws_id = ?').get(rumorData.recipient_character_id);

        if (!recipientRow || recipientRow.simulation_id !== simId) {
            throw new LwsValidationError('Recipient character does not belong to this simulation', ['recipient_character_id']);
        }
    }

    // Invariant 8 & 9: Causal event verification
    if (rumorData.causal_event_id || event) {
        const evKey = rumorData.causal_event_id || event?.event_internal_id || event?.id || event?.lws_id;
        const evRow = typeof evKey === 'number'
            ? db.prepare('SELECT id, lws_id, simulation_id, event_type, actor_character_id, target_character_id FROM lws_events WHERE id = ?').get(evKey)
            : db.prepare('SELECT id, lws_id, simulation_id, event_type, actor_character_id, target_character_id FROM lws_events WHERE lws_id = ?').get(evKey);

        if (!evRow && !event) {
            throw new LwsValidationError('Causal event does not exist', ['causal_event_id']);
        }

        const activeEv = evRow || event;
        const evSimId = activeEv.simulation_id ?? activeEv.simulation_internal_id ?? simId;
        if (evSimId !== simId) {
            throw new LwsValidationError('Causal event belongs to a different simulation', ['causal_event_id']);
        }

        const evType = activeEv.event_type;
        if (evType !== 'COMMUNICATE' && evType !== 'DIRECTOR_MODIFY_STATE' && evType !== 'SIMULATION_START') {
            throw new LwsValidationError(`Causal event must be COMMUNICATE or DIRECTOR_MODIFY_STATE, got ${evType}`, ['causal_event_id']);
        }

        // Invariant 9: Transmitter/recipient match event actor/target on COMMUNICATE
        if (evType === 'COMMUNICATE' && depth > 0) {
            const evActorId = activeEv.actor_character_id ?? activeEv.actor_internal_id;
            const evTargetId = activeEv.target_character_id ?? activeEv.target_internal_id;

            if (transmitterRow && evActorId && transmitterRow.id !== evActorId) {
                throw new LwsValidationError('Transmitter character must match COMMUNICATE event actor', ['transmitter_character_id']);
            }
            if (recipientRow && evTargetId && recipientRow.id !== evTargetId) {
                throw new LwsValidationError('Recipient character must match COMMUNICATE event target', ['recipient_character_id']);
            }
        }
    }

    return {
        depth,
        distortionLevel,
        confidenceScore,
        veracity,
        parentRow,
        rootRow,
        transmitterRow,
        recipientRow,
    };
}

/**
 * Creates and persists a social information / rumor node in SQLite.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} data
 * @param {object} [event]
 * @returns {object}
 */
export function createSocialInformation(db, data, event = null) {
    const simId = data.simulation_id;
    const simLwsId = data.sim_lws_id;

    // Validate topology
    const validated = validateRumorTreeTopology(db, simId, data, event);

    const lwsId = data.lws_id || generateDeterministicUuid(
        'social_info',
        simLwsId,
        data.root_social_information_lws_id || data.subject_key,
        data.transmitter_char_lws_id || 'orig',
        data.recipient_char_lws_id || 'all',
        data.causal_event_lws_id || 'init',
    );

    const parentId = validated.parentRow ? validated.parentRow.id : null;
    let rootId = validated.rootRow ? validated.rootRow.id : null;

    let origId = null;
    if (data.originator_character_id) {
        const c = typeof data.originator_character_id === 'number'
            ? db.prepare('SELECT id FROM lws_simulation_characters WHERE id = ?').get(data.originator_character_id)
            : db.prepare('SELECT id FROM lws_simulation_characters WHERE lws_id = ?').get(data.originator_character_id);
        if (c) origId = c.id;
    }

    const transId = validated.transmitterRow ? validated.transmitterRow.id : null;
    const recipId = validated.recipientRow ? validated.recipientRow.id : null;

    let causalEvId = null;
    if (data.causal_event_id) {
        const ev = typeof data.causal_event_id === 'number'
            ? db.prepare('SELECT id FROM lws_events WHERE id = ?').get(data.causal_event_id)
            : db.prepare('SELECT id FROM lws_events WHERE lws_id = ?').get(data.causal_event_id);
        if (ev) causalEvId = ev.id;
    } else if (event) {
        causalEvId = event.event_internal_id || event.id || null;
    }

    let groundTruthEvId = null;
    if (data.ground_truth_event_id) {
        const ev = typeof data.ground_truth_event_id === 'number'
            ? db.prepare('SELECT id FROM lws_events WHERE id = ?').get(data.ground_truth_event_id)
            : db.prepare('SELECT id FROM lws_events WHERE lws_id = ?').get(data.ground_truth_event_id);
        if (ev) groundTruthEvId = ev.id;
    }

    const stmt = db.prepare(`
        INSERT INTO lws_social_information (
            lws_id, simulation_id, parent_social_information_id, root_social_information_id,
            originator_character_id, transmitter_character_id, recipient_character_id,
            causal_event_id, subject_key, topic, claim_statement, veracity,
            ground_truth_event_id, distortion_level, transmission_depth,
            confidence_score, fictional_time, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const res = stmt.run(
        lwsId,
        simId,
        parentId,
        rootId, // temporarily null if depth 0 and not yet inserted
        origId,
        transId,
        recipId,
        causalEvId,
        data.subject_key,
        data.topic,
        data.claim_statement,
        validated.veracity,
        groundTruthEvId,
        validated.distortionLevel,
        validated.depth,
        validated.confidenceScore,
        data.fictional_time,
        data.created_at,
    );

    return getSocialInformationByLwsId(db, simId, lwsId);
}

/**
 * Retrieves a single social information row by UUID.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {string} infoLwsId
 * @returns {object}
 */
export function getSocialInformationByLwsId(db, simId, infoLwsId) {
    if (!isValidUuid(infoLwsId)) {
        throw new LwsValidationError('Invalid social information UUID format', ['infoLwsId']);
    }

    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) throw new LwsNotFoundError('Simulation not found');
        resolvedSimId = s.id;
    }

    const row = db.prepare(`
        SELECT si.*,
               s.lws_id AS simulation_lws_id,
               psi.lws_id AS parent_social_info_lws_id,
               rsi.lws_id AS root_social_info_lws_id,
               sc_orig.lws_id AS originator_character_lws_id,
               sc_trans.lws_id AS transmitter_character_lws_id,
               sc_recip.lws_id AS recipient_character_lws_id,
               ev.lws_id AS causal_event_lws_id,
               gtev.lws_id AS ground_truth_event_lws_id
        FROM lws_social_information si
        JOIN lws_simulations s ON si.simulation_id = s.id
        LEFT JOIN lws_social_information psi ON si.parent_social_information_id = psi.id
        LEFT JOIN lws_social_information rsi ON si.root_social_information_id = rsi.id
        LEFT JOIN lws_simulation_characters sc_orig ON si.originator_character_id = sc_orig.id
        LEFT JOIN lws_simulation_characters sc_trans ON si.transmitter_character_id = sc_trans.id
        LEFT JOIN lws_simulation_characters sc_recip ON si.recipient_character_id = sc_recip.id
        LEFT JOIN lws_events ev ON si.causal_event_id = ev.id
        LEFT JOIN lws_events gtev ON si.ground_truth_event_id = gtev.id
        WHERE si.lws_id = ? AND si.simulation_id = ?
    `).get(infoLwsId, resolvedSimId);

    if (!row) {
        throw new LwsNotFoundError('Social information not found');
    }

    return formatSocialInformation(row);
}

/**
 * Traverses and builds the complete transmission tree from a root or node.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {string} infoLwsId
 * @returns {object} Tree DTO with nested children
 */
export function getRumorTree(db, simId, infoLwsId) {
    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) throw new LwsNotFoundError('Simulation not found');
        resolvedSimId = s.id;
    }

    const target = getSocialInformationByLwsId(db, resolvedSimId, infoLwsId);
    const rootLwsId = target.root_social_information_id || target.lws_id;

    const root = getSocialInformationByLwsId(db, resolvedSimId, rootLwsId);

    // Fetch all nodes belonging to this root
    const rows = db.prepare(`
        SELECT si.*,
               s.lws_id AS simulation_lws_id,
               psi.lws_id AS parent_social_info_lws_id,
               rsi.lws_id AS root_social_info_lws_id,
               sc_orig.lws_id AS originator_character_lws_id,
               sc_trans.lws_id AS transmitter_character_lws_id,
               sc_recip.lws_id AS recipient_character_lws_id,
               ev.lws_id AS causal_event_lws_id,
               gtev.lws_id AS ground_truth_event_lws_id
        FROM lws_social_information si
        JOIN lws_simulations s ON si.simulation_id = s.id
        LEFT JOIN lws_social_information psi ON si.parent_social_information_id = psi.id
        LEFT JOIN lws_social_information rsi ON si.root_social_information_id = rsi.id
        LEFT JOIN lws_simulation_characters sc_orig ON si.originator_character_id = sc_orig.id
        LEFT JOIN lws_simulation_characters sc_trans ON si.transmitter_character_id = sc_trans.id
        LEFT JOIN lws_simulation_characters sc_recip ON si.recipient_character_id = sc_recip.id
        LEFT JOIN lws_events ev ON si.causal_event_id = ev.id
        LEFT JOIN lws_events gtev ON si.ground_truth_event_id = gtev.id
        WHERE (si.root_social_information_id = (SELECT id FROM lws_social_information WHERE lws_id = ?) OR si.lws_id = ?)
          AND si.simulation_id = ?
        ORDER BY si.transmission_depth ASC, si.id ASC
    `).all(rootLwsId, rootLwsId, resolvedSimId);

    const formattedNodes = rows.map(formatSocialInformation);
    const nodesById = new Map();
    for (const node of formattedNodes) {
        nodesById.set(node.lws_id, { ...node, children: [] });
    }

    let treeRoot = nodesById.get(root.lws_id);
    for (const node of nodesById.values()) {
        if (node.parent_social_information_id && nodesById.has(node.parent_social_information_id)) {
            nodesById.get(node.parent_social_information_id).children.push(node);
        }
    }

    return treeRoot || root;
}


/**
 * Lists all social information rows across a simulation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @returns {object[]}
 */
export function listSimulationSocialInformation(db, simId) {
    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) return [];
        resolvedSimId = s.id;
    }

    const rows = db.prepare(`
        SELECT si.*,
               s.lws_id AS simulation_lws_id,
               psi.lws_id AS parent_social_info_lws_id,
               rsi.lws_id AS root_social_info_lws_id,
               sc_orig.lws_id AS originator_character_lws_id,
               sc_trans.lws_id AS transmitter_character_lws_id,
               sc_recip.lws_id AS recipient_character_lws_id,
               ev.lws_id AS causal_event_lws_id,
               gtev.lws_id AS ground_truth_event_lws_id
        FROM lws_social_information si
        JOIN lws_simulations s ON si.simulation_id = s.id
        LEFT JOIN lws_social_information psi ON si.parent_social_information_id = psi.id
        LEFT JOIN lws_social_information rsi ON si.root_social_information_id = rsi.id
        LEFT JOIN lws_simulation_characters sc_orig ON si.originator_character_id = sc_orig.id
        LEFT JOIN lws_simulation_characters sc_trans ON si.transmitter_character_id = sc_trans.id
        LEFT JOIN lws_simulation_characters sc_recip ON si.recipient_character_id = sc_recip.id
        LEFT JOIN lws_events ev ON si.causal_event_id = ev.id
        LEFT JOIN lws_events gtev ON si.ground_truth_event_id = gtev.id
        WHERE si.simulation_id = ?
        ORDER BY si.fictional_time DESC, si.id DESC
    `).all(resolvedSimId);

    return rows.map(formatSocialInformation);
}

/**
 * Lists social information with query filtering.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {object} [options]
 * @returns {object[]}
 */
export function listSocialInformation(db, simId, options = {}) {
    let resolvedSimId = simId;
    if (typeof simId === 'string') {
        const s = db.prepare('SELECT id FROM lws_simulations WHERE (lws_id = ? OR id = ?)').get(simId, simId);
        if (!s) return [];
        resolvedSimId = s.id;
    }

    let sql = `
        SELECT si.*,
               s.lws_id AS simulation_lws_id,
               psi.lws_id AS parent_social_info_lws_id,
               rsi.lws_id AS root_social_info_lws_id,
               sc_orig.lws_id AS originator_character_lws_id,
               sc_trans.lws_id AS transmitter_character_lws_id,
               sc_recip.lws_id AS recipient_character_lws_id,
               ev.lws_id AS causal_event_lws_id,
               gtev.lws_id AS ground_truth_event_lws_id
        FROM lws_social_information si
        JOIN lws_simulations s ON si.simulation_id = s.id
        LEFT JOIN lws_social_information psi ON si.parent_social_information_id = psi.id
        LEFT JOIN lws_social_information rsi ON si.root_social_information_id = rsi.id
        LEFT JOIN lws_simulation_characters sc_orig ON si.originator_character_id = sc_orig.id
        LEFT JOIN lws_simulation_characters sc_trans ON si.transmitter_character_id = sc_trans.id
        LEFT JOIN lws_simulation_characters sc_recip ON si.recipient_character_id = sc_recip.id
        LEFT JOIN lws_events ev ON si.causal_event_id = ev.id
        LEFT JOIN lws_events gtev ON si.ground_truth_event_id = gtev.id
        WHERE si.simulation_id = ?
    `;
    const params = [resolvedSimId];

    if (options.topic) {
        sql += ' AND si.topic = ?';
        params.push(options.topic);
    }
    if (options.originator_character_id) {
        const c = typeof options.originator_character_id === 'number'
            ? db.prepare('SELECT id FROM lws_simulation_characters WHERE id = ?').get(options.originator_character_id)
            : db.prepare('SELECT id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(options.originator_character_id, options.originator_character_id, resolvedSimId);
        if (c) {
            sql += ' AND si.originator_character_id = ?';
            params.push(c.id);
        }
    }
    if (options.recipient_character_id) {
        const c = typeof options.recipient_character_id === 'number'
            ? db.prepare('SELECT id FROM lws_simulation_characters WHERE id = ?').get(options.recipient_character_id)
            : db.prepare('SELECT id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND simulation_id = ?').get(options.recipient_character_id, options.recipient_character_id, resolvedSimId);
        if (c) {
            sql += ' AND si.recipient_character_id = ?';
            params.push(c.id);
        }
    }

    sql += ' ORDER BY si.fictional_time DESC, si.id DESC';

    if (options.limit !== undefined) {
        sql += ' LIMIT ?';
        params.push(Number(options.limit));
        if (options.offset !== undefined) {
            sql += ' OFFSET ?';
            params.push(Number(options.offset));
        }
    }

    const rows = db.prepare(sql).all(...params);
    return rows.map(formatSocialInformation);
}

/**
 * Lists rumors/social information known to a specific character.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {number | string} simChar
 * @param {object} [options]
 * @returns {object[]}
 */
export function listKnownRumors(db, simId, simChar, options = {}) {
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

    let sql = `
        SELECT si.*,
               s.lws_id AS simulation_lws_id,
               psi.lws_id AS parent_social_info_lws_id,
               rsi.lws_id AS root_social_info_lws_id,
               sc_orig.lws_id AS originator_character_lws_id,
               sc_trans.lws_id AS transmitter_character_lws_id,
               sc_recip.lws_id AS recipient_character_lws_id,
               ev.lws_id AS causal_event_lws_id,
               gtev.lws_id AS ground_truth_event_lws_id
        FROM lws_social_information si
        JOIN lws_simulations s ON si.simulation_id = s.id
        LEFT JOIN lws_social_information psi ON si.parent_social_information_id = psi.id
        LEFT JOIN lws_social_information rsi ON si.root_social_information_id = rsi.id
        LEFT JOIN lws_simulation_characters sc_orig ON si.originator_character_id = sc_orig.id
        LEFT JOIN lws_simulation_characters sc_trans ON si.transmitter_character_id = sc_trans.id
        LEFT JOIN lws_simulation_characters sc_recip ON si.recipient_character_id = sc_recip.id
        LEFT JOIN lws_events ev ON si.causal_event_id = ev.id
        LEFT JOIN lws_events gtev ON si.ground_truth_event_id = gtev.id
        WHERE si.simulation_id = ? AND (si.recipient_character_id = ? OR si.originator_character_id = ?)
    `;
    const params = [resolvedSimId, charRow.id, charRow.id];

    if (options.topic) {
        sql += ' AND si.topic = ?';
        params.push(options.topic);
    }

    sql += ' ORDER BY si.fictional_time DESC, si.id DESC';

    if (options.limit !== undefined) {
        sql += ' LIMIT ?';
        params.push(Number(options.limit));
        if (options.offset !== undefined) {
            sql += ' OFFSET ?';
            params.push(Number(options.offset));
        }
    }

    const rows = db.prepare(sql).all(...params);
    return rows.map(formatSocialInformation);
}


/**
 * Evaluates subjective belief adoption by recipient when receiving social communication.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {object} recipientChar
 * @param {object} transmitterChar
 * @param {object} socialInfo
 * @param {object} event
 * @param {string} eventCreatedAt
 */
export function evaluateBeliefAdoption(
    db,
    simId,
    recipientChar,
    transmitterChar,
    socialInfo,
    event,
    eventCreatedAt,
) {
    if (!recipientChar || !transmitterChar || !socialInfo) return;

    // Check recipient's trust in transmitter
    const rel = getRelationshipByCharacters(db, simId, recipientChar.id, transmitterChar.id);
    const trust = rel?.trust ?? 0;

    // If trust <= -30, testimony is rejected
    if (trust <= -30) {
        return;
    }

    // Formula: confidence = clamp(round(C_rumor * (Trust + 100) / 200), 1, 100)
    const cRumor = socialInfo.confidence_score ?? 50;
    const scaledConfidence = clamp(Math.round(cRumor * ((trust + 100) / 200)), 1, 100);
    const beliefType = scaledConfidence >= 70 ? 'belief' : 'suspicion';
    const sourceBasis = 'hearsay';

    upsertCharacterBelief(db, {
        simulation_id: simId,
        simulation_character_id: recipientChar.id,
        char_lws_id: recipientChar.lws_id,
        subject_key: socialInfo.subject_key,
        statement: socialInfo.claim_statement,
        belief_type: beliefType,
        confidence: scaledConfidence,
        source_basis: sourceBasis,
        causal_event_id: event.event_internal_id || event.id,
        created_at: eventCreatedAt,
        updated_at: eventCreatedAt,
    });
}
