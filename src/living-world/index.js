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
export * from './simulations/common.js';
export * from './events/taxonomy.js';
export * from './events/authority.js';
export * from './events/events.js';
export * from './events/narrative-turns.js';
export * from './events/replay.js';
export * from './simulations/lock.js';
export * from './time/routines.js';
export * from './time/scheduled-events.js';
export * from './time/travel.js';
export * from './time/time-advance.js';
export * from './perception/spatial.js';
export * from './perception/perceptions.js';
export * from './perception/knowledge.js';
export * from './perception/memories.js';
export * from './perception/memory-retrieval.js';
export * from './perception/beliefs.js';
export * from './perception/camera.js';
export * from './cognition/common.js';
export * from './cognition/needs.js';
export * from './cognition/emotions.js';
export * from './cognition/values.js';
export * from './cognition/goals.js';
export * from './cognition/intentions.js';
export * from './cognition/deliberation.js';
export * from './cognition/arbitration.js';
export * from './social/common.js';
export * from './social/relationships.js';
export * from './social/evidence.js';
export * from './social/rumors.js';
export * from './social/factions.js';
export * from './social/development.js';
export * from './environment/common.js';
export * from './environment/environment.js';
export * from './environment/operational-states.js';
export * from './population/common.js';
export * from './population/archetypes.js';
export * from './population/ambient-generator.js';
export * from './population/character-tiers.js';
export * from './population/promotion.js';


