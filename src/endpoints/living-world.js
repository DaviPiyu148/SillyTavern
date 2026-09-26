import express from 'express';
import {
    getLwsStatus,
    isLwsAvailable,
    LwsValidationError,
    LwsNotFoundError,
    LwsConflictError,
    LwsAuthorityError,
    LwsTurnRejectedError,
    LwsInvalidStateTransitionError,
    createWorld,
    getWorldByLwsId,
    listWorlds,
    updateWorld,
    deleteWorld,
    createCharacter,
    getCharacterByLwsId,
    listCharacters,
    updateCharacter,
    deleteCharacter,
    createLocation,
    getLocationByLwsId,
    listLocations,
    updateLocation,
    deleteLocation,
    createFaction,
    getFactionByLwsId,
    listFactions,
    updateFaction,
    deleteFaction,
    addFactionMember,
    removeFactionMember,
    listFactionMembers,
    createWorldRule,
    getWorldRuleByLwsId,
    listWorldRules,
    updateWorldRule,
    deleteWorldRule,
    createScenario,
    getScenarioByLwsId,
    listScenarios,
    updateScenario,
    deleteScenario,
    addScenarioCharacter,
    removeScenarioCharacter,
    listScenarioCharacters,
    createPromptConfig,
    getPromptConfig,
    updatePromptConfig,
    createSimulation,
    getSimulationByLwsId,
    listSimulations,
    updateSimulation,
    deleteSimulation,
    addSimulationCharacter,
    getSimulationCharacterByLwsId,
    listSimulationCharacters,
    updateSimulationCharacter,
    deleteSimulationCharacter,
    commitEvent,
    getEventByLwsId,
    listEvents,
    executeNarrativeTurn,
    getNarrativeTurnByLwsId,
    listNarrativeTurns,
    verifySimulationParity,
    advanceFictionalTime,
    getScheduledEvents,
    getScheduledEventByLwsId,
    validateScheduledEventInput,
    validateRoutineBlock,
    ensureActiveSimulation,
    getEventPerceptions,
    getCharacterPerceptions,
    listCharacterKnowledge,
    getCharacterFact,
    listCharacterMemories,
    retrieveCharacterMemories,
    listCharacterBeliefs,
    getCharacterBelief,
    getSimulationCamera,
    buildSubjectivePerspective,
    buildObserverPerspective,
    NEED_NAMES,
    getCharacterNeeds,
    getActiveAcuteGoals,
    listCharacterGoals,
    createGoal,
    updateGoal,
    deleteGoal,
    getActiveIntention,
    listCharacterIntentions,
    getCharacterValues,
    getCharacterEmotion,
    deliberateCharacter,
    getRelationship,
    getRelationshipByCharacters,
    listCharacterRelationships,
    exportSocialGraph,
    listRelationshipEvidence,
    getSocialInformationByLwsId,
    listSocialInformation,
    getRumorTree,
    listKnownRumors,
    getCharacterFactionMemberships,
    listSimulationFactionMemberships,
    listCharacterDevelopmentRecords,
    EVENT_TYPES,
    getDb,
} from '../living-world/index.js';
import { isValidUuid, generateUuid } from '../living-world/authored/common.js';

const router = express.Router();

/**
 * Standard error response mapper for LWS endpoints.
 * Never leaks stack traces or filesystem paths.
 * @param {Error} err
 * @param {import('express').Response} res
 * @param {string} routeName
 */
function handleRouteError(err, res, routeName) {
    if (err instanceof LwsValidationError) {
        return res.status(400).json({ error: err.message, fields: err.fields ?? [] });
    }
    if (err instanceof LwsNotFoundError) {
        return res.status(404).json({ error: err.message });
    }
    if (err instanceof LwsConflictError) {
        return res.status(409).json({ error: err.message });
    }
    if (err instanceof LwsInvalidStateTransitionError) {
        return res.status(422).json({ error: err.message, code: 'INVALID_STATE_TRANSITION', fields: err.fields ?? [] });
    }
    if (err instanceof LwsAuthorityError) {
        if (err.code === 'DIRECTOR_UNAUTHORIZED' || err.code === 'FORBIDDEN_PROVENANCE') {
            return res.status(403).json({ error: err.message, code: err.code });
        }
        return res.status(422).json({ error: err.message, code: err.code, fields: err.fields ?? [] });
    }
    if (err instanceof LwsTurnRejectedError) {
        return res.status(422).json(err.turn);
    }
    console.error(`[LWS API] Unexpected error in ${routeName}:`, err.message);
    return res.status(500).json({ error: 'Internal error' });
}

/**
 * Validates that all provided route parameters match the RFC 4122 UUID format.
 * Returns false and sends 400 if any parameter fails.
 * @param {Record<string, string>} params
 * @param {import('express').Response} res
 * @returns {boolean}
 */
function checkUuidParams(params, res) {
    for (const [key, val] of Object.entries(params)) {
        if (!isValidUuid(val)) {
            res.status(400).json({ error: `Invalid ${key} UUID format` });
            return false;
        }
    }
    return true;
}

/**
 * Ensures an active simulation is not paused for mutating routes.
 * @param {import('better-sqlite3').Database} db
 * @param {string} simLwsId
 * @returns {object}
 */
function ensureMutableSimulation(db, simLwsId) {
    const sim = ensureActiveSimulation(db, simLwsId);
    if (sim.status === 'paused') {
        throw new LwsAuthorityError('Simulation is paused', 'SIMULATION_IS_PAUSED');
    }
    return sim;
}

/**
 * Ensures simulation character exists and is not soft-deleted.
 * @param {import('better-sqlite3').Database} db
 * @param {number} simId
 * @param {string} charLwsId
 * @returns {object}
 */
function ensureSimulationCharacter(db, simId, charLwsId) {
    if (!isValidUuid(charLwsId)) {
        throw new LwsValidationError('Invalid character UUID format', ['charLwsId']);
    }
    const char = db.prepare(`
        SELECT sc.*, c.name, c.lws_id AS authored_character_lws_id
        FROM lws_simulation_characters sc
        JOIN lws_characters c ON sc.character_id = c.id
        WHERE sc.simulation_id = ? AND (sc.lws_id = ? OR c.lws_id = ?) AND sc.deleted_at IS NULL
    `).get(simId, charLwsId, charLwsId);
    if (!char) {
        throw new LwsNotFoundError('Character not found in simulation');
    }
    return char;
}



// ============================================================================
// System Status / Ping
// ============================================================================

router.get('/status', (req, res) => {
    try {
        const status = getLwsStatus();
        if (!status.initialized) {
            return res.status(503).json({
                error: 'Living World subsystem is unavailable',
                initialized: false,
                schemaVersion: null,
            });
        }
        return res.json(status);
    } catch (err) {
        return handleRouteError(err, res, 'GET /status');
    }
});

