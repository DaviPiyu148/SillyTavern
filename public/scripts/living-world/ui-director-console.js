/**
 * Living World Simulator (LWS) - UI Director Console
 * Dedicated controls for time advance, camera switches, and authoritative state interventions.
 */

import { lwsState } from './state.js';
import { lwsApi } from './api.js';
import { renderDirectorPanel } from './templates.js';

export class LwsUiDirectorConsole {
    constructor({ state = lwsState, api = lwsApi } = {}) {
        this.state = state;
        this.api = api;
        this.container = null;
    }

    mount(parent) {
        this.container = typeof parent === 'string' ? document.querySelector(parent) : parent;
        if (!this.container) return;
        this.render();
    }

    async render() {
        if (!this.container) return;
        const s = this.state.getState();
        const simId = s.simulation_lws_id;

        if (!simId) {
            this.container.innerHTML = '<div class="lws-empty-state">Select an active simulation to open Director Console.</div>';
            return;
        }

        try {
            const [charsRes, locsRes] = await Promise.all([
                this.api.listSimulationCharacters(simId),
                this.api.listLocations(s.world_lws_id),
            ]);

            const characters = charsRes.characters || [];
            const locations = locsRes.locations || [];

            this.container.innerHTML = renderDirectorPanel({
                characters,
                locations,
                cameraMode: s.camera_mode,
            });

            this._attachListeners();
        } catch (err) {
            this.container.innerHTML = `<div class="lws-empty-state lws-progress-alert">Error loading Director Console: ${err.message}</div>`;
        }
    }

    _attachListeners() {
        if (!this.container) return;
        const simId = this.state.getState().simulation_lws_id;

        // Advance Time
        const btnAdvance = this.container.querySelector('#lws-btn-advance-time');
        const selAdvance = this.container.querySelector('#lws-advance-seconds');
        if (btnAdvance && selAdvance) {
            btnAdvance.addEventListener('click', async () => {
                const secs = parseInt(selAdvance.value, 10) || 3600;
                btnAdvance.disabled = true;
                try {
                    const res = await this.api.advanceTime(simId, { advance_seconds: secs });
                    this.state.setState({ current_fictional_time: res.current_fictional_time || res.fictional_time });
                    alert(`Advanced fictional time by ${secs} seconds.`);
                } catch (err) {
                    alert(`Error advancing time: ${err.message}`);
                } finally {
                    btnAdvance.disabled = false;
                }
            });
        }

        // Camera Switch
        const btnCam = this.container.querySelector('#lws-btn-set-camera');
        const selCamMode = this.container.querySelector('#lws-camera-mode-select');
        const selCamChar = this.container.querySelector('#lws-camera-target-char');
        const selCamLoc = this.container.querySelector('#lws-camera-target-loc');
        const grpChar = this.container.querySelector('#lws-camera-target-char-group');
        const grpLoc = this.container.querySelector('#lws-camera-target-loc-group');

        if (selCamMode) {
            selCamMode.addEventListener('change', () => {
                const mode = selCamMode.value;
                if (grpChar) grpChar.style.display = mode === 'follow_character' ? 'block' : 'none';
                if (grpLoc) grpLoc.style.display = mode === 'observe_location' ? 'block' : 'none';
            });
        }

        if (btnCam) {
            btnCam.addEventListener('click', async () => {
                const mode = selCamMode.value;
                const charId = selCamChar ? selCamChar.value : null;
                const locId = selCamLoc ? selCamLoc.value : null;

                const payload = { mode };
                if (mode === 'follow_character') payload.target_character_lws_id = charId;
                if (mode === 'observe_location') payload.target_location_lws_id = locId;

                try {
                    await this.api.setSimulationCamera(simId, payload);
                    this.state.setState({
                        camera_mode: mode,
                        selected_char_lws_id: charId,
                        selected_loc_lws_id: locId,
                    });
                    alert(`Camera updated to: ${mode}`);
                } catch (err) {
                    alert(`Error updating camera: ${err.message}`);
                }
            });
        }

        // Narrative Note
        const btnNote = this.container.querySelector('#lws-btn-submit-note');
        const txtNote = this.container.querySelector('#lws-director-note-text');
        if (btnNote && txtNote) {
            btnNote.addEventListener('click', async () => {
                const text = txtNote.value.trim();
                if (!text) return;
                try {
                    await this.api.recordDirectorNote(simId, text);
                    txtNote.value = '';
                    alert('Event note injected into simulation history.');
                } catch (err) {
                    alert(`Error injecting note: ${err.message}`);
                }
            });
        }
    }
}
