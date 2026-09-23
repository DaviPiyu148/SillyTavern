import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    createWorld,
    deleteWorld,
    createPromptConfig,
    getPromptConfig,
    updatePromptConfig,
    LwsConflictError,
    LwsNotFoundError,
} from '../../src/living-world/index.js';

describe('Authored Prompt Configuration Service', () => {
    let world;

    beforeEach(() => {
        openDb(':memory:');
        world = createWorld({ name: 'Prompt Config Test World' });
    });

    afterEach(() => {
        closeDb();
    });

    test('creates and retrieves prompt config for a world', () => {
        const config = createPromptConfig(world.lws_id, {
            style_notes: 'High fantasy, evocative and atmospheric description.',
            tone_notes: 'Serious, grounded, low-tech medieval realism.',
            format_notes: 'Third person limited narrative.',
            extensions: { model_hint: 'claude-3-5-sonnet' },
        });

        expect(config.lws_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(config.style_notes).toBe('High fantasy, evocative and atmospheric description.');
        expect(config.tone_notes).toBe('Serious, grounded, low-tech medieval realism.');
        expect(config.format_notes).toBe('Third person limited narrative.');
        expect(config.extensions).toEqual({ model_hint: 'claude-3-5-sonnet' });

        const fetched = getPromptConfig(world.lws_id);
        expect(fetched.style_notes).toBe(config.style_notes);
    });

    test('rejects creating a duplicate prompt config on the same world with 409 conflict', () => {
        createPromptConfig(world.lws_id, { style_notes: 'Initial config' });

        expect(() => {
            createPromptConfig(world.lws_id, { style_notes: 'Second config' });
        }).toThrow(LwsConflictError);
    });

    test('updates prompt config fields', () => {
        createPromptConfig(world.lws_id, { style_notes: 'Draft' });
        const updated = updatePromptConfig(world.lws_id, {
            style_notes: 'Polished style',
            tone_notes: 'Grimdark',
        });

        expect(updated.style_notes).toBe('Polished style');
        expect(updated.tone_notes).toBe('Grimdark');
    });

    test('throws 404 when querying config for world without one or for non-existent world', () => {
        expect(() => getPromptConfig(world.lws_id)).toThrow(LwsNotFoundError);
        expect(() => getPromptConfig('00000000-0000-0000-0000-000000000000')).toThrow(LwsNotFoundError);

        deleteWorld(world.lws_id);
        expect(() => getPromptConfig(world.lws_id)).toThrow(LwsNotFoundError);
    });
});
