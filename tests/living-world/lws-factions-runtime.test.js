import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    init,
    onExit,
    createWorld,
    createLocation,
    createCharacter,
    createFaction,
    addFactionMember,
    createSimulation,
    addSimulationCharacter,
    commitEvent,
    getFactionMembership,
    getCharacterFactionMemberships,
    listSimulationFactionMemberships,
    getCharacterValues,
    getCharacterNeeds,
    EVENT_TYPES,
    getDb,
} from '../../src/living-world/index.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('LWS Phase 8 Runtime Factions & Non-Hive Mechanics', () => {
    let tempDir;
    let world;
    let location;
    let sim;
    let factionGuild;
    let charAlice;
    let charBob;
    let simCharAlice;
    let simCharBob;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-factions-test-'));
        const dbPath = path.join(tempDir, 'factions-test.db');
        await init({ dbPath });

        world = createWorld({ name: 'Faction World' });
        location = createLocation(world.lws_id, { name: 'Town Square' });
        factionGuild = createFaction(world.lws_id, { name: 'Mages Guild', description: 'Arcane scholars' });

        charAlice = createCharacter(world.lws_id, { name: 'Alice' });
        charBob = createCharacter(world.lws_id, { name: 'Bob' });

        // Add authored memberships
        addFactionMember(world.lws_id, factionGuild.lws_id, { character_lws_id: charAlice.lws_id, role: 'archmage' });
        addFactionMember(world.lws_id, factionGuild.lws_id, { character_lws_id: charBob.lws_id, role: 'apprentice' });

        sim = createSimulation(world.lws_id, {
            name: 'Faction Sim',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });

        // Add characters to simulation
        simCharAlice = addSimulationCharacter(sim.lws_id, { character_id: charAlice.lws_id, initial_location_id: location.lws_id });
        simCharBob = addSimulationCharacter(sim.lws_id, { character_id: charBob.lws_id, initial_location_id: location.lws_id });
    });

    afterEach(async () => {
        await onExit();
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    test('initializes runtime faction memberships on CHARACTER_JOIN from authored relations', () => {
        const db = getDb();

        const aliceMemberships = getCharacterFactionMemberships(db, sim.lws_id, simCharAlice.lws_id);
        expect(aliceMemberships).toHaveLength(1);
        expect(aliceMemberships[0].faction_name).toBe('Mages Guild');
        expect(aliceMemberships[0].rank_role).toBe('archmage');
        expect(aliceMemberships[0].standing).toBe(0);
        expect(aliceMemberships[0].loyalty_score).toBe(50);
        expect(aliceMemberships[0].membership_status).toBe('active');

        const bobMemberships = getCharacterFactionMemberships(db, sim.lws_id, simCharBob.lws_id);
        expect(bobMemberships).toHaveLength(1);
        expect(bobMemberships[0].rank_role).toBe('apprentice');
    });

    test('enforces non-hive mind independence: members maintain distinct values and needs', () => {
        const db = getDb();

        // Mutate Alice's values and needs via event
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            actor_character_id: simCharAlice.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                target: 'character_value',
                dimension: 'honesty',
                strength: 90,
            },
            provenance: 'director',
        }, { isAdmin: true });

        const aliceValues = getCharacterValues(db, simCharAlice.lws_id);
        const bobValues = getCharacterValues(db, simCharBob.lws_id);

        const aliceHonesty = aliceValues.find(v => v.dimension === 'honesty');
        const bobHonesty = bobValues.find(v => v.dimension === 'honesty');

        expect(aliceHonesty.strength).toBe(90);
        expect(bobHonesty.strength).toBe(0); // Bob unaffected by Alice's value shift
    });

    test('updates faction standing, loyalty, role, and status via event transitions', () => {
        const db = getDb();

        // Commit director modification to promote Bob and increase loyalty
        commitEvent(sim.lws_id, {
            event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
            actor_character_id: simCharBob.lws_id,
            fictional_time: '2026-06-01T12:00:00Z',
            payload: {
                target: 'faction_membership',
                faction_id: factionGuild.lws_id,
                rank_role: 'journeyman',
                standing: 45,
                loyalty_score: 80,
                membership_status: 'active',
            },
            provenance: 'director',
        }, { isAdmin: true });

        const bobMemberships = getCharacterFactionMemberships(db, sim.lws_id, simCharBob.lws_id);
        expect(bobMemberships[0].rank_role).toBe('journeyman');
        expect(bobMemberships[0].standing).toBe(45);
        expect(bobMemberships[0].loyalty_score).toBe(80);
        expect(bobMemberships[0].membership_status).toBe('active');
    });

    test('lists simulation-wide faction memberships with query filtering', () => {
        const db = getDb();

        const allMemberships = listSimulationFactionMemberships(db, sim.lws_id);
        expect(allMemberships).toHaveLength(2);

        const filteredByRole = listSimulationFactionMemberships(db, sim.lws_id, {
            faction_id: factionGuild.lws_id,
        });
        expect(filteredByRole).toHaveLength(2);
    });
});
