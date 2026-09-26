/**
 * Living World Simulator (LWS) - UI World & Simulation Browser
 * Handles World CRUD, Scenario CRUD, and Simulation lifecycle.
 */

import { lwsState } from './state.js';
import { lwsApi } from './api.js';
import { escapeHtml } from './templates.js';

export class LwsUiWorldBrowser {
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
        this.container.innerHTML = '<div class="lws-empty-state"><i class="fa-solid fa-spinner fa-spin"></i> Loading worlds...</div>';

        try {
            const worldsRes = await this.api.listWorlds();
            const worlds = worldsRes.worlds || [];
            const activeWorldId = this.state.getState().world_lws_id;

            let scenarios = [];
            let simulations = [];
            if (activeWorldId) {
                try {
                    const scRes = await this.api.listScenarios(activeWorldId);
                    scenarios = scRes.scenarios || [];
                    const simRes = await this.api.listSimulations(activeWorldId);
                    simulations = simRes.simulations || [];
                } catch (e) {
                    console.warn('[LWS WorldBrowser] Error fetching scenarios/simulations:', e);
                }
            }

            this.container.innerHTML = `
                <div class="lws-world-browser-layout">
                    <!-- Worlds Column -->
                    <div class="lws-card">
                        <div class="lws-card-header">
                            <span class="lws-card-title"><i class="fa-solid fa-earth-americas"></i> Authored Worlds</span>
                            <button id="lws-btn-create-world" class="lws-btn lws-btn-primary" title="Create New World">
                                <i class="fa-solid fa-plus"></i> New World
                            </button>
                        </div>
                        <div class="lws-entity-list" id="lws-world-list">
                            ${worlds.length === 0 ? '<div class="lws-empty-state">No worlds authored yet.</div>' : ''}
                            ${worlds.map(w => `
                                <div class="lws-entity-item ${w.lws_id === activeWorldId ? 'lws-active-item' : ''}" data-world-id="${escapeHtml(w.lws_id)}">
                                    <div class="lws-entity-meta">
                                        <strong>${escapeHtml(w.name)}</strong>
                                        <p class="lws-desc">${escapeHtml(w.description || '')}</p>
                                    </div>
                                    <div class="lws-entity-actions">
                                        <button class="lws-btn lws-btn-select-world" data-world-id="${escapeHtml(w.lws_id)}" data-world-name="${escapeHtml(w.name)}">Select</button>
                                        <button class="lws-btn lws-btn-delete-world lws-btn-danger" data-world-id="${escapeHtml(w.lws_id)}" title="Delete World"><i class="fa-solid fa-trash"></i></button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <!-- Scenarios & Simulations Column -->
                    <div class="lws-card">
                        <div class="lws-card-header">
                            <span class="lws-card-title"><i class="fa-solid fa-film"></i> Scenarios & Simulations</span>
                            ${activeWorldId ? `
                                <button id="lws-btn-create-scenario" class="lws-btn lws-btn-primary">
                                    <i class="fa-solid fa-plus"></i> New Scenario
                                </button>
                            ` : ''}
                        </div>
                        <div class="lws-card-body">
                            ${!activeWorldId ? '<div class="lws-empty-state">Select a world to view scenarios and simulations.</div>' : `
                                <h4>Scenarios</h4>
                                <div class="lws-entity-list">
                                    ${scenarios.length === 0 ? '<div class="lws-empty-state">No scenarios created.</div>' : ''}
                                    ${scenarios.map(sc => `
                                        <div class="lws-entity-item" data-scenario-id="${escapeHtml(sc.lws_id)}">
                                            <div>
                                                <strong>${escapeHtml(sc.name)}</strong>
                                                <p class="lws-desc">${escapeHtml(sc.description || '')}</p>
                                            </div>
                                            <div class="lws-entity-actions">
                                                <button class="lws-btn lws-btn-primary lws-btn-launch-sim" data-scenario-id="${escapeHtml(sc.lws_id)}" data-scenario-name="${escapeHtml(sc.name)}">
                                                    <i class="fa-solid fa-play"></i> Launch
                                                </button>
                                                <button class="lws-btn lws-btn-delete-scenario lws-btn-danger" data-scenario-id="${escapeHtml(sc.lws_id)}"><i class="fa-solid fa-trash"></i></button>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>

                                <h4 style="margin-top: 16px;">Active Simulations</h4>
                                <div class="lws-entity-list">
                                    ${simulations.length === 0 ? '<div class="lws-empty-state">No simulations running.</div>' : ''}
                                    ${simulations.map(sim => `
                                        <div class="lws-entity-item ${sim.lws_id === this.state.getState().simulation_lws_id ? 'lws-active-item' : ''}" data-sim-id="${escapeHtml(sim.lws_id)}">
                                            <div>
                                                <strong>${escapeHtml(sim.name)}</strong>
                                                <span class="lws-badge">${escapeHtml(sim.status)}</span>
                                            </div>
                                            <div class="lws-entity-actions">
                                                <button class="lws-btn lws-btn-resume-sim" data-sim-id="${escapeHtml(sim.lws_id)}" data-sim-name="${escapeHtml(sim.name)}">Resume</button>
                                                <button class="lws-btn lws-btn-delete-sim lws-btn-danger" data-sim-id="${escapeHtml(sim.lws_id)}"><i class="fa-solid fa-trash"></i></button>
                                            </div>
                                        </div>
                                    `).join('')}
                                </div>
                            `}
                        </div>
                    </div>
                </div>
            `;

            this._attachListeners();
        } catch (err) {
            this.container.innerHTML = `<div class="lws-empty-state lws-progress-alert">Error loading worlds: ${escapeHtml(err.message)}</div>`;
        }
    }

