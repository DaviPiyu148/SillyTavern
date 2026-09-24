import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import express from 'express';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { openDb, closeDb, getDb } from '../../src/living-world/db.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';
import {
    calculateTreeDistance,
    computeTravelDuration,
    computePlannedDepartureTime,
    computeArrivalTime,
} from '../../src/living-world/time/travel.js';
import { advanceFictionalTime } from '../../src/living-world/time/time-advance.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { addSimulationCharacter } from '../../src/living-world/simulations/simulation-characters.js';
import { internalCommitEvent } from '../../src/living-world/events/events.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';
import { verifySimulationParity } from '../../src/living-world/events/replay.js';

describe('LWS Phase 5 Travel, Pathfinding, and Interruption', () => {
    describe('Tree Distance and Travel Duration Math', () => {
        test('calculates distance between same location as 0', () => {
            const locMap = new Map([[1, { id: 1, parent_location_id: null }]]);
            expect(calculateTreeDistance(locMap, 1, 1)).toBe(0);
            expect(computeTravelDuration(locMap, 1, 1)).toBe(0);
        });

        test('calculates sibling distance as 2 and duration as 300s', () => {
            const locMap = new Map([
                [1, { id: 1, parent_location_id: null }],
                [2, { id: 2, parent_location_id: 1 }],
                [3, { id: 3, parent_location_id: 1 }],
            ]);
            expect(calculateTreeDistance(locMap, 2, 3)).toBe(2);
            expect(computeTravelDuration(locMap, 2, 3)).toBe(300);
        });

        test('calculates parent-child distance as 1 and duration as 300s', () => {
            const locMap = new Map([
                [1, { id: 1, parent_location_id: null }],
                [2, { id: 2, parent_location_id: 1 }],
            ]);
            expect(calculateTreeDistance(locMap, 1, 2)).toBe(1);
            expect(computeTravelDuration(locMap, 1, 2)).toBe(300);
        });

        test('calculates cross-district distance as 4 and duration as 2400s', () => {
            const locMap = new Map([
                [1, { id: 1, parent_location_id: null }],
                [2, { id: 2, parent_location_id: 1 }],
                [3, { id: 3, parent_location_id: 2 }],
                [4, { id: 4, parent_location_id: 1 }],
                [5, { id: 5, parent_location_id: 4 }],
            ]);
            expect(calculateTreeDistance(locMap, 3, 5)).toBe(4);
            expect(computeTravelDuration(locMap, 3, 5)).toBe(2400); // 4 * 600
        });

        test('prefers location extension connections override over tree distance', () => {
            const locMap = new Map([
                [1, {
                    id: 1,
                    lws_id: 'loc-1',
                    parent_location_id: null,
                    extensions: {
                        connections: {
                            'loc-2': { duration_seconds: 1800 },
                        },
                    },
                }],
                [2, {
                    id: 2,
                    lws_id: 'loc-2',
                    parent_location_id: 1,
                }],
            ]);
            // Default tree distance would be 1 (300s), but connection override specifies 1800s
            expect(computeTravelDuration(locMap, 1, 2)).toBe(1800);
        });

        test('handles stringified json in location extensions', () => {
            const locMap = new Map([
                [1, {
                    id: 1,
                    lws_id: 'loc-1',
                    parent_location_id: null,
                    extensions: JSON.stringify({
                        routes: {
                            'loc-2': { travel_time_seconds: 450 },
                        },
                    }),
                }],
                [2, {
                    id: 2,
                    lws_id: 'loc-2',
                    parent_location_id: null,
                }],
            ]);
            expect(computeTravelDuration(locMap, 1, 2)).toBe(450);
        });

        test('computes planned departure time and arrival ETA accurately', () => {
            const start = '2026-06-01T09:30:00Z';
            const duration = 1800; // 30 minutes
            const departure = computePlannedDepartureTime(start, duration);
            expect(departure).toBe('2026-06-01T09:00:00Z');

            const arrival = computeArrivalTime(departure, duration);
            expect(arrival).toBe(start);

            // Zero duration returns same
            expect(computePlannedDepartureTime(start, 0)).toBe(start);
            expect(computeArrivalTime(departure, 0)).toBe(departure);
        });
    });

    describe('Temporal Travel Simulation Execution', () => {
        let app;
        let server;
        let baseUrl;
        let world;
        let tavern;
        let outpost;
        let charDave;
        let simDave;
        let sim;
        let tempDir;

        beforeEach(async () => {
            tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-travel-test-'));
            const dbPath = path.join(tempDir, 'test.db');
            openDb(dbPath);

            app = express();
            app.use(express.json());
            app.use('/api/living-world', lwsRouter);

            await new Promise((resolve) => {
                server = app.listen(0, '127.0.0.1', () => {
                    baseUrl = `http://127.0.0.1:${server.address().port}`;
                    resolve();
                });
            });

            world = createWorld({ name: 'Travel World' });

            outpost = createLocation(world.lws_id, {
                name: 'Outpost',
            });

            // Create Tavern with connection override to Outpost (1800s / 30m)
            tavern = createLocation(world.lws_id, {
                name: 'Tavern',
                extensions: {
                    connections: {
                        [outpost.lws_id]: { duration_seconds: 1800 },
                    },
                },
            });

            charDave = createCharacter(world.lws_id, { name: 'Dave' });

            sim = createSimulation(world.lws_id, {
                name: 'Sim Travel',
                initial_fictional_time: '2026-06-01T08:45:00Z', // Monday 08:45
            });

            // Add Dave to simulation starting at Tavern
            simDave = addSimulationCharacter(sim.lws_id, {
                character_id: charDave.lws_id,
                current_location_id: tavern.lws_id,
                activity: 'idle',
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

        test('Canonical Proof Scenario 4: Discovers planned departure at 09:00 and arrives at 09:30', async () => {
            const db = getDb();
            // Assign routine: Monday 09:30 to 12:00 at Outpost (activity: guarding)
            const putRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simDave.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: [{
                        block_id: 'outpost_guard',
                        day_of_week: 'monday',
                        start_time: '09:30:00',
                        end_time: '12:00:00',
                        activity: 'guarding',
                        target_location_id: outpost.lws_id,
                        priority: 80,
                    }],
                }),
            });
            expect(putRes.status).toBe(200);

            // Advance from 08:45:00Z to 10:00:00Z (75 minutes / 4500 seconds)
            const advRes = await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/time-advance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    target_fictional_time: '2026-06-01T10:00:00Z',
                }),
            });
            expect(advRes.status).toBe(200);
            const advData = await advRes.json();

            // Verify intermediate events:
            // 1. At 09:00:00Z -> Dave starts travel (UPDATE_RUNTIME_STATE in_transit, UPDATE_CHARACTER_ACTIVITY travelling)
            // 2. At 09:30:00Z -> Dave arrives (MOVE_CHARACTER to Outpost, UPDATE_RUNTIME_STATE travel: null, UPDATE_CHARACTER_ACTIVITY guarding)
            const events = advData.intermediate_events;
            expect(events.length).toBeGreaterThanOrEqual(4);

            const travelDepartures = events.filter(e => e.fictional_time === '2026-06-01T09:00:00Z');
            expect(travelDepartures.length).toBe(2);
            expect(travelDepartures.some(e => e.event_type === EVENT_TYPES.UPDATE_RUNTIME_STATE)).toBe(true);
            expect(travelDepartures.some(e => e.event_type === EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY)).toBe(true);

            const travelArrivals = events.filter(e => e.fictional_time === '2026-06-01T09:30:00Z');
            expect(travelArrivals.some(e => e.event_type === EVENT_TYPES.MOVE_CHARACTER)).toBe(true);
            expect(travelArrivals.some(e => e.event_type === EVENT_TYPES.UPDATE_CHARACTER_ACTIVITY)).toBe(true);

            // Verify final character state: at Outpost, activity = guarding
            const charRow = db.prepare(`
                SELECT sc.*, loc.lws_id AS loc_lws_id
                FROM lws_simulation_characters sc
                JOIN lws_locations loc ON sc.current_location_id = loc.id
                WHERE sc.lws_id = ?
            `).get(simDave.lws_id);

            expect(charRow.loc_lws_id).toBe(outpost.lws_id);
            expect(charRow.activity).toBe('guarding');
            const runtimeState = JSON.parse(charRow.runtime_state);
            expect(runtimeState.travel).toBeNull();

            // Verify pure replay parity is 100%
            const parity = verifySimulationParity(sim.lws_id);
            expect(parity.verified).toBe(true);
            expect(parity.drift_detected).toBe(false);
        });

        test('travel interruption suspends travel on severe physical condition', async () => {
            const db = getDb();
            // Start Dave in transit manually
            const callerContext = { isInternalEngine: true, isDedicatedRoute: true };
            const simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);

            // Dave sets out on travel departing at 08:45:00Z, ETA 09:15:00Z (1800s)
            internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                fictional_time: '2026-06-01T08:45:00Z',
                actor_character_id: simDave.lws_id,
                payload: {
                    patch: {
                        travel: {
                            origin_location_id: tavern.lws_id,
                            destination_location_id: outpost.lws_id,
                            departure_time: '2026-06-01T08:45:00Z',
                            eta_time: '2026-06-01T09:15:00Z',
                            travel_duration_seconds: 1800,
                            status: 'in_transit',
                            destination_routine_activity: 'guarding',
                        },
                    },
                },
            }, callerContext);

            // Suffer severe condition: unconscious
            internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.UPDATE_PHYSICAL_CONDITION,
                fictional_time: '2026-06-01T08:45:00Z',
                actor_character_id: simDave.lws_id,
                payload: {
                    physical_condition: 'unconscious',
                },
            }, callerContext);

            // Advance time to 09:00:00Z
            await advanceFictionalTime(db, {
                simLwsId: sim.lws_id,
                targetFictionalTime: '2026-06-01T09:00:00Z',
            });

            // Travel should now be suspended!
            const charRow = db.prepare(`
                SELECT sc.*, loc.lws_id AS loc_lws_id
                FROM lws_simulation_characters sc
                JOIN lws_locations loc ON sc.current_location_id = loc.id
                WHERE sc.lws_id = ?
            `).get(simDave.lws_id);

            expect(charRow.loc_lws_id).toBe(tavern.lws_id); // Still at Tavern
            expect(charRow.activity).toBe('unconscious');
            const state = JSON.parse(charRow.runtime_state);
            expect(state.travel.status).toBe('suspended');
            expect(state.travel.remaining_seconds).toBeGreaterThan(0);
        });

        test('travel recovery resumes travel when routine is still active', async () => {
            const db = getDb();
            const callerContext = { isInternalEngine: true, isDedicatedRoute: true };
            const simRow = db.prepare('SELECT * FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);

            // Set up routine at outpost for Monday 09:00 - 18:00
            await fetch(`${baseUrl}/api/living-world/simulations/${sim.lws_id}/characters/${simDave.lws_id}/routines`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routines: [{
                        block_id: 'all_day_guard',
                        day_of_week: 'monday',
                        start_time: '09:00:00',
                        end_time: '18:00:00',
                        activity: 'guarding',
                        target_location_id: outpost.lws_id,
                        priority: 50,
                    }],
                }),
            });

            // Dave has suspended travel with 600s (10m) remaining
            internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.UPDATE_RUNTIME_STATE,
                fictional_time: '2026-06-01T08:45:00Z',
                actor_character_id: simDave.lws_id,
                payload: {
                    patch: {
                        travel: {
                            origin_location_id: tavern.lws_id,
                            destination_location_id: outpost.lws_id,
                            departure_time: '2026-06-01T08:45:00Z',
                            eta_time: '2026-06-01T09:15:00Z',
                            travel_duration_seconds: 1800,
                            status: 'suspended',
                            suspended_at: '2026-06-01T08:50:00Z',
                            remaining_seconds: 600,
                            destination_routine_activity: 'guarding',
                        },
                    },
                },
            }, callerContext);

            // Clear physical condition to healthy
            internalCommitEvent(db, simRow, {
                event_type: EVENT_TYPES.UPDATE_PHYSICAL_CONDITION,
                fictional_time: '2026-06-01T08:45:00Z',
                actor_character_id: simDave.lws_id,
                payload: {
                    physical_condition: 'healthy',
                },
            }, callerContext);

            // Advance time to 09:10:00Z (Dave resumes at 08:45:00Z, ETA is 08:55:00Z, arrives before 09:10)
            await advanceFictionalTime(db, {
                simLwsId: sim.lws_id,
                targetFictionalTime: '2026-06-01T09:10:00Z',
            });

            const charRow = db.prepare(`
                SELECT sc.*, loc.lws_id AS loc_lws_id
                FROM lws_simulation_characters sc
                JOIN lws_locations loc ON sc.current_location_id = loc.id
                WHERE sc.lws_id = ?
            `).get(simDave.lws_id);

            expect(charRow.loc_lws_id).toBe(outpost.lws_id);
            expect(charRow.activity).toBe('guarding');
            const state = JSON.parse(charRow.runtime_state);
            expect(state.travel).toBeNull();
        });
    });
});
