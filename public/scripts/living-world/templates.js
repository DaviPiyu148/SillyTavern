/**
 * Living World Simulator (LWS) - Native HTML Templates
 * Strictly enforces semantic markup, ARIA accessibility, and escapeHtml sanitization.
 */

import { escapeHtml } from '../utils.js';

/**
 * Helper to safely format a fictional or real ISO timestamp into a readable string.
 * @param {string|null} isoString
 * @returns {string}
 */
export function formatClock(isoString) {
    if (!isoString) return 'Not running';
    try {
        const d = new Date(isoString);
        return d.toUTCString().replace('GMT', 'UTC');
    } catch {
        return escapeHtml(String(isoString));
    }
}

/**
 * Calculates progress percentage and CSS status modifier.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {{ pct: number, modClass: string }}
 */
export function calculateProgressMeta(value, min = 0, max = 100) {
    const val = Number(value) || 0;
    const clamped = Math.max(min, Math.min(max, val));
    const range = (max - min) || 1;
    const pct = Math.round(((clamped - min) / range) * 100);

    let modClass = '';
    if (pct < 30) {
        modClass = 'lws-progress-alert';
    } else if (pct < 60) {
        modClass = 'lws-progress-warn';
    }

    return { pct, modClass };
}

/**
 * Renders an accessible progress bar element.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {string} label
 * @returns {string}
 */
export function renderProgressBar(value, min = 0, max = 100, label = '') {
    const { pct, modClass } = calculateProgressMeta(value, min, max);
    const safeLabel = escapeHtml(label);
    return `
        <div class="lws-metric-row" role="region" aria-label="${safeLabel}">
            <div class="lws-metric-meta">
                <span class="lws-metric-label">${safeLabel}</span>
                <span class="lws-metric-value">${pct}% (${escapeHtml(String(value))})</span>
            </div>
            <div class="lws-progress-track" role="progressbar" aria-valuenow="${value}" aria-valuemin="${min}" aria-valuemax="${max}" aria-label="${safeLabel}">
                <div class="lws-progress-fill ${modClass}" style="width: ${pct}%;"></div>
            </div>
        </div>
    `.trim();
}

/**
 * Renders top status bar elements.
 * @param {object} props
 * @returns {string}
 */
export function renderTopBar({ worldName = 'No World', simName = 'No Simulation', fictionalClock = null, cameraMode = 'god_view' } = {}) {
    return `
        <header id="lws-top-bar" role="banner">
            <div class="lws-header-left">
                <div class="lws-badge lws-badge-accent" title="Active World">
                    <i class="fa-solid fa-earth-americas"></i>
                    <span id="lws-badge-world-name">${escapeHtml(worldName)}</span>
                </div>
                <div class="lws-badge" title="Active Simulation">
                    <i class="fa-solid fa-play"></i>
                    <span id="lws-badge-sim-name">${escapeHtml(simName)}</span>
                </div>
                <div class="lws-badge lws-badge-clock" title="Fictional Simulation Clock">
                    <i class="fa-solid fa-clock"></i>
                    <span id="lws-badge-clock">${formatClock(fictionalClock)}</span>
                </div>
            </div>
            <div class="lws-header-right">
                <div class="lws-badge lws-badge-camera" title="Active Camera Focus">
                    <i class="fa-solid fa-video"></i>
                    <span id="lws-badge-camera">${escapeHtml(cameraMode)}</span>
                </div>
                <button id="lws-btn-drawer-close" class="lws-btn" title="Close LWS Workspace" aria-label="Close Workspace">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </header>
    `.trim();
}

/**
 * Renders tab navigation header.
 * @param {string} activeTab
 * @returns {string}
 */
