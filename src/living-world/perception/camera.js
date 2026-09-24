import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import { isValidUuid, generateDeterministicUuid, isoNow, safeJsonParse } from '../authored/common.js';
import { ensureActiveSimulation } from '../simulations/common.js';
import { listCharacterKnowledge } from './knowledge.js';
import { retrieveCharacterMemories } from './memory-retrieval.js';
import { listCharacterBeliefs } from './beliefs.js';

export const VALID_CAMERA_MODES = Object.freeze(['follow_character', 'observe_location', 'god_view']);

/**
 * Validates camera mode.
 * @param {string} mode
 * @returns {string}
 */
export function validateCameraMode(mode) {
    if (!VALID_CAMERA_MODES.includes(mode)) {
        throw new LwsValidationError(
            `Invalid camera mode: '${mode}'. Must be one of: ${VALID_CAMERA_MODES.join(', ')}`,
            ['mode'],
        );
    }
    return mode;
}

/**
 * Formats a camera database row for presentation.
 * @param {object} row
 * @returns {object}
 */
export function formatCamera(row) {
    if (!row) return null;
    return {
        lws_id: row.lws_id,
        camera_name: row.camera_name,
        mode: row.mode,
        target_character_lws_id: row.target_character_lws_id ?? null,
        target_location_lws_id: row.target_location_lws_id ?? null,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Retrieves the current camera focus state for a simulation.
 * If no camera record exists yet, returns default god_view representation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} simLwsId
 * @param {string} [cameraName='default']
 * @returns {object}
 */
export function getSimulationCamera(db, simLwsId, cameraName = 'default') {
    const sim = ensureActiveSimulation(db, simLwsId);

    const row = db.prepare(`
        SELECT
            c.*,
            sc.lws_id AS target_character_lws_id,
            loc.lws_id AS target_location_lws_id
        FROM lws_simulation_cameras c
        LEFT JOIN lws_simulation_characters sc ON c.target_character_id = sc.id
        LEFT JOIN lws_locations loc ON c.target_location_id = loc.id
        WHERE c.simulation_id = ? AND c.camera_name = ?
    `).get(sim.id, cameraName.trim());

    if (!row) {
        return {
            lws_id: generateDeterministicUuid('camera', sim.lws_id, cameraName.trim()),
            camera_name: cameraName.trim(),
            mode: 'god_view',
            target_character_lws_id: null,
            target_location_lws_id: null,
            created_at: sim.created_at,
            updated_at: sim.updated_at,
        };
    }

    return formatCamera(row);
}

/**
 * Sets/updates a simulation camera focus.
 * Uses deterministic SHA-256 derived UUID from (simLwsId, cameraName).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {object} params
 * @returns {object}
 */
export function setSimulationCamera(db, {
    simulation_id,
    sim_lws_id,
    camera_name = 'default',
    mode = 'god_view',
    target_character_id = null,
    target_character_lws_id = null,
    target_location_id = null,
    target_location_lws_id = null,
    created_at = isoNow(),
    updated_at = isoNow(),
}) {
    if (!simulation_id && sim_lws_id) {
        const simRow = db.prepare('SELECT id, lws_id FROM lws_simulations WHERE lws_id = ? AND deleted_at IS NULL').get(sim_lws_id);
        if (simRow) {
            simulation_id = simRow.id;
            sim_lws_id = simRow.lws_id;
        }
    }

    if (!simulation_id) {
        throw new LwsValidationError('simulation_id is required', ['simulation_id']);
    }

    validateCameraMode(mode);

    let targetCharInternal = null;
    const charIdent = target_character_id || target_character_lws_id;
    if (charIdent) {
        if (typeof charIdent === 'number') {
            targetCharInternal = charIdent;
        } else {
            const char = db.prepare('SELECT id FROM lws_simulation_characters WHERE (lws_id = ? OR id = ?) AND deleted_at IS NULL').get(charIdent, charIdent);
            if (char) targetCharInternal = char.id;
        }
    }

    let targetLocInternal = null;
    const locIdent = target_location_id || target_location_lws_id;
    if (locIdent) {
        if (typeof locIdent === 'number') {
            targetLocInternal = locIdent;
        } else {
            const loc = db.prepare('SELECT id FROM lws_locations WHERE (lws_id = ? OR id = ?) AND deleted_at IS NULL').get(locIdent, locIdent);
            if (loc) targetLocInternal = loc.id;
        }
    }

    if (mode === 'follow_character' && (!targetCharInternal || targetLocInternal)) {
        throw new LwsValidationError('follow_character mode requires target_character_id and NULL target_location_id', ['mode']);
    }
    if (mode === 'observe_location' && (!targetLocInternal || targetCharInternal)) {
        throw new LwsValidationError('observe_location mode requires target_location_id and NULL target_character_id', ['mode']);
    }
    if (mode === 'god_view' && (targetCharInternal || targetLocInternal)) {
        throw new LwsValidationError('god_view mode requires NULL target_character_id and NULL target_location_id', ['mode']);
    }

    const camName = camera_name.trim();
    const lwsId = generateDeterministicUuid('camera', sim_lws_id || String(simulation_id), camName);

    const stmt = db.prepare(`
        INSERT INTO lws_simulation_cameras (
            lws_id, simulation_id, camera_name, mode,
            target_character_id, target_location_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(simulation_id, camera_name) DO UPDATE SET
            mode = excluded.mode,
            target_character_id = excluded.target_character_id,
            target_location_id = excluded.target_location_id,
            updated_at = excluded.updated_at
    `);

    stmt.run(
        lwsId,
        simulation_id,
        camName,
        mode,
        targetCharInternal,
        targetLocInternal,
        created_at,
        updated_at,
    );

    return getSimulationCamera(db, sim_lws_id || simulation_id, camName);
}

/**
 * Builds the subjective, non-omniscient perspective for a specific character.
 * Strictly excludes foreign location state and unperceived hidden facts.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} simLwsId
 * @param {string} charLwsId
 * @returns {object} Subjective Perspective DTO
 */
export function buildSubjectivePerspective(db, simLwsId, charLwsId) {
    const sim = ensureActiveSimulation(db, simLwsId);

    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }

    const charRow = db.prepare(`
        SELECT
            sc.*,
            c.name,
            c.description AS authored_description,
            loc.lws_id AS location_lws_id,
            loc.name AS location_name,
            loc.description AS location_description
        FROM lws_simulation_characters sc
        JOIN lws_characters c ON sc.character_id = c.id
        LEFT JOIN lws_locations loc ON sc.current_location_id = loc.id
        WHERE sc.lws_id = ? AND sc.simulation_id = ? AND sc.deleted_at IS NULL
    `).get(charLwsId, sim.id);

    if (!charRow) {
        throw new LwsNotFoundError('Character not found in simulation');
    }

    // Co-located nearby characters only (dist = 0)
    let nearbyCharacters = [];
    if (charRow.current_location_id) {
        const nearbyRows = db.prepare(`
            SELECT
                sc.lws_id,
                c.name,
                sc.activity,
                sc.physical_condition
            FROM lws_simulation_characters sc
            JOIN lws_characters c ON sc.character_id = c.id
            WHERE sc.simulation_id = ?
              AND sc.current_location_id = ?
              AND sc.id != ?
              AND sc.deleted_at IS NULL
        `).all(sim.id, charRow.current_location_id, charRow.id);

        nearbyCharacters = nearbyRows.map(r => ({
            lws_id: r.lws_id,
            character_id: r.lws_id,
            name: r.name,
            activity: r.activity,
            physical_condition: r.physical_condition,
        }));
    }

    const knowledge = listCharacterKnowledge(db, charLwsId);
    const memories = retrieveCharacterMemories(db, charLwsId, {
        currentFictionalTime: sim.current_fictional_time,
        limit: 5,
    });
    const beliefs = listCharacterBeliefs(db, charLwsId);

    const characterObj = {
        lws_id: charRow.lws_id,
        character_id: charRow.lws_id,
        name: charRow.name,
        activity: charRow.activity,
        physical_condition: charRow.physical_condition,
        runtime_state: safeJsonParse(charRow.runtime_state, {}),
    };

    const locationObj = charRow.location_lws_id ? {
        lws_id: charRow.location_lws_id,
        location_id: charRow.location_lws_id,
        name: charRow.location_name,
        description: charRow.location_description,
    } : null;

    return {
        simulation_id: sim.lws_id,
        fictional_time: sim.current_fictional_time,
        character_id: charRow.lws_id,
        character: characterObj,
        current_location: locationObj,
        co_located_characters: nearbyCharacters,
        knowledge,
        memories,
        beliefs,
        privileged: false,
        subjective_view: {
            character: characterObj,
            location: locationObj,
            nearby_characters: nearbyCharacters,
            knowledge,
            memories,
            beliefs,
        },
    };
}

