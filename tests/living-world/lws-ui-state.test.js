import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { lwsState, DEFAULT_LWS_STATE, STORAGE_KEY_LAST_SIM } from '../../public/scripts/living-world/state.js';

describe('LWS UI State Store (lws-ui-state)', () => {
    let mockAccountStorage;

    beforeEach(() => {
        mockAccountStorage = {
            _data: {},
            getItem: jest.fn(key => mockAccountStorage._data[key] || null),
            setItem: jest.fn((key, val) => { mockAccountStorage._data[key] = String(val); }),
            removeItem: jest.fn(key => { delete mockAccountStorage._data[key]; }),
        };
        globalThis.accountStorage = mockAccountStorage;
        lwsState.reset();
    });

    it('initializes with default state values', () => {
        const state = lwsState.getState();
        expect(state.world_lws_id).toBeNull();
        expect(state.simulation_lws_id).toBeNull();
        expect(state.camera_mode).toBe('god_view');
        expect(state.active_tab).toBe('world');
        expect(state.is_generating).toBe(false);
        expect(state.turns).toEqual([]);
        expect(state.characters).toEqual([]);
    });

    it('updates state and notifies change listeners', () => {
        const globalListener = jest.fn();
        const tabListener = jest.fn();

        lwsState.on('change', globalListener);
        lwsState.on('change:active_tab', tabListener);

        lwsState.setState({ active_tab: 'narrative' });

        expect(globalListener).toHaveBeenCalledWith({ active_tab: 'narrative' }, expect.any(Object));
        expect(tabListener).toHaveBeenCalledWith('narrative', expect.any(Object));
        expect(lwsState.getState().active_tab).toBe('narrative');

        // Does not fire if value has not changed
        globalListener.mockClear();
        lwsState.setState({ active_tab: 'narrative' });
        expect(globalListener).not.toHaveBeenCalled();
    });

    it('unsubscribes listeners with off()', () => {
        const listener = jest.fn();
        lwsState.on('change:camera_mode', listener);
        lwsState.setState({ camera_mode: 'follow_character' });
        expect(listener).toHaveBeenCalledWith('follow_character', expect.any(Object));

        lwsState.off('change:camera_mode', listener);
        lwsState.setState({ camera_mode: 'observe_location' });
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('syncs simulation_lws_id with accountStorage', () => {
        const testSimId = '11111111-2222-3333-4444-555555555555';
        lwsState.setState({ simulation_lws_id: testSimId });

        expect(mockAccountStorage.setItem).toHaveBeenCalledWith(STORAGE_KEY_LAST_SIM, testSimId);
        expect(lwsState.getLastSimId()).toBe(testSimId);

        // Setting null removes it from storage
        lwsState.setState({ simulation_lws_id: null });
        expect(mockAccountStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY_LAST_SIM);
    });

    it('handles resetOn404() by clearing simulation state and removing storage key', () => {
        const testSimId = '22222222-3333-4444-5555-666666666666';
        lwsState.setState({
            simulation_lws_id: testSimId,
            simulation_name: 'Dead Sim',
            active_tab: 'narrative',
            turns: [{ turn_number: 1, text: 'Hello' }],
        });

        const reset404Listener = jest.fn();
        lwsState.on('reset:404', reset404Listener);

        lwsState.resetOn404();

        expect(reset404Listener).toHaveBeenCalled();
        expect(mockAccountStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY_LAST_SIM);

        const state = lwsState.getState();
        expect(state.simulation_lws_id).toBeNull();
        expect(state.simulation_name).toBe('');
        expect(state.turns).toEqual([]);
        expect(state.active_tab).toBe('world');
    });

    it('handles errors inside listeners gracefully without breaking store execution', () => {
        const badListener = jest.fn(() => {
            throw new Error('Listener failed');
        });
        const goodListener = jest.fn();

        lwsState.on('change', badListener);
        lwsState.on('change', goodListener);

        expect(() => {
            lwsState.setState({ is_generating: true });
        }).not.toThrow();

        expect(goodListener).toHaveBeenCalled();
        expect(lwsState.getState().is_generating).toBe(true);
    });
});