export function renderNavTabs(activeTab = 'world') {
    const tabs = [
        { id: 'world', icon: 'fa-globe', label: 'Worlds & Sims' },
        { id: 'narrative', icon: 'fa-book-open', label: 'Narrative' },
        { id: 'mind', icon: 'fa-brain', label: 'Mind Inspector' },
        { id: 'roster', icon: 'fa-users', label: 'Authored Roster' },
        { id: 'director', icon: 'fa-sliders', label: 'Director Console' },
    ];

    const tabButtons = tabs.map(tab => {
        const isActive = tab.id === activeTab;
        const activeClass = isActive ? 'lws-active' : '';
        return `
            <button class="lws-tab-btn ${activeClass}" role="tab" aria-selected="${isActive}" data-tab="${tab.id}" id="lws-tab-${tab.id}">
                <i class="fa-solid ${tab.icon}"></i>
                <span>${escapeHtml(tab.label)}</span>
            </button>
        `.trim();
    }).join('\n');

    return `
        <nav class="lws-nav-tabs" role="tablist" aria-label="LWS Workspace Navigation">
            ${tabButtons}
        </nav>
    `.trim();
}

/**
 * Renders a single narrative turn item.
 * @param {object} turn
 * @returns {string}
 */
export function renderTurnItem(turn) {
    const turnNum = turn.turn_number ?? '#';
    const timestamp = formatClock(turn.fictional_time);
    const narrativeText = escapeHtml(turn.narrative_text || turn.user_prompt || '');

    let dialoguesHtml = '';
    if (Array.isArray(turn.dialogues) && turn.dialogues.length > 0) {
        dialoguesHtml = `
            <div class="lws-turn-dialogues">
                ${turn.dialogues.map(d => `
                    <div class="lws-dialogue-bubble">
                        <div class="lws-speaker-name">${escapeHtml(d.speaker || d.character_name || 'Unknown')}</div>
                        <div class="lws-dialogue-text">"${escapeHtml(d.text || d.speech || '')}"</div>
                    </div>
                `).join('')}
            </div>
        `.trim();
    }

    return `
        <article class="lws-turn-entry" data-turn-number="${turnNum}">
            <header class="lws-turn-header">
                <span class="lws-turn-num">Turn ${escapeHtml(String(turnNum))}</span>
                <span class="lws-turn-time"><i class="fa-solid fa-clock"></i> ${timestamp}</span>
            </header>
            <div class="lws-turn-narrative">${narrativeText}</div>
            ${dialoguesHtml}
        </article>
    `.trim();
}

/**
 * Renders the chronological turn stream.
 * @param {Array<object>} turns
 * @returns {string}
 */
export function renderTurnStream(turns = []) {
    if (!Array.isArray(turns) || turns.length === 0) {
        return `
            <div class="lws-turn-stream" role="feed" aria-label="Turn Stream">
                <div class="lws-empty-state">No narrative turns recorded yet. Launch simulation or send a prompt below.</div>
            </div>
        `.trim();
    }

    return `
        <div class="lws-turn-stream" role="feed" aria-label="Turn Stream">
            ${turns.map(renderTurnItem).join('\n')}
        </div>
    `.trim();
}

/**
 * Renders Mind Inspector view cards.
 * Epistemic rule: Displays only subjective cognition and suppresses unperceived NPC data.
 * @param {object} props
 * @returns {string}
 */
