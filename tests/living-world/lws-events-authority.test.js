import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    init,
    onExit,
    createWorld,
    createCharacter,
    createLocation,
    createSimulation,
    updateSimulation,
    addSimulationCharacter,
    commitEvent,
    LwsAuthorityError,
    LwsValidationError,
    EVENT_TYPES,
} from '../../src/living-world/index.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

describe('LWS Event Authority Engine and Provenance Enforcement', () => {
    let tempDir;
    let world;
    let sim;
    let charA;
    let charB;
    let loc1;
    let loc2;
    let simCharA;
    let simCharB;

    beforeEach(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-auth-test-'));
        const dbPath = path.join(tempDir, 'authority-test.db');
        await init({ dbPath });

        world = createWorld({ name: 'Authority World' });
        charA = createCharacter(world.lws_id, { name: 'Alice' });
        charB = createCharacter(world.lws_id, { name: 'Bob' });
        loc1 = createLocation(world.lws_id, { name: 'Plaza' });
        loc2 = createLocation(world.lws_id, { name: 'Tavern' });

        sim = createSimulation(world.lws_id, {
            name: 'Authority Simulation',
            initial_fictional_time: '2026-06-01T12:00:00Z',
        });

        simCharA = addSimulationCharacter(sim.lws_id, {
            character_id: charA.lws_id,
            initial_location_id: loc1.lws_id,
        });

        simCharB = addSimulationCharacter(sim.lws_id, {
            character_id: charB.lws_id,
            initial_location_id: loc2.lws_id, // Different location
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

    describe('Provenance Security & Caller Authorization', () => {
        test('rejects client asserting "system" provenance with FORBIDDEN_PROVENANCE', () => {
            let caughtErr;
            try {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.REST,
                    actor_character_id: simCharA.lws_id,
                    provenance: 'system',
                });
            } catch (err) {
                caughtErr = err;
            }
            expect(caughtErr).toBeInstanceOf(LwsAuthorityError);
            expect(caughtErr?.code).toBe('FORBIDDEN_PROVENANCE');
        });

        test('rejects client asserting "simulation_engine" provenance with FORBIDDEN_PROVENANCE', () => {
            let caughtErr;
            try {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.REST,
                    actor_character_id: simCharA.lws_id,
                    provenance: 'simulation_engine',
                });
            } catch (err) {
                caughtErr = err;
            }
            expect(caughtErr).toBeInstanceOf(LwsAuthorityError);
            expect(caughtErr?.code).toBe('FORBIDDEN_PROVENANCE');
        });

        test('rejects non-admin caller asserting "director" provenance with DIRECTOR_UNAUTHORIZED', () => {
            let caughtErr;
            try {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.DIRECTOR_NOTE,
                    payload: { note: 'Secret Note' },
                    provenance: 'director',
                }, { isAdmin: false });
            } catch (err) {
                caughtErr = err;
            }
            expect(caughtErr).toBeInstanceOf(LwsAuthorityError);
            expect(caughtErr?.code).toBe('DIRECTOR_UNAUTHORIZED');
        });

        test('accepts "director" provenance when caller is authenticated admin (isAdmin: true)', () => {
            const event = commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.DIRECTOR_NOTE,
                payload: { note: 'Admin verified' },
                provenance: 'director',
            }, { isAdmin: true });

            expect(event).toBeDefined();
            expect(event.event_type).toBe(EVENT_TYPES.DIRECTOR_NOTE);
            expect(event.provenance).toBe('director');
        });

        test('rejects director-only event types if caller lacks director provenance', () => {
            let caughtErr;
            try {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.DIRECTOR_MODIFY_STATE,
                    actor_character_id: simCharA.lws_id,
                    payload: { activity: 'acting' },
                    provenance: 'user', // Non-director trying to use director-only event
                });
            } catch (err) {
                caughtErr = err;
            }
            expect(caughtErr).toBeInstanceOf(LwsAuthorityError);
            expect(caughtErr?.code).toBe('DIRECTOR_REQUIRED');
        });
    });

    describe('Taxonomy Validation (Stage 1)', () => {
        test('rejects completely unknown event types with LwsValidationError (HTTP 400)', () => {
            let caughtErr;
            try {
                commitEvent(sim.lws_id, {
                    event_type: 'SUMMON_DRAGON',
                    actor_character_id: simCharA.lws_id,
                    provenance: 'user',
                });
            } catch (err) {
                caughtErr = err;
            }
            expect(caughtErr).toBeInstanceOf(LwsValidationError);
            expect(caughtErr?.message).toContain('Unknown event_type');
        });

        test('rejects Phase 5 dedicated event types on generic commitEvent with DEDICATED_ROUTE_REQUIRED', () => {
            const dedicatedTypes = [
                'TRIGGER_SCHEDULED_EVENT',
                'SCHEDULE_WORLD_EVENT',
                'CANCEL_SCHEDULED_EVENT',
                'SUPERSEDE_SCHEDULED_EVENT',
                'UPDATE_CHARACTER_ROUTINE',
                'TIME_ADVANCE',
            ];

            for (const dType of dedicatedTypes) {
                let caughtErr;
                try {
                    commitEvent(sim.lws_id, {
                        event_type: dType,
                        provenance: 'user',
                    });
                } catch (err) {
                    caughtErr = err;
                }
                expect(caughtErr).toBeInstanceOf(LwsAuthorityError);
                expect(caughtErr?.code).toBe('DEDICATED_ROUTE_REQUIRED');
            }
        });
    });

    describe('Simulation Lifecycle Authority (Stage 3)', () => {
        test('rejects regular events when simulation is paused with SIMULATION_IS_PAUSED', () => {
            updateSimulation(sim.lws_id, { status: 'paused' });

            let caughtErr;
            try {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.REST,
                    actor_character_id: simCharA.lws_id,
                    provenance: 'user',
                });
            } catch (err) {
                caughtErr = err;
            }
            expect(caughtErr).toBeInstanceOf(LwsAuthorityError);
            expect(caughtErr?.code).toBe('SIMULATION_IS_PAUSED');
        });

        test('allows SIMULATION_RESUME when simulation is paused', () => {
            updateSimulation(sim.lws_id, { status: 'paused' });

            const event = commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.SIMULATION_RESUME,
                provenance: 'user',
            });
            expect(event.event_type).toBe(EVENT_TYPES.SIMULATION_RESUME);
        });

        test('rejects events when simulation is archived with SIMULATION_IS_ARCHIVED', () => {
            updateSimulation(sim.lws_id, { status: 'archived' });

            let caughtErr;
            try {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.REST,
                    actor_character_id: simCharA.lws_id,
                    provenance: 'user',
                });
            } catch (err) {
                caughtErr = err;
            }
            expect(caughtErr).toBeInstanceOf(LwsAuthorityError);
            expect(caughtErr?.code).toBe('SIMULATION_IS_ARCHIVED');
        });

        test('permits terminal SIMULATION_STOP { action: "delete" } on archived simulation', () => {
            updateSimulation(sim.lws_id, { status: 'archived' });

            const deleteEvent = commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.SIMULATION_STOP,
                payload: { action: 'delete' },
                provenance: 'user',
            }, { isInternalSystem: true });

            expect(deleteEvent).toBeDefined();
            expect(deleteEvent.event_type).toBe(EVENT_TYPES.SIMULATION_STOP);
        });
    });

    describe('Clock Lock and Spatial Authority (Stage 3)', () => {
        test('rejects fictional_time that deviates from simulation clock with FICTIONAL_TIME_MISMATCH', () => {
            let caughtErr;
            try {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.REST,
                    actor_character_id: simCharA.lws_id,
                    fictional_time: '2026-06-01T12:00:01Z', // Off by 1 second
                    provenance: 'user',
                });
            } catch (err) {
                caughtErr = err;
            }
            expect(caughtErr).toBeInstanceOf(LwsAuthorityError);
            expect(caughtErr?.code).toBe('FICTIONAL_TIME_MISMATCH');
        });

        test('rejects INTERACT_OBJECT when actor is not at the object location with SPATIAL_DISCONNECT', () => {
            // simCharA is at loc1 (Plaza). Trying to interact with object at loc2 (Tavern)
            let caughtErr;
            try {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.INTERACT_OBJECT,
                    actor_character_id: simCharA.lws_id,
                    location_id: loc2.lws_id,
                    payload: { object_name: 'Barstool', action: 'sit' },
                    provenance: 'user',
                });
            } catch (err) {
                caughtErr = err;
            }
            expect(caughtErr).toBeInstanceOf(LwsAuthorityError);
            expect(caughtErr?.code).toBe('SPATIAL_DISCONNECT');
        });

        test('accepts INTERACT_OBJECT when actor is at the location', () => {
            const event = commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.INTERACT_OBJECT,
                actor_character_id: simCharA.lws_id,
                location_id: loc1.lws_id,
                payload: { object_name: 'Fountain', action: 'drink' },
                provenance: 'user',
            });
            expect(event).toBeDefined();
            expect(event.event_type).toBe(EVENT_TYPES.INTERACT_OBJECT);
        });

        test('rejects direct COMMUNICATE when actor and target are not collocated with SPATIAL_DISCONNECT', () => {
            // simCharA is at loc1, simCharB is at loc2
            let caughtErr;
            try {
                commitEvent(sim.lws_id, {
                    event_type: EVENT_TYPES.COMMUNICATE,
                    actor_character_id: simCharA.lws_id,
                    target_character_id: simCharB.lws_id,
                    location_id: loc1.lws_id,
                    payload: { message: 'Can you hear me?', channel: 'direct' },
                    provenance: 'user',
                });
            } catch (err) {
                caughtErr = err;
            }
            expect(caughtErr).toBeInstanceOf(LwsAuthorityError);
            expect(caughtErr?.code).toBe('SPATIAL_DISCONNECT');
        });

        test('accepts remote COMMUNICATE when actor and target are in different locations', () => {
            const event = commitEvent(sim.lws_id, {
                event_type: EVENT_TYPES.COMMUNICATE,
                actor_character_id: simCharA.lws_id,
                target_character_id: simCharB.lws_id,
                location_id: loc1.lws_id,
                payload: { message: 'Calling over radio', channel: 'remote' },
                provenance: 'user',
            });
            expect(event).toBeDefined();
            expect(event.event_type).toBe(EVENT_TYPES.COMMUNICATE);
        });
    });
});
