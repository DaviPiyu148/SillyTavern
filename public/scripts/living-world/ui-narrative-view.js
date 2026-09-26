/**
 * Living World Simulator (LWS) - UI Narrative View
 * Manages chronological narrative turns, dialogue streams, and prompt generation.
 */

import { lwsState } from './state.js';
import { lwsApi } from './api.js';
import { renderTurnStream } from './templates.js';

export class LwsUiNarrativeView {
    constructor({ state = lwsState, api = lwsApi } = {}) {
        this.state = state;
        this.api = api;
        this.container = null;
        this._bindEvents();
    }

    _bindEvents() {
        this.state.on('change:turns', turns => {
            this.updateTurns(turns);
        });

        this.state.on('change:is_generating', isGen => {
            this.updateGeneratingState(isGen);
        });
    }

    mount(parent) {
        this.container = typeof parent === 'string' ? document.querySelector(parent) : parent;
        if (!this.container) return;
        this.render();
    }

    render() {
        if (!this.container) return;
        const currentTurns = this.state.getState().turns || [];

        const streamHolder = this.container.querySelector('#lws-narrative-stream-holder') || this.container;
        streamHolder.innerHTML = renderTurnStream(currentTurns);

        this._attachInputListeners();
    }

    updateTurns(turns) {
        if (!this.container) return;
        const streamHolder = this.container.querySelector('#lws-narrative-stream-holder') || this.container;
        streamHolder.innerHTML = renderTurnStream(turns);
        // Scroll to bottom
        const stream = streamHolder.querySelector('.lws-turn-stream');
        if (stream) stream.scrollTop = stream.scrollHeight;
    }

    updateGeneratingState(isGenerating) {
        if (!this.container) return;
        const btnGen = this.container.querySelector('#lws-btn-generate-turn');
        const inputPole = this.container.querySelector('#lws-narrative-input');

        if (btnGen) {
            btnGen.disabled = isGenerating;
            btnGen.innerHTML = isGenerating
                ? '<i class="fa-solid fa-spinner fa-spin"></i> Generating...'
                : '<i class="fa-solid fa-paper-plane"></i> Generate';
        }
        if (inputPole) {
            inputPole.disabled = isGenerating;
        }
    }

    _attachInputListeners() {
        if (!this.container) return;
        const btnGen = this.container.querySelector('#lws-btn-generate-turn');
        const inputPole = this.container.querySelector('#lws-narrative-input');

        const doSubmit = async () => {
            if (this.state.getState().is_generating) return;
            const simId = this.state.getState().simulation_lws_id;
            if (!simId) {
                alert('No active simulation selected.');
                return;
            }

            const promptText = inputPole?.value?.trim() || '';
            if (inputPole) inputPole.value = '';

            this.state.setState({ is_generating: true });
            try {
                const res = await this.api.generateTurn(simId, {
                    generation_mode: 'CONTINUE',
                    user_prompt: promptText,
                });

                // Update turns list
                const turnsRes = await this.api.listTurns(simId);
                const turns = turnsRes.turns || [];
                this.state.setState({ turns });
            } catch (err) {
                alert(`Error generating turn: ${err.message}`);
            } finally {
                this.state.setState({ is_generating: false });
            }
        };

        if (btnGen) {
            btnGen.addEventListener('click', doSubmit);
        }

        if (inputPole) {
            inputPole.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    doSubmit();
                }
            });
        }
    }
}
