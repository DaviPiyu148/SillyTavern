import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { init, onExit } from '../../src/living-world/index.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';
import { LwsApiClient } from '../../public/scripts/living-world/api.js';
import { lwsState, STORAGE_KEY_LAST_SIM } from '../../public/scripts/living-world/state.js';

const toArray = (res, key) => (Array.isArray(res) ? res : (res?.[key] || []));
const toEntity = (res, key) => (res && typeof res === 'object' && res[key] ? res[key] : res);

describe('LWS UI Native Workflow & CRUD Lifecycle Integration (lws-ui-workflow-integration)', () => {
    let server;
    let baseUrl;
    let tempDir;
    let client;
    let mockAccountStorage;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-ui-workflow-test-'));
        const dbPath = path.join(tempDir, 'ui-workflow-test.db');
        await init({ dbPath });

        const app = express();
        app.use(express.json());
        app.use((req, res, next) => {
            req.user = { profile: { handle: 'test-admin', admin: true, enabled: true } };
            next();
        });
        app.use('/api/living-world', lwsRouter);

        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        client = new LwsApiClient({ baseUrl });

        mockAccountStorage = {
            _data: {},
            getItem: (key) => mockAccountStorage._data[key] || null,
            setItem: (key, val) => { mockAccountStorage._data[key] = String(val); },
            removeItem: (key) => { delete mockAccountStorage._data[key]; },
        };
        globalThis.accountStorage = mockAccountStorage;
    });

    afterAll(async () => {
        await onExit();
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
        if (tempDir) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                void err;
            }
        }
    });

    // =========================================================================
    // 1. World CRUD Lifecycle
    // =========================================================================
    let worldLwsId;
    it('executes full World CRUD lifecycle (create, read, update, delete)', async () => {
        // Create
        const createdRes = await client.createWorld({
            name: 'Aethelgard',
            description: 'A magical realm of floating isles',
            tags: ['fantasy', 'magic'],
        });
        const created = toEntity(createdRes, 'world');
        expect(created.lws_id).toBeDefined();
        worldLwsId = created.lws_id;

        // Read (list)
        const listRes = await client.listWorlds();
        const worlds = toArray(listRes, 'worlds');
        const found = worlds.find(w => w.lws_id === worldLwsId);
        expect(found).toBeDefined();
        expect(found.name).toBe('Aethelgard');

        // Read (single)
        const singleRes = await client.getWorld(worldLwsId);
        const w = toEntity(singleRes, 'world');
        expect(w.name).toBe('Aethelgard');

        // Update
        const updatedRes = await client.updateWorld(worldLwsId, {
            description: 'Updated realm description',
        });
        const wUp = toEntity(updatedRes, 'world');
        expect(wUp.description).toBe('Updated realm description');

        // Create secondary world to test soft-delete
        const toDeleteRes = await client.createWorld({ name: 'Doomed World' });
        const delId = toEntity(toDeleteRes, 'world').lws_id;
        const delRes = await client.deleteWorld(delId);
        expect(delRes).toBeNull(); // 204 No Content

        // Deleted world cannot be read
        await expect(client.getWorld(delId)).rejects.toThrow();
    });

    // =========================================================================
    // 2. Character CRUD Lifecycle
    // =========================================================================
    let charDaveId;
    let charCharlotteId;
    it('executes full Character CRUD lifecycle (create, read, update, delete)', async () => {
        // Create Character 1 (Dave)
        const charDave = toEntity(await client.createCharacter(worldLwsId, {
            name: 'Dave',
            personality: 'Analytical and pragmatic scholar',
        }), 'character');
        charDaveId = charDave.lws_id;
        expect(charDaveId).toBeDefined();

        // Create Character 2 (Charlotte)
        const charCharlotte = toEntity(await client.createCharacter(worldLwsId, {
            name: 'Charlotte',
            personality: 'Curious explorer and cartographer',
        }), 'character');
        charCharlotteId = charCharlotte.lws_id;
        expect(charCharlotteId).toBeDefined();

        // Read (list)
        const charsRes = await client.listCharacters(worldLwsId);
        const chars = toArray(charsRes, 'characters');
        expect(chars.length).toBeGreaterThanOrEqual(2);

        // Read (single)
        const single = toEntity(await client.getCharacter(worldLwsId, charDaveId), 'character');
        expect(single.name).toBe('Dave');

        // Update
        const updated = toEntity(await client.updateCharacter(worldLwsId, charDaveId, {
            personality: 'Seasoned pragmatic scholar',
        }), 'character');
        expect(updated.personality).toBe('Seasoned pragmatic scholar');

        // Delete test with third character
        const tempChar = toEntity(await client.createCharacter(worldLwsId, { name: 'Temporary NPC' }), 'character');
        const tempCharId = tempChar.lws_id;
        await client.deleteCharacter(worldLwsId, tempCharId);
        await expect(client.getCharacter(worldLwsId, tempCharId)).rejects.toThrow();
    });

    // =========================================================================
    // 3. Location CRUD Lifecycle
    // =========================================================================
    let locLibraryId;
    let locObservatoryId;
    it('executes full Location CRUD lifecycle with hierarchical parent locations', async () => {
        // Create root location
        const locLibrary = toEntity(await client.createLocation(worldLwsId, {
            name: 'Grand Archives',
            description: 'Towering shelves of ancient lore',
        }), 'location');
        locLibraryId = locLibrary.lws_id;
        expect(locLibraryId).toBeDefined();

        // Create child location with parent_location_id
        const locObservatory = toEntity(await client.createLocation(worldLwsId, {
            name: 'Stargazer Spire',
            description: 'Open observatory at the tower apex',
            parent_location_id: locLibraryId,
        }), 'location');
        locObservatoryId = locObservatory.lws_id;
        expect(locObservatoryId).toBeDefined();

        // Read (list)
        const locList = toArray(await client.listLocations(worldLwsId), 'locations');
        expect(locList.length).toBeGreaterThanOrEqual(2);

        // Update
        const updated = toEntity(await client.updateLocation(worldLwsId, locObservatoryId, {
            description: 'Refurbished celestial observatory',
        }), 'location');
        expect(updated.description).toBe('Refurbished celestial observatory');

        // Delete test
        const tempLoc = toEntity(await client.createLocation(worldLwsId, { name: 'Cellar' }), 'location');
        const tempLocId = tempLoc.lws_id;
        await client.deleteLocation(worldLwsId, tempLocId);
        await expect(client.getLocation(worldLwsId, tempLocId)).rejects.toThrow();
    });

    // =========================================================================
    // 4. Faction CRUD and Membership Management Lifecycle
    // =========================================================================
    let factionId;
    it('executes full Faction CRUD and Membership management (list, add, remove)', async () => {
        // Create Faction
        const faction = toEntity(await client.createFaction(worldLwsId, {
            name: 'Order of the Compass',
            description: 'Scholars dedicated to charting the known reaches',
        }), 'faction');
        factionId = faction.lws_id;
        expect(factionId).toBeDefined();

        // Read Faction
        const fSingle = toEntity(await client.getFaction(worldLwsId, factionId), 'faction');
        expect(fSingle.name).toBe('Order of the Compass');

        // Update Faction
        const fUpdated = toEntity(await client.updateFaction(worldLwsId, factionId, {
            description: 'Guild of elite cartographers and explorers',
        }), 'faction');
        expect(fUpdated.description).toBe('Guild of elite cartographers and explorers');

        // Add Member
        const memberRes = await client.addFactionMember(worldLwsId, factionId, {
            character_lws_id: charDaveId,
            role: 'Archivist',
            rank: 2,
        });
        expect(memberRes).toBeDefined();

        // List Members
        const membersList = toArray(await client.listFactionMembers(worldLwsId, factionId), 'members');
        expect(membersList.length).toBeGreaterThanOrEqual(1);

        // Remove Member
        await client.removeFactionMember(worldLwsId, factionId, charDaveId);
        const afterRemove = toArray(await client.listFactionMembers(worldLwsId, factionId), 'members');
        expect(afterRemove.filter(m => m.character_lws_id === charDaveId)).toHaveLength(0);

        // Delete Faction test
        const tempFac = toEntity(await client.createFaction(worldLwsId, { name: 'Rival Gang' }), 'faction');
        const tempFacId = tempFac.lws_id;
        await client.deleteFaction(worldLwsId, tempFacId);
        await expect(client.getFaction(worldLwsId, tempFacId)).rejects.toThrow();
    });

    // =========================================================================
    // 5. World Rules CRUD Lifecycle
    // =========================================================================
    let ruleId;
    it('executes full World Rule CRUD lifecycle', async () => {
        // Create Rule
        const rule = toEntity(await client.createWorldRule(worldLwsId, {
            title: 'Law of Conservation of Magic',
            body: 'No enchantment can be cast without equivalent catalyst expenditure.',
            sort_order: 1,
        }), 'rule');
        ruleId = rule.lws_id;
        expect(ruleId).toBeDefined();

        // Read (list)
        const rules = toArray(await client.listWorldRules(worldLwsId), 'rules');
        expect(rules.some(r => r.lws_id === ruleId)).toBe(true);

        // Read (single)
        const rSingle = toEntity(await client.getWorldRule(worldLwsId, ruleId), 'rule');
        expect(rSingle.title).toBe('Law of Conservation of Magic');

        // Update
        const rUpdated = toEntity(await client.updateWorldRule(worldLwsId, ruleId, {
            body: 'Updated law text.',
        }), 'rule');
        expect(rUpdated.body).toBe('Updated law text.');

        // Delete
        const tempRule = toEntity(await client.createWorldRule(worldLwsId, { title: 'Temporary Rule', body: 'Temp' }), 'rule');
        const tempRuleId = tempRule.lws_id;
        await client.deleteWorldRule(worldLwsId, tempRuleId);
        await expect(client.getWorldRule(worldLwsId, tempRuleId)).rejects.toThrow();
    });

    // =========================================================================
    // 6. Ambient Archetypes CRUD Lifecycle
    // =========================================================================
    let archetypeId;
    it('executes full Ambient Archetype CRUD lifecycle', async () => {
        // Create Archetype with required schema fields
        const arch = toEntity(await client.createAmbientArchetype(worldLwsId, {
            archetype_key: 'town_guard',
            role_title: 'Town Guardsman',
            description_template: 'Vigilant guard armed with halberd',
            default_activities: ['patrolling the gate'],
            location_tags: ['town'],
            time_windows: ['morning', 'afternoon', 'evening'],
            spawn_weight: 10,
        }), 'archetype');
        archetypeId = arch.lws_id;
        expect(archetypeId).toBeDefined();

        // Read (list)
        const archetypes = toArray(await client.listAmbientArchetypes(worldLwsId), 'ambient_archetypes');
        expect(archetypes.some(a => a.lws_id === archetypeId)).toBe(true);

        // Read (single)
        const aSingle = toEntity(await client.getAmbientArchetype(worldLwsId, archetypeId), 'archetype');
        expect(aSingle.role_title || aSingle.name).toBe('Town Guardsman');

        // Update
        const aUpdated = toEntity(await client.updateAmbientArchetype(worldLwsId, archetypeId, {
            description_template: 'Elite city watchman',
        }), 'archetype');
        expect(aUpdated.description_template || aUpdated.description).toBe('Elite city watchman');

        // Delete
        const tempArch = toEntity(await client.createAmbientArchetype(worldLwsId, {
            archetype_key: 'temp_citizen',
            role_title: 'Temp Citizen',
            description_template: 'Temp',
        }), 'archetype');
        const tempArchId = tempArch.lws_id;
        await client.deleteAmbientArchetype(worldLwsId, tempArchId);
        await expect(client.getAmbientArchetype(worldLwsId, tempArchId)).rejects.toThrow();
    });

    // =========================================================================
    // 7. Scenarios & Roster Management Lifecycle
    // =========================================================================
    let scenarioId;
    it('executes full Scenario CRUD and Roster management (add, remove)', async () => {
        // Create Scenario
        const scenario = toEntity(await client.createScenario(worldLwsId, {
            name: 'The Lost Codex',
            description: 'Investigation into missing astronomical parchment',
            starting_location_id: locLibraryId,
            opening_narrative: 'Rain drums against the arched glass of the Grand Archives.',
        }), 'scenario');
        scenarioId = scenario.lws_id;
        expect(scenarioId).toBeDefined();

        // Read (list)
        const scenarios = toArray(await client.listScenarios(worldLwsId), 'scenarios');
        expect(scenarios.some(s => s.lws_id === scenarioId)).toBe(true);

        // Add Roster characters
        await client.addScenarioCharacter(worldLwsId, scenarioId, {
            character_lws_id: charDaveId,
            role: 'Investigator',
        });
        await client.addScenarioCharacter(worldLwsId, scenarioId, {
            character_lws_id: charCharlotteId,
            role: 'Assistant',
        });

        // Read Scenario with roster
        const scSingle = toEntity(await client.getScenario(worldLwsId, scenarioId), 'scenario');
        expect(scSingle.name).toBe('The Lost Codex');

        // Remove character from roster
        await client.removeScenarioCharacter(worldLwsId, scenarioId, charCharlotteId);

        // Update Scenario
        const scUpdated = toEntity(await client.updateScenario(worldLwsId, scenarioId, {
            description: 'Revised codex investigation scenario',
        }), 'scenario');
        expect(scUpdated.description).toBe('Revised codex investigation scenario');

        // Delete Scenario test
        const tempSc = toEntity(await client.createScenario(worldLwsId, { name: 'Unused Scenario' }), 'scenario');
        const tempScId = tempSc.lws_id;
        await client.deleteScenario(worldLwsId, tempScId);
        await expect(client.getScenario(worldLwsId, tempScId)).rejects.toThrow();
    });

    // =========================================================================
    // 8. Prompt Configuration Management (Create, Get, Update)
    // =========================================================================
    it('executes Prompt Configuration management (create, get, update via PATCH)', async () => {
        // Create initial config if not exists
        await client.createPromptConfig(worldLwsId, {
            style_notes: 'Base simulation instructions...',
            tone_notes: 'Scholarly fantasy',
        });

        const initialCfg = toEntity(await client.getPromptConfig(worldLwsId), 'prompt_config');
        expect(initialCfg).toBeDefined();
        expect(initialCfg.style_notes).toBe('Base simulation instructions...');

        const updated = toEntity(await client.updatePromptConfig(worldLwsId, {
            style_notes: 'Simulation prompt instructions updated...',
        }), 'prompt_config');
        expect(updated.style_notes).toBe('Simulation prompt instructions updated...');
    });

    // =========================================================================
    // 9. Simulation Runtime Lifecycle & Reconnection
    // =========================================================================
    let simLwsId;
    it('executes Simulation creation, hydration, time-advance, and session recovery', async () => {
        // Re-add Charlotte and Dave to scenario roster for simulation
        await client.addScenarioCharacter(worldLwsId, scenarioId, {
            character_lws_id: charDaveId,
            role: 'Investigator',
        });
        await client.addScenarioCharacter(worldLwsId, scenarioId, {
            character_lws_id: charCharlotteId,
            role: 'Navigator',
        });

        // Create Simulation with explicit scenario_id parameter
        const sim = toEntity(await client.createSimulation(worldLwsId, {
            scenario_id: scenarioId,
            scenario_lws_id: scenarioId,
            name: 'Codex Expedition Live',
            initial_fictional_time: '2026-06-01T08:00:00Z',
        }), 'simulation');
        simLwsId = sim.lws_id;
        expect(simLwsId).toBeDefined();

        // Validate client session sync with accountStorage
        lwsState.setState({ simulation_lws_id: simLwsId });
        expect(mockAccountStorage.getItem(STORAGE_KEY_LAST_SIM)).toBe(simLwsId);

        // Read Simulation
        const s = toEntity(await client.getSimulation(simLwsId), 'simulation');
        expect(s.name).toBe('Codex Expedition Live');

        // List simulation characters
        const simChars = toArray(await client.listSimulationCharacters(simLwsId), 'characters');
        expect(simChars.length).toBeGreaterThanOrEqual(1);

        // Advance Time (1 hour)
        const timeRes = await client.advanceTime(simLwsId, { advance_seconds: 3600 });
        expect(timeRes.fictional_time || timeRes.current_fictional_time).toBeDefined();

        // Director Interventions
        // 1. Note
        const noteRes = await client.recordDirectorNote(simLwsId, 'The bell strikes nine in the morning.');
        expect(noteRes).toBeDefined();

        // 2. Goal injection
        const simCharDave = simChars.find(c => c.character_id === charDaveId || c.lws_id === charDaveId);
        const targetDaveId = simCharDave?.lws_id || simChars[0].lws_id;
        const goalRes = await client.injectGoal(simLwsId, targetDaveId, {
            title: 'Search library shelves',
            description: 'Look through astronomy folios',
            priority: 75,
            category: 'ACUTE',
        });
        expect(goalRes).toBeDefined();

        // Update Simulation
        const sUp = toEntity(await client.updateSimulation(simLwsId, { name: 'Codex Expedition Renamed' }), 'simulation');
        expect(sUp.name).toBe('Codex Expedition Renamed');

        // Test Session Reset on 404 (non-existent or deleted sim)
        lwsState.resetOn404();
        expect(mockAccountStorage.getItem(STORAGE_KEY_LAST_SIM)).toBeNull();
        expect(lwsState.getState().simulation_lws_id).toBeNull();
    });
});
