import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
    parseAdvanceSeconds,
    createSlashCommandHandlers,
    registerLwsSlashCommands,
    COMMAND_DEFINITIONS,
} from '../../public/scripts/living-world/slash-commands.js';

describe('LWS Slash Commands (lws-ui-slash-commands)', () => {
    let mockApi;
    let mockState;
    let handlers;

    beforeEach(() => {
        let stateData = {
            simulation_lws_id: 'test-sim-id',
            active_tab: 'world',
            camera_mode: 'god_view',
            selected_char_lws_id: null,
            selected_loc_lws_id: null,
            is_generating: false,
        };

        mockState = {
            getState: jest.fn(() => ({ ...stateData })),
            setState: jest.fn(partial => { Object.assign(stateData, partial); }),
        };

        mockApi = {
            advanceTime: jest.fn().mockResolvedValue({ advanced_seconds: 3600 }),
            setSimulationCamera: jest.fn().mockResolvedValue({ mode: 'god_view' }),
            getCharacterCognition: jest.fn().mockResolvedValue({ needs: {} }),
            recordDirectorNote: jest.fn().mockResolvedValue({ id: 'evt-1' }),
            modifyNeed: jest.fn().mockResolvedValue({ ok: true }),
            injectBelief: jest.fn().mockResolvedValue({ ok: true }),
            injectGoal: jest.fn().mockResolvedValue({ ok: true }),
            promoteEntity: jest.fn().mockResolvedValue({ ok: true }),
            generateTurn: jest.fn().mockResolvedValue({ turn: { narrative_text: 'Turn text' } }),
        };

        handlers = createSlashCommandHandlers({ api: mockApi, state: mockState });
    });

    describe('Duration parsing', () => {
        it('parses duration strings accurately into seconds', () => {
            expect(parseAdvanceSeconds('3600')).toBe(3600);
            expect(parseAdvanceSeconds('1h')).toBe(3600);
            expect(parseAdvanceSeconds('2 hr')).toBe(7200);
            expect(parseAdvanceSeconds('15m')).toBe(900);
            expect(parseAdvanceSeconds('30 min')).toBe(1800);
            expect(parseAdvanceSeconds('1d')).toBe(86400);
            expect(parseAdvanceSeconds('45s')).toBe(45);
            expect(parseAdvanceSeconds('')).toBe(3600); // default
        });
    });

    describe('Command dispatching', () => {
        it('/lws switches the active workspace tab in state', async () => {
            const result = await handlers.handleLws({}, 'narrative');
            expect(result).toContain('narrative');
            expect(mockState.setState).toHaveBeenCalledWith({ active_tab: 'narrative' });
        });

        it('/lws-time dispatches advanceTime to dedicated route', async () => {
            const result = await handlers.handleTime({}, 'advance 1h');
            expect(result).toContain('3600 seconds');
            expect(mockApi.advanceTime).toHaveBeenCalledWith('test-sim-id', { advance_seconds: 3600 });
        });

        it('/lws-camera updates camera mode and state', async () => {
            // God view
            await handlers.handleCamera({}, 'god');
            expect(mockApi.setSimulationCamera).toHaveBeenCalledWith('test-sim-id', { mode: 'god_view' });
            expect(mockState.setState).toHaveBeenCalledWith(expect.objectContaining({ camera_mode: 'god_view' }));

            // Follow character
            await handlers.handleCamera({}, 'follow char-123');
            expect(mockApi.setSimulationCamera).toHaveBeenCalledWith('test-sim-id', {
                mode: 'follow_character',
                target_character_lws_id: 'char-123',
            });
            expect(mockState.setState).toHaveBeenCalledWith(expect.objectContaining({
                camera_mode: 'follow_character',
                selected_char_lws_id: 'char-123',
            }));
        });

        it('/lws-inspect loads cognition and switches to mind tab', async () => {
            const result = await handlers.handleInspect({}, 'char-456');
            expect(result).toContain('char-456');
            expect(mockApi.getCharacterCognition).toHaveBeenCalledWith('test-sim-id', 'char-456');
            expect(mockState.setState).toHaveBeenCalledWith({
                active_tab: 'mind',
                selected_char_lws_id: 'char-456',
            });
        });

        it('/lws-director dispatches dedicated interventions', async () => {
            // Note
            await handlers.handleDirector({}, 'note A storm brews');
            expect(mockApi.recordDirectorNote).toHaveBeenCalledWith('test-sim-id', 'A storm brews');

            // Need override
            await handlers.handleDirector({}, 'need char-1 energy 85');
            expect(mockApi.modifyNeed).toHaveBeenCalledWith('test-sim-id', 'char-1', 'energy', 85);

            // Belief injection
            await handlers.handleDirector({}, 'belief char-1 secret_door The door is hidden');
            expect(mockApi.injectBelief).toHaveBeenCalledWith('test-sim-id', 'char-1', 'secret_door', 'The door is hidden');

            // Goal injection
            await handlers.handleDirector({}, 'goal char-1 Find the lost key');
            expect(mockApi.injectGoal).toHaveBeenCalledWith('test-sim-id', 'char-1', expect.objectContaining({
                title: 'Find the lost key',
            }));

            // Entity promotion
            await handlers.handleDirector({}, 'promote transient-99 CORE');
            expect(mockApi.promoteEntity).toHaveBeenCalledWith('test-sim-id', {
                transient_id: 'transient-99',
                target_tier: 'CORE',
            });
        });

        it('/lws-generate toggles is_generating state during turn dispatch', async () => {
            const result = await handlers.handleGenerate({}, 'Continue story');
            expect(result).toContain('Turn generated');
            expect(mockApi.generateTurn).toHaveBeenCalledWith('test-sim-id', {
                generation_mode: 'CONTINUE',
                user_prompt: 'Continue story',
            });

            expect(mockState.setState).toHaveBeenCalledWith({ is_generating: true });
            expect(mockState.setState).toHaveBeenCalledWith({ is_generating: false });
        });

        it('rejects commands when no simulation is selected', async () => {
            mockState.getState.mockReturnValue({ simulation_lws_id: null });
            await expect(handlers.handleTime({}, 'advance 1h')).rejects.toThrow('No active Living World simulation');
            await expect(handlers.handleCamera({}, 'god')).rejects.toThrow('No active Living World simulation');
            await expect(handlers.handleDirector({}, 'note Test')).rejects.toThrow('No active Living World simulation');
            await expect(handlers.handleGenerate({}, 'Hello')).rejects.toThrow('No active Living World simulation');
        });
    });

    describe('Registration with SlashCommandParser', () => {
        it('registers all 7 defined slash commands', () => {
            const registeredCommands = [];
            const mockParser = {
                addCommandObject: jest.fn(cmd => { registeredCommands.push(cmd); }),
            };

            const success = registerLwsSlashCommands({
                parser: mockParser,
                api: mockApi,
                state: mockState,
            });

            expect(success).toBe(true);
            expect(registeredCommands).toHaveLength(7);
            const names = registeredCommands.map(c => c.name);
            expect(names).toEqual(['lws', 'lws-time', 'lws-time-set', 'lws-camera', 'lws-inspect', 'lws-director', 'lws-generate']);
        });
    });
});
