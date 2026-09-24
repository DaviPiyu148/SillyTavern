import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { openDb, closeDb } from '../../src/living-world/db.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';
import {
    validateRoutineBlock,
    matchesRoutineTime,
    getRoutineAtTime,
    arbitrateCharacterActivity,
    isSeverePhysicalCondition,
} from '../../src/living-world/time/routines.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';

describe('LWS Phase 5 Routines and Six-Tier Arbitration', () => {
    describe('Domain Logic and Validation', () => {
        test('validates valid routine block', () => {
            const valid = {
                block_id: 'morning_forge',
                day_of_week: 'monday',
                start_time: '08:00:00',
                end_time: '12:00:00',
                activity: 'smithing',
                priority: 80,
                flexibility: 'strict',
                enabled: 1,
            };
            const result = validateRoutineBlock(valid);
            expect(result.block_id).toBe('morning_forge');
            expect(result.priority).toBe(80);
            expect(result.flexibility).toBe('strict');
        });

        test('rejects invalid block_id', () => {
            expect(() => validateRoutineBlock({ block_id: '' })).toThrow(/block_id/);
            expect(() => validateRoutineBlock({ block_id: 'invalid space' })).toThrow(/block_id/);
        });

        test('rejects invalid day_of_week', () => {
            expect(() => validateRoutineBlock({
                block_id: 'test',
                day_of_week: 'someday',
                start_time: '08:00:00',
                end_time: '12:00:00',
                activity: 'resting',
            })).toThrow(/day_of_week/);
        });

        test('rejects invalid time syntax and out-of-range hours', () => {
            expect(() => validateRoutineBlock({
                block_id: 'test',
                day_of_week: 'daily',
                start_time: '24:00:00',
                end_time: '12:00:00',
                activity: 'resting',
            })).toThrow(/start_time/);

            expect(() => validateRoutineBlock({
                block_id: 'test',
                day_of_week: 'daily',
                start_time: '08:00:00',
                end_time: '25:00:00',
                activity: 'resting',
            })).toThrow(/end_time/);
        });

        test('rejects empty interval where start_time == end_time', () => {
            expect(() => validateRoutineBlock({
                block_id: 'test',
                day_of_week: 'daily',
                start_time: '09:00:00',
                end_time: '09:00:00',
                activity: 'resting',
            })).toThrow(/empty interval/);
        });

        test('overnight routine matches start day and next day before end_time', () => {
            const overnight = {
                block_id: 'night_shift',
                day_of_week: 'monday',
                start_time: '22:00:00',
                end_time: '06:00:00',
                activity: 'guarding',
                enabled: 1,
            };

            // Monday before start: 2026-06-01 is Monday
            expect(matchesRoutineTime(overnight, '2026-06-01T21:59:59Z')).toBe(false);
            // Monday at start
            expect(matchesRoutineTime(overnight, '2026-06-01T22:00:00Z')).toBe(true);
            // Monday late night
            expect(matchesRoutineTime(overnight, '2026-06-01T23:59:59Z')).toBe(true);
            // Tuesday early morning: 2026-06-02 is Tuesday
            expect(matchesRoutineTime(overnight, '2026-06-02T03:00:00Z')).toBe(true);
            expect(matchesRoutineTime(overnight, '2026-06-02T05:59:59Z')).toBe(true);
            // Tuesday after end_time
            expect(matchesRoutineTime(overnight, '2026-06-02T06:00:00Z')).toBe(false);
            // Wednesday morning
            expect(matchesRoutineTime(overnight, '2026-06-03T03:00:00Z')).toBe(false);
        });

        test('tie-breaking resolves by priority, then day specificity, then block_id', () => {
            // Monday timestamp: 2026-06-01T10:00:00Z
            const routines = [
                {
                    block_id: 'b_daily',
                    day_of_week: 'daily',
                    start_time: '08:00:00',
                    end_time: '12:00:00',
                    priority: 50,
                    activity: 'generic_work',
                    enabled: 1,
                },
                {
                    block_id: 'a_monday',
                    day_of_week: 'monday',
                    start_time: '08:00:00',
                    end_time: '12:00:00',
                    priority: 50,
                    activity: 'monday_work',
                    enabled: 1,
                },
                {
                    block_id: 'c_high_priority',
                    day_of_week: 'weekday',
                    start_time: '08:00:00',
                    end_time: '12:00:00',
                    priority: 80,
                    activity: 'important_task',
                    enabled: 1,
                },
            ];

            // 1. High priority (80) wins over 50
            const winner1 = getRoutineAtTime(routines, '2026-06-01T10:00:00Z');
            expect(winner1.block_id).toBe('c_high_priority');

            // 2. Day specificity: 'monday' (rank 3) beats 'daily' (rank 1) at equal priority (50)
            const routinesEqualPriority = routines.filter(r => r.priority === 50);
            const winner2 = getRoutineAtTime(routinesEqualPriority, '2026-06-01T10:00:00Z');
            expect(winner2.block_id).toBe('a_monday');

            // 3. Lexicographical block_id tie-breaking
            const routinesIdentical = [
                { block_id: 'zeta', day_of_week: 'monday', start_time: '08:00:00', end_time: '12:00:00', priority: 50, enabled: 1 },
                { block_id: 'alpha', day_of_week: 'monday', start_time: '08:00:00', end_time: '12:00:00', priority: 50, enabled: 1 },
            ];
            const winner3 = getRoutineAtTime(routinesIdentical, '2026-06-01T10:00:00Z');
            expect(winner3.block_id).toBe('alpha');
        });

        test('detects severe physical conditions', () => {
            expect(isSeverePhysicalCondition({ physical_condition: 'unconscious' })).toBe(true);
            expect(isSeverePhysicalCondition({ physical_condition: 'comatose' })).toBe(true);
            expect(isSeverePhysicalCondition({ physical_condition: 'critically_injured' })).toBe(true);
            expect(isSeverePhysicalCondition({ physical_condition: 'incapacitated' })).toBe(true);
            expect(isSeverePhysicalCondition({ physical_condition: 'paralyzed' })).toBe(true);
            expect(isSeverePhysicalCondition({ physical_condition: 'dying' })).toBe(true);
            expect(isSeverePhysicalCondition({ physical_condition: 'dead' })).toBe(true);
            expect(isSeverePhysicalCondition({ physical_condition: 'normal' })).toBe(false);
            expect(isSeverePhysicalCondition({ physical_condition: 'fatigued' })).toBe(false);
            expect(isSeverePhysicalCondition({ runtime_state: { condition: { severity: 'severe' } } })).toBe(true);
        });

        test('arbitrates activities according to the six-tier hierarchy', () => {
            const routines = [{
                block_id: 'work',
                day_of_week: 'daily',
                start_time: '08:00:00',
                end_time: '17:00:00',
                activity: 'working',
                enabled: 1,
            }];
            const time = '2026-06-01T10:00:00Z';

            // Tier 1: DIRECTOR_OVERRIDE wins over everything
            const overrideChar = {
                activity: 'idle',
                physical_condition: 'unconscious',
                runtime_state: { director_override: { active: true, activity: 'frozen' } },
            };
            expect(arbitrateCharacterActivity(overrideChar, routines, time).tier).toBe('DIRECTOR_OVERRIDE');

            // Tier 2: INTERRUPTED wins over travel and routine
            const injuredChar = {
                activity: 'working',
                physical_condition: 'critically_injured',
                runtime_state: { travel: { status: 'in_transit' } },
            };
            expect(arbitrateCharacterActivity(injuredChar, routines, time).tier).toBe('INTERRUPTED');

            // Tier 4: TRAVEL wins over routine
            const travelChar = {
                activity: 'travelling',
                physical_condition: 'normal',
                runtime_state: { travel: { status: 'in_transit' } },
            };
            expect(arbitrateCharacterActivity(travelChar, routines, time).tier).toBe('TRAVEL');

            // Tier 5: ROUTINE
            const normalChar = {
                activity: 'idle',
                physical_condition: 'normal',
                runtime_state: {},
            };
            expect(arbitrateCharacterActivity(normalChar, routines, time).tier).toBe('ROUTINE');

            // Tier 6: IDLE when no routine matches
            const nightTime = '2026-06-01T23:00:00Z';
            expect(arbitrateCharacterActivity(normalChar, routines, nightTime).tier).toBe('IDLE');
        });
    });

    describe('REST API and Resurrection Lifecycle', () => {
        let app;
        let server;
        let baseUrl;
        let world;
        let loc;
        let char;
        let sim;
        let simChar;
        let tempDir;

        beforeEach(async () => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-routines-test-'));
            const dbPath = path.join(tempDir, 'test.db');
            openDb(dbPath);

            app = express();
            app.use(express.json());
            app.use('/api/living-world', lwsRouter);

            await new Promise((resolve) => {
                server = app.listen(0, '127.0.0.1', () => {
                    const port = server.address().port;
                    baseUrl = `http://127.0.0.1:${port}`;
                    resolve();
                });
            });

            world = createWorld({ name: 'Routines World' });
            loc = createLocation(world.lws_id, { name: 'Forge' });
            char = createCharacter(world.lws_id, { name: 'Blacksmith' });
            sim = createSimulation(world.lws_id, {
                name: 'Sim Routines',
                initial_fictional_time: '2026-06-01T08:00:00Z',
            });
            simChar = addSimulationCharacter(sim.lws_id, {
                character_id: char.lws_id,
                current_location_id: loc.lws_id,
            });
        });

        afterEach(async () => {
            if (server) {
                await new Promise((resolve) => server.close(resolve));
            }
            closeDb();
            if (tempDir) {
                try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_err) { /* ignore cleanup error */ }
            }
        });

        test('PUT and GET /simulations/:simLwsId/characters/:charLwsId/routines with resurrection', async () => {
            const routinesPayload = [
                {
                    block_id: 'morning_smithing',
                    day_of_week: 'daily',
                    start_time: '09:00:00',
                    end_time: '13:00:00',
                    activity: 'smithing',
                    target_location_id: loc.lws_id,
                    priority: 60,
                    flexibility: 'strict',
                },
                {
                    block_id: 'evening_rest',
                    day_of_week: 'daily',
                    start_time: '18:00:00',
                    end_time: '22:00:00',
                    activity: 'resting',
                    priority: 40,
                },
            ];

            // 1. Initial PUT
            const putRes1 = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simChar.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ routines: routinesPayload }),
            });
            expect(putRes1.status).toBe(200);

            // 2. GET routines
            const getRes1 = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simChar.lws_id}/routines`);
            expect(getRes1.status).toBe(200);
            const getBody1 = await getRes1.json();
            expect(getBody1.routines).toHaveLength(2);
            const initialMorningId = getBody1.routines.find(r => r.block_id === 'morning_smithing').lws_id;
            expect(initialMorningId).toBeDefined();

            // 3. Remove morning routine (soft delete)
            const putRes2 = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simChar.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ routines: [routinesPayload[1]] }),
            });
            expect(putRes2.status).toBe(200);

            const getRes2 = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simChar.lws_id}/routines`);
            const getBody2 = await getRes2.json();
            expect(getBody2.routines).toHaveLength(1);
            expect(getBody2.routines[0].block_id).toBe('evening_rest');

            // 4. Re-add morning routine -> RESURRECTION must preserve original lws_id!
            const putRes3 = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simChar.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ routines: routinesPayload }),
            });
            expect(putRes3.status).toBe(200);

            const getRes3 = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simChar.lws_id}/routines`);
            const getBody3 = await getRes3.json();
            expect(getBody3.routines).toHaveLength(2);
            const resurrectedMorning = getBody3.routines.find(r => r.block_id === 'morning_smithing');
            expect(resurrectedMorning.lws_id).toBe(initialMorningId);
        });
    });
});
