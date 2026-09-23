import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import {
    openDb,
    closeDb,
    createWorld,
    createWorldRule,
    getWorldRuleByLwsId,
    listWorldRules,
    updateWorldRule,
    deleteWorldRule,
    LwsValidationError,
    LwsNotFoundError,
} from '../../src/living-world/index.js';

describe('Authored WorldRule Service', () => {
    let world;

    beforeEach(() => {
        openDb(':memory:');
        world = createWorld({ name: 'Rules Test World' });
    });

    afterEach(() => {
        closeDb();
    });

    test('creates and retrieves a world rule with sort_order', () => {
        const rule = createWorldRule(world.lws_id, {
            title: 'Law of Conservation of Magic',
            body: 'Magic cannot be created or destroyed, only transmuted through sacrifice.',
            sort_order: 10,
        });

        expect(rule.lws_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(rule.title).toBe('Law of Conservation of Magic');
        expect(rule.body).toBe('Magic cannot be created or destroyed, only transmuted through sacrifice.');
        expect(rule.sort_order).toBe(10);

        const fetched = getWorldRuleByLwsId(world.lws_id, rule.lws_id);
        expect(fetched.title).toBe(rule.title);
        expect(fetched.body).toBe(rule.body);
    });

    test('rejects missing or empty body', () => {
        expect(() => createWorldRule(world.lws_id, { body: '' })).toThrow(LwsValidationError);
        expect(() => createWorldRule(world.lws_id, { body: '   ' })).toThrow(LwsValidationError);
        expect(() => createWorldRule(world.lws_id, {})).toThrow(LwsValidationError);
    });

    test('lists rules sorted by sort_order ascending', () => {
        createWorldRule(world.lws_id, { title: 'Rule 3', body: 'Third rule', sort_order: 30 });
        createWorldRule(world.lws_id, { title: 'Rule 1', body: 'First rule', sort_order: 10 });
        createWorldRule(world.lws_id, { title: 'Rule 2', body: 'Second rule', sort_order: 20 });

        const rules = listWorldRules(world.lws_id);
        expect(rules).toHaveLength(3);
        expect(rules[0].title).toBe('Rule 1');
        expect(rules[1].title).toBe('Rule 2');
        expect(rules[2].title).toBe('Rule 3');
    });

    test('updates rule title, body, and sort_order', () => {
        const rule = createWorldRule(world.lws_id, { title: 'Draft', body: 'WIP', sort_order: 1 });
        const updated = updateWorldRule(world.lws_id, rule.lws_id, {
            title: 'Final Rule',
            body: 'Final text',
            sort_order: 5,
        });

        expect(updated.title).toBe('Final Rule');
        expect(updated.body).toBe('Final text');
        expect(updated.sort_order).toBe(5);
    });

    test('soft-deletes world rule and excludes from listing', () => {
        const rule = createWorldRule(world.lws_id, { title: 'To Delete', body: 'Obsolete rule' });
        deleteWorldRule(world.lws_id, rule.lws_id);

        expect(() => getWorldRuleByLwsId(world.lws_id, rule.lws_id)).toThrow(LwsNotFoundError);
        const rules = listWorldRules(world.lws_id);
        expect(rules).toHaveLength(0);
    });
});