    _attachListeners() {
        if (!this.container) return;

        // Select world
        this.container.querySelectorAll('.lws-btn-select-world').forEach(btn => {
            btn.addEventListener('click', () => {
                const worldId = btn.getAttribute('data-world-id');
                const worldName = btn.getAttribute('data-world-name');
                this.state.setState({ world_lws_id: worldId, world_name: worldName });
                this.render();
            });
        });

        // Delete world
        this.container.querySelectorAll('.lws-btn-delete-world').forEach(btn => {
            btn.addEventListener('click', async () => {
                const worldId = btn.getAttribute('data-world-id');
                if (confirm('Are you sure you want to soft-delete this world?')) {
                    await this.api.deleteWorld(worldId);
                    if (this.state.getState().world_lws_id === worldId) {
                        this.state.setState({ world_lws_id: null, world_name: '' });
                    }
                    this.render();
                }
            });
        });

        // Create world
        const btnCreateWorld = this.container.querySelector('#lws-btn-create-world');
        if (btnCreateWorld) {
            btnCreateWorld.addEventListener('click', async () => {
                const name = prompt('World Name:');
                if (name) {
                    const desc = prompt('World Description (optional):') || '';
                    const res = await this.api.createWorld({ name, description: desc });
                    const newWorld = res.world;
                    this.state.setState({ world_lws_id: newWorld.lws_id, world_name: newWorld.name });
                    this.render();
                }
            });
        }

        // Create scenario
        const btnCreateScenario = this.container.querySelector('#lws-btn-create-scenario');
        if (btnCreateScenario) {
            btnCreateScenario.addEventListener('click', async () => {
                const worldId = this.state.getState().world_lws_id;
                if (!worldId) return;
                const name = prompt('Scenario Name:');
                if (name) {
                    const desc = prompt('Scenario Description (optional):') || '';
                    await this.api.createScenario(worldId, { name, description: desc });
                    this.render();
                }
            });
        }

        // Launch simulation
        this.container.querySelectorAll('.lws-btn-launch-sim').forEach(btn => {
            btn.addEventListener('click', async () => {
                const worldId = this.state.getState().world_lws_id;
                const scenarioId = btn.getAttribute('data-scenario-id');
                const scenarioName = btn.getAttribute('data-scenario-name');
                const simName = `${scenarioName} Sim`;

                const res = await this.api.createSimulation(worldId, {
                    scenario_lws_id: scenarioId,
                    name: simName,
                    initial_fictional_time: '2026-06-01T08:00:00Z',
                });

                const sim = res.simulation || res;
                this.state.setState({
                    simulation_lws_id: sim.lws_id,
                    simulation_name: sim.name,
                    current_fictional_time: sim.current_fictional_time,
                    active_tab: 'narrative',
                });
            });
        });

        // Resume simulation
        this.container.querySelectorAll('.lws-btn-resume-sim').forEach(btn => {
            btn.addEventListener('click', async () => {
                const simId = btn.getAttribute('data-sim-id');
                const simName = btn.getAttribute('data-sim-name');
                this.state.setState({
                    simulation_lws_id: simId,
                    simulation_name: simName,
                    active_tab: 'narrative',
                });
            });
        });

        // Delete simulation
        this.container.querySelectorAll('.lws-btn-delete-sim').forEach(btn => {
            btn.addEventListener('click', async () => {
                const simId = btn.getAttribute('data-sim-id');
                if (confirm('Delete simulation?')) {
                    await this.api.deleteSimulation(simId);
                    if (this.state.getState().simulation_lws_id === simId) {
                        this.state.resetOn404();
                    }
                    this.render();
                }
            });
        });
    }
}
