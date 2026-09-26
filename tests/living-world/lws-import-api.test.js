import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { init, onExit, createWorld, getDb, CONFLICT_POLICIES } from '../../src/living-world/index.js';
import { router as lwsRouter } from '../../src/endpoints/living-world.js';

describe('Import & Authoring REST API Endpoints (Phase 11)', () => {
    let server;
    let baseUrl;
    let tempDir;
    let testWorld;

    beforeAll(async () => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lws-import-api-test-'));
        const dbPath = path.join(tempDir, 'import-api-test.db');
        await init({ dbPath });

        const app = express();
        app.use(express.json());
        app.use('/api/living-world', lwsRouter);

        server = http.createServer(app);
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;

        testWorld = createWorld({ name: 'Import Test Realm', description: 'World for API testing' });
    });

    afterAll(async () => {
        await onExit();
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
        if (tempDir) {
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (err) {
                void err;
            }
        }
    });

    // 1. Character Card Preview
    test('POST /import/character/preview parses JSON card and returns preview token and normalized entity', async () => {
        const v2Card = {
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: {
                name: 'Sir Galahad',
                description: 'A pure and noble knight of the Round Table.',
                personality: 'Valiant, devout, humble, steadfast.',
                first_mes: 'Hail, traveller. May the light guide our path.',
                mes_example: '<START>\n{{char}}: Speak your quest.',
                creator_notes: 'Created for Camelot scenario.',
                tags: ['knight', 'camelot', 'holy'],
            },
        };

        const res = await fetch(`${baseUrl}/api/living-world/import/character/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card: v2Card, target_world_lws_id: testWorld.lws_id }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.preview_token).toBeDefined();
        expect(typeof data.preview_token).toBe('string');
        expect(data.source_type).toBe('sillytavern_card_v2');
        expect(data.normalized.name).toBe('Sir Galahad');
        expect(data.normalized.personality).toContain('Valiant');
        expect(data.provenance).toBeDefined();
    });

    // 2. Character Card Commit
    test('POST /worlds/:worldLwsId/import/character commits character into target world', async () => {
        const v2Card = {
            spec: 'chara_card_v2',
            spec_version: '2.0',
            data: {
                name: 'Lady Morgana',
                description: 'Enchantress and sister to the king.',
                personality: 'Cunning, ambitious, perceptive.',
                first_mes: 'The shadows hold many truths, wanderer.',
            },
        };

        // Step 1: Preview
        const prevRes = await fetch(`${baseUrl}/api/living-world/import/character/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card: v2Card, target_world_lws_id: testWorld.lws_id }),
        });
        const prevData = await prevRes.json();
        expect(prevRes.status).toBe(200);

        // Step 2: Commit
        const commitRes = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/import/character`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                preview_token: prevData.preview_token,
                candidate_entities: prevData.candidate_entities,
                conflict_policy: CONFLICT_POLICIES.REJECT,
            }),
        });

        expect(commitRes.status).toBe(201);
        const commitData = await commitRes.json();
        expect(commitData.success).toBe(true);
        expect(commitData.character.name).toBe('Lady Morgana');
        expect(commitData.character.lws_id).toBeDefined();
    });

    test('POST /worlds/:worldLwsId/import/character handles conflict with RENAME policy', async () => {
        const card = {
            name: 'Lady Morgana',
            description: 'Alternate version of Morgana.',
            personality: 'Dark, brooding.',
        };

        const prevRes = await fetch(`${baseUrl}/api/living-world/import/character/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ card, target_world_lws_id: testWorld.lws_id }),
        });
        const prevData = await prevRes.json();
        expect(prevData.conflicts.length).toBeGreaterThan(0);

        const commitRes = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/import/character`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                preview_token: prevData.preview_token,
                candidate_entities: prevData.candidate_entities,
                conflict_policy: CONFLICT_POLICIES.RENAME,
            }),
        });

        expect(commitRes.status).toBe(201);
        const commitData = await commitRes.json();
        expect(commitData.character.name).toBe('Lady Morgana (Import 2)');
    });

    // 3. WorldInfo Preview
    test('POST /import/worldinfo/preview parses lorebook JSON and returns classified candidates', async () => {
        const lorebook = {
            entries: {
                0: {
                    keys: ['elysium', 'city', 'room'],
                    content: 'Elysium is a magnificent city of towering white marble towers and emerald gardens located in the heart of the realm.',
                },
                1: {
                    keys: ['high council', 'guild', 'order'],
                    content: 'The High Council is a guild faction led by the Grand Magister with headquarters in the capital.',
                },
            },
        };

        const res = await fetch(`${baseUrl}/api/living-world/import/worldinfo/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ worldinfo: lorebook, target_world_lws_id: testWorld.lws_id }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.preview_token).toBeDefined();
        expect(data.candidate_entities.locations.length).toBe(1);
        expect(data.candidate_entities.locations[0].name).toBe('elysium');
        expect(data.candidate_entities.factions.length).toBe(1);
        expect(data.candidate_entities.factions[0].name).toBe('high council');
    });

    // 4. WorldInfo Commit
    test('POST /worlds/:worldLwsId/import/worldinfo commits candidates into world', async () => {
        const lorebook = {
            entries: {
                0: {
                    keys: ['silverspire', 'room', 'building'],
                    content: 'Silverspire is a remote observatory building location atop Mount Celestia located at the peak.',
                },
            },
        };

        const prevRes = await fetch(`${baseUrl}/api/living-world/import/worldinfo/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ worldinfo: lorebook, target_world_lws_id: testWorld.lws_id }),
        });
        const prevData = await prevRes.json();

        const commitRes = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/import/worldinfo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                preview_token: prevData.preview_token,
                candidate_entities: prevData.candidate_entities,
                conflict_policy: CONFLICT_POLICIES.REJECT,
            }),
        });

        expect(commitRes.status).toBe(201);
        const commitData = await commitRes.json();
        expect(commitData.imported_counts.locations).toBe(1);
    });

    // 5. Freeform Preview
    test('POST /import/freeform/preview parses markdown outline and returns structured candidates', async () => {
        const text = `# Kingdom of Veritas

## Location: The Sunken Vault
An ancient treasury buried beneath the tidal marshes.

## Faction: The Drowned Guard
An order of spectral guardians bound by ancient oaths.
`;

        const res = await fetch(`${baseUrl}/api/living-world/import/freeform/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, target_world_lws_id: testWorld.lws_id }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.preview_token).toBeDefined();
        expect(data.candidate_entities.locations.length).toBe(1);
        expect(data.candidate_entities.locations[0].name).toBe('The Sunken Vault');
        expect(data.candidate_entities.factions.length).toBe(1);
        expect(data.candidate_entities.factions[0].name).toBe('The Drowned Guard');
    });

    // 6. Freeform Commit
    test('POST /worlds/:worldLwsId/import/freeform commits freeform entities', async () => {
        const text = `
## Location: Whispering Glade
A peaceful grove enchanted with quiet murmurs.
`;

        const prevRes = await fetch(`${baseUrl}/api/living-world/import/freeform/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text, target_world_lws_id: testWorld.lws_id }),
        });
        const prevData = await prevRes.json();

        const commitRes = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/import/freeform`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                preview_token: prevData.preview_token,
                candidate_entities: prevData.candidate_entities,
                conflict_policy: CONFLICT_POLICIES.REJECT,
            }),
        });

        expect(commitRes.status).toBe(201);
        const commitData = await commitRes.json();
        expect(commitData.imported_counts.locations).toBe(1);
    });

    // 7. World Manifest Preview (JSON & YAML)
    test('POST /import/manifest/preview validates valid JSON manifest', async () => {
        const manifest = {
            schema_version: 'lws_world_manifest_v1',
            world: {
                name: 'Solaris Prime',
                description: 'A stellar civilization at the edge of the galaxy.',
            },
            locations: [
                { name: 'Core Station', description: 'Central orbital hub.' },
            ],
            characters: [
                { name: 'Commander Vane', description: 'Fleet commander.' },
            ],
        };

        const res = await fetch(`${baseUrl}/api/living-world/import/manifest/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manifest }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.valid).toBe(true);
        expect(data.preview_token).toBeDefined();
    });

    test('POST /import/manifest/preview validates YAML manifest with text/yaml content-type', async () => {
        const yamlContent = `
schema_version: "lws_world_manifest_v1"
world:
  name: "Terran Expanse"
  description: "Colonial worlds of humanity."
locations:
  - name: "New Haven"
    description: "First colony."
`;

        const res = await fetch(`${baseUrl}/api/living-world/import/manifest/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'text/yaml' },
            body: yamlContent,
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.valid).toBe(true);
    });

    test('POST /import/manifest/preview rejects invalid schema with HTTP 400', async () => {
        const invalidManifest = {
            schema_version: 'invalid_manifest_version',
            world: { name: 'Broken' },
        };

        const res = await fetch(`${baseUrl}/api/living-world/import/manifest/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manifest: invalidManifest }),
        });

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBeDefined();
    });

    // 8. World Manifest Commit
    test('POST /import/manifest/commit creates a full world hierarchy atomically', async () => {
        const manifest = {
            schema_version: 'lws_world_manifest_v1',
            world: {
                name: 'Eldoria',
                description: 'High fantasy world of magic.',
            },
            locations: [
                { name: 'Crystal Citadel', description: 'Seat of the Arch-Mage.' },
            ],
            characters: [
                { name: 'Arch-Mage Anton', description: 'Keeper of the Crystal Citadel.' },
            ],
        };

        // Preview
        const prevRes = await fetch(`${baseUrl}/api/living-world/import/manifest/preview`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ manifest }),
        });
        const prevData = await prevRes.json();

        // Commit
        const commitRes = await fetch(`${baseUrl}/api/living-world/import/manifest/commit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                preview_token: prevData.preview_token,
                manifest,
                conflict_policy: CONFLICT_POLICIES.REJECT,
            }),
        });

        expect(commitRes.status).toBe(201);
        const commitData = await commitRes.json();
        expect(commitData.success).toBe(true);
        expect(commitData.world.name).toBe('Eldoria');
        expect(commitData.world.lws_id).toBeDefined();
        expect(commitData.imported_counts.locations).toBe(1);
        expect(commitData.imported_counts.characters).toBe(1);
    });

    // 9. Export Manifest
    test('GET /worlds/:worldLwsId/export/manifest exports full round-trip world manifest', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/export/manifest`);
        expect(res.status).toBe(200);
        const manifest = await res.json();
        expect(manifest.schema_version).toBe('lws_world_manifest_v1');
        expect(manifest.world.name).toBe('Import Test Realm');
        expect(Array.isArray(manifest.characters)).toBe(true);
        expect(Array.isArray(manifest.locations)).toBe(true);
        expect(Array.isArray(manifest.factions)).toBe(true);
        expect(manifest.exported_at).toBeDefined();
    });

    // 10. Security & Error handling
    test('POST /worlds/:worldLwsId/import/character rejects forged/corrupted preview_token with 400', async () => {
        const res = await fetch(`${baseUrl}/api/living-world/worlds/${testWorld.lws_id}/import/character`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                preview_token: 'forged_fake_token',
                candidate_entities: { characters: [{ name: 'Fake' }] },
            }),
        });

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toMatch(/preview token/i);
    });

    test('GET /worlds/:worldLwsId/export/manifest returns 404 for nonexistent world', async () => {
        const nonexistentUuid = '00000000-0000-4000-8000-000000000000';
        const res = await fetch(`${baseUrl}/api/living-world/worlds/${nonexistentUuid}/export/manifest`);
        expect(res.status).toBe(404);
    });
});