/**
 * Builds the privileged Observer perspective of full simulation ground truth.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} simLwsId
 * @param {string} [cameraName='default']
 * @returns {object} Privileged Observer Perspective DTO
 */
export function buildObserverPerspective(db, simLwsId, cameraName = 'default') {
    const sim = ensureActiveSimulation(db, simLwsId);
    const camera = getSimulationCamera(db, simLwsId, cameraName);

    // All active characters ground truth
    const characters = db.prepare(`
        SELECT
            sc.lws_id AS lws_id,
            sc.lws_id AS character_id,
            c.name,
            loc.lws_id AS current_location_id,
            loc.name AS current_location_name,
            sc.activity,
            sc.physical_condition,
            sc.runtime_state
        FROM lws_simulation_characters sc
        JOIN lws_characters c ON sc.character_id = c.id
        LEFT JOIN lws_locations loc ON sc.current_location_id = loc.id
        WHERE sc.simulation_id = ? AND sc.deleted_at IS NULL
        ORDER BY c.name ASC
    `).all(sim.id).map(r => ({
        ...r,
        runtime_state: safeJsonParse(r.runtime_state, {}),
    }));

    // All active locations with occupants
    const locations = db.prepare(`
        SELECT
            loc.lws_id AS lws_id,
            loc.lws_id AS location_id,
            loc.name,
            loc.description,
            loc.extensions
        FROM lws_locations loc
        WHERE loc.world_id = ? AND loc.deleted_at IS NULL
        ORDER BY loc.name ASC
    `).all(sim.world_id).map(l => {
        const occupants = characters.filter(c => c.current_location_id === l.location_id).map(c => c.character_id);
        return {
            lws_id: l.lws_id,
            location_id: l.location_id,
            name: l.name,
            description: l.description,
            extensions: safeJsonParse(l.extensions, {}),
            occupants,
        };
    });

    return {
        simulation_id: sim.lws_id,
        simulation: {
            lws_id: sim.lws_id,
            name: sim.name,
            current_fictional_time: sim.current_fictional_time,
            status: sim.status,
        },
        fictional_time: sim.current_fictional_time,
        camera,
        characters,
        locations,
        privileged: true,
        ground_truth: {
            characters,
            locations,
        },
    };
}
