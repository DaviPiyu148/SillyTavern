import { describe, it, expect, jest } from '@jest/globals';

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
    formatClock,
    escapeHtml,
} = await import('../../public/scripts/living-world/templates.js');

describe('LWS UI Templates & Sanitization (lws-ui-templates)', () => {
    describe('escapeHtml and XSS mitigation', () => {
        it('strictly escapes malicious script tags in top bar world and sim names', () => {
            const html = renderTopBar({
                worldName: '<script>alert("xss")</script>World',
                simName: '<img src=x onerror=alert(1)>Sim',
                cameraMode: '<b>god_view</b>',
            });

            expect(html).not.toContain('<script>');
            expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;World');
            expect(html).not.toContain('<img src=x');
            expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;Sim');
            expect(html).toContain('&lt;b&gt;god_view&lt;/b&gt;');
        });

        it('strictly escapes dialogue text and speaker names in narrative turn items', () => {
            const turn = {
                turn_number: 1,
                fictional_time: '2026-06-01T12:00:00Z',
                narrative_text: '<a href="javascript:steal()">Click me</a>',
                dialogues: [
                    { speaker: '<script>char</script>', text: 'Hello <iframe src="..."></iframe>' },
                ],
            };

            const html = renderTurnItem(turn);
            expect(html).not.toContain('<a href="javascript:steal()">');
            expect(html).toContain('&lt;a href=&quot;javascript:steal()&quot;&gt;Click me&lt;/a&gt;');
            expect(html).not.toContain('<script>char</script>');
            expect(html).toContain('&lt;script&gt;char&lt;/script&gt;');
            expect(html).not.toContain('<iframe');
            expect(html).toContain('&lt;iframe src=&quot;...&quot;&gt;&lt;/iframe&gt;');
        });

        it('strictly escapes goal titles and belief statements in Mind Inspector', () => {
            const html = renderMindInspector({
                character: { name: '<div class="evil">Dave</div>' },
                activeGoals: [{ title: '<script>badGoal()</script>', priority: 90 }],
                beliefs: [{ statement: '<svg onload=alert(1)>', confidence: 85 }],
                cameraMode: 'follow_character',
            });

            expect(html).not.toContain('<div class="evil">');
            expect(html).toContain('&lt;div class=&quot;evil&quot;&gt;Dave&lt;/div&gt;');
            expect(html).not.toContain('<script>');
            expect(html).toContain('&lt;script&gt;badGoal()&lt;/script&gt;');
            expect(html).not.toContain('<svg');
            expect(html).toContain('&lt;svg onload=alert(1)&gt;');
        });
    });

    describe('Semantic landmarks and ARIA accessibility', () => {
        it('renders workspace shell with semantic landmarks and ARIA roles', () => {
            const html = renderWorkspaceShell({ activeTab: 'narrative' });

            expect(html).toContain('<main id="lws-workspace" role="main"');
            expect(html).toContain('<header id="lws-top-bar" role="banner"');
            expect(html).toContain('<nav class="lws-nav-tabs" role="tablist"');
            expect(html).toContain('<section id="lws-panel-narrative" class="lws-view-panel lws-active" role="tabpanel"');
            expect(html).toContain('aria-labelledby="lws-tab-narrative"');
        });

        it('renders progress bar with valid progressbar ARIA attributes', () => {
            const html = renderProgressBar(25, 0, 100, 'Energy');

            expect(html).toContain('role="progressbar"');
            expect(html).toContain('aria-valuenow="25"');
            expect(html).toContain('aria-valuemin="0"');
            expect(html).toContain('aria-valuemax="100"');
            expect(html).toContain('aria-label="Energy"');
            expect(html).toContain('lws-progress-alert'); // below 30% triggers alert class
        });

        it('renders turn stream container with feed role', () => {
            const emptyHtml = renderTurnStream([]);
            expect(emptyHtml).toContain('role="feed"');
            expect(emptyHtml).toContain('lws-empty-state');

            const populatedHtml = renderTurnStream([{ turn_number: 1, narrative_text: 'The sun rises.' }]);
            expect(populatedHtml).toContain('role="feed"');
            expect(populatedHtml).toContain('<article class="lws-turn-entry"');
        });
    });

    describe('Progress calculations and clock formatting', () => {
        it('calculates progress percentage and alert classes accurately', () => {
            expect(calculateProgressMeta(20, 0, 100)).toEqual({ pct: 20, modClass: 'lws-progress-alert' });
            expect(calculateProgressMeta(45, 0, 100)).toEqual({ pct: 45, modClass: 'lws-progress-warn' });
            expect(calculateProgressMeta(80, 0, 100)).toEqual({ pct: 80, modClass: '' });
            expect(calculateProgressMeta(150, 0, 100)).toEqual({ pct: 100, modClass: '' }); // Clamped
        });

        it('formats ISO timestamps cleanly', () => {
            expect(formatClock(null)).toBe('Not running');
            const formatted = formatClock('2026-06-01T12:00:00.000Z');
            expect(formatted).toContain('2026');
            expect(formatted).toContain('12:00:00');
        });
    });
});
