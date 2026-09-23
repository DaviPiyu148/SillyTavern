import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    createWorld,
    createLocation,
    getLocationByLwsId,
    listLocations,
    updateLocation,
    deleteLocation,
    LwsValidationError,
    LwsNotFoundError,
} from '../../src/living-world/index.js';

describe('Authored Location Service', () => {
    let world;

    beforeEach(() => {
        openDb(':memory:');
        world = createWorld({ name: 'Location Test World' });
    });

    afterEach(() => {
        closeDb();
    });

    test('creates location with valid attributes', () => {
        const loc = createLocation(world.lws_id, {
            name: 'Ironhold Fortress',
            description: 'A massive bastion overlooking the valley.',
            tags: ['fortress', 'military'],
            extensions: { elevation: 1200 },
        });

        expect(loc.lws_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(loc.name).toBe('Ironhold Fortress');
        expect(loc.description).toBe('A massive bastion overlooking the valley.');
        expect(loc.tags).toEqual(['fortress', 'military']);
        expect(loc.extensions).toEqual({ elevation: 1200 });
        expect(loc.id).toBeUndefined();
        expect(loc.deleted_at).toBeUndefined();
    });

    test('rejects blank location name', () => {
        expect(() => createLocation(world.lws_id, { name: '' })).toThrow(LwsValidationError);
        expect(() => createLocation(world.lws_id, {})).toThrow(LwsValidationError);
    });

    test('retrieves and updates location', () => {
        const created = createLocation(world.lws_id, { name: 'Old Town' });
        const fetched = getLocationByLwsId(world.lws_id, created.lws_id);
        expect(fetched.name).toBe('Old Town');

        const updated = updateLocation(world.lws_id, created.lws_id, {
            name: 'New Town',
            description: 'Rebuilt city',
        });
        expect(updated.name).toBe('New Town');
        expect(updated.description).toBe('Rebuilt city');
    });

    test('lists active locations and filters soft-deleted', () => {
        createLocation(world.lws_id, { name: 'Castle' });
        createLocation(world.lws_id, { name: 'Dungeon' });
        const cave = createLocation(world.lws_id, { name: 'Cave' });

        deleteLocation(world.lws_id, cave.lws_id);

        const list = listLocations(world.lws_id);
        expect(list).toHaveLength(2);
        expect(list[0].name).toBe('Castle');
        expect(list[1].name).toBe('Dungeon');
    });

    test('soft-deletes location and throws 404 on subsequent lookups', () => {
        const loc = createLocation(world.lws_id, { name: 'Ruins' });
        expect(deleteLocation(world.lws_id, loc.lws_id)).toBe(true);

        expect(() => getLocationByLwsId(world.lws_id, loc.lws_id)).toThrow(LwsNotFoundError);
        expect(() => updateLocation(world.lws_id, loc.lws_id, { name: 'Fixed' })).toThrow(LwsNotFoundError);
        expect(() => deleteLocation(world.lws_id, loc.lws_id)).toThrow(LwsNotFoundError);
    });
});
