/**
 * Living World Simulator (LWS) - UI Mind Inspector
 * Enforces strict epistemic discipline: Subjective character perspective under follow_character;
 * suppresses unperceived NPC private thoughts; Observer ground truth only under god_view.
 */

import { lwsState } from './state.js';
import { lwsApi } from './api.js';
import { renderMindInspector } from './templates.js';

export class LwsUiMindInspector {
    constructor({ state = lwsState, api = lwsApi } = {}) {
        this.state = state;
        this.api = api;
        this.container = null;
        this._bindEvents();
    }

    _bindEvents() {
        this.state.on('change:camera_mode', () => this.refresh());
        this.state.on('change:selected_char_lws_id', () => this.refresh());
        this.state.on('change:active_tab', tab => {
            if (tab === 'mind') this.refresh();
        });
    }

    mount(parent) {
        this.container = typeof parent === 'string' ? document.querySelector(parent) : parent;
        if (!this.container) return;
        this.render();
    }

    render() {
        this.refresh();
    }

    async refresh() {
        if (!this.container) return;
        const s = this.state.getState();
        const simId = s.simulation_lws_id;

        if (!simId) {
            this.container.innerHTML = '<div class="lws-empty-state">Select an active simulation to inspect character cognition.</div>';
            return;
        }

        this.container.innerHTML = '<div class="lws-empty-state"><i class="fa-solid fa-spinner fa-spin"></i> Loading mind perspective...</div>';

        try {
            if (s.camera_mode === 'god_view') {
                const observerRes = await this.api.getObserverPerspective(simId);
                this.state.setState({ observer_perspective: observerRes });

                const chars = observerRes.characters || [];
                const firstChar = chars[0];

                let charNeeds = {};
                let activeGoals = [];
                let beliefs = [];

                if (firstChar) {
                    try {
                        const cog = await this.api.getCharacterCognition(simId, firstChar.lws_id);
                        charNeeds = cog.needs || {};
                        activeGoals = cog.active_goals || [];
                    } catch {
                        // Ignore
                    }
                }

                this.container.innerHTML = renderMindInspector({
                    character: firstChar ? { name: `[Observer Ground Truth] ${firstChar.name}` } : { name: 'Observer Perspective' },
                    needs: charNeeds,
                    activeGoals,
                    beliefs,
                    perspective: observerRes,
                    cameraMode: 'god_view',
                });
            } else if (s.camera_mode === 'follow_character') {
                const charId = s.selected_char_lws_id;
                if (!charId) {
                    this.container.innerHTML = '<div class="lws-empty-state">No character selected in follow mode.</div>';
                    return;
                }

                // Epistemic isolation: fetch subjective perspective and cognition
                const [perspRes, cogRes] = await Promise.all([
                    this.api.getSubjectivePerspective(simId, charId),
                    this.api.getCharacterCognition(simId, charId),
                ]);

                this.state.setState({ perspective: perspRes });

                this.container.innerHTML = renderMindInspector({
                    character: perspRes.character,
                    needs: cogRes.needs || {},
                    activeGoals: cogRes.active_goals || [],
                    values: cogRes.values || {},
                    emotions: cogRes.current_emotion || {},
                    beliefs: perspRes.beliefs || [],
                    perspective: perspRes,
                    cameraMode: 'follow_character',
                });
            } else {
                // observe_location mode
                this.container.innerHTML = `
                    <div class="lws-empty-state">
                        Camera is set to Location Observation mode. Switch to Follow Character to inspect subjective cognition.
                    </div>
                `;
            }
        } catch (err) {
            this.container.innerHTML = `<div class="lws-empty-state lws-progress-alert">Error loading mind perspective: ${err.message}</div>`;
        }
    }
}
