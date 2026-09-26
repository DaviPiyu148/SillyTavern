import { describe, it, expect, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

// Mock utils.js before importing templates
jest.unstable_mockModule('../../public/scripts/utils.js', () => ({
    escapeHtml: (str) => String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
}));

const {
    renderWorkspaceShell,
    renderTopBar,
    renderNavTabs,
    renderTurnItem,
    renderTurnStream,
    renderMindInspector,
    renderDirectorPanel,
    renderProgressBar,
    calculateProgressMeta,
} = await import('../../public/scripts/living-world/templates.js');

describe('LWS UI Static Contracts & Conformance (lws-ui-static-contracts)', () => {
    const rootDir = path.resolve('.');

    describe('1. Semantic HTML Landmarks in Templates', () => {
        it('workspace shell renders semantic <main> with role="main"', () => {
            const shellHtml = renderWorkspaceShell({ activeTab: 'world' });
            expect(shellHtml).toMatch(/<main\s+id="lws-workspace"\s+role="main"/);
            expect(shellHtml).toMatch(/aria-label="Living World Simulator Workspace"/);
        });

        it('top status bar renders semantic <header> with role="banner"', () => {
            const topBarHtml = renderTopBar({ worldName: 'Aethelgard', simName: 'Live', fictionalClock: '2026-06-01T12:00:00Z' });
            expect(topBarHtml).toMatch(/<header\s+id="lws-top-bar"\s+role="banner"/);
            expect(topBarHtml).toContain('Aethelgard');
            expect(topBarHtml).toContain('Live');
        });

        it('tab navigation renders semantic <nav> with role="tablist"', () => {
            const navHtml = renderNavTabs('narrative');
            expect(navHtml).toMatch(/<nav\s+class="lws-nav-tabs"\s+role="tablist"/);
            expect(navHtml).toMatch(/aria-label="LWS Workspace Navigation"/);
        });

        it('workspace view panels render semantic <section> with role="tabpanel"', () => {
            const shellHtml = renderWorkspaceShell({ activeTab: 'narrative' });
            expect(shellHtml).toMatch(/<section\s+id="lws-panel-world"[^>]*role="tabpanel"/);
            expect(shellHtml).toMatch(/<section\s+id="lws-panel-narrative"[^>]*role="tabpanel"/);
            expect(shellHtml).toMatch(/<section\s+id="lws-panel-mind"[^>]*role="tabpanel"/);
            expect(shellHtml).toMatch(/<section\s+id="lws-panel-roster"[^>]*role="tabpanel"/);
            expect(shellHtml).toMatch(/<section\s+id="lws-panel-director"[^>]*role="tabpanel"/);
        });

        it('narrative turn entries render semantic <article class="lws-turn-entry">', () => {
            const turnHtml = renderTurnItem({
                turn_number: 1,
                fictional_time: '2026-06-01T12:00:00Z',
                narrative_text: 'The sun rose over the peaks.',
                dialogues: [{ speaker: 'Dave', text: 'Good morning.' }],
            });
            expect(turnHtml).toMatch(/<article\s+class="lws-turn-entry"/);
            expect(turnHtml).toMatch(/<header\s+class="lws-turn-header"/);
            expect(turnHtml).toContain('Turn 1');
            expect(turnHtml).toContain('The sun rose over the peaks.');
            expect(turnHtml).toContain('Dave');
        });
    });

    describe('2. ARIA Accessibility & Metric Contracts', () => {
        it('metric progress bars render role="progressbar" with min, max, valuenow, and label', () => {
            const barHtml = renderProgressBar(65, 0, 100, 'Energy');
            expect(barHtml).toContain('role="progressbar"');
            expect(barHtml).toContain('aria-valuenow="65"');
            expect(barHtml).toContain('aria-valuemin="0"');
            expect(barHtml).toContain('aria-valuemax="100"');
            expect(barHtml).toContain('aria-label="Energy"');
            expect(barHtml).toContain('style="width: 65%;"');
        });

        it('progress meta accurately assigns alert and warn CSS modifiers', () => {
            const alertMeta = calculateProgressMeta(20, 0, 100);
            expect(alertMeta.pct).toBe(20);
            expect(alertMeta.modClass).toBe('lws-progress-alert');

            const warnMeta = calculateProgressMeta(45, 0, 100);
            expect(warnMeta.pct).toBe(45);
            expect(warnMeta.modClass).toBe('lws-progress-warn');

            const normalMeta = calculateProgressMeta(80, 0, 100);
            expect(normalMeta.pct).toBe(80);
            expect(normalMeta.modClass).toBe('');
        });

        it('nav tabs set aria-selected="true" for the active tab and "false" for inactive tabs', () => {
            const navHtml = renderNavTabs('mind');
            expect(navHtml).toMatch(/aria-selected="true"\s+data-tab="mind"/);
            expect(navHtml).toMatch(/aria-selected="false"\s+data-tab="world"/);
            expect(navHtml).toMatch(/aria-selected="false"\s+data-tab="narrative"/);
        });

        it('turn stream container defines role="feed" with aria-label', () => {
            const streamHtml = renderTurnStream([]);
            expect(streamHtml).toMatch(/role="feed"\s+aria-label="Turn Stream"/);
        });

        it('mind inspector renders role="region" with descriptive character aria-label', () => {
            const mindHtml = renderMindInspector({
                character: { name: 'Charlotte' },
                needs: { energy: 70, nourishment: 80 },
                cameraMode: 'follow_character',
            });
            expect(mindHtml).toMatch(/role="region"\s+aria-label="Mind Inspector for Charlotte"/);
        });
    });

    describe('3. CSS Scoping & Theme Variables Conformance', () => {
        const cssPath = path.join(rootDir, 'public', 'css', 'living-world.css');
        let cssContent;

        beforeAll(() => {
            expect(fs.existsSync(cssPath)).toBe(true);
            cssContent = fs.readFileSync(cssPath, 'utf8');
        });

        it('reaches 100% selector scoping under #lws-workspace, #lws-*, or .lws-*', () => {
            // Remove comments
            const cleanCss = cssContent.replace(/\/\*[\s\S]*?\*\//g, '');
            // Match all rules (excluding @media / @keyframes declarations)
            const ruleRegex = /([^{}]+)\s*\{([^}]+)\}/g;
            let match;
            const unscopedSelectors = [];

            while ((match = ruleRegex.exec(cleanCss)) !== null) {
                const rawSelector = match[1].trim();
                // Skip at-rules like @media or @keyframes
                if (rawSelector.startsWith('@')) continue;

                // Split multiple comma-separated selectors in a single rule
                const selectors = rawSelector.split(',').map(s => s.trim());
                for (const sel of selectors) {
                    if (!sel) continue;
                    // Check if selector begins with or is scoped to #lws- or .lws-
                    const isScoped = sel.startsWith('#lws-') ||
                        sel.startsWith('.lws-') ||
                        sel.includes('#lws-workspace') ||
                        sel.startsWith('::') ||
                        sel.startsWith(':');

                    if (!isScoped) {
                        unscopedSelectors.push(sel);
                    }
                }
            }

            expect(unscopedSelectors).toEqual([]);
        });

        it('uses native SillyTavern CSS theme variables for look & feel integration', () => {
            expect(cssContent).toContain('var(--SmartThemeBodyColor');
            expect(cssContent).toContain('var(--SmartThemeBorderColor');
            expect(cssContent).toContain('var(--SmartThemeChatTintColor');
        });
    });

    describe('4. Host Integration Scaffolding & Bootstrap Contracts', () => {
        const indexPath = path.join(rootDir, 'public', 'index.html');
        let indexHtml;

        beforeAll(() => {
            expect(fs.existsSync(indexPath)).toBe(true);
            indexHtml = fs.readFileSync(indexPath, 'utf8');
        });

        it('links public/css/living-world.css in <head>', () => {
            expect(indexHtml).toMatch(/<link[^>]+href="css\/living-world\.css"[^>]*>/);
        });

        it('mounts public/scripts/living-world/index.js as an ES module script', () => {
            expect(indexHtml).toMatch(/<script\s+type="module"\s+src="scripts\/living-world\/index\.js"><\/script>/);
        });

        it('public/scripts/living-world/index.js defines coordinator lifecycle and topbar button', () => {
            const coordinatorPath = path.join(rootDir, 'public', 'scripts', 'living-world', 'index.js');
            expect(fs.existsSync(coordinatorPath)).toBe(true);
            const coordinatorSource = fs.readFileSync(coordinatorPath, 'utf8');

            expect(coordinatorSource).toContain('_injectTopBarButton');
            expect(coordinatorSource).toContain('lws-topbar-button');
            expect(coordinatorSource).toContain('hydrateSession');
            expect(coordinatorSource).toContain('export const lws');
        });
    });

    describe('5. Strict XSS Mitigation Verification', () => {
        it('safely neutralizes malicious script tags and inline event handlers across all template surfaces', () => {
            const xssVector = '<script>alert("xss")</script><img src=x onerror=alert(1)>';

            const topBar = renderTopBar({ worldName: xssVector, simName: xssVector });
            expect(topBar).not.toContain('<script>');
            expect(topBar).not.toContain('<img src=x onerror=alert(1)>');
            expect(topBar).toContain('&lt;script&gt;');
            expect(topBar).toContain('&lt;img');

            const turnItem = renderTurnItem({
                turn_number: 1,
                fictional_time: '2026-06-01T12:00:00Z',
                narrative_text: xssVector,
                dialogues: [{ speaker: xssVector, text: xssVector }],
            });
            expect(turnItem).not.toContain('<script>');
            expect(turnItem).toContain('&lt;script&gt;');

            const director = renderDirectorPanel({
                characters: [{ lws_id: 'c1', name: xssVector }],
                locations: [{ lws_id: 'l1', name: xssVector }],
            });
            expect(director).not.toContain('<script>');
            expect(director).toContain('&lt;script&gt;');
        });
    });
});