router.post('/ping', (req, res) => {
    try {
        if (!isLwsAvailable()) {
            return res.status(503).json({ error: 'Living World subsystem is unavailable' });
        }
        return res.json({ pong: true, timestamp: Date.now() });
    } catch (err) {
        return handleRouteError(err, res, 'POST /ping');
    }
});

// ============================================================================
// Worlds
// ============================================================================

router.post('/worlds', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    try {
        const world = createWorld(req.body ?? {});
        return res.status(201).json(world);
    } catch (err) {
        return handleRouteError(err, res, 'POST /worlds');
    }
});

router.get('/worlds', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    try {
        const worlds = listWorlds();
        return res.json(worlds);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds');
    }
});

router.get('/worlds/:lwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ lwsId: req.params.lwsId }, res)) return;
    try {
        const world = getWorldByLwsId(req.params.lwsId);
        return res.json(world);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:lwsId');
    }
});

router.patch('/worlds/:lwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ lwsId: req.params.lwsId }, res)) return;
    try {
        const world = updateWorld(req.params.lwsId, req.body ?? {});
        return res.json(world);
    } catch (err) {
        return handleRouteError(err, res, 'PATCH /worlds/:lwsId');
    }
});

router.delete('/worlds/:lwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ lwsId: req.params.lwsId }, res)) return;
    try {
        deleteWorld(req.params.lwsId);
        return res.status(204).send();
    } catch (err) {
        return handleRouteError(err, res, 'DELETE /worlds/:lwsId');
    }
});

// ============================================================================
// Characters (World-Scoped)
// ============================================================================

router.post('/worlds/:worldLwsId/characters', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const char = createCharacter(req.params.worldLwsId, req.body ?? {});
        return res.status(201).json(char);
    } catch (err) {
        return handleRouteError(err, res, 'POST /worlds/:worldLwsId/characters');
    }
});

router.get('/worlds/:worldLwsId/characters', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const chars = listCharacters(req.params.worldLwsId);
        return res.json(chars);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/characters');
    }
});

router.get('/worlds/:worldLwsId/characters/:charLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const char = getCharacterByLwsId(req.params.worldLwsId, req.params.charLwsId);
        return res.json(char);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/characters/:charLwsId');
    }
});

router.patch('/worlds/:worldLwsId/characters/:charLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const char = updateCharacter(req.params.worldLwsId, req.params.charLwsId, req.body ?? {});
        return res.json(char);
    } catch (err) {
        return handleRouteError(err, res, 'PATCH /worlds/:worldLwsId/characters/:charLwsId');
    }
});

router.delete('/worlds/:worldLwsId/characters/:charLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        deleteCharacter(req.params.worldLwsId, req.params.charLwsId);
        return res.status(204).send();
    } catch (err) {
        return handleRouteError(err, res, 'DELETE /worlds/:worldLwsId/characters/:charLwsId');
    }
});

// ============================================================================
// Locations (World-Scoped)
// ============================================================================

router.post('/worlds/:worldLwsId/locations', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const loc = createLocation(req.params.worldLwsId, req.body ?? {});
        return res.status(201).json(loc);
    } catch (err) {
        return handleRouteError(err, res, 'POST /worlds/:worldLwsId/locations');
    }
});

router.get('/worlds/:worldLwsId/locations', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const locs = listLocations(req.params.worldLwsId);
        return res.json(locs);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/locations');
    }
});

router.get('/worlds/:worldLwsId/locations/:locLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, locLwsId: req.params.locLwsId }, res)) return;
    try {
        const loc = getLocationByLwsId(req.params.worldLwsId, req.params.locLwsId);
        return res.json(loc);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/locations/:locLwsId');
    }
});

router.patch('/worlds/:worldLwsId/locations/:locLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, locLwsId: req.params.locLwsId }, res)) return;
    try {
        const loc = updateLocation(req.params.worldLwsId, req.params.locLwsId, req.body ?? {});
        return res.json(loc);
    } catch (err) {
        return handleRouteError(err, res, 'PATCH /worlds/:worldLwsId/locations/:locLwsId');
    }
});

router.delete('/worlds/:worldLwsId/locations/:locLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, locLwsId: req.params.locLwsId }, res)) return;
    try {
        deleteLocation(req.params.worldLwsId, req.params.locLwsId);
        return res.status(204).send();
    } catch (err) {
        return handleRouteError(err, res, 'DELETE /worlds/:worldLwsId/locations/:locLwsId');
    }
});

// ============================================================================
// Factions (World-Scoped) & Membership
// ============================================================================

router.post('/worlds/:worldLwsId/factions', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const faction = createFaction(req.params.worldLwsId, req.body ?? {});
        return res.status(201).json(faction);
    } catch (err) {
        return handleRouteError(err, res, 'POST /worlds/:worldLwsId/factions');
    }
});

router.get('/worlds/:worldLwsId/factions', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const factions = listFactions(req.params.worldLwsId);
        return res.json(factions);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/factions');
    }
});

router.get('/worlds/:worldLwsId/factions/:factionLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, factionLwsId: req.params.factionLwsId }, res)) return;
    try {
        const faction = getFactionByLwsId(req.params.worldLwsId, req.params.factionLwsId);
        return res.json(faction);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/factions/:factionLwsId');
    }
});

router.patch('/worlds/:worldLwsId/factions/:factionLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, factionLwsId: req.params.factionLwsId }, res)) return;
    try {
        const faction = updateFaction(req.params.worldLwsId, req.params.factionLwsId, req.body ?? {});
        return res.json(faction);
    } catch (err) {
        return handleRouteError(err, res, 'PATCH /worlds/:worldLwsId/factions/:factionLwsId');
    }
});

router.delete('/worlds/:worldLwsId/factions/:factionLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, factionLwsId: req.params.factionLwsId }, res)) return;
    try {
        deleteFaction(req.params.worldLwsId, req.params.factionLwsId);
        return res.status(204).send();
    } catch (err) {
        return handleRouteError(err, res, 'DELETE /worlds/:worldLwsId/factions/:factionLwsId');
    }
});

router.post('/worlds/:worldLwsId/factions/:factionLwsId/members', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, factionLwsId: req.params.factionLwsId }, res)) return;
    try {
        const member = addFactionMember(req.params.worldLwsId, req.params.factionLwsId, req.body ?? {});
        return res.status(201).json(member);
    } catch (err) {
        return handleRouteError(err, res, 'POST /worlds/:worldLwsId/factions/:factionLwsId/members');
    }
});

router.delete('/worlds/:worldLwsId/factions/:factionLwsId/members/:charLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({
        worldLwsId: req.params.worldLwsId,
        factionLwsId: req.params.factionLwsId,
        charLwsId: req.params.charLwsId,
    }, res)) return;
    try {
        removeFactionMember(req.params.worldLwsId, req.params.factionLwsId, req.params.charLwsId);
        return res.status(204).send();
    } catch (err) {
        return handleRouteError(err, res, 'DELETE /worlds/:worldLwsId/factions/:factionLwsId/members/:charLwsId');
    }
});