export function renderMindInspector({
    character = null,
    needs = {},
    activeGoals = [],
    values = {},
    emotions = {},
    beliefs = [],
    perspective = null,
    cameraMode = 'follow_character',
} = {}) {
    if (!character && cameraMode === 'follow_character') {
        return `
            <div class="lws-empty-state" role="region" aria-label="Mind Inspector">
                No character selected for mind inspection. Use camera follow or select a character.
            </div>
        `.trim();
    }

    const charName = escapeHtml(character?.name || 'Observer Perspective');
    const locationName = escapeHtml(perspective?.current_location?.name || perspective?.current_location_name || 'Unknown Location');

    // Needs cards
    const needDimensions = ['energy', 'nourishment', 'social', 'safety', 'morale'];
    const needsHtml = needDimensions.map(need => {
        const val = needs[need] ?? 50;
        return renderProgressBar(val, 0, 100, need.charAt(0).toUpperCase() + need.slice(1));
    }).join('\n');

    // Goals cards
    let goalsHtml = '<div class="lws-empty-state">No active goals</div>';
    if (Array.isArray(activeGoals) && activeGoals.length > 0) {
        goalsHtml = activeGoals.map(g => `
            <div class="lws-goal-item">
                <strong>${escapeHtml(g.title || g.description || 'Goal')}</strong>
                <span class="lws-badge lws-badge-accent">Priority ${escapeHtml(String(g.priority || 50))}</span>
            </div>
        `).join('\n');
    }

    // Beliefs cards
    let beliefsHtml = '<div class="lws-empty-state">No recorded beliefs</div>';
    if (Array.isArray(beliefs) && beliefs.length > 0) {
        beliefsHtml = beliefs.map(b => `
            <div class="lws-belief-item">
                <span class="lws-belief-text">"${escapeHtml(b.statement || b.subject_key || '')}"</span>
                <span class="lws-badge">Conf ${escapeHtml(String(b.confidence || 50))}%</span>
            </div>
        `).join('\n');
    }

    return `
        <div class="lws-mind-grid" role="region" aria-label="Mind Inspector for ${charName}">
            <div class="lws-card">
                <div class="lws-card-header">
                    <span class="lws-card-title"><i class="fa-solid fa-user"></i> ${charName}</span>
                    <span class="lws-badge"><i class="fa-solid fa-location-dot"></i> ${locationName}</span>
                </div>
                <div class="lws-card-body">
                    ${needsHtml}
                </div>
            </div>
            <div class="lws-card">
                <div class="lws-card-header">
                    <span class="lws-card-title"><i class="fa-solid fa-bullseye"></i> Active Goals</span>
                </div>
                <div class="lws-card-body">
                    ${goalsHtml}
                </div>
            </div>
            <div class="lws-card">
                <div class="lws-card-header">
                    <span class="lws-card-title"><i class="fa-solid fa-lightbulb"></i> Subjective Beliefs</span>
                </div>
                <div class="lws-card-body">
                    ${beliefsHtml}
                </div>
            </div>
        </div>
    `.trim();
}

/**
 * Renders the Director Console view.
 * @param {object} props
 * @returns {string}
 */
export function renderDirectorPanel({
    characters = [],
    locations = [],
    factions = [],
    cameraMode = 'god_view',
} = {}) {
    const charOptions = characters.map(c => `
        <option value="${escapeHtml(c.lws_id)}">${escapeHtml(c.name)}</option>
    `).join('');

    const locOptions = locations.map(l => `
        <option value="${escapeHtml(l.lws_id)}">${escapeHtml(l.name)}</option>
    `).join('');

    return `
        <div class="lws-director-grid" role="region" aria-label="Director Console">
            <div class="lws-card">
                <div class="lws-card-header">
                    <span class="lws-card-title"><i class="fa-solid fa-forward"></i> Advance Fictional Time</span>
                </div>
                <div class="lws-card-body">
                    <div class="lws-form-group">
                        <label class="lws-form-label" for="lws-advance-seconds">Time Increment</label>
                        <select id="lws-advance-seconds" class="lws-select">
                            <option value="60">1 Minute (+60s)</option>
                            <option value="300">5 Minutes (+300s)</option>
                            <option value="900">15 Minutes (+900s)</option>
                            <option value="3600" selected>1 Hour (+3600s)</option>
                            <option value="21600">6 Hours (+21600s)</option>
                            <option value="86400">1 Day (+86400s)</option>
                        </select>
                    </div>
                    <button id="lws-btn-advance-time" class="lws-btn lws-btn-primary">
                        <i class="fa-solid fa-play"></i> Advance Time
                    </button>
                </div>
            </div>

            <div class="lws-card">
                <div class="lws-card-header">
                    <span class="lws-card-title"><i class="fa-solid fa-video"></i> Camera Focus</span>
                </div>
                <div class="lws-card-body">
                    <div class="lws-form-group">
                        <label class="lws-form-label" for="lws-camera-mode-select">Camera Mode</label>
                        <select id="lws-camera-mode-select" class="lws-select">
                            <option value="god_view" ${cameraMode === 'god_view' ? 'selected' : ''}>God View (Observer Ground Truth)</option>
                            <option value="follow_character" ${cameraMode === 'follow_character' ? 'selected' : ''}>Follow Character (Subjective Perspective)</option>
                            <option value="observe_location" ${cameraMode === 'observe_location' ? 'selected' : ''}>Observe Location</option>
                        </select>
                    </div>
                    <div class="lws-form-group" id="lws-camera-target-char-group">
                        <label class="lws-form-label" for="lws-camera-target-char">Target Character</label>
                        <select id="lws-camera-target-char" class="lws-select">
                            ${charOptions}
                        </select>
                    </div>
                    <div class="lws-form-group" id="lws-camera-target-loc-group" style="display:none;">
                        <label class="lws-form-label" for="lws-camera-target-loc">Target Location</label>
                        <select id="lws-camera-target-loc" class="lws-select">
                            ${locOptions}
                        </select>
                    </div>
                    <button id="lws-btn-set-camera" class="lws-btn">
                        <i class="fa-solid fa-camera"></i> Apply Camera Focus
                    </button>
                </div>
            </div>

            <div class="lws-card">
                <div class="lws-card-header">
                    <span class="lws-card-title"><i class="fa-solid fa-note-sticky"></i> Narrative Director Annotation</span>
                </div>
                <div class="lws-card-body">
                    <div class="lws-form-group">
                        <label class="lws-form-label" for="lws-director-note-text">Director Event Narrative</label>
                        <textarea id="lws-director-note-text" class="lws-input-pole" rows="3" placeholder="A loud thunderclap echoes in the distance..."></textarea>
                    </div>
                    <button id="lws-btn-submit-note" class="lws-btn">
                        <i class="fa-solid fa-bullhorn"></i> Inject Event Note
                    </button>
                </div>
            </div>
        </div>
    `.trim();
}

