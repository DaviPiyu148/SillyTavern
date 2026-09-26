import { describe, it, expect } from '@jest/globals';
import { normalizeWorldInfo, classifyLoreEntry } from '../../src/living-world/import/worldinfo-importer.js';
import { LwsValidationError } from '../../src/living-world/errors.js';

describe('LWS World Info / Lorebook Importer & Classifier', () => {
    describe('5D Classification Scoring & Promotion', () => {
        it('classifies physical laws as World Rules with high confidence', () => {
            const ruleEntry = {
                comment: 'Law of Gravity',
                keys: ['physics', 'gravity', 'mandatory'],
                content: 'Rule 1: All objects must fall towards the center of mass. Magic cannot violate this system rule.',
                constant: true,
                selective: false,
            };

            const classification = classifyLoreEntry(ruleEntry);
            expect(classification.topCategory).toBe('rule');
            expect(classification.maxScore).toBeGreaterThanOrEqual(0.80);
            expect(classification.isAmbiguous).toBe(false);
        });

        it('classifies cities/structures as Locations with high confidence', () => {
            const locEntry = {
                comment: 'Silverkeep Citadel',
                keys: ['castle', 'city', 'building'],
                content: 'Silverkeep Citadel is a massive stone castle located at the northern peak of the mountain district.',
            };

            const classification = classifyLoreEntry(locEntry);
            expect(classification.topCategory).toBe('location');
            expect(classification.maxScore).toBeGreaterThanOrEqual(0.80);
            expect(classification.isAmbiguous).toBe(false);
        });

        it('classifies military orders as Factions with high confidence', () => {
            const facEntry = {
                comment: 'The Iron Brotherhood',
                keys: ['guild', 'order', 'army', 'faction'],
                content: 'The Iron Brotherhood is a military order founded by Commander Valen, with headquarters in the capital.',
            };

            const classification = classifyLoreEntry(facEntry);
            expect(classification.topCategory).toBe('faction');
            expect(classification.maxScore).toBeGreaterThanOrEqual(0.80);
            expect(classification.isAmbiguous).toBe(false);
        });

        it('classifies generic populations as Ambient Archetypes with high confidence', () => {
            const archEntry = {
                comment: 'City Guards',
                keys: ['guards', 'patrons', 'ambient'],
                content: 'City guards patrol the streets day and night, checking credentials of travelers and citizens.',
            };

            const classification = classifyLoreEntry(archEntry);
            expect(classification.topCategory).toBe('archetype');
            expect(classification.maxScore).toBeGreaterThanOrEqual(0.80);
            expect(classification.isAmbiguous).toBe(false);
        });
    });

    describe('Ambiguity Detection and Lore Fallback', () => {
        it('flags multi-class entries as ambiguous when scores are close', () => {
            const ambiguousEntry = {
                comment: 'The Silver Guard',
                keys: ['order', 'guards'],
                content: 'The Silver Guard is an order of guards with high military standing.',
            };

            const classification = classifyLoreEntry(ambiguousEntry);
            expect(classification.isAmbiguous).toBe(true);
        });

        it('falls back to lore_entries for flavor narrative without converting to world rules', () => {
            const flavorEntry = {
                comment: 'The Legend of the Golden Sun',
                keys: ['mythology', 'legend', 'ancient times'],
                content: 'Long ago, before the ages of iron, gods walked across the starlit meadows and spoke in whispers.',
            };

            const classification = classifyLoreEntry(flavorEntry);
            expect(classification.topCategory).toBe('lore');
            expect(classification.maxScore).toBeLessThan(0.50);
        });
    });

    describe('normalizeWorldInfo Payload Processing', () => {
        it('normalizes a multi-entry lorebook into structured candidate buckets', () => {
            const lorebook = {
                name: 'Fantasy Realm Lore',
                entries: [
                    {
                        uid: 1,
                        comment: 'Magic Conservation Law',
                        keys: ['physics', 'magic', 'mandatory'],
                        content: 'Rule: Energy cannot be created or destroyed. System rule always active.',
                        constant: true,
                    },
                    {
                        uid: 2,
                        comment: 'Oakhaven Town',
                        keys: ['city', 'tavern', 'building'],
                        content: 'Oakhaven is a quiet forest town located south of the river.',
                    },
                    {
                        uid: 3,
                        comment: 'Merchant Syndicate',
                        keys: ['guild', 'syndicate', 'faction'],
                        content: 'A powerful guild of traders with headquarters in the capital.',
                    },
                    {
                        uid: 4,
                        comment: 'Ancient Folk Song',
                        keys: ['folklore', 'song'],
                        content: 'A popular ballad sung by travelers around campfires.',
                    },
                ],
            };

            const result = normalizeWorldInfo(lorebook, { filename: 'realm_lore.json' });

            expect(result.summary.total_entries).toBe(4);
            expect(result.candidate_entities.world_rules.length).toBeGreaterThanOrEqual(1);
            expect(result.candidate_entities.locations.length).toBeGreaterThanOrEqual(1);
            expect(result.candidate_entities.factions.length).toBeGreaterThanOrEqual(1);
            expect(result.candidate_entities.lore_entries.length).toBeGreaterThanOrEqual(1);
            expect(result.provenance.source_format).toBe('worldinfo_v1');
            expect(result.provenance.source_filename).toBe('realm_lore.json');
        });

        it('handles entries as an object map (SillyTavern dict format)', () => {
            const mapLorebook = {
                entries: {
                    '0': {
                        comment: 'Dragon Peak',
                        keys: ['mountain', 'castle', 'located at'],
                        content: 'A high mountain castle located at the northern peak.',
                    },
                },
            };

            const result = normalizeWorldInfo(mapLorebook);
            expect(result.summary.total_entries).toBe(1);
            expect(result.candidate_entities.locations.length).toBe(1);
            expect(result.candidate_entities.locations[0].name).toBe('Dragon Peak');
        });

        it('rejects lorebooks exceeding 1000 entries limit', () => {
            const hugeEntries = Array.from({ length: 1001 }, (_, i) => ({
                comment: `Entry ${i}`,
                content: `Lore content ${i}`,
            }));

            expect(() => {
                normalizeWorldInfo({ entries: hugeEntries });
            }).toThrow(LwsValidationError);
        });
    });
});