router.get('/worlds/:worldLwsId/factions/:factionLwsId/members', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, factionLwsId: req.params.factionLwsId }, res)) return;
    try {
        const members = listFactionMembers(req.params.worldLwsId, req.params.factionLwsId);
        return res.json(members);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/factions/:factionLwsId/members');
    }
});

// ============================================================================
// World Rules (World-Scoped)
// ============================================================================

router.post('/worlds/:worldLwsId/world-rules', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const rule = createWorldRule(req.params.worldLwsId, req.body ?? {});
        return res.status(201).json(rule);
    } catch (err) {
        return handleRouteError(err, res, 'POST /worlds/:worldLwsId/world-rules');
    }
});

router.get('/worlds/:worldLwsId/world-rules', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const rules = listWorldRules(req.params.worldLwsId);
        return res.json(rules);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/world-rules');
    }
});

router.get('/worlds/:worldLwsId/world-rules/:ruleLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, ruleLwsId: req.params.ruleLwsId }, res)) return;
    try {
        const rule = getWorldRuleByLwsId(req.params.worldLwsId, req.params.ruleLwsId);
        return res.json(rule);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/world-rules/:ruleLwsId');
    }
});

router.patch('/worlds/:worldLwsId/world-rules/:ruleLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, ruleLwsId: req.params.ruleLwsId }, res)) return;
    try {
        const rule = updateWorldRule(req.params.worldLwsId, req.params.ruleLwsId, req.body ?? {});
        return res.json(rule);
    } catch (err) {
        return handleRouteError(err, res, 'PATCH /worlds/:worldLwsId/world-rules/:ruleLwsId');
    }
});

router.delete('/worlds/:worldLwsId/world-rules/:ruleLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, ruleLwsId: req.params.ruleLwsId }, res)) return;
    try {
        deleteWorldRule(req.params.worldLwsId, req.params.ruleLwsId);
        return res.status(204).send();
    } catch (err) {
        return handleRouteError(err, res, 'DELETE /worlds/:worldLwsId/world-rules/:ruleLwsId');
    }
});

// ============================================================================
// Scenarios (World-Scoped) & Roster
// ============================================================================

router.post('/worlds/:worldLwsId/scenarios', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const scenario = createScenario(req.params.worldLwsId, req.body ?? {});
        return res.status(201).json(scenario);
    } catch (err) {
        return handleRouteError(err, res, 'POST /worlds/:worldLwsId/scenarios');
    }
});

router.get('/worlds/:worldLwsId/scenarios', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const scenarios = listScenarios(req.params.worldLwsId);
        return res.json(scenarios);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/scenarios');
    }
});

router.get('/worlds/:worldLwsId/scenarios/:scenarioLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, scenarioLwsId: req.params.scenarioLwsId }, res)) return;
    try {
        const scenario = getScenarioByLwsId(req.params.worldLwsId, req.params.scenarioLwsId);
        return res.json(scenario);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/scenarios/:scenarioLwsId');
    }
});

router.patch('/worlds/:worldLwsId/scenarios/:scenarioLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, scenarioLwsId: req.params.scenarioLwsId }, res)) return;
    try {
        const scenario = updateScenario(req.params.worldLwsId, req.params.scenarioLwsId, req.body ?? {});
        return res.json(scenario);
    } catch (err) {
        return handleRouteError(err, res, 'PATCH /worlds/:worldLwsId/scenarios/:scenarioLwsId');
    }
});

router.delete('/worlds/:worldLwsId/scenarios/:scenarioLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, scenarioLwsId: req.params.scenarioLwsId }, res)) return;
    try {
        deleteScenario(req.params.worldLwsId, req.params.scenarioLwsId);
        return res.status(204).send();
    } catch (err) {
        return handleRouteError(err, res, 'DELETE /worlds/:worldLwsId/scenarios/:scenarioLwsId');
    }
});

router.post('/worlds/:worldLwsId/scenarios/:scenarioLwsId/characters', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, scenarioLwsId: req.params.scenarioLwsId }, res)) return;
    try {
        const entry = addScenarioCharacter(req.params.worldLwsId, req.params.scenarioLwsId, req.body ?? {});
        return res.status(201).json(entry);
    } catch (err) {
        return handleRouteError(err, res, 'POST /worlds/:worldLwsId/scenarios/:scenarioLwsId/characters');
    }
});

router.delete('/worlds/:worldLwsId/scenarios/:scenarioLwsId/characters/:charLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({
        worldLwsId: req.params.worldLwsId,
        scenarioLwsId: req.params.scenarioLwsId,
        charLwsId: req.params.charLwsId,
    }, res)) return;
    try {
        removeScenarioCharacter(req.params.worldLwsId, req.params.scenarioLwsId, req.params.charLwsId);
        return res.status(204).send();
    } catch (err) {
        return handleRouteError(err, res, 'DELETE /worlds/:worldLwsId/scenarios/:scenarioLwsId/characters/:charLwsId');
    }
});

router.get('/worlds/:worldLwsId/scenarios/:scenarioLwsId/characters', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId, scenarioLwsId: req.params.scenarioLwsId }, res)) return;
    try {
        const roster = listScenarioCharacters(req.params.worldLwsId, req.params.scenarioLwsId);
        return res.json(roster);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/scenarios/:scenarioLwsId/characters');
    }
});

// ============================================================================
// Authored Prompt Config (World-Scoped, 1:1)
// ============================================================================

router.post('/worlds/:worldLwsId/prompt-config', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const config = createPromptConfig(req.params.worldLwsId, req.body ?? {});
        return res.status(201).json(config);
    } catch (err) {
        return handleRouteError(err, res, 'POST /worlds/:worldLwsId/prompt-config');
    }
});

router.get('/worlds/:worldLwsId/prompt-config', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const config = getPromptConfig(req.params.worldLwsId);
        return res.json(config);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/prompt-config');
    }
});

router.patch('/worlds/:worldLwsId/prompt-config', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const config = updatePromptConfig(req.params.worldLwsId, req.body ?? {});
        return res.json(config);
    } catch (err) {
        return handleRouteError(err, res, 'PATCH /worlds/:worldLwsId/prompt-config');
    }
});

// ====================================================================
// Simulations & Simulation Characters (Phase 3)
// ====================================================================

// 1. POST /worlds/:worldLwsId/simulations
router.post('/worlds/:worldLwsId/simulations', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const simulation = createSimulation(req.params.worldLwsId, req.body ?? {});
        return res.status(201).json(simulation);
    } catch (err) {
        return handleRouteError(err, res, 'POST /worlds/:worldLwsId/simulations');
    }
});

// 2. GET /worlds/:worldLwsId/simulations
router.get('/worlds/:worldLwsId/simulations', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ worldLwsId: req.params.worldLwsId }, res)) return;
    try {
        const simulations = listSimulations(req.params.worldLwsId, { status: req.query.status });
        return res.json(simulations);
    } catch (err) {
        return handleRouteError(err, res, 'GET /worlds/:worldLwsId/simulations');
    }
});

