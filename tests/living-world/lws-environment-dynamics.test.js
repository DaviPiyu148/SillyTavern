import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDb, closeDb, getDb } from '../../src/living-world/index.js';
import {
    calculateDiurnalTemperature,
    calculateDiurnalLighting,
} from '../../src/living-world/environment/common.js';
import {
    getLocationEnvironment,
    updateLocationEnvironment,
} from '../../src/living-world/environment/environment.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { advanceFictionalTime } from '../../src/living-world/time/time-advance.js';
import { commitEvent } from '../../src/living-world/events/events.js';
import { EVENT_TYPES } from '../../src/living-world/events/taxonomy.js';

describe('Phase 9 - Environment Dynamics & Diurnal Curves', () => {
    let db;

    beforeEach(() => {
        openDb(':memory:');
        db = getDb();
    });

    afterEach(() => {
        closeDb();
    });

    it('calculates sinusoidal diurnal temperature curve accurately', () => {
        const baseline = 20.0;
        // Peak at 14:00 (+5.0°C) -> 25.0°C
        const temp14 = calculateDiurnalTemperature('2026-06-15T14:00:00.000Z', baseline, false);
        expect(temp14).toBeCloseTo(25.0, 1);

        // Trough at 04:00 (-5.0°C) -> 15.0°C
        const temp04 = calculateDiurnalTemperature('2026-06-15T04:00:00.000Z', baseline, false);
        expect(temp04).toBeCloseTo(15.0, 1);

        // Transition at 09:00 -> baseline
        const temp09 = calculateDiurnalTemperature('2026-06-15T09:00:00.000Z', baseline, false);
        expect(temp09).toBeCloseTo(baseline, 1);
    });

    it('applies indoor buffering towards 21°C regression baseline', () => {
        const coldOutdoorBaseline = 0.0;
        const outdoorTemp04 = calculateDiurnalTemperature('2026-01-15T04:00:00.000Z', coldOutdoorBaseline, false);
        const indoorTemp04 = calculateDiurnalTemperature('2026-01-15T04:00:00.000Z', coldOutdoorBaseline, true);

        // Indoor temperature should be strongly buffered towards 21°C
        expect(indoorTemp04).toBeGreaterThan(outdoorTemp04);
        expect(indoorTemp04).toBeGreaterThan(15.0);
    });

    it('evaluates diurnal lighting levels according to solar hour', () => {
        // Solar midday (12:00) -> bright
        expect(calculateDiurnalLighting('2026-06-15T12:00:00.000Z', false, false, 'clear')).toBe('bright');

        // Dawn (06:30) -> dim
        expect(calculateDiurnalLighting('2026-06-15T06:30:00.000Z', false, false, 'clear')).toBe('dim');

        // Dusk (19:30) -> dim
        expect(calculateDiurnalLighting('2026-06-15T19:30:00.000Z', false, false, 'clear')).toBe('dim');

        // Deep night (01:00) -> pitch_black
        expect(calculateDiurnalLighting('2026-06-15T01:00:00.000Z', false, false, 'clear')).toBe('pitch_black');

        // Night with illuminated tag -> dim
        expect(calculateDiurnalLighting('2026-06-15T01:00:00.000Z', false, true, 'clear')).toBe('dim');

        // Midday with severe storm -> dim
        expect(calculateDiurnalLighting('2026-06-15T12:00:00.000Z', false, false, 'storm')).toBe('dim');
    });

    it('progresses environment dynamically on TIME_ADVANCE while preserving explicit overrides', async () => {
        const world = createWorld({ name: 'Env Dynamics World' });
        const loc1 = createLocation(world.lws_id, { name: 'Loc1' });
        const loc2 = createLocation(world.lws_id, { name: 'Loc2' });
        const sim = createSimulation(world.lws_id, {
            name: 'Env Dynamics Sim',
            initial_fictional_time: '2026-06-15T08:00:00Z',
        });

        const simRow = db.prepare('SELECT id FROM lws_simulations WHERE lws_id = ?').get(sim.lws_id);
        const loc1Row = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ?').get(loc1.lws_id);
        const loc2Row = db.prepare('SELECT id FROM lws_locations WHERE lws_id = ?').get(loc2.lws_id);

        // loc1: dynamic, baseline 20.0
        updateLocationEnvironment(db, simRow.id, loc1Row.id, { weather: 'clear', temperature_baseline: 20.0 }, '2026-06-15T08:00:00Z');
        // loc2: explicit temperature override (50.0°C) and lighting override ('pitch_black')
        updateLocationEnvironment(db, simRow.id, loc2Row.id, { weather: 'clear', temperature_override: 50.0, lighting_override: 'pitch_black' }, '2026-06-15T08:00:00Z');

        // Advance fictional time to 14:00 (peak diurnal temperature)
        await advanceFictionalTime(db, {
            simLwsId: sim.lws_id,
            targetFictionalTime: '2026-06-15T14:00:00Z',
        });

        const env1 = getLocationEnvironment(db, simRow.id, loc1Row.id, '2026-06-15T14:00:00Z');
        const env2 = getLocationEnvironment(db, simRow.id, loc2Row.id, '2026-06-15T14:00:00Z');

        // loc1 should have progressed to ~25°C and bright lighting
        expect(env1.temperature_celsius).toBeCloseTo(25.0, 1);
        expect(env1.lighting_level).toBe('bright');
        expect(env1.weather).toBe('clear');

        // loc2 should have preserved its overrides
        expect(env2.temperature_celsius).toBe(50.0);
        expect(env2.temperature_override).toBe(50.0);
        expect(env2.lighting_level).toBe('pitch_black');
        expect(env2.lighting_override).toBe('pitch_black');
    });
});

