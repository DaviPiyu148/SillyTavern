import { describe, it, expect } from '@jest/globals';
import { parseModelResponse } from '../../src/living-world/prompt/output-parser.js';
import { OUTPUT_CONTRACT_TYPES } from '../../src/living-world/prompt/common.js';

describe('Phase 10 - Model Output Parser & Proposal Extractor', () => {
    it('parses dual-block output with XML proposal tags', () => {
        const rawResponse = `
<lws_proposal>
{
  "event_type": "COMMUNICATE",
  "actor_character_id": "char-1",
  "target_character_id": "char-2",
  "location_id": "loc-1",
  "payload": {
    "channel": "whisper",
    "content": "Keep your head down."
  }
}
</lws_proposal>
Kaelen leaned in close, his voice dropping to a harsh whisper. "Keep your head down," he warned, glancing toward the shadowed doorway.`;

        const parsed = parseModelResponse(rawResponse, OUTPUT_CONTRACT_TYPES.DUAL_BLOCK);
        expect(parsed.has_proposals).toBe(true);
        expect(parsed.proposals).toHaveLength(1);
        expect(parsed.proposals[0].event_type).toBe('COMMUNICATE');
        expect(parsed.proposals[0].actor_character_id).toBe('char-1');
        expect(parsed.proposals[0].target_character_id).toBe('char-2');
        expect(parsed.proposals[0].location_id).toBe('loc-1');
        expect(parsed.proposals[0].payload.content).toBe('Keep your head down.');

        expect(parsed.narrative_prose).toContain('Kaelen leaned in close');
        expect(parsed.narrative_prose).not.toContain('<lws_proposal>');
        expect(parsed.narrative_prose).not.toContain('COMMUNICATE');
        expect(parsed.parsing_errors).toHaveLength(0);
    });

    it('parses markdown fenced json proposals', () => {
        const rawResponse = `
\`\`\`json
{
  "event_type": "TRAVEL_ARRIVE",
  "actor_character_id": "char-1",
  "location_id": "loc-market",
  "payload": {
    "speed": "walk"
  }
}
\`\`\`
She stepped onto the cobblestones of the grand market.`;

        const parsed = parseModelResponse(rawResponse, OUTPUT_CONTRACT_TYPES.DUAL_BLOCK);
        expect(parsed.has_proposals).toBe(true);
        expect(parsed.proposals[0].event_type).toBe('TRAVEL_ARRIVE');
        expect(parsed.narrative_prose).toBe('She stepped onto the cobblestones of the grand market.');
    });

    it('parses structured proposal mode raw JSON directly', () => {
        const rawResponse = JSON.stringify({
            event_type: 'OBSERVE',
            actor_character_id: 'char-1',
            location_id: 'loc-1',
            payload: { focus: 'stranger' },
        });

        const parsed = parseModelResponse(rawResponse, OUTPUT_CONTRACT_TYPES.STRUCTURED_PROPOSAL);
        expect(parsed.has_proposals).toBe(true);
        expect(parsed.proposals[0].event_type).toBe('OBSERVE');
        expect(parsed.proposals[0].payload.focus).toBe('stranger');
        expect(parsed.narrative_prose).toBe('');
    });

    it('handles pure narrative prose without proposals', () => {
        const rawResponse = 'The rain drummed steadily against the tavern window while the fire crackled softly in the hearth.';
        const parsed = parseModelResponse(rawResponse, OUTPUT_CONTRACT_TYPES.NARRATIVE_PROSE);

        expect(parsed.has_proposals).toBe(false);
        expect(parsed.proposals).toHaveLength(0);
        expect(parsed.narrative_prose).toBe(rawResponse);
        expect(parsed.parsing_errors).toHaveLength(0);
    });

    it('gracefully handles malformed JSON without throwing', () => {
        const rawResponse = `
<lws_proposal>
{
  "event_type": "COMMUNICATE",
  broken_syntax: unquoted
}
</lws_proposal>
He tried to speak, but the words failed him.`;

        const parsed = parseModelResponse(rawResponse, OUTPUT_CONTRACT_TYPES.DUAL_BLOCK);
        expect(parsed.has_proposals).toBe(false);
        expect(parsed.parsing_errors.length).toBeGreaterThan(0);
        expect(parsed.narrative_prose).toContain('He tried to speak');
    });
});
