/**
 * Living World Simulator (LWS) - Location Runtime Environment Service
 */

import { generateUuid } from '../authored/common.js';
import { LwsNotFoundError, LwsValidationError } from '../errors.js';
import {
    WEATHER_TYPES,
    LIGHTING_LEVELS,
    AIR_QUALITY_TYPES,
    calculateDiurnalTemperature,
    calculateDiurnalLighting,
} from './common.js';

/**
 * Maps raw database row into formatted environment object.
 *
 * @param {object} row
 * @param {string} [fictionalTime] Optional current fictional time for derived calculations
 * @param {object} [locationRow] Optional authored location record for tags/indoor status
 * @returns {object}
 */
export function formatEnvironmentRow(row, fictionalTime = null, locationRow = null) {
    if (!row) return null;

    let hazards = [];
    if (typeof row.hazards === 'string') {
        try {
            hazards = JSON.parse(row.hazards);
        } catch {
            hazards = [];
        }
    } else if (Array.isArray(row.hazards)) {
        hazards = row.hazards;
    }

    let isIndoor = Boolean(row.is_indoor);
    let hasIlluminatedTag = false;
    if (locationRow) {
        if (locationRow.is_indoor !== undefined) {
            isIndoor = Boolean(locationRow.is_indoor);
        }
        let tags = [];
        if (typeof locationRow.tags === 'string') {
            try {
                tags = JSON.parse(locationRow.tags);
            } catch {
                tags = [];
            }
        } else if (Array.isArray(locationRow.tags)) {
            tags = locationRow.tags;
        }
        hasIlluminatedTag = tags.includes('illuminated') || tags.includes('lit') || tags.includes('indoor');
        if (tags.includes('indoor')) {
            isIndoor = true;
        }
    }

    let effectiveTemp = row.temperature_celsius;
    let effectiveLighting = row.lighting_level;

    if (fictionalTime) {
        if (row.temperature_override !== null && row.temperature_override !== undefined) {
            effectiveTemp = row.temperature_override;
        } else {
            effectiveTemp = calculateDiurnalTemperature(fictionalTime, row.temperature_baseline ?? 20.0, isIndoor);
        }

        if (row.lighting_override !== null && row.lighting_override !== undefined) {
            effectiveLighting = row.lighting_override;
        } else {
            effectiveLighting = calculateDiurnalLighting(fictionalTime, isIndoor, hasIlluminatedTag, row.weather);
        }
    }

    return {
        id: row.id,
        lws_id: row.lws_id,
        simulation_id: row.simulation_id,
        location_id: row.location_id,
        weather: row.weather,
        temperature_baseline: row.temperature_baseline,
        temperature_celsius: effectiveTemp,
        temperature_override: row.temperature_override,
        lighting_level: effectiveLighting,
        lighting_override: row.lighting_override,
        noise_level: row.noise_level,
        is_indoor: isIndoor ? 1 : 0,
        air_quality: row.air_quality,
        hazards,
        last_evaluated_fictional_time: row.last_evaluated_fictional_time,
        created_at: row.created_at,
        updated_at: row.updated_at,
    };
}

/**
 * Ensures a location environment row exists for the given location in simulation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @param {number} locationId
 * @param {object} [initialData={}]
 * @returns {object} The environment row
 */