// 3. GET /simulations/:simLwsId
router.get('/simulations/:simLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const simulation = getSimulationByLwsId(req.params.simLwsId);
        return res.json(simulation);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId');
    }
});

// 4. PATCH /simulations/:simLwsId
router.patch('/simulations/:simLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const simulation = updateSimulation(req.params.simLwsId, req.body ?? {});
        return res.json(simulation);
    } catch (err) {
        return handleRouteError(err, res, 'PATCH /simulations/:simLwsId');
    }
});

// 5. DELETE /simulations/:simLwsId
router.delete('/simulations/:simLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        deleteSimulation(req.params.simLwsId);
        return res.status(204).send();
    } catch (err) {
        return handleRouteError(err, res, 'DELETE /simulations/:simLwsId');
    }
});

// 6. POST /simulations/:simLwsId/characters
router.post('/simulations/:simLwsId/characters', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const simChar = addSimulationCharacter(req.params.simLwsId, req.body ?? {});
        return res.status(201).json(simChar);
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/characters');
    }
});

// 7. GET /simulations/:simLwsId/characters
router.get('/simulations/:simLwsId/characters', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const simChars = listSimulationCharacters(req.params.simLwsId);
        return res.json(simChars);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters');
    }
});

// 8. GET /simulations/:simLwsId/characters/:simCharLwsId
router.get('/simulations/:simLwsId/characters/:simCharLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, simCharLwsId: req.params.simCharLwsId }, res)) return;
    try {
        const simChar = getSimulationCharacterByLwsId(req.params.simLwsId, req.params.simCharLwsId);
        return res.json(simChar);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:simCharLwsId');
    }
});

// 9. PATCH /simulations/:simLwsId/characters/:simCharLwsId
router.patch('/simulations/:simLwsId/characters/:simCharLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, simCharLwsId: req.params.simCharLwsId }, res)) return;
    try {
        const simChar = updateSimulationCharacter(req.params.simLwsId, req.params.simCharLwsId, req.body ?? {});
        return res.json(simChar);
    } catch (err) {
        return handleRouteError(err, res, 'PATCH /simulations/:simLwsId/characters/:simCharLwsId');
    }
});

// 10. DELETE /simulations/:simLwsId/characters/:simCharLwsId
router.delete('/simulations/:simLwsId/characters/:simCharLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, simCharLwsId: req.params.simCharLwsId }, res)) return;
    try {
        deleteSimulationCharacter(req.params.simLwsId, req.params.simCharLwsId);
        return res.status(204).send();
    } catch (err) {
        return handleRouteError(err, res, 'DELETE /simulations/:simLwsId/characters/:simCharLwsId');
    }
});

// ====================================================================
// Events, Turns, and Replay (Phase 4)
// ====================================================================

// 1. POST /simulations/:simLwsId/events
router.post('/simulations/:simLwsId/events', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const callerContext = {
            user: req.user,
            isAdmin: req.user?.profile?.admin === true,
        };
        const event = commitEvent(req.params.simLwsId, req.body ?? {}, callerContext);
        return res.status(201).json(event);
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/events');
    }
});

// 2. GET /simulations/:simLwsId/events
router.get('/simulations/:simLwsId/events', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const events = listEvents(req.params.simLwsId, req.query ?? {});
        return res.json(events);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/events');
    }
});

// 3. GET /simulations/:simLwsId/events/:eventLwsId
router.get('/simulations/:simLwsId/events/:eventLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, eventLwsId: req.params.eventLwsId }, res)) return;
    try {
        const event = getEventByLwsId(req.params.simLwsId, req.params.eventLwsId);
        return res.json(event);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/events/:eventLwsId');
    }
});

// 4. POST /simulations/:simLwsId/turns
router.post('/simulations/:simLwsId/turns', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const callerContext = {
            user: req.user,
            isAdmin: req.user?.profile?.admin === true,
        };
        const result = executeNarrativeTurn(req.params.simLwsId, req.body ?? {}, callerContext);
        if (!result.success) {
            return res.status(422).json(result.turn);
        }
        return res.status(201).json(result.turn);
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/turns');
    }
});

// 5. GET /simulations/:simLwsId/turns
router.get('/simulations/:simLwsId/turns', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const turns = listNarrativeTurns(req.params.simLwsId, req.query ?? {});
        return res.json(turns);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/turns');
    }
});

// 6. GET /simulations/:simLwsId/turns/:turnLwsId
router.get('/simulations/:simLwsId/turns/:turnLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, turnLwsId: req.params.turnLwsId }, res)) return;
    try {
        const turn = getNarrativeTurnByLwsId(req.params.simLwsId, req.params.turnLwsId);
        return res.json(turn);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/turns/:turnLwsId');
    }
});

// 7. POST /simulations/:simLwsId/replay-verify
router.post('/simulations/:simLwsId/replay-verify', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const result = verifySimulationParity(req.params.simLwsId);
        return res.json(result);
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/replay-verify');
    }
});

// ============================================================================
// Phase 5: Time Advance, Scheduled Events, and Routines
// ============================================================================

// 8. POST /simulations/:simLwsId/time-advance
router.post('/simulations/:simLwsId/time-advance', async (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const db = getDb();
        const result = await advanceFictionalTime(db, {
            simLwsId: req.params.simLwsId,
            targetFictionalTime: req.body?.target_fictional_time,
            durationSeconds: req.body?.duration_seconds,
            expectedFictionalTime: req.body?.expected_fictional_time,
            provenance: req.body?.provenance ?? 'user',
        });
        return res.json(result);
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/time-advance');
    }
});

// 9. POST /simulations/:simLwsId/scheduled-events
router.post('/simulations/:simLwsId/scheduled-events', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const input = validateScheduledEventInput(req.body ?? {}, sim.current_fictional_time);
        if (input.target_location_id) {
            const loc = db.prepare('SELECT id, deleted_at FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(input.target_location_id, sim.world_id);
            if (!loc) throw new LwsNotFoundError(`Location ${input.target_location_id} not found in this world`);
            if (loc.deleted_at !== null) throw new LwsValidationError('Cannot assign a soft-deleted location to scheduled event', ['target_location_id']);
        }
        const scheduledEventId = generateUuid();

        const event = commitEvent(req.params.simLwsId, {
            event_type: EVENT_TYPES.SCHEDULE_WORLD_EVENT,
            fictional_time: sim.current_fictional_time,
            provenance: req.body?.provenance ?? 'user',
            payload: {
                scheduled_event_id: scheduledEventId,
                scheduled_fictional_time: input.scheduled_fictional_time,
                title: input.title,
                description: input.description,
                target_location_id: input.target_location_id,
                payload: input.payload,
                supersedes_event_id: null,
            },
        }, { isDedicatedRoute: true });

        const created = getScheduledEventByLwsId(db, sim.id, scheduledEventId);
        return res.status(201).json({ ...created, commit_event: event });
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/scheduled-events');
    }
});

