import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { createInMemoryTestDb } from './fixtures/test-db.js';

describe('LWS Phase 8 Social & Development Database Foundation', () => {
    let memoryDb;

    beforeEach(() => {
        memoryDb = createInMemoryTestDb();
    });

    afterEach(() => {
        if (memoryDb && memoryDb.open) {
            memoryDb.close();
        }
    });

    test('applies migration 008 and sets PRAGMA user_version to 8', () => {
        const userVersion = memoryDb.pragma('user_version', { simple: true });
        expect(userVersion).toBe(8);
    });

    test('creates all 5 Phase 8 social and character development tables', () => {
        const tables = memoryDb.prepare('SELECT name FROM sqlite_master WHERE type=\'table\'').all();
        const tableNames = tables.map(t => t.name);

        const expectedTables = [
            'lws_character_relationships',
            'lws_relationship_evidence',
            'lws_social_information',
            'lws_character_faction_memberships',
            'lws_character_development_records',
        ];

        for (const t of expectedTables) {
            expect(tableNames).toContain(t);
        }
    });

    test('creates all 15 Phase 8 database triggers', () => {
        const triggers = memoryDb.prepare('SELECT name FROM sqlite_master WHERE type=\'trigger\'').all();
        const triggerNames = triggers.map(t => t.name);

        const expectedTriggers = [
            'trg_lws_character_relationships_no_self_rel',
            'trg_lws_character_relationships_same_sim',
            'trg_lws_character_relationships_immutability',
            'trg_lws_character_relationships_no_delete',
            'trg_lws_relationship_evidence_same_sim',
            'trg_lws_relationship_evidence_no_update',
            'trg_lws_relationship_evidence_no_delete',
            'trg_lws_social_information_same_sim',
            'trg_lws_social_information_no_update',
            'trg_lws_social_information_no_delete',
            'trg_lws_character_faction_memberships_same_sim',
            'trg_lws_character_faction_memberships_immutability',
            'trg_lws_character_faction_memberships_no_delete',
            'trg_lws_character_development_records_no_update',
            'trg_lws_character_development_records_no_delete',
        ];

        for (const trg of expectedTriggers) {
            expect(triggerNames).toContain(trg);
        }
    });

    test('creates all 10 Phase 8 indexes', () => {
        const indexes = memoryDb.prepare('SELECT name FROM sqlite_master WHERE type=\'index\'').all();
        const indexNames = indexes.map(i => i.name);

        const expectedIndexes = [
            'idx_lws_rel_unique_directional',
            'idx_lws_rel_source',
            'idx_lws_rel_target',
            'idx_lws_rel_evidence_rel',
            'idx_lws_rel_evidence_sim_time',
            'idx_lws_social_info_sim_subj',
            'idx_lws_social_info_tree',
            'idx_lws_faction_mem_unique',
            'idx_lws_faction_mem_char',
            'idx_lws_dev_records_char_time',
        ];

        for (const idx of expectedIndexes) {
            expect(indexNames).toContain(idx);
        }
    });

    test('enforces no-self-relationship trigger on lws_character_relationships', () => {
        // Setup world, character, simulation
        memoryDb.prepare(`
            INSERT INTO lws_worlds (id, lws_id, name, created_at, updated_at)
            VALUES (1, '00000000-0000-0000-0000-000000000001', 'World', '2026-01-01', '2026-01-01')
        `).run();
        memoryDb.prepare(`
            INSERT INTO lws_characters (id, lws_id, world_id, name, created_at, updated_at)
            VALUES (1, '00000000-0000-0000-0000-000000000002', 1, 'Alice', '2026-01-01', '2026-01-01')
        `).run();
        memoryDb.prepare(`
            INSERT INTO lws_simulations (id, lws_id, world_id, name, current_fictional_time, created_at, updated_at)
            VALUES (1, '00000000-0000-0000-0000-000000000003', 1, 'Sim', '2026-01-01T00:00:00Z', '2026-01-01', '2026-01-01')
        `).run();
        memoryDb.prepare(`
            INSERT INTO lws_simulation_characters (id, lws_id, simulation_id, character_id, created_at, updated_at)
            VALUES (1, '00000000-0000-0000-0000-000000000004', 1, 1, '2026-01-01', '2026-01-01')
        `).run();

        // Inserting self-relationship must fail
        expect(() => {
            memoryDb.prepare(`
                INSERT INTO lws_character_relationships (
                    lws_id, simulation_id, source_character_id, target_character_id,
                    trust, affection, familiarity, respect, loyalty, created_at, updated_at
                ) VALUES ('00000000-0000-0000-0000-000000000005', 1, 1, 1, 0, 0, 0, 0, 0, '2026-01-01', '2026-01-01')
            `).run();
        }).toThrow(/Source and target characters cannot be the same/);
    });

    test('enforces append-only trigger on lws_relationship_evidence', () => {
        // Setup entities
        memoryDb.exec(`
            INSERT INTO lws_worlds (id, lws_id, name, created_at, updated_at)
            VALUES (1, '00000000-0000-0000-0000-000000000001', 'World', '2026-01-01', '2026-01-01');
            INSERT INTO lws_characters (id, lws_id, world_id, name, created_at, updated_at)
            VALUES (1, '00000000-0000-0000-0000-000000000002', 1, 'Alice', '2026-01-01', '2026-01-01'),
                   (2, '00000000-0000-0000-0000-000000000003', 1, 'Bob', '2026-01-01', '2026-01-01');
            INSERT INTO lws_simulations (id, lws_id, world_id, name, current_fictional_time, created_at, updated_at)
            VALUES (1, '00000000-0000-0000-0000-000000000004', 1, 'Sim', '2026-01-01T00:00:00Z', '2026-01-01', '2026-01-01');
            INSERT INTO lws_simulation_characters (id, lws_id, simulation_id, character_id, created_at, updated_at)
            VALUES (1, '00000000-0000-0000-0000-000000000005', 1, 1, '2026-01-01', '2026-01-01'),
                   (2, '00000000-0000-0000-0000-000000000006', 1, 2, '2026-01-01', '2026-01-01');
            INSERT INTO lws_character_relationships (
                id, lws_id, simulation_id, source_character_id, target_character_id,
                trust, affection, familiarity, respect, loyalty, created_at, updated_at
            ) VALUES (1, '00000000-0000-0000-0000-000000000007', 1, 1, 2, 10, 10, 10, 10, 10, '2026-01-01', '2026-01-01');
            INSERT INTO lws_events (id, lws_id, simulation_id, sequence_number, event_type, fictional_time, provenance, created_at)
            VALUES (1, '00000000-0000-0000-0000-000000000008', 1, 1, 'COMMUNICATE', '2026-01-01T00:00:00Z', 'llm_proposal', '2026-01-01');
            INSERT INTO lws_relationship_evidence (
                id, lws_id, simulation_id, relationship_id, source_character_id, target_character_id,
                causal_event_id, fictional_time, delta_trust, delta_affection, delta_familiarity, delta_respect, delta_loyalty,
                interaction_type, narrative_rationale, created_at
            ) VALUES (1, '00000000-0000-0000-0000-000000000009', 1, 1, 1, 2, 1, '2026-01-01T00:00:00Z', 10, 10, 10, 10, 10, 'conversation', 'Good talk', '2026-01-01');
        `);

        // Updating relationship evidence must fail
        expect(() => {
            memoryDb.prepare('UPDATE lws_relationship_evidence SET delta_trust = 20 WHERE id = 1').run();
        }).toThrow(/updates to lws_relationship_evidence are prohibited/);

        // Deleting relationship evidence must fail
        expect(() => {
            memoryDb.prepare('DELETE FROM lws_relationship_evidence WHERE id = 1').run();
        }).toThrow(/physical deletion from lws_relationship_evidence is prohibited/);
    });
});
