/**
 * Living World Simulator (LWS) - Reactive UI State Store
 * Manages transient client-side UI session state and local preferences.
 * Authoritative simulation state resides strictly in SQLite.
 */

export const DEFAULT_LWS_STATE = Object.freeze({
    world_lws_id: null,
    simulation_lws_id: null,
    camera_mode: 'god_view',
    selected_char_lws_id: null,
    selected_loc_lws_id: null,
    is_generating: false,
    active_tab: 'world',
    current_fictional_time: null,
    simulation_name: '',
    world_name: '',
    turns: [],
    characters: [],
    locations: [],
    needs: {},
    beliefs: {},
    goals: {},
    perspective: null,
    observer_perspective: null,
});

export const STORAGE_KEY_LAST_SIM = 'lws_last_sim_id';

class LwsStateStore {
    constructor() {
        this._state = { ...DEFAULT_LWS_STATE };
        this._listeners = new Map();
    }

    /**
     * Retrieves a copy of the current transient state.
     * @returns {object}
     */
    getState() {
        return { ...this._state };
    }

    /**
     * Subscribes a listener to state events.
     * @param {string} event
     * @param {Function} callback
     */
    on(event, callback) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(callback);
    }

    /**
     * Unsubscribes a listener from state events.
     * @param {string} event
     * @param {Function} callback
     */
    off(event, callback) {
        if (this._listeners.has(event)) {
            this._listeners.get(event).delete(callback);
        }
    }

    /**
     * Emits an event to registered listeners.
     * @param {string} event
     * @param {*} data
     */
    emit(event, data) {
        if (this._listeners.has(event)) {
            for (const cb of this._listeners.get(event)) {
                try {
                    cb(data, this._state);
                } catch (err) {
                    console.error(`[LWS State] Error in listener for event "${event}":`, err);
                }
            }
        }
    }

    /**
     * Updates state properties, notifies listeners, and optionally syncs accountStorage.
     * @param {object} partialState
     */
    setState(partialState = {}) {
        const changes = {};
        let hasChanged = false;

        for (const [key, value] of Object.entries(partialState)) {
            if (this._state[key] !== value) {
                this._state[key] = value;
                changes[key] = value;
                hasChanged = true;
                this.emit(`change:${key}`, value);
            }
        }

        if (hasChanged) {
            // Auto-sync simulation ID to accountStorage convenience cache
            if ('simulation_lws_id' in changes) {
                this._persistLastSimId(changes.simulation_lws_id);
            }
            this.emit('change', changes);
        }
    }

    /**
     * Resets state to default initial state.
     */
    reset() {
        this._state = { ...DEFAULT_LWS_STATE };
        this.emit('reset', this._state);
        this.emit('change', this._state);
    }

    /**
     * Handles HTTP 404 on simulation hydration:
     * Clears client simulation state, removes accountStorage key, and emits reset:404.
     */
    resetOn404() {
        this._removeLastSimId();
        this.setState({
            simulation_lws_id: null,
            simulation_name: '',
            turns: [],
            characters: [],
            perspective: null,
            observer_perspective: null,
            active_tab: 'world',
        });
        this.emit('reset:404');
    }

    /**
     * Reads last selected simulation ID from accountStorage (or localStorage fallback).
     * @returns {string|null}
     */
    getLastSimId() {
        try {
            if (typeof globalThis.accountStorage !== 'undefined' && typeof globalThis.accountStorage?.getItem === 'function') {
                return globalThis.accountStorage.getItem(STORAGE_KEY_LAST_SIM) || null;
            }
            if (typeof globalThis.localStorage !== 'undefined' && typeof globalThis.localStorage?.getItem === 'function') {
                return globalThis.localStorage.getItem(STORAGE_KEY_LAST_SIM) || null;
            }
        } catch (e) {
            console.warn('[LWS State] Failed to read accountStorage:', e);
        }
        return null;
    }

    /**
     * Persists last selected simulation ID to accountStorage (or localStorage fallback).
     * @param {string|null} simId
     * @private
     */
    _persistLastSimId(simId) {
        try {
            if (simId) {
                if (typeof globalThis.accountStorage !== 'undefined' && typeof globalThis.accountStorage?.setItem === 'function') {
                    globalThis.accountStorage.setItem(STORAGE_KEY_LAST_SIM, simId);
                } else if (typeof globalThis.localStorage !== 'undefined' && typeof globalThis.localStorage?.setItem === 'function') {
                    globalThis.localStorage.setItem(STORAGE_KEY_LAST_SIM, simId);
                }
            } else {
                this._removeLastSimId();
            }
        } catch (e) {
            console.warn('[LWS State] Failed to write accountStorage:', e);
        }
    }

    /**
     * Removes last simulation ID from storage.
     * @private
     */
    _removeLastSimId() {
        try {
            if (typeof globalThis.accountStorage !== 'undefined' && typeof globalThis.accountStorage?.removeItem === 'function') {
                globalThis.accountStorage.removeItem(STORAGE_KEY_LAST_SIM);
            } else if (typeof globalThis.localStorage !== 'undefined' && typeof globalThis.localStorage?.removeItem === 'function') {
                globalThis.localStorage.removeItem(STORAGE_KEY_LAST_SIM);
            }
        } catch (e) {
            console.warn('[LWS State] Failed to remove accountStorage key:', e);
        }
    }
}

export const lwsState = new LwsStateStore();
