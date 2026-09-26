/**
 * Living World Simulator (LWS) - UI Authored Roster & Entities
 * Full lifecycle CRUD across Characters, Locations, Factions, World Rules, Archetypes, Rosters, and Prompt Config.
 */

import { lwsState } from './state.js';
import { lwsApi } from './api.js';
import { escapeHtml } from './templates.js';

export class LwsUiAuthoredRoster {
    constructor({ state = lwsState, api = lwsApi } = {}) {
        this.state = state;
        this.api = api;
        this.container = null;
        this.activeSection = 'characters'; // characters | locations | factions | rules | archetypes | config
    }

    mount(parent) {
        this.container = typeof parent === 'string' ? document.querySelector(parent) : parent;
        if (!this.container) return;
        this.render();
    }

    async render() {
        if (!this.container) return;
        const worldId = this.state.getState().world_lws_id;
        if (!worldId) {
            this.container.innerHTML = '<div class="lws-empty-state">Select or create a World to manage authored entities.</div>';
            return;
        }

        this.container.innerHTML = `
            <div class="lws-roster-layout">
                <div class="lws-roster-nav" style="display:flex; gap:8px; margin-bottom:12px;">
                    <button class="lws-btn ${this.activeSection === 'characters' ? 'lws-btn-primary' : ''}" data-roster-tab="characters"><i class="fa-solid fa-user"></i> Characters</button>
                    <button class="lws-btn ${this.activeSection === 'locations' ? 'lws-btn-primary' : ''}" data-roster-tab="locations"><i class="fa-solid fa-location-dot"></i> Locations</button>
                    <button class="lws-btn ${this.activeSection === 'factions' ? 'lws-btn-primary' : ''}" data-roster-tab="factions"><i class="fa-solid fa-shield"></i> Factions</button>
                    <button class="lws-btn ${this.activeSection === 'rules' ? 'lws-btn-primary' : ''}" data-roster-tab="rules"><i class="fa-solid fa-scroll"></i> World Rules</button>
                    <button class="lws-btn ${this.activeSection === 'archetypes' ? 'lws-btn-primary' : ''}" data-roster-tab="archetypes"><i class="fa-solid fa-users-line"></i> Archetypes</button>
                    <button class="lws-btn ${this.activeSection === 'config' ? 'lws-btn-primary' : ''}" data-roster-tab="config"><i class="fa-solid fa-sliders"></i> Prompt Config</button>
                </div>
                <div id="lws-roster-content">
                    <div class="lws-empty-state"><i class="fa-solid fa-spinner fa-spin"></i> Loading...</div>
                </div>
            </div>
        `;

        this._attachNavListeners();
        await this._loadSectionContent();
    }