/**
 * Renders the complete workspace DOM shell.
 * @param {object} props
 * @returns {string}
 */
export function renderWorkspaceShell(props = {}) {
    const topBarHtml = renderTopBar(props);
    const navTabsHtml = renderNavTabs(props.activeTab || 'world');

    return `
        <main id="lws-workspace" role="main" aria-label="Living World Simulator Workspace">
            ${topBarHtml}
            ${navTabsHtml}
            <div class="lws-main-layout">
                <section id="lws-panel-world" class="lws-view-panel ${props.activeTab === 'world' ? 'lws-active' : ''}" role="tabpanel" aria-labelledby="lws-tab-world">
                    <!-- World Browser content mounted dynamically -->
                </section>
                <section id="lws-panel-narrative" class="lws-view-panel ${props.activeTab === 'narrative' ? 'lws-active' : ''}" role="tabpanel" aria-labelledby="lws-tab-narrative">
                    <div class="lws-narrative-container">
                        <div id="lws-narrative-stream-holder"></div>
                        <div class="lws-composer-bar">
                            <textarea id="lws-narrative-input" class="lws-input-pole" rows="2" placeholder="Send prompt or action to Living World..." aria-label="Prompt input"></textarea>
                            <button id="lws-btn-generate-turn" class="lws-btn lws-btn-primary" aria-label="Generate turn">
                                <i class="fa-solid fa-paper-plane"></i> Generate
                            </button>
                        </div>
                    </div>
                </section>
                <section id="lws-panel-mind" class="lws-view-panel ${props.activeTab === 'mind' ? 'lws-active' : ''}" role="tabpanel" aria-labelledby="lws-tab-mind">
                    <div id="lws-mind-inspector-holder"></div>
                </section>
                <section id="lws-panel-roster" class="lws-view-panel ${props.activeTab === 'roster' ? 'lws-active' : ''}" role="tabpanel" aria-labelledby="lws-tab-roster">
                    <div id="lws-authored-roster-holder"></div>
                </section>
                <section id="lws-panel-director" class="lws-view-panel ${props.activeTab === 'director' ? 'lws-active' : ''}" role="tabpanel" aria-labelledby="lws-tab-director">
                    <div id="lws-director-console-holder"></div>
                </section>
            </div>
        </main>
    `.trim();
}
