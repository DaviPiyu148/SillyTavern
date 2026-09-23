import {
    openDb,
    closeDb,
    getDb,
    getDbVersion,
    isDbAvailable,
    getLastError,
} from './db.js';
import { color } from '../util.js';

/**
 * Initializes the Living World Simulator subsystem.
 *
 * Startup failure policy:
 * LWS startup failure is non-fatal to SillyTavern.
 * If initialization fails, the root cause is logged, LWS enters a degraded/unavailable
 * state, and SillyTavern continues its startup sequence.
 *
 * @param {object} [options]
 * @param {string} [options.dbPath] Optional custom DB path (useful for testing)
 * @returns {Promise<boolean>} True if initialized successfully, false if degraded
 */
export async function init(options = {}) {
    if (isDbAvailable()) {
        return true;
    }

    try {
        openDb(options.dbPath);
        const version = getDbVersion();
        console.log(color.green(`[LWS] Subsystem initialized (schema version ${version})`));
        return true;
    } catch (err) {
        console.error(color.red('[LWS] Subsystem initialization failed (running degraded):'), err.message);
        return false;
    }
}

/**
 * Performs graceful shutdown of the LWS subsystem.
 */
export async function onExit() {
    closeDb();
    console.log('[LWS] Subsystem shut down');
}

/**
 * Returns the public status of the LWS subsystem.
 *
 * @returns {{ initialized: boolean, schemaVersion: number | null }}
 */
export function getLwsStatus() {
    const available = isDbAvailable();
    return {
        initialized: available,
        schemaVersion: available ? getDbVersion() : null,
    };
}

/**
 * Returns true if the LWS subsystem is ready to process requests.
 * @returns {boolean}
 */
export function isLwsAvailable() {
    return isDbAvailable();
}

export {
    openDb,
    closeDb,
    getDb,
    getDbVersion,
    getLastError,
};

export * from './errors.js';
export * from './authored/worlds.js';
export * from './authored/characters.js';
export * from './authored/locations.js';
export * from './authored/factions.js';
export * from './authored/scenarios.js';
export * from './authored/world-rules.js';
export * from './authored/prompt-configs.js';
export * from './simulations/simulations.js';
export * from './simulations/simulation-characters.js';
export * from './events/taxonomy.js';
export * from './events/authority.js';
export * from './events/events.js';
export * from './events/narrative-turns.js';
export * from './events/replay.js';