// 10. GET /simulations/:simLwsId/scheduled-events
router.get('/simulations/:simLwsId/scheduled-events', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const events = getScheduledEvents(db, sim.id, {
            status: req.query?.status,
            fromTime: req.query?.from_time,
            toTime: req.query?.to_time,
        });
        return res.json(events);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/scheduled-events');
    }
});

// 11. GET /simulations/:simLwsId/scheduled-events/:eventLwsId
router.get('/simulations/:simLwsId/scheduled-events/:eventLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, eventLwsId: req.params.eventLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const event = getScheduledEventByLwsId(db, sim.id, req.params.eventLwsId);
        return res.json(event);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/scheduled-events/:eventLwsId');
    }
});

// 12. POST /simulations/:simLwsId/scheduled-events/:eventLwsId/cancel
router.post('/simulations/:simLwsId/scheduled-events/:eventLwsId/cancel', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, eventLwsId: req.params.eventLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const existing = getScheduledEventByLwsId(db, sim.id, req.params.eventLwsId);
        if (existing.status !== 'pending') {
            throw new LwsAuthorityError(`Cannot cancel scheduled event with terminal status '${existing.status}'`, 'SCHEDULED_EVENT_TERMINAL');
        }

        const event = commitEvent(req.params.simLwsId, {
            event_type: EVENT_TYPES.CANCEL_SCHEDULED_EVENT,
            fictional_time: sim.current_fictional_time,
            provenance: req.body?.provenance ?? 'user',
            payload: {
                scheduled_event_id: req.params.eventLwsId,
                reason: req.body?.reason || 'cancelled_by_user',
            },
        }, { isDedicatedRoute: true });

        const updated = getScheduledEventByLwsId(db, sim.id, req.params.eventLwsId);
        return res.json({ ...updated, cancel_event: event });
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/scheduled-events/:eventLwsId/cancel');
    }
});

// 13. POST /simulations/:simLwsId/scheduled-events/:eventLwsId/supersede
router.post('/simulations/:simLwsId/scheduled-events/:eventLwsId/supersede', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, eventLwsId: req.params.eventLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const existing = getScheduledEventByLwsId(db, sim.id, req.params.eventLwsId);
        if (existing.status !== 'pending') {
            throw new LwsAuthorityError(`Cannot supersede scheduled event with terminal status '${existing.status}'`, 'SCHEDULED_EVENT_TERMINAL');
        }

        const input = validateScheduledEventInput(req.body ?? {}, sim.current_fictional_time);
        if (input.target_location_id) {
            const loc = db.prepare('SELECT id, deleted_at FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(input.target_location_id, sim.world_id);
            if (!loc) throw new LwsNotFoundError(`Location ${input.target_location_id} not found in this world`);
            if (loc.deleted_at !== null) throw new LwsValidationError('Cannot assign a soft-deleted location to scheduled event', ['target_location_id']);
        }
        const successorId = generateUuid();

        const event = commitEvent(req.params.simLwsId, {
            event_type: EVENT_TYPES.SUPERSEDE_SCHEDULED_EVENT,
            fictional_time: sim.current_fictional_time,
            provenance: req.body?.provenance ?? 'user',
            payload: {
                predecessor_id: req.params.eventLwsId,
                successor_id: successorId,
                scheduled_fictional_time: input.scheduled_fictional_time,
                title: input.title,
                description: input.description,
                target_location_id: input.target_location_id,
                payload: input.payload,
            },
        }, { isDedicatedRoute: true });

        const successor = getScheduledEventByLwsId(db, sim.id, successorId);
        return res.status(201).json({ ...successor, supersede_event: event });
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/scheduled-events/:eventLwsId/supersede');
    }
});

// 14. PUT /simulations/:simLwsId/characters/:charLwsId/routines
router.put('/simulations/:simLwsId/characters/:charLwsId/routines', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const rawRoutines = req.body?.routines;
        if (!Array.isArray(rawRoutines)) {
            throw new LwsValidationError('routines must be an array', ['routines']);
        }

        const validatedRoutines = rawRoutines.map((r, i) => validateRoutineBlock(r, i));
        for (const r of validatedRoutines) {
            if (r.target_location_id) {
                const loc = db.prepare('SELECT id, deleted_at FROM lws_locations WHERE lws_id = ? AND world_id = ?').get(r.target_location_id, sim.world_id);
                if (!loc) throw new LwsNotFoundError(`Location ${r.target_location_id} not found in this world`);
                if (loc.deleted_at !== null) throw new LwsValidationError('Cannot assign a soft-deleted location to routine', ['target_location_id']);
            }
        }

        const event = commitEvent(req.params.simLwsId, {
            event_type: EVENT_TYPES.UPDATE_CHARACTER_ROUTINE,
            actor_character_id: req.params.charLwsId,
            fictional_time: sim.current_fictional_time,
            provenance: req.body?.provenance ?? 'user',
            payload: {
                action: 'replace_all',
                routines: validatedRoutines,
            },
        }, { isDedicatedRoute: true });

        return res.json({ routines: validatedRoutines, event });
    } catch (err) {
        return handleRouteError(err, res, 'PUT /simulations/:simLwsId/characters/:charLwsId/routines');
    }
});

// 15. GET /simulations/:simLwsId/characters/:charLwsId/routines
router.get('/simulations/:simLwsId/characters/:charLwsId/routines', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const charRow = db.prepare(`
            SELECT id FROM lws_simulation_characters
            WHERE lws_id = ? AND simulation_id = ? AND deleted_at IS NULL
        `).get(req.params.charLwsId, sim.id);

        if (!charRow) {
            throw new LwsNotFoundError(`Character ${req.params.charLwsId} not found in this simulation`);
        }

        const routines = db.prepare(`
            SELECT r.*, loc.lws_id AS target_location_lws_id
            FROM lws_simulation_character_routines r
            LEFT JOIN lws_locations loc ON r.target_location_id = loc.id
            WHERE r.simulation_character_id = ? AND r.deleted_at IS NULL
            ORDER BY r.priority DESC, r.day_of_week ASC, r.start_time ASC
        `).all(charRow.id);

        const formatted = routines.map(r => ({
            lws_id: r.lws_id,
            block_id: r.block_id,
            day_of_week: r.day_of_week,
            start_time: r.start_time,
            end_time: r.end_time,
            activity: r.activity,
            target_location_id: r.target_location_lws_id || null,
            priority: r.priority,
            flexibility: r.flexibility,
            enabled: r.enabled,
            created_at: r.created_at,
            updated_at: r.updated_at,
        }));

        return res.json({ routines: formatted });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/routines');
    }
});

// ============================================================================
// Phase 6: Perception, Knowledge, Memory, Beliefs, Camera & Perspectives
// Exactly 13 Phase 6 Endpoints
// ============================================================================

