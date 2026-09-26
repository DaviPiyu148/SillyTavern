/**
 * Living World Simulator (LWS) - Native Slash Commands
 * Registers /lws, /lws-time, /lws-time-set, /lws-camera, /lws-inspect, /lws-director, /lws-generate
 * Enforces dedicated domain routes and rejects arbitrary state mutations.
 */

import { lwsState } from './state.js';
import { lwsApi } from './api.js';

export const COMMAND_DEFINITIONS = [
    {
        name: 'lws',
        aliases: ['living-world'],
        helpString: 'Open LWS workspace or switch view tab. Usage: /lws [world|narrative|mind|roster|director]',
    },
    {
        name: 'lws-time',
        aliases: ['lws-advance'],
        helpString: 'Advance simulation fictional time. Usage: /lws-time advance [seconds]',
    },
    {
        name: 'lws-time-set',
        aliases: [],
        helpString: 'Set fictional clock to specific ISO timestamp. Usage: /lws-time-set [iso_timestamp]',
    },
    {
        name: 'lws-camera',
        aliases: ['lws-cam'],
        helpString: 'Switch simulation camera focus. Usage: /lws-camera [god|follow <charId>|observe <locId>]',
    },
    {
        name: 'lws-inspect',
        aliases: ['lws-mind'],
        helpString: 'Open mind inspector for character. Usage: /lws-inspect [charId]',
    },
    {
        name: 'lws-director',
        aliases: [],
        helpString: 'Execute authoritative director intervention. Usage: /lws-director [note|need|belief|goal|social|env|promote] ...',
    },
    {
        name: 'lws-generate',
        aliases: ['lws-turn'],
        helpString: 'Trigger narrative turn generation with prompt. Usage: /lws-generate [prompt]',
    },
];

/**
 * Parses time advance string into seconds (e.g. "3600", "1h", "30m", "1d").
 * @param {string} str
 * @returns {number}
 */
export function parseAdvanceSeconds(str) {
    if (!str) return 3600;
    const trimmed = String(str).trim().toLowerCase();
    if (/^\d+$/.test(trimmed)) {
        return parseInt(trimmed, 10);
    }
    const match = trimmed.match(/^(\d+)\s*(s|sec|m|min|h|hr|d|day)$/);
    if (!match) {
        const parsed = parseInt(trimmed, 10);
        return isNaN(parsed) ? 3600 : parsed;
    }
    const val = parseInt(match[1], 10);
    const unit = match[2];
    switch (unit) {
        case 's':
        case 'sec': return val;
        case 'm':
        case 'min': return val * 60;
        case 'h':
        case 'hr': return val * 3600;
        case 'd':
        case 'day': return val * 86400;
        default: return val;
    }
}

/**
 * Creates command handlers wired to API client and State store.
 * @param {object} param0
 * @returns {object} Handlers map
 */