export function ensureLocationEnvironment(db, simulationId, locationId, initialData = {}) {
    const existing = db.prepare(`
        SELECT * FROM lws_location_environments
        WHERE simulation_id = ? AND location_id = ?
    `).get(simulationId, locationId);

    if (existing) {
        return existing;
    }

    const locRow = db.prepare(`
        SELECT * FROM lws_locations WHERE id = ?
    `).get(locationId);

    let isIndoor = 0;
    if (locRow) {
        if (locRow.is_indoor) isIndoor = 1;
        let tags = [];
        try {
            tags = typeof locRow.tags === 'string' ? JSON.parse(locRow.tags) : (locRow.tags || []);
        } catch {
            tags = [];
        }
        if (tags.includes('indoor')) isIndoor = 1;
    }

    const now = new Date().toISOString();
    const lwsId = generateUuid();
    const weather = initialData.weather || 'clear';
    const tempBaseline = initialData.temperature_baseline ?? 20.0;
    const tempCelsius = initialData.temperature_celsius ?? tempBaseline;
    const tempOverride = initialData.temperature_override ?? null;
    const lightingLevel = initialData.lighting_level || 'normal';
    const lightingOverride = initialData.lighting_override ?? null;
    const noiseLevel = initialData.noise_level ?? 20;
    const airQuality = initialData.air_quality || 'clean';
    const hazardsJson = JSON.stringify(initialData.hazards || []);

    db.prepare(`
        INSERT INTO lws_location_environments (
            lws_id, simulation_id, location_id, weather,
            temperature_baseline, temperature_celsius, temperature_override,
            lighting_level, lighting_override, noise_level, is_indoor,
            air_quality, hazards, last_evaluated_fictional_time,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        lwsId,
        simulationId,
        locationId,
        weather,
        tempBaseline,
        tempCelsius,
        tempOverride,
        lightingLevel,
        lightingOverride,
        noiseLevel,
        isIndoor,
        airQuality,
        hazardsJson,
        initialData.last_evaluated_fictional_time || null,
        now,
        now,
    );

    return db.prepare(`
        SELECT * FROM lws_location_environments WHERE lws_id = ?
    `).get(lwsId);
}

/**
 * Retrieves the environment record for a simulation location.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @param {number} locationId
 * @param {string} [fictionalTime]
 * @returns {object} Formatted environment object
 */
export function getLocationEnvironment(db, simulationId, locationId, fictionalTime = null) {
    let row = db.prepare(`
        SELECT * FROM lws_location_environments
        WHERE simulation_id = ? AND location_id = ?
    `).get(simulationId, locationId);

    if (!row) {
        row = ensureLocationEnvironment(db, simulationId, locationId);
    }

    const locRow = db.prepare(`
        SELECT * FROM lws_locations WHERE id = ?
    `).get(locationId);

    return formatEnvironmentRow(row, fictionalTime, locRow);
}

/**
 * Lists all location environments in a simulation.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @param {string} [fictionalTime]
 * @returns {object[]}
 */
export function listLocationEnvironments(db, simulationId, fictionalTime = null) {
    const rows = db.prepare(`
        SELECT * FROM lws_location_environments
        WHERE simulation_id = ?
        ORDER BY id ASC
    `).all(simulationId);

    return rows.map(r => {
        const locRow = db.prepare('SELECT * FROM lws_locations WHERE id = ?').get(r.location_id);
        return formatEnvironmentRow(r, fictionalTime, locRow);
    });
}

/**
 * Updates a location environment authoritative state.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {number} simulationId
 * @param {number} locationId
 * @param {object} updates
 * @param {string} [fictionalTime]
 * @returns {object} Updated environment object
 */
export function updateLocationEnvironment(db, simulationId, locationId, updates = {}, fictionalTime = null) {
    let row = db.prepare(`
        SELECT * FROM lws_location_environments
        WHERE simulation_id = ? AND location_id = ?
    `).get(simulationId, locationId);

    if (!row) {
        row = ensureLocationEnvironment(db, simulationId, locationId);
    }

    const locRow = db.prepare(`
        SELECT * FROM lws_locations WHERE id = ?
    `).get(locationId);

    if (updates.weather !== undefined && !WEATHER_TYPES.includes(updates.weather)) {
        throw new LwsValidationError(`Invalid weather: ${updates.weather}`, ['weather']);
    }
    if (updates.lighting_override !== undefined && updates.lighting_override !== null && !LIGHTING_LEVELS.includes(updates.lighting_override)) {
        throw new LwsValidationError(`Invalid lighting_override: ${updates.lighting_override}`, ['lighting_override']);
    }
    if (updates.temperature_override !== undefined && updates.temperature_override !== null) {
        if (typeof updates.temperature_override !== 'number' || updates.temperature_override < -50.0 || updates.temperature_override > 60.0) {
            throw new LwsValidationError('temperature_override must be a number between -50.0 and 60.0', ['temperature_override']);
        }
    }
    if (updates.air_quality !== undefined && !AIR_QUALITY_TYPES.includes(updates.air_quality)) {
        throw new LwsValidationError(`Invalid air_quality: ${updates.air_quality}`, ['air_quality']);
    }
    if (updates.noise_level !== undefined) {
        if (typeof updates.noise_level !== 'number' || updates.noise_level < 0 || updates.noise_level > 100) {
            throw new LwsValidationError('noise_level must be an integer between 0 and 100', ['noise_level']);
        }
    }

    const weather = updates.weather ?? row.weather;
    const tempBaseline = updates.temperature_baseline ?? row.temperature_baseline;
    const tempOverride = updates.temperature_override !== undefined ? updates.temperature_override : row.temperature_override;
    const lightingOverride = updates.lighting_override !== undefined ? updates.lighting_override : row.lighting_override;
    const noiseLevel = updates.noise_level ?? row.noise_level;
    const airQuality = updates.air_quality ?? row.air_quality;
    const hazardsJson = updates.hazards !== undefined ? JSON.stringify(updates.hazards) : row.hazards;
    const isIndoor = updates.is_indoor !== undefined ? (updates.is_indoor ? 1 : 0) : row.is_indoor;
    const lastEvalTime = fictionalTime || updates.last_evaluated_fictional_time || row.last_evaluated_fictional_time;
    const now = new Date().toISOString();

    let computedTemp = row.temperature_celsius;
    let computedLighting = row.lighting_level;

    if (fictionalTime) {
        computedTemp = tempOverride !== null
            ? tempOverride
            : calculateDiurnalTemperature(fictionalTime, tempBaseline, Boolean(isIndoor));

        let hasIlluminatedTag = false;
        if (locRow) {
            let tags = [];
            try {
                tags = typeof locRow.tags === 'string' ? JSON.parse(locRow.tags) : (locRow.tags || []);
            } catch {
                tags = [];
            }
            hasIlluminatedTag = tags.includes('illuminated') || tags.includes('lit');
        }
        computedLighting = lightingOverride !== null
            ? lightingOverride
            : calculateDiurnalLighting(fictionalTime, Boolean(isIndoor), hasIlluminatedTag, weather);
    }

    db.prepare(`
        UPDATE lws_location_environments
        SET weather = ?,
            temperature_baseline = ?,
            temperature_celsius = ?,
            temperature_override = ?,
            lighting_level = ?,
            lighting_override = ?,
            noise_level = ?,
            is_indoor = ?,
            air_quality = ?,
            hazards = ?,
            last_evaluated_fictional_time = ?,
            updated_at = ?
        WHERE id = ?
    `).run(
        weather,
        tempBaseline,
        computedTemp,
        tempOverride,
        computedLighting,
        lightingOverride,
        noiseLevel,
        isIndoor,
        airQuality,
        hazardsJson,
        lastEvalTime,
        now,
        row.id,
    );

    const updatedRow = db.prepare('SELECT * FROM lws_location_environments WHERE id = ?').get(row.id);
    return formatEnvironmentRow(updatedRow, fictionalTime, locRow);
}
