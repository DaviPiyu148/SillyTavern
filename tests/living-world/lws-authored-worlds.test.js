import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    createWorld,
    getWorldByLwsId,
    listWorlds,
    updateWorld,
    deleteWorld,
    LwsValidationError,
    LwsNotFoundError,
} from '../../src/living-world/index.js';
import { createFileTestDb } from './fixtures/test-db.js';

describe('Authored World Service', () => {
    beforeEach(() => {
        openDb(':memory:');
    });

    afterEach(() => {
        closeDb();
    });

    test('creates a world with valid fields and generates stable UUID', () => {
        const world = createWorld({
            name: '  Valdor  ',
            description: 'A fantasy realm',
            tags: ['fantasy', 'high-magic'],
            extensions: { custom_setting: 'value1' },
        });

        expect(world).toBeDefined();
        expect(world.lws_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(world.name).toBe('Valdor');
        expect(world.description).toBe('A fantasy realm');
        expect(world.tags).toEqual(['fantasy', 'high-magic']);
        expect(world.extensions).toEqual({ custom_setting: 'value1' });
        expect(world.created_at).toBeDefined();
        expect(world.updated_at).toBe(world.created_at);
        expect(world.id).toBeUndefined();
        expect(world.deleted_at).toBeUndefined();
    });

    test('rejects missing or empty world name', () => {
        expect(() => createWorld({ name: '' })).toThrow(LwsValidationError);
        expect(() => createWorld({ name: '   ' })).toThrow(LwsValidationError);
        expect(() => createWorld({})).toThrow(LwsValidationError);
        expect(() => createWorld({ name: 123 })).toThrow(LwsValidationError);
    });

    test('rejects world name exceeding 255 characters', () => {
        const longName = 'A'.repeat(256);
        expect(() => createWorld({ name: longName })).toThrow(LwsValidationError);
    });

    test('rejects invalid tags and extensions', () => {
        expect(() => createWorld({ name: 'W', tags: 'not-array' })).toThrow(LwsValidationError);
        expect(() => createWorld({ name: 'W', tags: [123] })).toThrow(LwsValidationError);
        expect(() => createWorld({ name: 'W', extensions: 'not-object' })).toThrow(LwsValidationError);
        expect(() => createWorld({ name: 'W', extensions: [1, 2] })).toThrow(LwsValidationError);
    });

    test('retrieves world by UUID and rejects invalid UUID', () => {
        const created = createWorld({ name: 'World A' });
        const fetched = getWorldByLwsId(created.lws_id);
        expect(fetched.name).toBe('World A');
        expect(fetched.lws_id).toBe(created.lws_id);

        expect(() => getWorldByLwsId('not-a-uuid')).toThrow(LwsValidationError);
        expect(() => getWorldByLwsId('00000000-0000-0000-0000-000000000000')).toThrow(LwsNotFoundError);
    });

    test('lists active worlds and excludes soft-deleted worlds by default', () => {
        createWorld({ name: 'Bravo' });
        createWorld({ name: 'Alpha' });
        const charlie = createWorld({ name: 'Charlie' });

        deleteWorld(charlie.lws_id);

        const list = listWorlds();
        expect(list).toHaveLength(2);
        expect(list[0].name).toBe('Alpha');
        expect(list[1].name).toBe('Bravo');

        const all = listWorlds({ includeDeleted: true });
        expect(all).toHaveLength(3);
    });

    test('updates editable fields and advances updated_at without changing lws_id', async () => {
        const created = createWorld({ name: 'Original', description: 'Desc 1' });
        const originalLwsId = created.lws_id;
        const originalCreatedAt = created.created_at;

        // Small delay to ensure timestamp progression
        await new Promise(r => setTimeout(r, 2));

        const updated = updateWorld(created.lws_id, {
            name: 'Renamed',
            description: 'Updated desc',
            tags: ['new-tag'],
        });

        expect(updated.lws_id).toBe(originalLwsId);
        expect(updated.created_at).toBe(originalCreatedAt);
        expect(updated.name).toBe('Renamed');
        expect(updated.description).toBe('Updated desc');
        expect(updated.tags).toEqual(['new-tag']);
        expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(originalCreatedAt));
    });

    test('soft-deletes world and subsequent lookups return 404', () => {
        const created = createWorld({ name: 'Temporary' });
        expect(deleteWorld(created.lws_id)).toBe(true);

        expect(() => getWorldByLwsId(created.lws_id)).toThrow(LwsNotFoundError);
        expect(() => updateWorld(created.lws_id, { name: 'New' })).toThrow(LwsNotFoundError);
        expect(() => deleteWorld(created.lws_id)).toThrow(LwsNotFoundError);
    });

    test('persists world across database restart on file-backed database', () => {
        closeDb();
        const { dbPath, cleanup } = createFileTestDb('lws-world-durability-');

        try {
            openDb(dbPath);
            const created = createWorld({ name: 'Persistent World', description: 'Survives restart' });
            const savedLwsId = created.lws_id;
            closeDb();

            // Reopen
            openDb(dbPath);
            const retrieved = getWorldByLwsId(savedLwsId);
            expect(retrieved.name).toBe('Persistent World');
            expect(retrieved.description).toBe('Survives restart');
            closeDb();
        } finally {
            cleanup();
        }
    });
});