export function createSlashCommandHandlers({ api = lwsApi, state = lwsState } = {}) {
    return {
        async handleLws(args, value) {
            const tab = (value || args?.tab || 'world').trim().toLowerCase();
            state.setState({ active_tab: tab });
            return `LWS active tab switched to: ${tab}`;
        },

        async handleTime(args, value) {
            const simId = state.getState().simulation_lws_id;
            if (!simId) throw new Error('No active Living World simulation selected.');

            const parts = (value || '').trim().split(/\s+/);
            const subAction = parts[0]?.toLowerCase() || 'advance';
            const advanceArg = parts.slice(1).join(' ') || args?.seconds || '3600';

            if (subAction === 'advance') {
                const advanceSeconds = parseAdvanceSeconds(advanceArg);
                const res = await api.advanceTime(simId, { advance_seconds: advanceSeconds });
                return `Fictional time advanced by ${advanceSeconds} seconds.`;
            }
            throw new Error(`Unknown /lws-time action: ${subAction}. Use /lws-time advance [duration]`);
        },

        async handleTimeSet(args, value) {
            const simId = state.getState().simulation_lws_id;
            if (!simId) throw new Error('No active Living World simulation selected.');

            const targetTime = (value || args?.target || '').trim();
            if (!targetTime) throw new Error('Target timestamp required. Usage: /lws-time-set [iso_timestamp]');

            await api.advanceTime(simId, { target_fictional_time: targetTime });
            return `Fictional time set to: ${targetTime}`;
        },

        async handleCamera(args, value) {
            const simId = state.getState().simulation_lws_id;
            if (!simId) throw new Error('No active Living World simulation selected.');

            const parts = (value || '').trim().split(/\s+/);
            const mode = parts[0]?.toLowerCase() || 'god';

            if (mode === 'god' || mode === 'god_view') {
                await api.setSimulationCamera(simId, { mode: 'god_view' });
                state.setState({ camera_mode: 'god_view', selected_char_lws_id: null, selected_loc_lws_id: null });
                return 'Camera set to God View (Observer ground truth)';
            } else if (mode === 'follow' || mode === 'follow_character') {
                const charId = parts[1] || args?.charId;
                if (!charId) throw new Error('Character ID required for follow mode. Usage: /lws-camera follow [charId]');
                await api.setSimulationCamera(simId, { mode: 'follow_character', target_character_lws_id: charId });
                state.setState({ camera_mode: 'follow_character', selected_char_lws_id: charId });
                return `Camera following character: ${charId}`;
            } else if (mode === 'observe' || mode === 'observe_location') {
                const locId = parts[1] || args?.locId;
                if (!locId) throw new Error('Location ID required for observe mode. Usage: /lws-camera observe [locId]');
                await api.setSimulationCamera(simId, { mode: 'observe_location', target_location_lws_id: locId });
                state.setState({ camera_mode: 'observe_location', selected_loc_lws_id: locId });
                return `Camera observing location: ${locId}`;
            }
            throw new Error(`Unknown camera mode: ${mode}. Use god, follow, or observe.`);
        },

        async handleInspect(args, value) {
            const simId = state.getState().simulation_lws_id;
            if (!simId) throw new Error('No active Living World simulation selected.');

            const charId = (value || args?.charId || state.getState().selected_char_lws_id || '').trim();
            if (!charId) throw new Error('Character ID required for inspection.');

            const cognition = await api.getCharacterCognition(simId, charId);
            state.setState({
                active_tab: 'mind',
                selected_char_lws_id: charId,
            });
            return `Mind Inspector loaded for character: ${charId}`;
        },

        async handleDirector(args, value) {
            const simId = state.getState().simulation_lws_id;
            if (!simId) throw new Error('No active Living World simulation selected.');

            const parts = (value || '').trim().split(/\s+/);
            const action = parts[0]?.toLowerCase();

            switch (action) {
                case 'note': {
                    const text = parts.slice(1).join(' ');
                    if (!text) throw new Error('Note text required.');
                    await api.recordDirectorNote(simId, text);
                    return 'Director narrative event note injected.';
                }
                case 'need': {
                    const charId = parts[1];
                    const needName = parts[2];
                    const val = parseInt(parts[3], 10);
                    if (!charId || !needName || isNaN(val)) throw new Error('Usage: /lws-director need [charId] [needName] [val]');
                    await api.modifyNeed(simId, charId, needName, val);
                    return `Director override: need ${needName} for character ${charId} set to ${val}.`;
                }
                case 'belief': {
                    const charId = parts[1];
                    const key = parts[2];
                    const text = parts.slice(3).join(' ');
                    if (!charId || !key || !text) throw new Error('Usage: /lws-director belief [charId] [subjectKey] [statement]');
                    await api.injectBelief(simId, charId, key, text);
                    return `Director injected belief [${key}] into character ${charId}.`;
                }
                case 'goal': {
                    const charId = parts[1];
                    const title = parts.slice(2).join(' ');
                    if (!charId || !title) throw new Error('Usage: /lws-director goal [charId] [title]');
                    await api.injectGoal(simId, charId, { title, priority: 80, category: 'ACUTE' });
                    return `Director injected goal "${title}" into character ${charId}.`;
                }
                case 'promote': {
                    const transientId = parts[1];
                    const targetTier = (parts[2] || 'SUPPORTING').toUpperCase();
                    if (!transientId) throw new Error('Usage: /lws-director promote [transientId] [tier]');
                    await api.promoteEntity(simId, { transient_id: transientId, target_tier: targetTier });
                    return `Entity ${transientId} promoted to ${targetTier}.`;
                }
                default:
                    throw new Error(`Unknown director action: ${action}. Use note, need, belief, goal, or promote.`);
            }
        },

        async handleGenerate(args, value) {
            const simId = state.getState().simulation_lws_id;
            if (!simId) throw new Error('No active Living World simulation selected.');

            const prompt = (value || args?.prompt || '').trim();
            state.setState({ is_generating: true });
            try {
                const res = await api.generateTurn(simId, {
                    generation_mode: 'CONTINUE',
                    user_prompt: prompt,
                });
                return `Turn generated successfully: ${res?.turn?.narrative_text?.slice(0, 80) || 'Done'}...`;
            } finally {
                state.setState({ is_generating: false });
            }
        },
    };
}

/**
 * Registers all LWS slash commands with SillyTavern's SlashCommandParser.
 * @param {object} options
 */
export function registerLwsSlashCommands({ parser = globalThis.SlashCommandParser, api = lwsApi, state = lwsState } = {}) {
    if (!parser || typeof parser.addCommandObject !== 'function') {
        return false;
    }

    const handlers = createSlashCommandHandlers({ api, state });

    const commandMappings = [
        { name: 'lws', handler: handlers.handleLws },
        { name: 'lws-time', handler: handlers.handleTime },
        { name: 'lws-time-set', handler: handlers.handleTimeSet },
        { name: 'lws-camera', handler: handlers.handleCamera },
        { name: 'lws-inspect', handler: handlers.handleInspect },
        { name: 'lws-director', handler: handlers.handleDirector },
        { name: 'lws-generate', handler: handlers.handleGenerate },
    ];

    for (const mapping of commandMappings) {
        const def = COMMAND_DEFINITIONS.find(d => d.name === mapping.name);
        try {
            // Attempt SlashCommand.fromProps if class available, else plain command object
            const cmdObj = typeof globalThis.SlashCommand?.fromProps === 'function'
                ? globalThis.SlashCommand.fromProps({
                    name: def.name,
                    aliases: def.aliases,
                    helpString: def.helpString,
                    callback: (args, val) => mapping.handler(args, val),
                })
                : {
                    name: def.name,
                    aliases: def.aliases,
                    helpString: def.helpString,
                    callback: (args, val) => mapping.handler(args, val),
                };

            parser.addCommandObject(cmdObj);
        } catch (err) {
            console.warn(`[LWS SlashCommands] Failed to register command ${mapping.name}:`, err);
        }
    }

    return true;
}
