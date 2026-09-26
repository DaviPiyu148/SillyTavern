/**
 * Living World Simulator (LWS) - Native Host Bootstrap & Coordinator
 * Integrates LWS seamlessly into SillyTavern's host lifecycle and UI.
 */

import { lwsState } from './state.js';
import { lwsApi } from './api.js';
import { LwsUiShell } from './ui-shell.js';
import { LwsUiWorldBrowser } from './ui-world-browser.js';
import { LwsUiAuthoredRoster } from './ui-authored-roster.js';
import { LwsUiNarrativeView } from './ui-narrative-view.js';
import { LwsUiMindInspector } from './ui-mind-inspector.js';
import { LwsUiDirectorConsole } from './ui-director-console.js';
import { registerLwsSlashCommands } from './slash-commands.js';

class LwsBootstrap {
    constructor() {
        this.state = lwsState;
        this.api = lwsApi;
        this.shell = null;
        this.components = {};
        this.isInitialized = false;
    }

    /**
     * Initializes LWS frontend on host readiness.
     */
    async init() {
        if (this.isInitialized) return;
        this.isInitialized = true;

        console.debug('[LWS] Initializing Living World Native UI...');

        // 1. Mount UI Shell
        this.shell = new LwsUiShell({ state: this.state });
        this.shell.mount(document.body);
        this.shell.hide(); // Hidden initially until opened via top button or slash command

        // 2. Instantiate and mount component views
        this.components.worldBrowser = new LwsUiWorldBrowser({ state: this.state, api: this.api });
        this.components.worldBrowser.mount('#lws-panel-world');

        this.components.authoredRoster = new LwsUiAuthoredRoster({ state: this.state, api: this.api });
        this.components.authoredRoster.mount('#lws-panel-roster');

        this.components.narrativeView = new LwsUiNarrativeView({ state: this.state, api: this.api });
        this.components.narrativeView.mount('#lws-panel-narrative');

        this.components.mindInspector = new LwsUiMindInspector({ state: this.state, api: this.api });
        this.components.mindInspector.mount('#lws-panel-mind');

        this.components.directorConsole = new LwsUiDirectorConsole({ state: this.state, api: this.api });
        this.components.directorConsole.mount('#lws-panel-director');

        // 3. Inject top-bar icon button
        this._injectTopBarButton();

        // 4. Register Slash Commands
        registerLwsSlashCommands({ api: this.api, state: this.state });

        // 5. Execute Session Hydration Sequence
        await this.hydrateSession();

        console.debug('[LWS] Living World Native UI ready.');
    }

    _injectTopBarButton() {
        const topBar = document.getElementById('top-bar') || document.getElementById('top-settings-holder');
        if (!topBar) return;

        const btn = document.createElement('div');
        btn.id = 'lws-topbar-button';
        btn.className = 'drawer menu_button menu_button_icon';
        btn.title = 'Living World Simulator';
        btn.setAttribute('data-i18n', '[title]Living World Simulator');
        btn.innerHTML = `
            <div class="drawer-toggle drawer-header">
                <i class="fa-solid fa-earth-americas fa-fw" style="color: #8ac8ff; cursor: pointer;"></i>
            </div>
        `;

        btn.addEventListener('click', () => {
            const container = document.getElementById('lws-workspace');
            if (container) {
                if (container.style.display === 'none' || !container.style.display) {
                    this.shell.show();
                } else {
                    this.shell.hide();
                }
            }
        });

        topBar.appendChild(btn);
    }

    /**
     * Exact 5-stage Session Hydration Sequence:
     * 1. Check accountStorage: 'lws_last_sim_id'
     * 2. If present, dispatch GET /simulations/:simId
     * 3. On HTTP 200, fetch parallel session streams: camera, characters, turns
     * 4. Hydrate inspector perspective: follow_character, observe_location, god_view
     * 5. On HTTP 404 or empty, clear accountStorage and render World & Sim Browser
     */
    async hydrateSession() {
        const lastSimId = this.state.getLastSimId();

        if (lastSimId) {
            try {
                // Stage 2: Validate simulation
                const simRes = await this.api.getSimulation(lastSimId);
                const sim = simRes.simulation || simRes;

                this.state.setState({
                    world_lws_id: sim.world_lws_id,
                    simulation_lws_id: sim.lws_id,
                    simulation_name: sim.name,
                    current_fictional_time: sim.current_fictional_time,
                });

                // Stage 3: Fetch Parallel Streams
                const [cameraRes, charsRes, turnsRes] = await Promise.all([
                    this.api.getSimulationCamera(sim.lws_id).catch(() => ({ mode: 'god_view' })),
                    this.api.listSimulationCharacters(sim.lws_id).catch(() => ({ characters: [] })),
                    this.api.listTurns(sim.lws_id).catch(() => ({ turns: [] })),
                ]);

                const cameraMode = cameraRes.mode || 'god_view';
                const chars = charsRes.characters || [];
                const turns = turnsRes.turns || [];

                this.state.setState({
                    camera_mode: cameraMode,
                    selected_char_lws_id: cameraRes.target_character_lws_id || (chars[0]?.lws_id || null),
                    selected_loc_lws_id: cameraRes.target_location_lws_id || null,
                    characters: chars,
                    turns: turns,
                    active_tab: 'narrative',
                });

                // Stage 4: Hydrate inspector
                if (cameraMode === 'follow_character' && cameraRes.target_character_lws_id) {
                    const [persp, cog] = await Promise.all([
                        this.api.getSubjectivePerspective(sim.lws_id, cameraRes.target_character_lws_id).catch(() => null),
                        this.api.getCharacterCognition(sim.lws_id, cameraRes.target_character_lws_id).catch(() => ({})),
                    ]);
                    this.state.setState({
                        perspective: persp,
                        needs: cog?.needs || {},
                    });
                } else if (cameraMode === 'god_view') {
                    const obsPersp = await this.api.getObserverPerspective(sim.lws_id).catch(() => null);
                    this.state.setState({ observer_perspective: obsPersp });
                }

                return;
            } catch (err) {
                console.warn('[LWS Session] Failed to hydrate simulation, falling back to world selection:', err);
                // Stage 5: HTTP 404 or invalid sim ID
                this.state.resetOn404();
            }
        }

        // Default: Render Worlds Browser
        this.state.setState({ active_tab: 'world' });
    }
}

export const lws = new LwsBootstrap();

// Auto-bootstrap when DOM is ready
if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => lws.init());
    } else {
        lws.init();
    }
}