// 1. GET /simulations/:simLwsId/events/:eventLwsId/perceptions
router.get('/simulations/:simLwsId/events/:eventLwsId/perceptions', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, eventLwsId: req.params.eventLwsId }, res)) return;
    try {
        const db = getDb();
        ensureActiveSimulation(db, req.params.simLwsId);
        const perceptions = getEventPerceptions(db, req.params.eventLwsId);
        return res.json({ perceptions });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/events/:eventLwsId/perceptions');
    }
});

// 2. GET /simulations/:simLwsId/characters/:charLwsId/perceptions
router.get('/simulations/:simLwsId/characters/:charLwsId/perceptions', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        ensureActiveSimulation(db, req.params.simLwsId);
        const perceptions = getCharacterPerceptions(db, req.params.charLwsId, {
            modality: req.query.modality,
            limit: req.query.limit,
        });
        return res.json({ perceptions });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/perceptions');
    }
});

// 3. GET /simulations/:simLwsId/characters/:charLwsId/knowledge
router.get('/simulations/:simLwsId/characters/:charLwsId/knowledge', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        ensureActiveSimulation(db, req.params.simLwsId);
        const knowledge = listCharacterKnowledge(db, req.params.charLwsId, {
            source_channel: req.query.source_channel,
            limit: req.query.limit,
        });
        return res.json({ knowledge });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/knowledge');
    }
});

// 4. GET /simulations/:simLwsId/characters/:charLwsId/knowledge/:factKey
router.get('/simulations/:simLwsId/characters/:charLwsId/knowledge/:factKey', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        ensureActiveSimulation(db, req.params.simLwsId);
        const fact = getCharacterFact(db, req.params.charLwsId, req.params.factKey);
        return res.json(fact);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/knowledge/:factKey');
    }
});

// 5. POST /simulations/:simLwsId/characters/:charLwsId/knowledge
router.post('/simulations/:simLwsId/characters/:charLwsId/knowledge', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);

        if (!req.body?.fact_key || typeof req.body.fact_key !== 'string') {
            throw new LwsValidationError('fact_key is required', ['fact_key']);
        }
        if (!req.body?.content || typeof req.body.content !== 'string') {
            throw new LwsValidationError('content is required', ['content']);
        }

        commitEvent(req.params.simLwsId, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            fictional_time: sim.current_fictional_time,
            provenance: 'director',
            payload: {
                target_id: req.params.charLwsId,
                facts: [{
                    fact_key: req.body.fact_key,
                    content: req.body.content,
                    source_channel: req.body.source_channel || 'director_injection',
                }],
            },
        }, { isDedicatedRoute: true, isAdmin: true });

        const fact = getCharacterFact(db, req.params.charLwsId, req.body.fact_key);
        return res.status(201).json(fact);
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/characters/:charLwsId/knowledge');
    }
});

// 6. GET /simulations/:simLwsId/characters/:charLwsId/memories
router.get('/simulations/:simLwsId/characters/:charLwsId/memories', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        ensureActiveSimulation(db, req.params.simLwsId);
        const memories = listCharacterMemories(db, req.params.charLwsId, {
            min_salience: req.query.min_salience,
            memory_type: req.query.memory_type,
            status: req.query.status,
            limit: req.query.limit,
        });
        return res.json({ memories });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/memories');
    }
});

// 7. GET /simulations/:simLwsId/characters/:charLwsId/memories/retrieve
router.get('/simulations/:simLwsId/characters/:charLwsId/memories/retrieve', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        let queryTags = req.query.query_tags;
        if (typeof queryTags === 'string') {
            queryTags = queryTags.split(',').map(t => t.trim()).filter(Boolean);
        }
        const memories = retrieveCharacterMemories(db, req.params.charLwsId, {
            currentFictionalTime: req.query.current_fictional_time || req.query.currentFictionalTime || sim.current_fictional_time,
            limit: req.query.limit,
            min_salience: req.query.min_salience,
            query_tags: queryTags,
            query_text: req.query.query_text,
            query: req.query.query,
        });
        return res.json({ memories });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/memories/retrieve');
    }
});

// 8. GET /simulations/:simLwsId/characters/:charLwsId/beliefs
router.get('/simulations/:simLwsId/characters/:charLwsId/beliefs', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        ensureActiveSimulation(db, req.params.simLwsId);
        const beliefs = listCharacterBeliefs(db, req.params.charLwsId, {
            belief_type: req.query.belief_type,
            limit: req.query.limit,
        });
        return res.json({ beliefs });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/beliefs');
    }
});

// 9. PUT /simulations/:simLwsId/characters/:charLwsId/beliefs/:subjectKey
router.put('/simulations/:simLwsId/characters/:charLwsId/beliefs/:subjectKey', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);

        const subjectKey = req.params.subjectKey;
        if (!subjectKey || typeof subjectKey !== 'string') {
            throw new LwsValidationError('subjectKey is required', ['subjectKey']);
        }

        const body = req.body || {};
        commitEvent(req.params.simLwsId, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            actor_character_id: req.params.charLwsId,
            fictional_time: sim.current_fictional_time,
            provenance: 'director',
            payload: {
                target: 'character_belief',
                target_id: req.params.charLwsId,
                subject_key: subjectKey,
                statement: body.statement ?? body.object_value ?? '',
                belief_type: body.belief_type || 'belief',
                confidence: body.confidence ?? 50,
                source_basis: body.source_basis || 'director_injection',
                beliefs: [{
                    subject_key: subjectKey,
                    statement: body.statement ?? body.object_value ?? '',
                    belief_type: body.belief_type || 'belief',
                    confidence: body.confidence ?? 50,
                    source_basis: body.source_basis || 'director_injection',
                }],
            },
        }, { isDedicatedRoute: true, isAdmin: true });

        const belief = getCharacterBelief(db, req.params.charLwsId, subjectKey);
        return res.json(belief);
    } catch (err) {
        return handleRouteError(err, res, 'PUT /simulations/:simLwsId/characters/:charLwsId/beliefs/:subjectKey');
    }
});

// 10. GET /simulations/:simLwsId/camera
router.get('/simulations/:simLwsId/camera', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const db = getDb();
        ensureActiveSimulation(db, req.params.simLwsId);
        const camera = getSimulationCamera(db, req.params.simLwsId, req.query.camera_name || 'default');
        return res.json(camera);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/camera');
    }
});

// 11. POST /simulations/:simLwsId/camera
router.post('/simulations/:simLwsId/camera', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);

        commitEvent(req.params.simLwsId, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            fictional_time: sim.current_fictional_time,
            provenance: 'director',
            payload: {
                camera: req.body || {},
            },
        }, { isDedicatedRoute: true, isAdmin: true });

        const camera = getSimulationCamera(db, req.params.simLwsId, req.body?.camera_name || 'default');
        return res.json(camera);
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/camera');
    }
});

// 12. GET /simulations/:simLwsId/characters/:charLwsId/perspective
router.get('/simulations/:simLwsId/characters/:charLwsId/perspective', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const perspective = buildSubjectivePerspective(db, req.params.simLwsId, req.params.charLwsId);
        return res.json(perspective);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/perspective');
    }
});

