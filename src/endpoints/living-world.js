import express from 'express';
import {
    getLwsStatus,
    isLwsAvailable,
    LwsValidationError,
    LwsNotFoundError,
    LwsConflictError,
    LwsAuthorityError,
    LwsTurnRejectedError,
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
} from '../living-world/index.js';
import { isValidUuid } from '../living-world/authored/common.js';

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

export { router };

