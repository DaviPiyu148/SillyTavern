/**
 * Living World Simulator (LWS) - Location Operational State Service
 */

import { generateUuid } from '../authored/common.js';
import { LwsValidationError } from '../errors.js';
import {
    ACCESS_STATUSES,
    CROWD_DENSITIES,
    evaluateOperatingHours,
} from './common.js';

/**
 * Formats raw operational state row.
 *
 * @param {object} row
 * @param {string} [fictionalTime]
 * @returns {object}
 */
export function formatOperationalStateRow(row, fictionalTime = null) {
    if (!row) return null;

    let operatingHours = null;
    if (typeof row.operating_hours === 'string') {
        try {
            operatingHours = JSON.parse(row.operating_hours);
        } catch {
            operatingHours = null;
        }
    } else if (row.operating_hours && typeof row.operating_hours === 'object') {
        operatingHours = row.operating_hours;
    }

    let effectiveAccess = row.access_status;
    if (row.access_override !== null && row.access_override !== undefined) {
        effectiveAccess = row.access_override;
    } else if (fictionalTime && operatingHours) {
        effectiveAccess = evaluateOperatingHours(fictionalTime, operatingHours);
    }

    return {
        id: row.id,
        lws_id: row.lws_id,
        simulation_id: row.simulation_id,
        location_id: row.location_id,
        access_status: effectiveAccess,
        access_override: row.access_override,
        operating_hours: operatingHours,
        crowd_density: row.crowd_density,
        ambient_capacity: row.ambient_capacity,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Ensures operational state record exists for simulation and location.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @param {number} locationId
 * @param {object} [initialData={}]
 * @returns {object}
 */
export function ensureLocationOperationalState(db, simulationId, locationId, initialData = {}) {
    const existing = db.prepare(`
        SELECT * FROM lws_location_operational_states
        WHERE simulation_id = ? AND location_id = ?
    `).get(simulationId, locationId);

    if (existing) {
        return existing;
    }

    const now = new Date().toISOString();
    const lwsId = generateUuid();
    const accessStatus = initialData.access_status || 'open';
    const accessOverride = initialData.access_override ?? null;
    const operatingHours = initialData.operating_hours ? JSON.stringify(initialData.operating_hours) : null;
    const crowdDensity = initialData.crowd_density || 'moderate';
    const ambientCapacity = initialData.ambient_capacity ?? 50;

    db.prepare(`
        INSERT INTO lws_location_operational_states (
            lws_id, simulation_id, location_id, access_status,
            access_override, operating_hours, crowd_density,
            ambient_capacity, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        lwsId,
        simulationId,
        locationId,
        accessStatus,
        accessOverride,
        operatingHours,
        crowdDensity,
        ambientCapacity,
        now,
        now,
    );

    return db.prepare(`
        SELECT * FROM lws_location_operational_states WHERE lws_id = ?
    `).get(lwsId);
}

/**
 * Retrieves operational state for a location in a simulation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @param {number} locationId
 * @param {string} [fictionalTime]
 * @returns {object}
 */
export function getLocationOperationalState(db, simulationId, locationId, fictionalTime = null) {
    let row = db.prepare(`
        SELECT * FROM lws_location_operational_states
        WHERE simulation_id = ? AND location_id = ?
    `).get(simulationId, locationId);

    if (!row) {
        row = ensureLocationOperationalState(db, simulationId, locationId);
    }

    return formatOperationalStateRow(row, fictionalTime);
}

/**
 * Lists all location operational states in a simulation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @param {string} [fictionalTime]
 * @returns {object[]}
 */
export function listLocationOperationalStates(db, simulationId, fictionalTime = null) {
    const rows = db.prepare(`
        SELECT * FROM lws_location_operational_states
        WHERE simulation_id = ?
        ORDER BY id ASC
    `).all(simulationId);

    return rows.map(r => formatOperationalStateRow(r, fictionalTime));
}

/**
 * Updates operational state for a location in simulation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @param {number} locationId
 * @param {object} updates
 * @param {string} [fictionalTime]
 * @returns {object}
 */
export function updateLocationOperationalState(db, simulationId, locationId, updates = {}, fictionalTime = null) {
    let row = db.prepare(`
        SELECT * FROM lws_location_operational_states
        WHERE simulation_id = ? AND location_id = ?
    `).get(simulationId, locationId);

    if (!row) {
        row = ensureLocationOperationalState(db, simulationId, locationId);
    }

    if (updates.access_status !== undefined && !ACCESS_STATUSES.includes(updates.access_status)) {
        throw new LwsValidationError(`Invalid access_status: ${updates.access_status}`, ['access_status']);
    }
    if (updates.access_override !== undefined && updates.access_override !== null && !ACCESS_STATUSES.includes(updates.access_override)) {
        throw new LwsValidationError(`Invalid access_override: ${updates.access_override}`, ['access_override']);
    }
    if (updates.crowd_density !== undefined && !CROWD_DENSITIES.includes(updates.crowd_density)) {
        throw new LwsValidationError(`Invalid crowd_density: ${updates.crowd_density}`, ['crowd_density']);
    }
    if (updates.ambient_capacity !== undefined) {
        if (typeof updates.ambient_capacity !== 'number' || updates.ambient_capacity < 0 || updates.ambient_capacity > 1000) {
            throw new LwsValidationError('ambient_capacity must be an integer between 0 and 1000', ['ambient_capacity']);
        }
    }
    if (updates.operating_hours !== undefined && updates.operating_hours !== null) {
        if (typeof updates.operating_hours === 'string') {
            try {
                JSON.parse(updates.operating_hours);
            } catch {
                throw new LwsValidationError('operating_hours must be a valid JSON object or string', ['operating_hours']);
            }
        } else if (typeof updates.operating_hours !== 'object') {
            throw new LwsValidationError('operating_hours must be a valid JSON object or string', ['operating_hours']);
        }
    }

    const accessOverride = updates.access_override !== undefined ? updates.access_override : row.access_override;
    const operatingHours = updates.operating_hours !== undefined
        ? (updates.operating_hours ? JSON.stringify(updates.operating_hours) : null)
        : row.operating_hours;
    const crowdDensity = updates.crowd_density ?? row.crowd_density;
    const ambientCapacity = updates.ambient_capacity ?? row.ambient_capacity;

    let computedAccess = updates.access_status ?? row.access_status;
    if (accessOverride !== null) {
        computedAccess = accessOverride;
    } else if (fictionalTime && operatingHours) {
        computedAccess = evaluateOperatingHours(fictionalTime, operatingHours);
    }

    const now = new Date().toISOString();

    db.prepare(`
        UPDATE lws_location_operational_states
        SET access_status = ?,
            access_override = ?,
            operating_hours = ?,
            crowd_density = ?,
            ambient_capacity = ?,
            updated_at = ?
        WHERE id = ?
    `).run(
        computedAccess,
        accessOverride,
        operatingHours,
        crowdDensity,
        ambientCapacity,
        now,
        row.id,
    );

    const updated = db.prepare('SELECT * FROM lws_location_operational_states WHERE id = ?').get(row.id);
    return formatOperationalStateRow(updated, fictionalTime);
}
