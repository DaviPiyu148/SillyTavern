import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDb, closeDb, getDb } from '../../src/living-world/db.js';
import { previewImport, commitImport } from '../../src/living-world/import/authoring.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createScenario, addScenarioCharacter } from '../../src/living-world/authored/scenarios.js';
import { createSimulation } from '../../src/living-world/simulations/simulations.js';
import { buildPromptContext } from '../../src/living-world/prompt/context-builder.js';
import { LwsValidationError, LwsConflictError } from '../../src/living-world/errors.js';
import { setTokenSigningSecret } from '../../src/living-world/import/common.js';

describe('LWS Authoring Bundle & Transaction Orchestration', () => {
    beforeEach(() => {
        openDb(':memory:');
        setTokenSigningSecret('bundle-test-secret-key-999');
    });

    afterEach(() => {
        closeDb();
    });

    describe('Preview -> Commit Workflow', () => {
        it('executes atomic multi-entity import from preview token', () => {
            const candidates = {
                world: { name: 'Eldoria', description: 'A mystical realm' },
                characters: [
                    { name: 'Sir Galahad', description: 'Knight', personality: 'Honorable' },
                    { name: 'Lady Guinevere', description: 'Queen', personality: 'Wise' },
                ],
                locations: [
                    { name: 'Camelot', description: 'Golden city' },
                    { name: 'Round Table Room', description: 'Great hall', parent_location_lws_id: 'Camelot' },
                ],
                factions: [
                    { name: 'Knights of the Round Table', description: 'Order of heroes' },
                ],
                world_rules: [
                    { title: 'Chivalric Code', body: 'Never harm an unarmed foe.' },
                ],
            };

            const preview = previewImport({ candidate_entities: candidates });

            expect(preview.valid).toBe(true);
            expect(typeof preview.preview_token).toBe('string');
            expect(preview.summary.characters).toBe(2);
            expect(preview.summary.locations).toBe(2);
            expect(preview.summary.total_conflicts).toBe(0);

            // Verify 0 rows in DB after preview
            const db = getDb();
            const worldCountBefore = db.prepare('SELECT COUNT(*) AS count FROM lws_worlds').get().count;
            expect(worldCountBefore).toBe(0);

            // Execute commit
            const commitResult = commitImport({
                preview_token: preview.preview_token,
                candidate_entities: candidates,
            });

            expect(commitResult.success).toBe(true);
            expect(commitResult.world.name).toBe('Eldoria');
            expect(commitResult.imported_counts.characters).toBe(2);
            expect(commitResult.imported_counts.locations).toBe(2);
            expect(commitResult.imported_counts.factions).toBe(1);
            expect(commitResult.imported_counts.world_rules).toBe(1);

            // Verify rows in DB after commit
            const worldCountAfter = db.prepare('SELECT COUNT(*) AS count FROM lws_worlds').get().count;
            expect(worldCountAfter).toBe(1);
            const charCount = db.prepare('SELECT COUNT(*) AS count FROM lws_characters').get().count;
            expect(charCount).toBe(2);
        });

        it('rejects commit when preview token has expired or is invalid', () => {
            const candidates = {
                world: { name: 'Test World' },
            };

            expect(() => {
                commitImport({
                    preview_token: 'invalid.token',
                    candidate_entities: candidates,
                });
            }).toThrow(LwsValidationError);
        });

        it('detects TOCTOU stale preview and throws LwsConflictError when DB state has changed', () => {
            const candidates = {
                world: { name: 'Stale Check World' },
                characters: [{ name: 'New Char' }],
            };

            const preview = previewImport({ candidate_entities: candidates });

            // Concurrent transaction alters DB state before commit
            const db = getDb();
            createWorld({ name: 'Interfering World' });

            expect(() => {
                commitImport({
                    preview_token: preview.preview_token,
                    candidate_entities: candidates,
                });
            }).toThrow(LwsConflictError);
        });
    });

    describe('Conflict Policies in Action (RENAME, REPLACE, MERGE)', () => {
        it('applies RENAME policy by appending (Import 2) suffix', () => {
            const world = createWorld({ name: 'Policy Test World' });
            createCharacter(world.lws_id, { name: 'Arthur' });

            const incoming = {
                characters: [{ name: 'Arthur', description: 'A duplicate Arthur' }],
            };

            const preview = previewImport({
                target_world_lws_id: world.lws_id,
                candidate_entities: incoming,
                conflict_policy: 'rename',
            });

            const result = commitImport({
                preview_token: preview.preview_token,
                target_world_lws_id: world.lws_id,
                candidate_entities: incoming,
                conflict_policy: 'rename',
            });

            expect(result.imported_counts.characters).toBe(1);
            expect(result.entities.characters[0].name).toBe('Arthur (Import 2)');
        });

        it('applies REPLACE policy by soft-deleting old row and inserting fresh row', () => {
            const world = createWorld({ name: 'Replace World' });
            const oldChar = createCharacter(world.lws_id, { name: 'Old Knight', description: 'Old' });

            const incoming = {
                characters: [{ name: 'Old Knight', description: 'New Replacement' }],
            };

            const preview = previewImport({
                target_world_lws_id: world.lws_id,
                candidate_entities: incoming,
                conflict_policy: 'replace',
            });

            const result = commitImport({
                preview_token: preview.preview_token,
                target_world_lws_id: world.lws_id,
                candidate_entities: incoming,
                conflict_policy: 'replace',
            });

            expect(result.imported_counts.characters).toBe(1);

            const db = getDb();
            const oldRow = db.prepare('SELECT deleted_at FROM lws_characters WHERE lws_id = ?').get(oldChar.lws_id);
            expect(oldRow.deleted_at).not.toBeNull();
        });

        it('applies MERGE policy by non-destructively updating fields and unioning tags', () => {
            const world = createWorld({ name: 'Merge World' });
            const existingChar = createCharacter(world.lws_id, {
                name: 'Elena',
                description: 'Original description',
                personality: 'Original personality',
                tags: ['mage', 'scholar'],
            });

            const incoming = {
                characters: [{
                    name: 'Elena',
                    personality: 'Updated personality',
                    tags: ['scholar', 'archmage'],
                }],
            };

            const preview = previewImport({
                target_world_lws_id: world.lws_id,
                candidate_entities: incoming,
                conflict_policy: 'merge',
            });

            commitImport({
                preview_token: preview.preview_token,
                target_world_lws_id: world.lws_id,
                candidate_entities: incoming,
                conflict_policy: 'merge',
            });

            const db = getDb();
            const updated = db.prepare('SELECT * FROM lws_characters WHERE lws_id = ?').get(existingChar.lws_id);

            expect(updated.description).toBe('Original description');
            expect(updated.personality).toBe('Updated personality');
            const tags = JSON.parse(updated.tags);
            expect(tags).toEqual(expect.arrayContaining(['mage', 'scholar', 'archmage']));
        });
    });

    describe('Active Simulation Decoupling & Snapshot Isolation', () => {
        it('proves updating authored character does NOT alter active simulation character prompt context', () => {
            const db = getDb();
            const world = createWorld({ name: 'Simulation World' });
            const char = createCharacter(world.lws_id, {
                name: 'Sir Galahad',
                personality: 'Chaste and chivalrous',
                description: 'A pure knight of Camelot',
            });
            const loc = createLocation(world.lws_id, { name: 'Castle' });
            const scen = createScenario(world.lws_id, {
                name: 'Quest for the Grail',
                starting_location_lws_id: loc.lws_id,
            });
            addScenarioCharacter(world.lws_id, scen.lws_id, { character_lws_id: char.lws_id, role: 'Protagonist' });

            const sim = createSimulation(world.lws_id, {
                name: 'Running Sim',
                scenario_id: scen.lws_id,
                initial_fictional_time: '1000-01-01T08:00:00Z',
            });

            // Build initial prompt context
            const initialContext = buildPromptContext(sim.lws_id, {
                characterLwsId: char.lws_id,
            });
            expect(initialContext.user_prompt).toContain('Chaste and chivalrous');

            // Import an updated card with MERGE policy mutating authored character personality
            const incoming = {
                characters: [{
                    name: 'Sir Galahad',
                    personality: 'CORRUPTED PERSONALITY FROM LIVE AUTHORING',
                }],
            };

            const preview = previewImport({
                target_world_lws_id: world.lws_id,
                candidate_entities: incoming,
                conflict_policy: 'merge',
            });

            commitImport({
                preview_token: preview.preview_token,
                target_world_lws_id: world.lws_id,
                candidate_entities: incoming,
                conflict_policy: 'merge',
            });

            // Verify live lws_characters is updated
            const liveChar = db.prepare('SELECT personality FROM lws_characters WHERE lws_id = ?').get(char.lws_id);
            expect(liveChar.personality).toBe('CORRUPTED PERSONALITY FROM LIVE AUTHORING');

            // Build generation prompt context again for running simulation
            const contextAfterLiveEdit = buildPromptContext(sim.lws_id, {
                characterLwsId: char.lws_id,
            });

            // Must still read frozen snapshot, proving snapshot isolation
            expect(contextAfterLiveEdit.user_prompt).toContain('Chaste and chivalrous');
            expect(contextAfterLiveEdit.user_prompt).not.toContain('CORRUPTED PERSONALITY');
        });
    });
});
