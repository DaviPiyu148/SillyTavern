import extract from 'png-chunks-extract';
import PNGtext from 'png-chunk-text';
import { LwsValidationError } from '../errors.js';
import {
    normalizeUnicode,
    sanitizePrototype,
    hashBuffer,
    hashString,
    hashObject,
    createProvenance,
    detectRawFormat,
} from './common.js';

const KNOWN_V1_FIELDS = new Set([
    'name',
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
]);

const KNOWN_V2_V3_FIELDS = new Set([
    'name',
    'description',
    'personality',
    'scenario',
    'first_mes',
    'mes_example',
    'alternate_greetings',
    'post_history_instructions',
    'creator',
    'character_version',
    'creator_notes',
    'system_prompt',
    'tags',
    'nickname',
    'character_book',
    'assets',
    'creator_notes_multilingual',
    'source',
    'sources',
    'group_only_greetings',
    'creation_date',
    'modification_date',
    'extensions',
]);

/**
 * Extracts character JSON metadata from a PNG image buffer.
 * Supports both V3 (ccv3) and V2/V1 (chara) chunks with ccv3 taking precedence.
 *
 * @param {Buffer | Uint8Array} buffer
 * @returns {{
 *   rawJson: string,
 *   sourceFormat: 'ccv3' | 'chara',
 *   extractedPayloadHash: string,
 *   secondaryChunkHash: string | null
 * }}
 */
export function extractPngMetadata(buffer) {
    if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
        throw new LwsValidationError('PNG metadata extraction requires a Buffer or Uint8Array', ['buffer']);
    }

    let chunks;
    try {
        chunks = extract(new Uint8Array(buffer));
    } catch (err) {
        throw new LwsValidationError(`Corrupt PNG structure: ${err.message}`, ['buffer']);
    }

    const textChunks = chunks
        .filter(c => c.name === 'tEXt')
        .map(c => {
            try {
                return PNGtext.decode(c.data);
            } catch {
                return null;
            }
        })
        .filter(Boolean);

    if (textChunks.length === 0) {
        throw new LwsValidationError('PNG image does not contain any text metadata chunks', ['buffer']);
    }

    const ccv3Chunk = textChunks.find(c => c.keyword && c.keyword.toLowerCase() === 'ccv3');
    const charaChunk = textChunks.find(c => c.keyword && c.keyword.toLowerCase() === 'chara');

    if (!ccv3Chunk && !charaChunk) {
        throw new LwsValidationError('PNG image does not contain character card metadata (neither ccv3 nor chara chunk found)', ['buffer']);
    }

    let ccv3Payload = null;
    let ccv3Hash = null;
    if (ccv3Chunk && ccv3Chunk.text) {
        try {
            ccv3Payload = Buffer.from(ccv3Chunk.text, 'base64').toString('utf8');
            ccv3Hash = hashString(ccv3Payload);
        } catch {
            ccv3Payload = null;
        }
    }

    let charaPayload = null;
    let charaHash = null;
    if (charaChunk && charaChunk.text) {
        try {
            charaPayload = Buffer.from(charaChunk.text, 'base64').toString('utf8');
            charaHash = hashString(charaPayload);
        } catch {
            charaPayload = null;
        }
    }

    if (ccv3Payload) {
        return {
            rawJson: ccv3Payload,
            sourceFormat: 'ccv3',
            extractedPayloadHash: ccv3Hash,
            secondaryChunkHash: charaHash,
        };
    }

    if (charaPayload) {
        return {
            rawJson: charaPayload,
            sourceFormat: 'chara',
            extractedPayloadHash: charaHash,
            secondaryChunkHash: null,
        };
    }

    throw new LwsValidationError('Failed to decode character payload from PNG chunks', ['buffer']);
}

/**
 * Parses raw input (Buffer, String, or Object) into a standardized raw card structure.
 *
 * @param {Buffer | string | object} input
 * @param {object} [options]
 * @param {string} [options.filename]
 * @returns {{
 *   rawCard: object,
 *   sourceFormat: string,
 *   sourceFileHash: string | null,
 *   extractedPayloadHash: string | null,
 *   secondaryChunkHash: string | null,
 *   canonicalObjectHash: string
 * }}
 */
