/**
 * Living World Simulator (LWS) - UI Shell
 * Mounts workspace container, manages top status bar and tab navigation.
 */

import { lwsState } from './state.js';
import { renderWorkspaceShell, renderTopBar, formatClock } from './templates.js';

export class LwsUiShell {
    constructor({ state = lwsState } = {}) {
        this.state = state;
        this.container = null;
        this._bindEvents();
    }

    _bindEvents() {
        this.state.on('change:active_tab', tab => {
            this.switchTab(tab);
        });

        this.state.on('change:world_name', () => this.updateHeader());
        this.state.on('change:simulation_name', () => this.updateHeader());
        this.state.on('change:current_fictional_time', () => this.updateHeader());
        this.state.on('change:camera_mode', () => this.updateHeader());
    }

    /**
     * Mounts workspace into parent element.
     * @param {HTMLElement|string} mountTarget
     */
    mount(mountTarget) {
        let parent = typeof mountTarget === 'string' ? document.querySelector(mountTarget) : mountTarget;
        if (!parent) {
            parent = document.body;
        }

        const currentState = this.state.getState();
        const html = renderWorkspaceShell({
            worldName: currentState.world_name || 'No World',
            simName: currentState.simulation_name || 'No Simulation',
            fictionalClock: currentState.current_fictional_time,
            cameraMode: currentState.camera_mode,
            activeTab: currentState.active_tab,
        });

        const temp = document.createElement('div');
        temp.innerHTML = html;
        this.container = temp.firstElementChild;
        parent.appendChild(this.container);

        this._attachDomListeners();
        return this.container;
    }

    _attachDomListeners() {
        if (!this.container) return;

        // Tab click listeners
        const tabs = this.container.querySelectorAll('.lws-tab-btn');
        tabs.forEach(tabBtn => {
            tabBtn.addEventListener('click', () => {
                const tabId = tabBtn.getAttribute('data-tab');
                if (tabId) {
                    this.state.setState({ active_tab: tabId });
                }
            });
        });

        // Close button
        const closeBtn = this.container.querySelector('#lws-btn-drawer-close');
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.hide();
            });
        }
    }

    switchTab(tabId) {
        if (!this.container) return;

        // Update tab buttons
        const tabBtns = this.container.querySelectorAll('.lws-tab-btn');
        tabBtns.forEach(btn => {
            const matches = btn.getAttribute('data-tab') === tabId;
            btn.classList.toggle('lws-active', matches);
            btn.setAttribute('aria-selected', String(matches));
        });

        // Update view panels
        const panels = this.container.querySelectorAll('.lws-view-panel');
        panels.forEach(panel => {
            const panelTabId = panel.id.replace('lws-panel-', '');
            const matches = panelTabId === tabId;
            panel.classList.toggle('lws-active', matches);
        });
    }

    updateHeader() {
        if (!this.container) return;
        const s = this.state.getState();

        const badgeWorld = this.container.querySelector('#lws-badge-world-name');
        if (badgeWorld) badgeWorld.textContent = s.world_name || 'No World';

        const badgeSim = this.container.querySelector('#lws-badge-sim-name');
        if (badgeSim) badgeSim.textContent = s.simulation_name || 'No Simulation';

        const badgeClock = this.container.querySelector('#lws-badge-clock');
        if (badgeClock) badgeClock.textContent = formatClock(s.current_fictional_time);

        const badgeCamera = this.container.querySelector('#lws-badge-camera');
        if (badgeCamera) badgeCamera.textContent = s.camera_mode;
    }

    show() {
        if (this.container) {
            this.container.style.display = 'flex';
        }
    }

    hide() {
        if (this.container) {
            this.container.style.display = 'none';
        }
    }
}
