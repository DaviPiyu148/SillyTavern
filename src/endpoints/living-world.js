import express from 'express';
import {
    getLwsStatus,
    isLwsAvailable,
    LwsValidationError,
    LwsNotFoundError,
    LwsConflictError,
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

export { router };