export function parseRawCardInput(input, options = {}) {
    if (!input) {
        throw new LwsValidationError('Card input is required', ['input']);
    }

    let rawCard = null;
    let sourceFormat = 'json';
    let sourceFileHash = null;
    let extractedPayloadHash = null;
    let secondaryChunkHash = null;

    if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
        sourceFileHash = hashBuffer(input);
        const detected = detectRawFormat(input, options.filename || '');

        if (detected === 'png') {
            const extracted = extractPngMetadata(input);
            sourceFormat = extracted.sourceFormat === 'ccv3' ? 'png_ccv3' : 'png_chara';
            extractedPayloadHash = extracted.extractedPayloadHash;
            secondaryChunkHash = extracted.secondaryChunkHash;
            try {
                rawCard = JSON.parse(extracted.rawJson);
            } catch (err) {
                throw new LwsValidationError(`Malformed JSON in PNG metadata: ${err.message}`, ['buffer']);
            }
        } else {
            try {
                const text = input.toString('utf8');
                rawCard = JSON.parse(text);
                extractedPayloadHash = hashString(text);
            } catch (err) {
                throw new LwsValidationError(`Malformed JSON card file: ${err.message}`, ['buffer']);
            }
        }
    } else if (typeof input === 'string') {
        extractedPayloadHash = hashString(input);
        try {
            rawCard = JSON.parse(input);
        } catch (err) {
            throw new LwsValidationError(`Malformed JSON card string: ${err.message}`, ['input']);
        }
    } else if (typeof input === 'object') {
        rawCard = input;
    } else {
        throw new LwsValidationError('Unsupported card input type', ['input']);
    }

    rawCard = sanitizePrototype(rawCard);
    const canonicalObjectHash = hashObject(rawCard);

    return {
        rawCard,
        sourceFormat,
        sourceFileHash,
        extractedPayloadHash,
        secondaryChunkHash,
        canonicalObjectHash,
    };
}

/**
 * Normalizes a SillyTavern Character Card (V1, V2, or V3) into canonical LWS authored character entity.
 *
 * @param {Buffer | string | object} input
 * @param {object} [options]
 * @param {string} [options.filename]
 * @returns {{
 *   character: object,
 *   embedded_lorebook: object | null,
 *   provenance: object,
 *   warnings: string[],
 *   spec_type: 'v1' | 'v2' | 'v3' | 'unknown' | 'future'
 * }}
 */
