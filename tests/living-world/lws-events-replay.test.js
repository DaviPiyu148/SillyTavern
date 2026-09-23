import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    init,
    onExit,
    createWorld,
    createCharacter,
    createLocation,
    createSimulation,
    addSimulationCharacter,
    commitEvent,
    listEvents,
    replaySimulation,
    verifySimulationParity,
    EVENT_TYPES,
} from '../../src/living-world/index.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('LWS In-Memory Zero-SQL Replay Engine and Canonical Parity Verification', () => {
    let tempDir;
    let world;
    let sim;
    let char1;
    let char2;
    let char3;
    let loc1;
    let loc2;
    let loc3;
    let simChar1;
    let simChar2;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-replay-test-'));
        const dbPath = path.join(tempDir, 'replay-test.db');
        await init({ dbPath });

        world = createWorld({ name: 'Replay World' });
        char1 = createCharacter(world.lws_id, { name: 'Eldrin', description: 'Archmage' });
        char2 = createCharacter(world.lws_id, { name: 'Lyra', description: 'Rogue' });
        char3 = createCharacter(world.lws_id, { name: 'Kael', description: 'Paladin' });

        loc1 = createLocation(world.lws_id, { name: 'Sanctum' });
        loc2 = createLocation(world.lws_id, { name: 'Market' });
        loc3 = createLocation(world.lws_id, { name: 'Crypt' });

        sim = createSimulation(world.lws_id, {
            name: 'Replay Timeline',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });

        simChar1 = addSimulationCharacter(sim.lws_id, {
            character_id: char1.lws_id,
            initial_location_id: loc1.lws_id,
            activity: 'meditating',
            physical_condition: 'energized',
            runtime_state: { mana: 100, inventory: ['grimoire'] },
        });

        simChar2 = addSimulationCharacter(sim.lws_id, {
            character_id: char2.lws_id,
            initial_location_id: loc2.lws_id,
            activity: 'browsing',
            physical_condition: 'healthy',
            runtime_state: { gold: 50 },
        });
    });

    afterEach(async () => {
        await onExit();
        if (tempDir) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                void err;
            }
        }
    });

    test('replays 25+ diverse events covering all 13 stateful types and proves 100% parity', () => {
        // We will execute a realistic sequence of 25+ events against the simulation.
        // Events already generated at initialization:
        // 1. SIMULATION_START (from createSimulation)
        // 2. CHARACTER_JOIN (simChar1)
        // 3. CHARACTER_JOIN (simChar2)

        // 4. MOVE_CHARACTER (simChar1 to loc2)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.MOVE_CHARACTER,
            actor_character_id: simChar1.lws_id,
            location_id: loc2.lws_id,
        });

        // 5. OBSERVE (simChar1 at loc2 - event-only fact)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.OBSERVE,
            actor_character_id: simChar1.lws_id,
            location_id: loc2.lws_id,
            payload: { focus: 'Crowd' },
        });

        // 6. COMMUNICATE (direct between collocated simChar1 and simChar2 at loc2)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMMUNICATE,
            actor_character_id: simChar1.lws_id,
            target_character_id: simChar2.lws_id,
            location_id: loc2.lws_id,
            payload: { message: 'Greetings, Lyra', channel: 'direct' },
        });

        // 7. EMOTE (simChar2 smiles)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.EMOTE,
            actor_character_id: simChar2.lws_id,
            payload: { expression: 'smiles warmly' },
        });

        // 8. UPDATE_CHARACTER_ACTIVITY (simChar1 bargaining)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY,
            actor_character_id: simChar1.lws_id,
            payload: { activity: 'bargaining' },
        });

        // 9. UPDATE_PHYSICAL_CONDITION (simChar2 tired)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.UPDATE_PHYSICAL_CONDITION,
            actor_character_id: simChar2.lws_id,
            payload: { physical_condition: 'fatigued' },
        });

        // 10. UPDATE_RUNTIME_STATE (simChar2 gains gold)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
            actor_character_id: simChar2.lws_id,
            payload: { patch: { gold: 120, reputation: { market: 'trusted' } } },
        });

        // 11. REST (simChar2 rests)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.REST,
            actor_character_id: simChar2.lws_id,
        });

        // 12. WORK (simChar1 works)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.WORK,
            actor_character_id: simChar1.lws_id,
        });

        // 13. INTERACT_OBJECT (simChar1 drinks potion at market)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.INTERACT_OBJECT,
            actor_character_id: simChar1.lws_id,
            location_id: loc2.lws_id,
            payload: { object_name: 'Potion of Clarity', action: 'drink' },
        });

        // 14. CONSUME_ITEM (simChar2 consumes ration)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CONSUME_ITEM,
            actor_character_id: simChar2.lws_id,
            payload: { item_name: 'Ration', quantity: 1 },
        });

        // 15. TRANSFER_ITEM (simChar2 gives amulet to collocated simChar1)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.TRANSFER_ITEM,
            actor_character_id: simChar2.lws_id,
            target_character_id: simChar1.lws_id,
            location_id: loc2.lws_id,
            payload: { item_name: 'Ancient Amulet', quantity: 1 },
        });

        // 16. GENERAL_ACTION (simChar1 casts ward)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.GENERAL_ACTION,
            actor_character_id: simChar1.lws_id,
            payload: { description: 'casts warding rune' },
        });

        // 17. MOVE_CHARACTER (simChar1 to loc3 Crypt)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.MOVE_CHARACTER,
            actor_character_id: simChar1.lws_id,
            location_id: loc3.lws_id,
        });

        // 18. MOVE_CHARACTER (simChar2 to loc3 Crypt)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.MOVE_CHARACTER,
            actor_character_id: simChar2.lws_id,
            location_id: loc3.lws_id,
        });

        // 19. COMBAT_ACTION (simChar1 and simChar2 spar collocated in Crypt)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.COMBAT_ACTION,
            actor_character_id: simChar1.lws_id,
            target_character_id: simChar2.lws_id,
            location_id: loc3.lws_id,
            payload: { action_type: 'defend' },
        });

        // 20. CHARACTER_JOIN (Kael joins in Crypt)
        const kaelJoin = commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_JOIN,
            location_id: loc3.lws_id,
            payload: {
                character_id: char3.lws_id,
                activity: 'praying',
                physical_condition: 'shielded',
                runtime_state: { oath: 'devotion' },
            },
        });
        const simChar3LwsId = kaelJoin.actor_character_id;

        // 21. DIRECTOR_NOTE
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.DIRECTOR_NOTE,
            payload: { note: 'A cold wind enters the crypt.' },
            provenance: 'director',
        }, { isAdmin: true });

        // 22. DIRECTOR_INSPECT
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.DIRECTOR_INSPECT,
            payload: { target_type: 'location', query: { id: loc3.lws_id } },
            provenance: 'director',
        }, { isAdmin: true });

        // 23. DIRECTOR_MODIFY_STATE (Simulation settings)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            payload: {
                target: 'simulation',
                settings_patch: { aura: 'spectral', gloom_level: 5 },
            },
            provenance: 'director',
        }, { isAdmin: true });

        // 24. DIRECTOR_MODIFY_STATE (Character coordinates & deepMerge state)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            actor_character_id: simChar3LwsId,
            location_id: loc1.lws_id,
            payload: {
                activity: 'meditating deeply',
                runtime_state: { oath: 'devotion', blessing: 'radiance' },
            },
            provenance: 'director',
        }, { isAdmin: true });

        // 25. CHARACTER_LEAVE (Lyra leaves the party)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.CHARACTER_LEAVE,
            actor_character_id: simChar2.lws_id,
            payload: { reason: 'Returned to shadows' },
        });

        // 26. SIMULATION_PAUSE
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.SIMULATION_PAUSE,
            payload: { reason: 'Intermission' },
            provenance: 'director',
        }, { isAdmin: true });

        // 27. SIMULATION_RESUME
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.SIMULATION_RESUME,
            payload: { reason: 'Resume adventure' },
            provenance: 'director',
        }, { isAdmin: true });

        // 28. SIMULATION_STOP (archive simulation)
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.SIMULATION_STOP,
            payload: { reason: 'Campaign conclusion' },
            provenance: 'director',
        }, { isAdmin: true });

        // --------------------------------------------------------------------
        // Parity Verification: Pure In-Memory Fold vs Projected SQLite Rows
        // --------------------------------------------------------------------
        const events = listEvents(sim.lws_id, { limit: 100000 });
        const replayResult = replaySimulation(events);
        expect(replayResult.simulation.status).toBe('archived');
        expect(Object.keys(replayResult.characters)).toHaveLength(3);

        const parityResult = verifySimulationParity(sim.lws_id);

        expect(parityResult.verified).toBe(true);
        expect(parityResult.event_count).toBeGreaterThanOrEqual(28);
        expect(parityResult.character_count).toBe(3);
        expect(parityResult.drift_detected).toBe(false);
    });
});
