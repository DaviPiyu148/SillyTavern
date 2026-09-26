import { describe, it, expect } from '@jest/globals';
import { normalizeCharacterCard, extractPngMetadata } from '../../src/living-world/import/card-importer.js';
import { LwsValidationError } from '../../src/living-world/errors.js';
import { write as writePngCard } from '../../src/character-card-parser.js';

// Minimal 1x1 valid PNG image buffer
const MINIMAL_PNG_BUFFER = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
);

describe('LWS Character Card Importer & Normalizer', () => {
    describe('V1 Card Import (Flat Root)', () => {
        it('normalizes V1 flat root card into canonical authored character', () => {
            const v1Card = {
                name: 'Elena the Mage',
                description: 'A quiet scholar from the high towers.',
                personality: 'Introverted, analytical, kind.',
                scenario: 'Studying ancient ruins in the library.',
                first_mes: 'Greetings, traveler. Are you seeking knowledge?',
                mes_example: '<START>\n<char>: What can I help you research today?',
            };

            const result = normalizeCharacterCard(v1Card, { filename: 'Elena.json' });

            expect(result.spec_type).toBe('v1');
            expect(result.character.name).toBe('Elena the Mage');
            expect(result.character.description).toBe('A quiet scholar from the high towers.');
            expect(result.character.personality).toBe('Introverted, analytical, kind.');
            expect(result.character.scenario_context).toBe('Studying ancient ruins in the library.');
            expect(result.character.mes_example).toBe('<START>\n<char>: What can I help you research today?');
            expect(result.character.extensions.first_mes).toBe('Greetings, traveler. Are you seeking knowledge?');
            expect(result.character.source_version).toBe('');
            expect(result.character.author_notes).toBe('');
            expect(result.character.tags).toEqual([]);
            expect(result.provenance.source_format).toBe('sillytavern_card_v1');
            expect(result.provenance.source_filename).toBe('Elena.json');
        });
    });

    describe('V2 Card Import (data.* container)', () => {
        it('normalizes V2 card with full metadata, creator notes, system prompt, tags, and version', () => {
            const v2Card = {
                spec: 'chara_card_v2',
                spec_version: '2.0',
                data: {
                    name: 'Captain Vance',
                    description: 'Commander of the Silver Guard.',
                    personality: 'Dutiful, stern, protective.',
                    scenario: 'Standing watch at the citadel gate.',
                    first_mes: 'Halt! State your business in the capital.',
                    mes_example: '<START>\n<char>: Step forward and show your pass.',
                    creator: 'AuthorX',
                    character_version: '2.4.1',
                    creator_notes: 'Designed for high fantasy combat simulations.',
                    system_prompt: 'You are Captain Vance. Speak with formal military brevity.',
                    tags: ['guard', 'military', 'warrior'],
                    alternate_greetings: ['Who goes there?', 'Move along, citizen.'],
                    post_history_instructions: 'Always refer to the High Command.',
                    extensions: {
                        depth_prompt: { depth: 4, prompt: 'Focus on duty.' },
                    },
                },
            };

            const result = normalizeCharacterCard(v2Card);

            expect(result.spec_type).toBe('v2');
            expect(result.character.name).toBe('Captain Vance');
            expect(result.character.source_version).toBe('2.4.1');
            expect(result.character.author_notes).toBe('Designed for high fantasy combat simulations.');
            expect(result.character.system_prompt_override).toBe('You are Captain Vance. Speak with formal military brevity.');
            expect(result.character.tags).toEqual(['guard', 'military', 'warrior']);
            expect(result.character.extensions.alternate_greetings).toEqual(['Who goes there?', 'Move along, citizen.']);
            expect(result.character.extensions.post_history_instructions).toBe('Always refer to the High Command.');
            expect(result.character.extensions.creator).toBe('AuthorX');
            expect(result.character.extensions.depth_prompt.depth).toBe(4);
            expect(result.provenance.source_format).toBe('sillytavern_card_v2');
        });
    });

    describe('V3 Card Import (CCv3 spec)', () => {
        it('normalizes V3 card with assets, nickname, and embedded lorebook', () => {
            const v3Card = {
                spec: 'chara_card_v3',
                spec_version: '3.0',
                data: {
                    name: 'Lady Seraphina',
                    nickname: 'The White Falcon',
                    description: 'Noble diplomat of House Aurelius.',
                    personality: 'Cunning, polite, ruthless behind smiles.',
                    scenario: 'Attending a grand royal banquet.',
                    first_mes: 'Welcome to the gala, my dear guest.',
                    tags: ['nobility', 'intrigue'],
                    assets: [{ type: 'icon', uri: 'asset://falcon_crest.png' }],
                    character_book: {
                        name: 'House Aurelius Lore',
                        entries: [
                            { keys: ['Aurelius'], content: 'An ancient noble house founded in 410.' },
                        ],
                    },
                    custom_vendor_flag: 'vendor_value_123',
                },
            };

            const result = normalizeCharacterCard(v3Card);

            expect(result.spec_type).toBe('v3');
            expect(result.character.name).toBe('Lady Seraphina');
            expect(result.character.extensions.nickname).toBe('The White Falcon');
            expect(result.character.extensions.assets).toEqual([{ type: 'icon', uri: 'asset://falcon_crest.png' }]);
            expect(result.embedded_lorebook.name).toBe('House Aurelius Lore');
            expect(result.character.extensions.unmapped_fields.custom_vendor_flag).toBe('vendor_value_123');
            expect(result.warnings).toContain('ASSETS_PRESERVED_IN_EXTENSIONS');
            expect(result.warnings).toContain('UNMAPPED_FIELDS_PRESERVED');
        });
    });

    describe('Zero Hallucination & Derived Fallbacks', () => {
        it('preserves omitted optional fields as empty and never invents default version or notes', () => {
            const bareCard = {
                name: 'Nameless Wanderer',
            };

            const result = normalizeCharacterCard(bareCard);

            expect(result.character.name).toBe('Nameless Wanderer');
            expect(result.character.description).toBe('');
            expect(result.character.personality).toBe('');
            expect(result.character.scenario_context).toBe('');
            expect(result.character.mes_example).toBe('');
            expect(result.character.author_notes).toBe('');
            expect(result.character.system_prompt_override).toBe('');
            expect(result.character.source_version).toBe('');
            expect(result.character.tags).toEqual([]);
        });

        it('derives mes_example from first_mes when mes_example is empty in source', () => {
            const cardWithFirstMesOnly = {
                name: 'Bob',
                first_mes: 'Hello there!',
                mes_example: '',
            };

            const result = normalizeCharacterCard(cardWithFirstMesOnly);

            expect(result.character.mes_example).toBe('<START>\n<char>: Hello there!');
            expect(result.character.extensions.first_mes).toBe('Hello there!');
        });

        it('preserves existing mes_example untouched when already provided', () => {
            const cardWithBoth = {
                name: 'Bob',
                first_mes: 'Hello there!',
                mes_example: '<START>\n<char>: Custom dialogue example.',
            };

            const result = normalizeCharacterCard(cardWithBoth);

            expect(result.character.mes_example).toBe('<START>\n<char>: Custom dialogue example.');
        });
    });

    describe('PNG Metadata Chunk Extraction & Precedence', () => {
        it('extracts metadata from PNG buffer written with SillyTavern card writer', () => {
            const cardData = {
                name: 'PNG Hero',
                description: 'Hero encoded in PNG chunk',
                first_mes: 'I live in an image!',
            };

            const pngWithCard = writePngCard(MINIMAL_PNG_BUFFER, JSON.stringify(cardData));
            expect(Buffer.isBuffer(pngWithCard)).toBe(true);

            const result = normalizeCharacterCard(pngWithCard, { filename: 'hero.png' });

            expect(result.character.name).toBe('PNG Hero');
            expect(result.character.description).toBe('Hero encoded in PNG chunk');
            expect(result.provenance.source_file_hash).toHaveLength(64);
            expect(result.provenance.extracted_payload_hash).toHaveLength(64);
        });

        it('throws LwsValidationError when PNG contains no character metadata', () => {
            expect(() => {
                normalizeCharacterCard(MINIMAL_PNG_BUFFER);
            }).toThrow(LwsValidationError);
        });
    });

    describe('Validation and Spec Edge Cases', () => {
        it('throws LwsValidationError if name is missing or whitespace only', () => {
            expect(() => {
                normalizeCharacterCard({ description: 'No name' });
            }).toThrow(LwsValidationError);

            expect(() => {
                normalizeCharacterCard({ name: '   ' });
            }).toThrow(LwsValidationError);
        });

        it('emits FORWARD_COMPATIBLE_SPEC_VERSION warning for future spec version (e.g. 4.0)', () => {
            const futureCard = {
                spec: 'chara_card_v4',
                spec_version: '4.0',
                data: {
                    name: 'Future Bot',
                    quantum_state: 'superpositioned',
                },
            };

            const result = normalizeCharacterCard(futureCard);

            expect(result.spec_type).toBe('future');
            expect(result.character.name).toBe('Future Bot');
            expect(result.warnings).toContain('FORWARD_COMPATIBLE_SPEC_VERSION');
            expect(result.character.extensions.unmapped_fields.quantum_state).toBe('superpositioned');
        });
    });
});