export function normalizeCharacterCard(input, options = {}) {
    const {
        rawCard,
        sourceFormat,
        sourceFileHash,
        extractedPayloadHash,
        secondaryChunkHash,
        canonicalObjectHash,
    } = parseRawCardInput(input, options);

    const warnings = [];
    let specType = 'v1';
    let data = rawCard;
    let rootSpec = rawCard.spec || rawCard.data?.spec || null;
    let specVersion = rawCard.spec_version || rawCard.data?.spec_version || null;

    const verNum = parseFloat(specVersion || (typeof rootSpec === 'string' ? rootSpec.replace('chara_card_v', '') : ''));

    if (verNum > 3.0 || (typeof rootSpec === 'string' && rootSpec.startsWith('chara_card_v') && verNum > 3.0)) {
        specType = 'future';
        warnings.push('FORWARD_COMPATIBLE_SPEC_VERSION');
        data = rawCard.data || rawCard;
    } else if (rootSpec === 'chara_card_v3' || specVersion === '3.0') {
        specType = 'v3';
        data = rawCard.data || rawCard;
    } else if (rootSpec === 'chara_card_v2' || specVersion === '2.0' || rawCard.data !== undefined) {
        specType = 'v2';
        data = rawCard.data || rawCard;
    } else if (!rawCard.name && !rawCard.data?.name) {
        throw new LwsValidationError('Character card must contain a valid name', ['name']);
    } else if (rawCard.spec || specVersion) {
        specType = 'unknown';
        warnings.push('UNKNOWN_SPEC_FORMAT');
        data = rawCard.data || rawCard;
    }

    // 1. Name validation (mandatory: 1 - 255 chars, NFC trimmed)
    const rawName = data.name;
    if (typeof rawName !== 'string' || rawName.trim().length === 0) {
        throw new LwsValidationError('Character card name is required and cannot be empty', ['name']);
    }
    const name = normalizeUnicode(rawName.trim()).slice(0, 255);

    // 2. Text fields normalization (max 65535 chars, NFC, default '')
    const description = normalizeUnicode(typeof data.description === 'string' ? data.description : '').slice(0, 65535);
    const personality = normalizeUnicode(typeof data.personality === 'string' ? data.personality : '').slice(0, 65535);
    const scenarioContext = normalizeUnicode(
        typeof data.scenario === 'string' ? data.scenario : (typeof data.scenario_context === 'string' ? data.scenario_context : '')
    ).slice(0, 65535);

    // First mes & Mes example handling
    const rawFirstMes = typeof data.first_mes === 'string' ? normalizeUnicode(data.first_mes) : '';
    let mesExample = normalizeUnicode(typeof data.mes_example === 'string' ? data.mes_example : '').slice(0, 65535);

    // If mes_example is empty and first_mes is present, first_mes serves as derived fallback
    if (!mesExample && rawFirstMes) {
        mesExample = `<START>\n<char>: ${rawFirstMes}`.slice(0, 65535);
    }

    const authorNotes = normalizeUnicode(
        typeof data.creator_notes === 'string' ? data.creator_notes : (typeof data.author_notes === 'string' ? data.author_notes : '')
    ).slice(0, 65535);

    const systemPromptOverride = normalizeUnicode(
        typeof data.system_prompt === 'string' ? data.system_prompt : (typeof data.system_prompt_override === 'string' ? data.system_prompt_override : '')
    ).slice(0, 65535);

    // 3. Source Version (Max 50 chars, preserve verbatim if present; never default to '1.0')
    let sourceVersion = '';
    if (typeof data.character_version === 'string' && data.character_version.trim().length > 0) {
        sourceVersion = normalizeUnicode(data.character_version.trim()).slice(0, 50);
    } else if (typeof data.source_version === 'string' && data.source_version.trim().length > 0) {
        sourceVersion = normalizeUnicode(data.source_version.trim()).slice(0, 50);
    }

    // 4. Tags (array of strings, default [])
    let tags = [];
    if (Array.isArray(data.tags)) {
        tags = data.tags.filter(t => typeof t === 'string' && t.trim().length > 0).map(t => normalizeUnicode(t.trim()).slice(0, 64));
    }

    // 5. Extensions & Vendor Preservations
    const extensions = sanitizePrototype(data.extensions || {});
    extensions.sillytavern_card = extensions.sillytavern_card || {};
    extensions.sillytavern_card.first_mes = rawFirstMes;
    if (rawFirstMes) {
        extensions.first_mes = rawFirstMes;
    }

    if (Array.isArray(data.alternate_greetings)) {
        extensions.alternate_greetings = data.alternate_greetings.filter(g => typeof g === 'string').map(g => normalizeUnicode(g));
    }
    if (typeof data.post_history_instructions === 'string' && data.post_history_instructions.length > 0) {
        extensions.post_history_instructions = normalizeUnicode(data.post_history_instructions);
    }
    if (typeof data.creator === 'string' && data.creator.length > 0) {
        extensions.creator = normalizeUnicode(data.creator);
    }
    if (typeof data.nickname === 'string' && data.nickname.length > 0) {
        extensions.nickname = normalizeUnicode(data.nickname);
    }
    if (data.assets !== undefined && data.assets !== null) {
        extensions.assets = sanitizePrototype(data.assets);
        warnings.push('ASSETS_PRESERVED_IN_EXTENSIONS');
    }
    if (data.creator_notes_multilingual && typeof data.creator_notes_multilingual === 'object') {
        extensions.creator_notes_multilingual = sanitizePrototype(data.creator_notes_multilingual);
    }
    if (data.source || data.sources) {
        const srcList = Array.isArray(data.sources) ? data.sources : (data.source ? [data.source] : []);
        extensions.sources = srcList.filter(s => typeof s === 'string').map(s => normalizeUnicode(s));
    }
    if (Array.isArray(data.group_only_greetings)) {
        extensions.group_only_greetings = data.group_only_greetings.filter(g => typeof g === 'string').map(g => normalizeUnicode(g));
    }

    // 6. Embedded Lorebook Extraction
    let embeddedLorebook = null;
    if (data.character_book && typeof data.character_book === 'object') {
        embeddedLorebook = sanitizePrototype(data.character_book);
        extensions.lorebook = embeddedLorebook;
    }

    // 7. Unmapped / Vendor Fields Capture
    const knownFields = (specType === 'v1') ? KNOWN_V1_FIELDS : KNOWN_V2_V3_FIELDS;
    const unmapped = {};
    for (const [key, val] of Object.entries(data)) {
        if (!knownFields.has(key)) {
            unmapped[key] = sanitizePrototype(val);
        }
    }
    if (Object.keys(unmapped).length > 0) {
        extensions.unmapped_fields = unmapped;
        warnings.push('UNMAPPED_FIELDS_PRESERVED');
    }

    // 8. Field Mappings Record
    const fieldMappings = {
        name: 'name',
        description: 'description',
        personality: 'personality',
        scenario: 'scenario_context',
        mes_example: 'mes_example',
        creator_notes: 'author_notes',
        system_prompt: 'system_prompt_override',
        character_version: 'source_version',
        tags: 'tags',
        first_mes: 'extensions.first_mes',
    };

    // 9. Provenance Assembly
    const provenance = createProvenance({
        source_format: `sillytavern_card_${specType}`,
        source_file_hash: sourceFileHash,
        source_filename: options.filename || null,
        source_version: sourceVersion || null,
        canonical_object_hash: canonicalObjectHash,
        extracted_payload_hash: extractedPayloadHash,
        secondary_chunk_hash: secondaryChunkHash,
        field_mappings: fieldMappings,
        unmapped_fields: unmapped,
        warnings,
    });

    if (data.creation_date !== undefined) {
        provenance.source_creation_date = data.creation_date;
    }
    if (data.modification_date !== undefined) {
        provenance.source_modification_date = data.modification_date;
    }

    extensions.provenance = provenance;

    const character = {
        name,
        description,
        personality,
        scenario_context: scenarioContext,
        mes_example: mesExample,
        author_notes: authorNotes,
        system_prompt_override: systemPromptOverride,
        source_version: sourceVersion,
        tags,
        extensions,
    };

    return {
        character,
        embedded_lorebook: embeddedLorebook,
        provenance,
        warnings,
        spec_type: specType,
    };
}