// 13. GET /simulations/:simLwsId/observer/perspective
router.get('/simulations/:simLwsId/observer/perspective', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const db = getDb();
        const perspective = buildObserverPerspective(db, req.params.simLwsId, req.query.camera_name || 'default');
        return res.json(perspective);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/observer/perspective');
    }
});

// ============================================================================
// Phase 7: Character Cognition and Decision Making
// ============================================================================

// 1. GET /simulations/:simLwsId/characters/:charLwsId/cognition
router.get('/simulations/:simLwsId/characters/:charLwsId/cognition', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const char = ensureSimulationCharacter(db, sim.id, req.params.charLwsId);

        const needs = getCharacterNeeds(db, char.id);
        const acuteNeedGoals = getActiveAcuteGoals(db, char.id);
        const activeGoals = listCharacterGoals(db, req.params.charLwsId, { status: 'active', include_deleted: false });
        const activeIntention = getActiveIntention(db, char.id);
        const values = getCharacterValues(db, char.id);
        const currentEmotion = getCharacterEmotion(db, char.id);

        return res.json({
            character_id: req.params.charLwsId,
            needs,
            acute_need_goals: acuteNeedGoals,
            active_goals: activeGoals,
            active_intention: activeIntention,
            values,
            current_emotion: currentEmotion,
        });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/cognition');
    }
});

// 2. GET /simulations/:simLwsId/characters/:charLwsId/needs
router.get('/simulations/:simLwsId/characters/:charLwsId/needs', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const char = ensureSimulationCharacter(db, sim.id, req.params.charLwsId);

        const needs = getCharacterNeeds(db, char.id);
        return res.json({ needs });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/needs');
    }
});

// 3. PUT /simulations/:simLwsId/characters/:charLwsId/needs/:needName
router.put('/simulations/:simLwsId/characters/:charLwsId/needs/:needName', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const isAdmin = req.user?.profile?.admin === true || req.isAdmin === true;
        if (!isAdmin) {
            throw new LwsAuthorityError('Director privileges required for need override', 'DIRECTOR_UNAUTHORIZED');
        }

        const db = getDb();
        const sim = ensureMutableSimulation(db, req.params.simLwsId);
        const char = ensureSimulationCharacter(db, sim.id, req.params.charLwsId);

        const needName = req.params.needName;
        if (!NEED_NAMES.includes(needName)) {
            throw new LwsValidationError(`Invalid need_name '${needName}'. Must be one of: ${NEED_NAMES.join(', ')}`, ['needName']);
        }

        const rawValue = req.body?.value;
        if (rawValue === undefined || rawValue === null || typeof rawValue !== 'number' || isNaN(rawValue)) {
            throw new LwsValidationError('Numeric value is required', ['value']);
        }
        const value = Math.max(0, Math.min(100, Math.round(rawValue)));

        commitEvent(req.params.simLwsId, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            actor_character_id: req.params.charLwsId,
            fictional_time: sim.current_fictional_time,
            provenance: 'director',
            payload: {
                character_needs: {
                    [req.params.charLwsId]: {
                        [needName]: value,
                    },
                },
            },
        }, { isDedicatedRoute: true, isAdmin: true });

        const updatedNeed = db.prepare(`
            SELECT * FROM lws_character_needs
            WHERE simulation_character_id = ? AND need_name = ?
        `).get(char.id, needName);

        return res.json(updatedNeed);
    } catch (err) {
        return handleRouteError(err, res, 'PUT /simulations/:simLwsId/characters/:charLwsId/needs/:needName');
    }
});

// 4. GET /simulations/:simLwsId/characters/:charLwsId/goals
router.get('/simulations/:simLwsId/characters/:charLwsId/goals', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        ensureSimulationCharacter(db, sim.id, req.params.charLwsId);

        const goals = listCharacterGoals(db, req.params.charLwsId, {
            status: req.query.status,
            goal_type: req.query.goal_type,
            include_deleted: req.query.include_deleted === 'true' || req.query.include_deleted === true,
        });
        return res.json({ goals });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/goals');
    }
});

// 5. POST /simulations/:simLwsId/characters/:charLwsId/goals
router.post('/simulations/:simLwsId/characters/:charLwsId/goals', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureMutableSimulation(db, req.params.simLwsId);
        const char = ensureSimulationCharacter(db, sim.id, req.params.charLwsId);

        const body = req.body || {};
        if (body.priority !== undefined && body.priority !== null) {
            const p = Number(body.priority);
            if (!Number.isInteger(p) || p < 1 || p > 79) {
                throw new LwsValidationError('Goal priority must be an integer between 1 and 79', ['priority']);
            }
        }

        const goal = createGoal(db, sim.id, char.id, body);
        return res.status(201).json(goal);
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/characters/:charLwsId/goals');
    }
});

// 6. PATCH /simulations/:simLwsId/characters/:charLwsId/goals/:goalLwsId
router.patch('/simulations/:simLwsId/characters/:charLwsId/goals/:goalLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId, goalLwsId: req.params.goalLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureMutableSimulation(db, req.params.simLwsId);
        ensureSimulationCharacter(db, sim.id, req.params.charLwsId);

        const goal = updateGoal(db, req.params.goalLwsId, req.body || {});
        return res.json(goal);
    } catch (err) {
        return handleRouteError(err, res, 'PATCH /simulations/:simLwsId/characters/:charLwsId/goals/:goalLwsId');
    }
});

// 7. GET /simulations/:simLwsId/characters/:charLwsId/intentions
router.get('/simulations/:simLwsId/characters/:charLwsId/intentions', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        ensureSimulationCharacter(db, sim.id, req.params.charLwsId);

        const intentions = listCharacterIntentions(db, req.params.charLwsId, {
            status: req.query.status,
            include_terminal: req.query.include_terminal === 'true' || req.query.include_terminal === true,
            limit: req.query.limit,
        });
        return res.json({ intentions });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/intentions');
    }
});

// 8. GET /simulations/:simLwsId/characters/:charLwsId/values
router.get('/simulations/:simLwsId/characters/:charLwsId/values', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const char = ensureSimulationCharacter(db, sim.id, req.params.charLwsId);

        const values = getCharacterValues(db, char.id);
        return res.json({ values });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/values');
    }
});

// 9. POST /simulations/:simLwsId/characters/:charLwsId/deliberate
router.post('/simulations/:simLwsId/characters/:charLwsId/deliberate', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const executeChosenAction = req.body?.execute_chosen_action === true;

        if (executeChosenAction) {
            ensureMutableSimulation(db, req.params.simLwsId);
        } else {
            ensureActiveSimulation(db, req.params.simLwsId);
        }

        const sim = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = ?').get(req.params.simLwsId);
        ensureSimulationCharacter(db, sim.id, req.params.charLwsId);

        const result = deliberateCharacter(db, req.params.simLwsId, req.params.charLwsId, {
            executeChosenAction,
            candidates: req.body?.candidates,
            context: req.body?.context,
        });

        if (executeChosenAction && result.success === false) {
            return res.status(422).json(result);
        }

        return res.json(result);
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/characters/:charLwsId/deliberate');
    }
});

