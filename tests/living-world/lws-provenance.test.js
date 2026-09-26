import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { openDb, closeDb, getDb } from '../../src/living-world/db.js';
import { createWorld } from '../../src/living-world/authored/worlds.js';
import { createCharacter } from '../../src/living-world/authored/characters.js';
import { createLocation } from '../../src/living-world/authored/locations.js';
import { createFaction, addFactionMember } from '../../src/living-world/authored/factions.js';
import { createScenario, addScenarioCharacter } from '../../src/living-world/authored/scenarios.js';
import { createWorldRule } from '../../src/living-world/authored/world-rules.js';
import { createPromptConfig } from '../../src/living-world/authored/prompt-configs.js';
import { createAmbientArchetype } from '../../src/living-world/population/archetypes.js';
import {
    normalizeUnicode,
    sanitizePrototype,
    canonicalJsonStringify,
    hashString,
    hashBuffer,
    hashObject,
    computePreviewStateHash,
    generatePreviewToken,
    verifyPreviewToken,
    createProvenance,
    appendMergeHistory,
    setTokenSigningSecret,
    detectRawFormat,
} from '../../src/living-world/import/common.js';

describe('LWS Common Import & Provenance Utilities', () => {
    beforeEach(() => {
        openDb(':memory:');
        setTokenSigningSecret('test-secret-key-1234567890');
    });

    afterEach(() => {
        closeDb();
    });

    describe('Unicode NFC Normalization', () => {
        it('normalizes decomposed Unicode strings to NFC form', () => {
            // "e\u0301" (decomposed é) -> "\u00e9" (composed é)
            const decomposed = 'Cafe\u0301';
            const normalized = normalizeUnicode(decomposed);
            expect(normalized).toBe('Café');
            expect(normalized.length).toBe(4);
        });

        it('recursively normalizes strings within objects and arrays', () => {
            const input = {
                title: 'Cafe\u0301',
                tags: ['Re\u0301sume\u0301', 'façade'],
                nested: { name: 'Noe\u0308l' },
            };
            const output = normalizeUnicode(input);
            expect(output.title).toBe('Café');
            expect(output.tags[0]).toBe('Résumé');
            expect(output.nested.name).toBe('Noël');
        });
    });

    describe('Prototype Pollution Sanitization', () => {
        it('strips __proto__, constructor, and prototype properties recursively', () => {
            const dirty = JSON.parse('{"name":"Hero","__proto__":{"polluted":true},"sub":{"constructor":"evil","val":123}}');
            const clean = sanitizePrototype(dirty);
            expect(clean.name).toBe('Hero');
            expect(clean.sub.val).toBe(123);
            expect(clean.__proto__).toBe(Object.prototype);
            expect(clean.sub.constructor).toBe(Object);
            expect({}.polluted).toBeUndefined();
        });

        it('preserves Uint8Array and Buffer untouched', () => {
            const buf = Buffer.from('hello');
            const clean = sanitizePrototype(buf);
            expect(Buffer.isBuffer(clean)).toBe(true);
        });
    });

    describe('RFC 8785 Canonical JSON & Hashing', () => {
        it('stringifies object keys deterministically in lexicographical order', () => {
            const objA = { z: 1, a: 2, m: { b: 3, a: 4 } };
            const objB = { a: 2, z: 1, m: { a: 4, b: 3 } };

            const jsonA = canonicalJsonStringify(objA);
            const jsonB = canonicalJsonStringify(objB);

            expect(jsonA).toBe(jsonB);
            expect(jsonA).toBe('{"a":2,"m":{"a":4,"b":3},"z":1}');
            expect(hashObject(objA)).toBe(hashObject(objB));
        });

        it('computes consistent hashes for string, buffer, and object', () => {
            const str = 'Test String';
            const hStr = hashString(str);
            const hBuf = hashBuffer(Buffer.from(str, 'utf8'));
            expect(hStr).toBe(hBuf);
            expect(hStr).toHaveLength(64);
        });
    });

    describe('computePreviewStateHash Across 10 Tables', () => {
        it('computes deterministic state hash over all authored entities and changes when state changes', () => {
            const db = getDb();
            const world = createWorld({ name: 'Hash Test World', description: 'Testing state hash' });
            const initialHash = computePreviewStateHash(db, world.lws_id);
            expect(initialHash).toHaveLength(64);

            // Adding a character alters state hash
            const char = createCharacter(world.lws_id, { name: 'Alice' });
            const hashAfterChar = computePreviewStateHash(db, world.lws_id);
            expect(hashAfterChar).not.toBe(initialHash);

            // Adding a location alters state hash
            const loc = createLocation(world.lws_id, { name: 'Castle' });
            const hashAfterLoc = computePreviewStateHash(db, world.lws_id);
            expect(hashAfterLoc).not.toBe(hashAfterChar);

            // Adding a faction alters state hash
            const faction = createFaction(world.lws_id, { name: 'Royal Guard' });
            const hashAfterFaction = computePreviewStateHash(db, world.lws_id);
            expect(hashAfterFaction).not.toBe(hashAfterLoc);

            // Adding join table membership alters state hash
            addFactionMember(world.lws_id, faction.lws_id, { character_lws_id: char.lws_id, role: 'Captain' });
            const hashAfterJoin = computePreviewStateHash(db, world.lws_id);
            expect(hashAfterJoin).not.toBe(hashAfterFaction);

            // Adding world rule alters state hash
            createWorldRule(world.lws_id, { sort_order: 1, title: 'Law 1', body: 'No stealing' });
            const hashAfterRule = computePreviewStateHash(db, world.lws_id);
            expect(hashAfterRule).not.toBe(hashAfterJoin);

            // Adding prompt config alters state hash
            createPromptConfig(world.lws_id, { style_notes: 'Gritty' });
            const hashAfterConfig = computePreviewStateHash(db, world.lws_id);
            expect(hashAfterConfig).not.toBe(hashAfterRule);

            // Adding scenario & scenario character alters state hash
            const scenario = createScenario(world.lws_id, { name: 'Siege', starting_location_lws_id: loc.lws_id });
            addScenarioCharacter(world.lws_id, scenario.lws_id, { character_lws_id: char.lws_id, role: 'Defender' });
            const hashAfterScenario = computePreviewStateHash(db, world.lws_id);
            expect(hashAfterScenario).not.toBe(hashAfterConfig);

            // Adding ambient archetype alters state hash
            createAmbientArchetype(db, world.lws_id, {
                archetype_key: 'castle_guard',
                entity_kind: 'person',
                role_title: 'Guard',
                name_pool: ['Bob'],
                description_template: 'A guard.',
            });
            const hashAfterArchetype = computePreviewStateHash(db, world.lws_id);
            expect(hashAfterArchetype).not.toBe(hashAfterScenario);
        });
    });

    describe('HMAC Preview Token Lifecycle', () => {
        it('generates a signed preview token and verifies valid token successfully', () => {
            const candidateHash = hashString('candidate-payload');
            const previewStateHash = hashString('current-state');
            const targetWorldLwsId = '550e8400-e29b-41d4-a716-446655440000';

            const token = generatePreviewToken({
                target_world_lws_id: targetWorldLwsId,
                candidate_hash: candidateHash,
                preview_state_hash: previewStateHash,
                conflict_policy: 'reject',
            });

            expect(typeof token).toBe('string');
            expect(token).toContain('.');

            const verified = verifyPreviewToken(token, {
                expected_world_lws_id: targetWorldLwsId,
                expected_candidate_hash: candidateHash,
                current_state_hash: previewStateHash,
            });

            expect(verified.valid).toBe(true);
            expect(verified.payload.target_world_lws_id).toBe(targetWorldLwsId);
            expect(verified.payload.candidate_hash).toBe(candidateHash);
        });

        it('rejects tampered or malformed preview tokens', () => {
            const token = generatePreviewToken({
                candidate_hash: hashString('payload'),
                preview_state_hash: hashString('state'),
            });

            // Tamper with payload
            const [b64, sig] = token.split('.');
            const tamperedB64 = Buffer.from(JSON.stringify({ fake: true })).toString('base64url');
            const tamperedToken = `${tamperedB64}.${sig}`;

            const res = verifyPreviewToken(tamperedToken);
            expect(res.valid).toBe(false);
            expect(res.code).toBe('LWS_PREVIEW_TOKEN_MISMATCH');
        });

        it('rejects expired preview tokens', () => {
            const token = generatePreviewToken({
                candidate_hash: hashString('payload'),
                preview_state_hash: hashString('state'),
                ttlMs: -1000, // Expired in past
            });

            const res = verifyPreviewToken(token);
            expect(res.valid).toBe(false);
            expect(res.code).toBe('LWS_PREVIEW_TOKEN_EXPIRED');
        });

        it('detects TOCTOU stale preview when DB state has changed', () => {
            const oldStateHash = hashString('old-state');
            const newStateHash = hashString('new-state');

            const token = generatePreviewToken({
                candidate_hash: hashString('payload'),
                preview_state_hash: oldStateHash,
            });

            const res = verifyPreviewToken(token, {
                current_state_hash: newStateHash,
            });

            expect(res.valid).toBe(false);
            expect(res.code).toBe('LWS_STALE_PREVIEW');
        });
    });

    describe('createProvenance and appendMergeHistory', () => {
        it('creates a standard ADR-009/019 provenance object with immutable history', () => {
            const prov = createProvenance({
                source_format: 'sillytavern_card_v2',
                source_file_hash: 'abc123hash',
                source_filename: 'Hero.png',
                source_version: '2.0',
                field_mappings: { name: 'name', description: 'description' },
                unmapped_fields: { custom_voice: 'en-US' },
                warnings: ['UNMAPPED_FIELDS_PRESERVED'],
            });

            expect(prov.source_format).toBe('sillytavern_card_v2');
            expect(prov.source_file_hash).toBe('abc123hash');
            expect(prov.source_filename).toBe('Hero.png');
            expect(prov.field_mappings.name).toBe('name');
            expect(prov.unmapped_fields.custom_voice).toBe('en-US');
            expect(prov.warnings).toContain('UNMAPPED_FIELDS_PRESERVED');
            expect(prov.import_history).toHaveLength(1);
            expect(prov.import_history[0].action).toBe('create');

            // Append merge history
            const merged = appendMergeHistory(prov, {
                source_format: 'sillytavern_card_v3',
                source_hash: 'def456hash',
                updated_fields: ['description'],
                unmapped_fields: { secondary_voice: 'ja-JP' },
            });

            expect(merged.import_history).toHaveLength(2);
            expect(merged.import_history[1].action).toBe('merge');
            expect(merged.unmapped_fields.secondary_voice).toBe('ja-JP');
            expect(merged.unmapped_fields.custom_voice).toBe('en-US');
        });
    });

    describe('Format Detection', () => {
        it('detects PNG buffer format correctly', () => {
            const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
            expect(detectRawFormat(pngHeader)).toBe('png');
        });

        it('detects JSON strings and objects correctly', () => {
            expect(detectRawFormat('{"name": "test"}')).toBe('json');
            expect(detectRawFormat({ name: 'test' })).toBe('json');
        });

        it('detects YAML files by filename extension', () => {
            expect(detectRawFormat('spec: lws_world_manifest_v1', 'world.yaml')).toBe('yaml');
            expect(detectRawFormat('spec: lws_world_manifest_v1', 'world.yml')).toBe('yaml');
        });

        it('defaults plain text for unstructured content', () => {
            expect(detectRawFormat('Once upon a time in a distant kingdom...', 'story.txt')).toBe('text');
        });
    });
});
