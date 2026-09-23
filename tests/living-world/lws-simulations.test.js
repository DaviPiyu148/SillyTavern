import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    getDb,
    createWorld,
    createCharacter,
    createLocation,
    deleteLocation,
    deleteCharacter,
    createScenario,
    addScenarioCharacter,
    createSimulation,
    getSimulationByLwsId,
    listSimulations,
    updateSimulation,
    deleteSimulation,
    addSimulationCharacter,
    getSimulationCharacterByLwsId,
    listSimulationCharacters,
    LwsValidationError,
    LwsNotFoundError,
    LwsConflictError,
} from '../../src/living-world/index.js';

describe('LWS Simulation Service: Lifecycle, Calendar Validation, and Instantiation', () => {
    let world;

    beforeEach(() => {
        openDb(':memory:');
        world = createWorld({ name: 'Springfield' });
    });

    afterEach(() => {
        closeDb();
    });

    describe('Semantic Fictional Timestamp Validation', () => {
        test('rejects missing or empty initial_fictional_time', () => {
            expect(() => {
                createSimulation(world.lws_id, { name: 'Sim 1' });
            }).toThrow(LwsValidationError);

            expect(() => {
                createSimulation(world.lws_id, { name: 'Sim 1', initial_fictional_time: '' });
            }).toThrow(LwsValidationError);
        });

        test('rejects lexical format errors', () => {
            const badLexical = [
                '2026-01-01',
                '2026/01/01 12:00:00',
                '2026-01-01T12:00:00',
                '2026-01-01T12:00:00.000Z',
                'tomorrow',
            ];

            for (const time of badLexical) {
                expect(() => {
                    createSimulation(world.lws_id, { name: `Sim ${time}`, initial_fictional_time: time });
                }).toThrow(LwsValidationError);
            }
        });

        test('rejects calendar semantic errors (invalid days, non-leap years, clock bounds)', () => {
            const badSemantics = [
                '2026-02-29T12:00:00Z', // 2026 is not a leap year
                '2026-04-31T00:00:00Z', // April only has 30 days
                '2026-06-31T00:00:00Z', // June only has 30 days
                '2026-11-31T00:00:00Z', // November only has 30 days
                '2026-13-01T00:00:00Z', // Invalid month 13
                '2026-00-10T00:00:00Z', // Invalid month 0
                '2026-01-32T00:00:00Z', // Invalid day 32
                '2026-01-01T24:00:00Z', // Hour 24 out of range
                '2026-01-01T12:60:00Z', // Minute 60 out of range
                '2026-01-01T12:00:60Z', // Second 60 out of range
            ];

            for (const time of badSemantics) {
                expect(() => {
                    createSimulation(world.lws_id, { name: `Sim ${time}`, initial_fictional_time: time });
                }).toThrow(LwsValidationError);
            }
        });

        test('accepts semantically valid timestamps including leap years', () => {
            const simLeap = createSimulation(world.lws_id, {
                name: 'Leap Year Sim',
                initial_fictional_time: '2024-02-29T23:59:59Z', // 2024 is a leap year
            });
            expect(simLeap.current_fictional_time).toBe('2024-02-29T23:59:59Z');

            const simNormal = createSimulation(world.lws_id, {
                name: 'Normal Sim',
                initial_fictional_time: '2026-02-28T08:30:00Z',
            });
            expect(simNormal.current_fictional_time).toBe('2026-02-28T08:30:00Z');
        });
    });

    describe('Scenario Instantiation', () => {
        test('atomically instantiates scenario roster characters with starting location and frozen snapshots', () => {
            const char1 = createCharacter(world.lws_id, {
                name: 'Dave',
                description: 'Family father',
                personality: 'Caring and cautious',
            });
            const char2 = createCharacter(world.lws_id, {
                name: 'Charlotte',
                description: 'Family mother',
                personality: 'Adventurous',
            });
            const loc = createLocation(world.lws_id, { name: 'Home Living Room' });

            const scenario = createScenario(world.lws_id, {
                name: 'Sunday Morning',
                starting_location_lws_id: loc.lws_id,
            });

            addScenarioCharacter(world.lws_id, scenario.lws_id, { character_lws_id: char1.lws_id, role: 'Father' });
            addScenarioCharacter(world.lws_id, scenario.lws_id, { character_lws_id: char2.lws_id, role: 'Mother' });

            const sim = createSimulation(world.lws_id, {
                name: 'Family Timeline 1',
                initial_fictional_time: '2026-06-01T09:00:00Z',
                scenario_id: scenario.lws_id,
            });

            expect(sim.scenario_id).toBe(scenario.lws_id);
            expect(sim.status).toBe('active');

            const simChars = listSimulationCharacters(sim.lws_id);
            expect(simChars).toHaveLength(2);

            const daveSim = simChars.find(c => c.character_id === char1.lws_id);
            expect(daveSim).toBeDefined();
            expect(daveSim.current_location_id).toBe(loc.lws_id);
            expect(daveSim.activity).toBe('idle');
            expect(daveSim.physical_condition).toBe('normal');
            expect(daveSim.runtime_state).toEqual({ role: 'Father', condition: 'normal' });
            expect(daveSim.authored_snapshot.name).toBe('Dave');
            expect(daveSim.authored_snapshot.personality).toBe('Caring and cautious');
        });

        test('excludes soft-deleted characters from scenario instantiation roster', () => {
            const char1 = createCharacter(world.lws_id, { name: 'Active Hero' });
            const char2 = createCharacter(world.lws_id, { name: 'Deleted Hero' });
            const scenario = createScenario(world.lws_id, { name: 'Hero Quest' });

            addScenarioCharacter(world.lws_id, scenario.lws_id, { character_lws_id: char1.lws_id });
            addScenarioCharacter(world.lws_id, scenario.lws_id, { character_lws_id: char2.lws_id });

            // Soft-delete char2
            deleteCharacter(world.lws_id, char2.lws_id);

            const sim = createSimulation(world.lws_id, {
                name: 'Filtered Roster Sim',
                initial_fictional_time: '2026-06-01T09:00:00Z',
                scenario_id: scenario.lws_id,
            });

            const simChars = listSimulationCharacters(sim.lws_id);
            expect(simChars).toHaveLength(1);
            expect(simChars[0].character_id).toBe(char1.lws_id);
        });

        test('rejects scenario instantiation if starting location is soft-deleted', () => {
            const loc = createLocation(world.lws_id, { name: 'Ancient Temple' });
            const scenario = createScenario(world.lws_id, {
                name: 'Temple Expedition',
                starting_location_lws_id: loc.lws_id,
            });

            // Soft-delete location
            deleteLocation(world.lws_id, loc.lws_id);

            expect(() => {
                createSimulation(world.lws_id, {
                    name: 'Expedition Sim',
                    initial_fictional_time: '2026-06-01T09:00:00Z',
                    scenario_id: scenario.lws_id,
                });
            }).toThrow(/Scenario starting location is soft-deleted/);
        });

        test('enforces active simulation name uniqueness within a world', () => {
            createSimulation(world.lws_id, {
                name: 'Unique Sim',
                initial_fictional_time: '2026-06-01T09:00:00Z',
            });

            expect(() => {
                createSimulation(world.lws_id, {
                    name: 'unique sim', // case-insensitive
                    initial_fictional_time: '2026-06-01T09:00:00Z',
                });
            }).toThrow(LwsConflictError);
        });
    });

    describe('Status Transition Matrix', () => {
        test('allows active ⇄ paused and active/paused → archived', () => {
            const sim = createSimulation(world.lws_id, {
                name: 'Transition Sim',
                initial_fictional_time: '2026-06-01T09:00:00Z',
            });
            expect(sim.status).toBe('active');

            // active -> paused
            const paused = updateSimulation(sim.lws_id, { status: 'paused' });
            expect(paused.status).toBe('paused');

            // paused -> active
            const resumed = updateSimulation(sim.lws_id, { status: 'active' });
            expect(resumed.status).toBe('active');

            // active -> archived
            const archived = updateSimulation(sim.lws_id, { status: 'archived' });
            expect(archived.status).toBe('archived');
        });

        test('rejects transitions out of archived status (terminal)', () => {
            const sim = createSimulation(world.lws_id, {
                name: 'Archived Sim',
                initial_fictional_time: '2026-06-01T09:00:00Z',
            });

            updateSimulation(sim.lws_id, { status: 'archived' });

            expect(() => {
                updateSimulation(sim.lws_id, { status: 'active' });
            }).toThrow(/Cannot transition simulation from archived status/);

            expect(() => {
                updateSimulation(sim.lws_id, { status: 'paused' });
            }).toThrow(/Cannot transition simulation from archived status/);
        });

        test('rejects unknown status values', () => {
            const sim = createSimulation(world.lws_id, {
                name: 'Bad Status Sim',
                initial_fictional_time: '2026-06-01T09:00:00Z',
            });

            expect(() => {
                updateSimulation(sim.lws_id, { status: 'running' });
            }).toThrow(LwsValidationError);
        });

        test('rejects modifying immutable or non-patchable fields (world_id, scenario_id, current_fictional_time)', () => {
            const sim = createSimulation(world.lws_id, {
                name: 'Immutable Fields Sim',
                initial_fictional_time: '2026-06-01T09:00:00Z',
            });

            expect(() => {
                updateSimulation(sim.lws_id, { world_id: 'some-other-uuid' });
            }).toThrow(/world_id is immutable/);

            expect(() => {
                updateSimulation(sim.lws_id, { scenario_id: 'some-scenario-uuid' });
            }).toThrow(/scenario_id is immutable/);

            expect(() => {
                updateSimulation(sim.lws_id, { current_fictional_time: '2026-07-01T12:00:00Z' });
            }).toThrow(/current_fictional_time cannot be modified via PATCH/);
        });
    });

    describe('Simulation Soft-Deletion', () => {
        test('permits soft-deletion from active status', () => {
            const sim = createSimulation(world.lws_id, {
                name: 'Active To Delete',
                initial_fictional_time: '2026-06-01T09:00:00Z',
            });

            const deleted = deleteSimulation(sim.lws_id);
            expect(deleted).toBe(true);

            expect(() => getSimulationByLwsId(sim.lws_id)).toThrow(LwsNotFoundError);
        });

        test('permits soft-deletion from paused status', () => {
            const sim = createSimulation(world.lws_id, {
                name: 'Paused To Delete',
                initial_fictional_time: '2026-06-01T09:00:00Z',
            });
            updateSimulation(sim.lws_id, { status: 'paused' });

            const deleted = deleteSimulation(sim.lws_id);
            expect(deleted).toBe(true);
            expect(() => getSimulationByLwsId(sim.lws_id)).toThrow(LwsNotFoundError);
        });

        test('permits soft-deletion from archived status', () => {
            const sim = createSimulation(world.lws_id, {
                name: 'Archived To Delete',
                initial_fictional_time: '2026-06-01T09:00:00Z',
            });
            updateSimulation(sim.lws_id, { status: 'archived' });

            const deleted = deleteSimulation(sim.lws_id);
            expect(deleted).toBe(true);
            expect(() => getSimulationByLwsId(sim.lws_id)).toThrow(LwsNotFoundError);
        });

        test('returns 404 when attempting to re-delete an already soft-deleted simulation', () => {
            const sim = createSimulation(world.lws_id, {
                name: 'Double Delete Sim',
                initial_fictional_time: '2026-06-01T09:00:00Z',
            });
            deleteSimulation(sim.lws_id);

            expect(() => {
                deleteSimulation(sim.lws_id);
            }).toThrow(LwsNotFoundError);
        });

        test('returns 404 when attempting to update a soft-deleted simulation', () => {
            const sim = createSimulation(world.lws_id, {
                name: 'Update Deleted Sim',
                initial_fictional_time: '2026-06-01T09:00:00Z',
            });
            deleteSimulation(sim.lws_id);

            expect(() => {
                updateSimulation(sim.lws_id, { name: 'Renamed' });
            }).toThrow(LwsNotFoundError);
        });

        test('excludes soft-deleted simulations from listSimulations', () => {
            const sim1 = createSimulation(world.lws_id, { name: 'Active 1', initial_fictional_time: '2026-06-01T09:00:00Z' });
            const sim2 = createSimulation(world.lws_id, { name: 'To Delete', initial_fictional_time: '2026-06-01T09:00:00Z' });

            deleteSimulation(sim2.lws_id);

            const activeSims = listSimulations(world.lws_id);
            expect(activeSims).toHaveLength(1);
            expect(activeSims[0].lws_id).toBe(sim1.lws_id);
        });

        test('preserves physical rows of simulation characters when simulation is soft-deleted', () => {
            const char = createCharacter(world.lws_id, { name: 'Survivor' });
            const sim = createSimulation(world.lws_id, {
                name: 'Preservation Sim',
                initial_fictional_time: '2026-06-01T09:00:00Z',
            });
            const simChar = addSimulationCharacter(sim.lws_id, { character_id: char.lws_id });

            deleteSimulation(sim.lws_id);

            // Child routes throw 404 because simulation is soft-deleted
            expect(() => listSimulationCharacters(sim.lws_id)).toThrow(LwsNotFoundError);
            expect(() => getSimulationCharacterByLwsId(sim.lws_id, simChar.lws_id)).toThrow(LwsNotFoundError);

            // Directly query SQLite to prove underlying rows remain physically intact
            const db = getDb();
            const rawSimChar = db.prepare('SELECT * FROM lws_simulation_characters WHERE lws_id = ?').get(simChar.lws_id);
            expect(rawSimChar).toBeDefined();
            expect(rawSimChar.deleted_at).toBeNull(); // remains intact for audit/replay
        });
    });
});
