import { describe, it, expect } from '@jest/globals';
import { parseFreeformOutline } from '../../src/living-world/import/freeform-importer.js';
import {
    buildAiNormalizationPrompt,
    parseAiNormalizedResponse,
    extractWithAi,
} from '../../src/living-world/import/ai-normalizer.js';
import { LwsValidationError } from '../../src/living-world/errors.js';

describe('LWS Freeform Importer & AI-Assisted Normalizer', () => {
    describe('Freeform Markdown Outline Parser', () => {
        it('extracts world, characters, locations, factions, and rules from markdown outline', () => {
            const markdown = `
# World: Aethelgard
A high fantasy realm divided by towering mountain ranges.

## Characters
- Cedric: A young blacksmith seeking vengeance.
- Rowan: An elven druid protecting the sacred groves.

## Locations
- Sunspire: The grand capital of the high empire.
- Darkwood: A dangerous ancient forest full of beasts.

## Factions
- The Silver Order: Holy knights guarding the realm.

## Rules
- Magic Law: Magic cannot resurrect the truly dead.
`;

            const result = parseFreeformOutline(markdown, { filename: 'aethelgard.md' });

            expect(result.candidate_entities.world.name).toBe('Aethelgard');
            expect(result.candidate_entities.characters).toHaveLength(2);
            expect(result.candidate_entities.characters[0].name).toBe('Cedric');
            expect(result.candidate_entities.characters[0].description).toBe('A young blacksmith seeking vengeance.');
            expect(result.candidate_entities.locations).toHaveLength(2);
            expect(result.candidate_entities.locations[0].name).toBe('Sunspire');
            expect(result.candidate_entities.factions).toHaveLength(1);
            expect(result.candidate_entities.factions[0].name).toBe('The Silver Order');
            expect(result.candidate_entities.world_rules).toHaveLength(1);
            expect(result.candidate_entities.world_rules[0].title).toBe('Magic Law');
            expect(result.provenance.source_format).toBe('freeform');
        });

        it('throws LwsValidationError if text is empty or whitespace only', () => {
            expect(() => {
                parseFreeformOutline('   ');
            }).toThrow(LwsValidationError);
        });
    });

    describe('AI Normalization Prompt & Sandboxing', () => {
        it('builds a prompt containing strict no-invention invariants', () => {
            const prompt = buildAiNormalizationPrompt('Some world description.');
            expect(prompt).toContain('DO NOT invent unmentioned locations');
            expect(prompt).toContain('Some world description.');
        });

        it('parses valid AI JSON response and enforces negative no-invention contract', () => {
            const sourceText = 'Cedric the blacksmith lives in Sunspire.';
            const aiResponse = JSON.stringify({
                world: { name: 'Aethelgard', description: 'Realm' },
                characters: [
                    { name: 'Cedric', description: 'A blacksmith' },
                    { name: 'Invented Guy', description: 'Never mentioned in source' },
                ],
                locations: [
                    { name: 'Sunspire', description: 'A city' },
                ],
            });

            const result = parseAiNormalizedResponse(aiResponse, sourceText);

            expect(result.candidate_entities.characters).toHaveLength(2);
            expect(result.candidate_entities.characters[0].name).toBe('Cedric');
            expect(result.candidate_entities.locations[0].name).toBe('Sunspire');

            // Invented character is flagged in inferred_fields
            expect(result.provenance.inferred_fields).toContain('character:Invented Guy');
            expect(result.warnings.some(w => w.includes('Invented Guy'))).toBe(true);
        });

        it('falls back to heuristic chunker when AI response is malformed JSON', () => {
            const sourceText = '# Characters\n- Arthur: King of Camelot';
            const badAiResponse = 'Here is the JSON: { invalid json...';

            const result = parseAiNormalizedResponse(badAiResponse, sourceText);

            expect(result.candidate_entities.characters.length).toBeGreaterThanOrEqual(1);
            expect(result.candidate_entities.characters[0].name).toBe('Arthur');
            expect(result.warnings.some(w => w.includes('AI JSON parse failed'))).toBe(true);
        });
    });

    describe('extractWithAi End-to-End Bridge', () => {
        it('uses mock LLM caller to produce structured candidates', async () => {
            const sourceText = 'Valoria is ruled by Queen Karen in the Golden Palace.';
            const mockLlm = async () => JSON.stringify({
                world: { name: 'Valoria', description: 'Fantasy kingdom' },
                characters: [{ name: 'Queen Karen', description: 'The monarch' }],
                locations: [{ name: 'Golden Palace', description: 'The royal seat' }],
            });

            const result = await extractWithAi(sourceText, mockLlm);

            expect(result.candidate_entities.world.name).toBe('Valoria');
            expect(result.candidate_entities.characters[0].name).toBe('Queen Karen');
            expect(result.candidate_entities.locations[0].name).toBe('Golden Palace');
        });

        it('handles LLM error by falling back gracefully to heuristic text parser', async () => {
            const sourceText = '# Factions\n- Shadow Clan: Secret assassins';
            const failingLlm = async () => {
                throw new Error('LLM connection error');
            };

            const result = await extractWithAi(sourceText, failingLlm);

            expect(result.candidate_entities.factions.length).toBe(1);
            expect(result.candidate_entities.factions[0].name).toBe('Shadow Clan');
            expect(result.warnings.some(w => w.includes('LLM connection error'))).toBe(true);
        });
    });
});