// ============================================================================
// Phase 8: Social Systems & Character Development Endpoints
// ============================================================================

// Tier 1: Privileged Observer

// 1. GET /simulations/:simLwsId/social/graph
router.get('/simulations/:simLwsId/social/graph', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const graph = exportSocialGraph(db, sim.id);
        return res.json({ graph });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/social/graph');
    }
});

// 2. GET /simulations/:simLwsId/social-information
router.get('/simulations/:simLwsId/social-information', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const info = listSocialInformation(db, sim.id, {
            topic: req.query.topic,
            originator_character_id: req.query.originator_character_id,
            recipient_character_id: req.query.recipient_character_id,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        return res.json({ social_information: info });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/social-information');
    }
});

// 3. GET /simulations/:simLwsId/social-information/:infoLwsId/tree
router.get('/simulations/:simLwsId/social-information/:infoLwsId/tree', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, infoLwsId: req.params.infoLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const tree = getRumorTree(db, sim.id, req.params.infoLwsId);
        return res.json({ tree });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/social-information/:infoLwsId/tree');
    }
});

// 4. GET /simulations/:simLwsId/faction-memberships
router.get('/simulations/:simLwsId/faction-memberships', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const memberships = listSimulationFactionMemberships(db, sim.id, {
            faction_id: req.query.faction_id,
            character_id: req.query.character_id,
            membership_status: req.query.membership_status,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        return res.json({ faction_memberships: memberships });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/faction-memberships');
    }
});

// Tier 2: Subjective Character

// 5. GET /simulations/:simLwsId/characters/:charLwsId/relationships
router.get('/simulations/:simLwsId/characters/:charLwsId/relationships', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const char = ensureSimulationCharacter(db, sim.id, req.params.charLwsId);
        const relationships = listCharacterRelationships(db, sim.id, char.id, {
            min_familiarity: req.query.min_familiarity !== undefined ? Number(req.query.min_familiarity) : undefined,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        return res.json({ relationships });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/relationships');
    }
});

// 6. GET /simulations/:simLwsId/characters/:charLwsId/relationships/:targetCharLwsId
router.get('/simulations/:simLwsId/characters/:charLwsId/relationships/:targetCharLwsId', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId, targetCharLwsId: req.params.targetCharLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const char = ensureSimulationCharacter(db, sim.id, req.params.charLwsId);
        const targetChar = ensureSimulationCharacter(db, sim.id, req.params.targetCharLwsId);
        const relationship = getRelationshipByCharacters(db, sim.id, char.id, targetChar.id);
        if (!relationship) {
            return res.json({
                source_character_id: char.lws_id,
                target_character_id: targetChar.lws_id,
                trust: 0,
                affection: 0,
                familiarity: 0,
                respect: 0,
                loyalty: 0,
                last_interaction_fictional_time: null,
            });
        }
        return res.json(relationship);
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/relationships/:targetCharLwsId');
    }
});

// 7. GET /simulations/:simLwsId/characters/:charLwsId/relationships/:targetCharLwsId/evidence
router.get('/simulations/:simLwsId/characters/:charLwsId/relationships/:targetCharLwsId/evidence', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId, targetCharLwsId: req.params.targetCharLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const char = ensureSimulationCharacter(db, sim.id, req.params.charLwsId);
        const targetChar = ensureSimulationCharacter(db, sim.id, req.params.targetCharLwsId);
        const relationship = getRelationshipByCharacters(db, sim.id, char.id, targetChar.id);
        if (!relationship) {
            return res.json({ evidence: [] });
        }
        const evidence = listRelationshipEvidence(db, sim.id, relationship.lws_id, {
            interaction_type: req.query.interaction_type,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        return res.json({ evidence });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/relationships/:targetCharLwsId/evidence');
    }
});

// 8. GET /simulations/:simLwsId/characters/:charLwsId/factions
router.get('/simulations/:simLwsId/characters/:charLwsId/factions', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const char = ensureSimulationCharacter(db, sim.id, req.params.charLwsId);
        const factions = getCharacterFactionMemberships(db, sim.id, char.id);
        return res.json({ factions });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/factions');
    }
});

// 9. GET /simulations/:simLwsId/characters/:charLwsId/development
router.get('/simulations/:simLwsId/characters/:charLwsId/development', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const char = ensureSimulationCharacter(db, sim.id, req.params.charLwsId);
        const development = listCharacterDevelopmentRecords(db, sim.id, char.id, {
            dimension_category: req.query.dimension_category,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        return res.json({ development });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/development');
    }
});

// 10. GET /simulations/:simLwsId/characters/:charLwsId/known-rumors
router.get('/simulations/:simLwsId/characters/:charLwsId/known-rumors', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId, charLwsId: req.params.charLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureActiveSimulation(db, req.params.simLwsId);
        const char = ensureSimulationCharacter(db, sim.id, req.params.charLwsId);
        const rumors = listKnownRumors(db, sim.id, char.id, {
            topic: req.query.topic,
            limit: req.query.limit,
            offset: req.query.offset,
        });
        return res.json({ rumors });
    } catch (err) {
        return handleRouteError(err, res, 'GET /simulations/:simLwsId/characters/:charLwsId/known-rumors');
    }
});

// Tier 3: Director Authority

// 11. POST /simulations/:simLwsId/social-interventions
router.post('/simulations/:simLwsId/social-interventions', (req, res) => {
    if (!isLwsAvailable()) return res.status(503).json({ error: 'Living World subsystem is unavailable' });
    if (!checkUuidParams({ simLwsId: req.params.simLwsId }, res)) return;
    try {
        const db = getDb();
        const sim = ensureMutableSimulation(db, req.params.simLwsId);

        const body = req.body || {};
        if (!body.social_state && !body.relationship && !body.faction_membership && !body.development_record) {
            throw new LwsValidationError('Social intervention requires social_state, relationship, faction_membership, or development_record payload', ['social_state']);
        }

        const socialState = body.social_state || {
            relationship: body.relationship,
            faction_membership: body.faction_membership,
            development_record: body.development_record,
        };

        const event = commitEvent(req.params.simLwsId, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            actor_character_id: body.actor_character_id || null,
            target_character_id: body.target_character_id || null,
            fictional_time: sim.current_fictional_time,
            payload: {
                target: 'social_state',
                social_state: socialState,
                ...socialState,
                rationale: body.rationale || 'Director social intervention',
            },
            provenance: 'director',
        }, { isDedicatedRoute: true, isAdmin: true });

        return res.status(201).json({
            event,
            status: 'committed',
        });
    } catch (err) {
        return handleRouteError(err, res, 'POST /simulations/:simLwsId/social-interventions');
    }
});

export { router };