    _attachNavListeners() {
        if (!this.container) return;
        this.container.querySelectorAll('[data-roster-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.activeSection = btn.getAttribute('data-roster-tab');
                this.render();
            });
        });
    }

    async _loadSectionContent() {
        const contentDiv = this.container?.querySelector('#lws-roster-content');
        if (!contentDiv) return;
        const worldId = this.state.getState().world_lws_id;

        try {
            switch (this.activeSection) {
                case 'characters': {
                    const res = await this.api.listCharacters(worldId);
                    const chars = res.characters || [];
                    contentDiv.innerHTML = `
                        <div class="lws-card">
                            <div class="lws-card-header">
                                <span class="lws-card-title">Authored Characters (${chars.length})</span>
                                <button id="lws-btn-new-char" class="lws-btn lws-btn-primary"><i class="fa-solid fa-plus"></i> New Character</button>
                            </div>
                            <div class="lws-entity-list">
                                ${chars.length === 0 ? '<div class="lws-empty-state">No characters authored.</div>' : ''}
                                ${chars.map(c => `
                                    <div class="lws-entity-item">
                                        <div>
                                            <strong>${escapeHtml(c.name)}</strong>
                                            <p class="lws-desc">${escapeHtml(c.personality || c.description || '')}</p>
                                        </div>
                                        <div class="lws-entity-actions">
                                            <button class="lws-btn lws-btn-edit-char" data-char-id="${escapeHtml(c.lws_id)}" data-char-name="${escapeHtml(c.name)}">Edit</button>
                                            <button class="lws-btn lws-btn-del-char lws-btn-danger" data-char-id="${escapeHtml(c.lws_id)}"><i class="fa-solid fa-trash"></i></button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;

                    contentDiv.querySelector('#lws-btn-new-char')?.addEventListener('click', async () => {
                        const name = prompt('Character Name:');
                        if (name) {
                            const personality = prompt('Personality:') || '';
                            await this.api.createCharacter(worldId, { name, personality });
                            this._loadSectionContent();
                        }
                    });

                    contentDiv.querySelectorAll('.lws-btn-del-char').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            if (confirm('Delete character?')) {
                                await this.api.deleteCharacter(worldId, btn.getAttribute('data-char-id'));
                                this._loadSectionContent();
                            }
                        });
                    });

                    contentDiv.querySelectorAll('.lws-btn-edit-char').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            const newDesc = prompt('New Personality / Description:');
                            if (newDesc !== null) {
                                await this.api.updateCharacter(worldId, btn.getAttribute('data-char-id'), { personality: newDesc });
                                this._loadSectionContent();
                            }
                        });
                    });
                    break;
                }

                case 'locations': {
                    const res = await this.api.listLocations(worldId);
                    const locs = res.locations || [];
                    contentDiv.innerHTML = `
                        <div class="lws-card">
                            <div class="lws-card-header">
                                <span class="lws-card-title">Authored Locations (${locs.length})</span>
                                <button id="lws-btn-new-loc" class="lws-btn lws-btn-primary"><i class="fa-solid fa-plus"></i> New Location</button>
                            </div>
                            <div class="lws-entity-list">
                                ${locs.length === 0 ? '<div class="lws-empty-state">No locations authored.</div>' : ''}
                                ${locs.map(l => `
                                    <div class="lws-entity-item">
                                        <div>
                                            <strong>${escapeHtml(l.name)}</strong>
                                            <p class="lws-desc">${escapeHtml(l.description || '')}</p>
                                        </div>
                                        <div class="lws-entity-actions">
                                            <button class="lws-btn lws-btn-del-loc lws-btn-danger" data-loc-id="${escapeHtml(l.lws_id)}"><i class="fa-solid fa-trash"></i></button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;

                    contentDiv.querySelector('#lws-btn-new-loc')?.addEventListener('click', async () => {
                        const name = prompt('Location Name:');
                        if (name) {
                            const description = prompt('Description:') || '';
                            await this.api.createLocation(worldId, { name, description });
                            this._loadSectionContent();
                        }
                    });

                    contentDiv.querySelectorAll('.lws-btn-del-loc').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            if (confirm('Delete location?')) {
                                await this.api.deleteLocation(worldId, btn.getAttribute('data-loc-id'));
                                this._loadSectionContent();
                            }
                        });
                    });
                    break;
                }

                case 'factions': {
                    const res = await this.api.listFactions(worldId);
                    const factions = res.factions || [];
                    contentDiv.innerHTML = `
                        <div class="lws-card">
                            <div class="lws-card-header">
                                <span class="lws-card-title">Authored Factions (${factions.length})</span>
                                <button id="lws-btn-new-faction" class="lws-btn lws-btn-primary"><i class="fa-solid fa-plus"></i> New Faction</button>
                            </div>
                            <div class="lws-entity-list">
                                ${factions.length === 0 ? '<div class="lws-empty-state">No factions authored.</div>' : ''}
                                ${factions.map(f => `
                                    <div class="lws-entity-item">
                                        <div>
                                            <strong>${escapeHtml(f.name)}</strong>
                                            <p class="lws-desc">${escapeHtml(f.description || '')}</p>
                                        </div>
                                        <div class="lws-entity-actions">
                                            <button class="lws-btn lws-btn-del-faction lws-btn-danger" data-fac-id="${escapeHtml(f.lws_id)}"><i class="fa-solid fa-trash"></i></button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;

                    contentDiv.querySelector('#lws-btn-new-faction')?.addEventListener('click', async () => {
                        const name = prompt('Faction Name:');
                        if (name) {
                            const description = prompt('Description:') || '';
                            await this.api.createFaction(worldId, { name, description });
                            this._loadSectionContent();
                        }
                    });

                    contentDiv.querySelectorAll('.lws-btn-del-faction').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            if (confirm('Delete faction?')) {
                                await this.api.deleteFaction(worldId, btn.getAttribute('data-fac-id'));
                                this._loadSectionContent();
                            }
                        });
                    });
                    break;
                }

                case 'rules': {
                    const res = await this.api.listWorldRules(worldId);
                    const rules = res.rules || [];
                    contentDiv.innerHTML = `
                        <div class="lws-card">
                            <div class="lws-card-header">
                                <span class="lws-card-title">World Rules (${rules.length})</span>
                                <button id="lws-btn-new-rule" class="lws-btn lws-btn-primary"><i class="fa-solid fa-plus"></i> New Rule</button>
                            </div>
                            <div class="lws-entity-list">
                                ${rules.length === 0 ? '<div class="lws-empty-state">No world rules defined.</div>' : ''}
                                ${rules.map(r => `
                                    <div class="lws-entity-item">
                                        <div>
                                            <strong>${escapeHtml(r.title || 'Rule')}</strong>
                                            <p class="lws-desc">${escapeHtml(r.body || '')}</p>
                                        </div>
                                        <div class="lws-entity-actions">
                                            <button class="lws-btn lws-btn-del-rule lws-btn-danger" data-rule-id="${escapeHtml(r.lws_id)}"><i class="fa-solid fa-trash"></i></button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;

                    contentDiv.querySelector('#lws-btn-new-rule')?.addEventListener('click', async () => {
                        const title = prompt('Rule Title:');
                        if (title) {
                            const body = prompt('Rule Content/Body:') || '';
                            await this.api.createWorldRule(worldId, { title, body, sort_order: 0 });
                            this._loadSectionContent();
                        }
                    });

                    contentDiv.querySelectorAll('.lws-btn-del-rule').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            if (confirm('Delete rule?')) {
                                await this.api.deleteWorldRule(worldId, btn.getAttribute('data-rule-id'));
                                this._loadSectionContent();
                            }
                        });
                    });
                    break;
                }

                case 'archetypes': {
                    const res = await this.api.listAmbientArchetypes(worldId);
                    const archetypes = res.archetypes || [];
                    contentDiv.innerHTML = `
                        <div class="lws-card">
                            <div class="lws-card-header">
                                <span class="lws-card-title">Ambient Archetypes (${archetypes.length})</span>
                                <button id="lws-btn-new-arch" class="lws-btn lws-btn-primary"><i class="fa-solid fa-plus"></i> New Archetype</button>
                            </div>
                            <div class="lws-entity-list">
                                ${archetypes.length === 0 ? '<div class="lws-empty-state">No ambient archetypes defined.</div>' : ''}
                                ${archetypes.map(a => `
                                    <div class="lws-entity-item">
                                        <div>
                                            <strong>${escapeHtml(a.name)}</strong>
                                            <span class="lws-badge">${escapeHtml(a.category || 'ambient')}</span>
                                            <p class="lws-desc">${escapeHtml(a.description || '')}</p>
                                        </div>
                                        <div class="lws-entity-actions">
                                            <button class="lws-btn lws-btn-del-arch lws-btn-danger" data-arch-id="${escapeHtml(a.lws_id)}"><i class="fa-solid fa-trash"></i></button>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;

                    contentDiv.querySelector('#lws-btn-new-arch')?.addEventListener('click', async () => {
                        const name = prompt('Archetype Name:');
                        if (name) {
                            const description = prompt('Description:') || '';
                            await this.api.createAmbientArchetype(worldId, {
                                name,
                                description,
                                category: 'CITIZEN',
                                default_attributes: {},
                                tags: [],
                            });
                            this._loadSectionContent();
                        }
                    });

                    contentDiv.querySelectorAll('.lws-btn-del-arch').forEach(btn => {
                        btn.addEventListener('click', async () => {
                            if (confirm('Delete archetype?')) {
                                await this.api.deleteAmbientArchetype(worldId, btn.getAttribute('data-arch-id'));
                                this._loadSectionContent();
                            }
                        });
                    });
                    break;
                }

                case 'config': {
                    let config = {};
                    try {
                        const cfgRes = await this.api.getPromptConfig(worldId);
                        config = cfgRes.prompt_config || {};
                    } catch (e) {
                        // May not exist yet
                    }

                    contentDiv.innerHTML = `
                        <div class="lws-card">
                            <div class="lws-card-header">
                                <span class="lws-card-title">Prompt & Layer Budget Configuration</span>
                            </div>
                            <div class="lws-card-body">
                                <div class="lws-form-group">
                                    <label class="lws-form-label" for="lws-cfg-template">System Prompt Template</label>
                                    <textarea id="lws-cfg-template" class="lws-input-pole" rows="6">${escapeHtml(config.system_prompt_template || '')}</textarea>
                                </div>
                                <button id="lws-btn-save-cfg" class="lws-btn lws-btn-primary">
                                    <i class="fa-solid fa-save"></i> Save Prompt Configuration
                                </button>
                            </div>
                        </div>
                    `;

                    contentDiv.querySelector('#lws-btn-save-cfg')?.addEventListener('click', async () => {
                        const tpl = contentDiv.querySelector('#lws-cfg-template').value;
                        await this.api.updatePromptConfig(worldId, { system_prompt_template: tpl });
                        alert('Prompt config updated.');
                    });
                    break;
                }
            }
        } catch (err) {
            contentDiv.innerHTML = `<div class="lws-empty-state lws-progress-alert">Error loading section: ${escapeHtml(err.message)}</div>`;
        }
    }
}
