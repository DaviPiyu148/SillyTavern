/**
 * Living World Simulator (LWS) - UI Import Wizard
 * Exposes Phase 11 two-stage preview, conflict policy selection, and HMAC commit workflow.
 */

import { lwsState } from './state.js';
import { lwsApi } from './api.js';
import { escapeHtml } from './templates.js';

export class LwsUiImportWizard {
    constructor({ state = lwsState, api = lwsApi } = {}) {
        this.state = state;
        this.api = api;
        this.container = null;
        this.currentPreview = null;
        this.importType = 'card'; // card | worldinfo | freeform | manifest
    }

    mount(parent) {
        this.container = typeof parent === 'string' ? document.querySelector(parent) : parent;
        if (!this.container) return;
        this.render();
    }

    render() {
        if (!this.container) return;
        const worldId = this.state.getState().world_lws_id;

        this.container.innerHTML = `
            <div class="lws-card" role="region" aria-label="Phase 11 Import Wizard">
                <div class="lws-card-header">
                    <span class="lws-card-title"><i class="fa-solid fa-wand-magic-sparkles"></i> LWS Import & Exchange Wizard</span>
                </div>
                <div class="lws-card-body">
                    <div class="lws-form-group">
                        <label class="lws-form-label" for="lws-import-type-select">Import Format</label>
                        <select id="lws-import-type-select" class="lws-select">
                            <option value="card" selected>Character Card (PNG Chunk / V2 / V3 JSON)</option>
                            <option value="worldinfo">Lorebook / World Info JSON</option>
                            <option value="freeform">Freeform World Scenario Text</option>
                            <option value="manifest">Canonical LWS World Manifest (JSON / YAML)</option>
                        </select>
                    </div>

                    <!-- Stage 1: Input / File Drop -->
                    <div id="lws-import-stage-1">
                        <div id="lws-import-dropzone" class="lws-wizard-dropzone">
                            <i class="fa-solid fa-cloud-arrow-up" style="font-size: 2em; margin-bottom: 8px;"></i>
                            <div>Click or drop file here to preview</div>
                            <input type="file" id="lws-import-file-input" style="display:none;" />
                        </div>

                        <div id="lws-freeform-input-container" style="display:none; margin-top: 12px;">
                            <label class="lws-form-label" for="lws-freeform-text">Freeform Scenario Outline</label>
                            <textarea id="lws-freeform-text" class="lws-input-pole" rows="6" placeholder="Paste freeform lore, faction descriptions, and world outlines..."></textarea>
                            <button id="lws-btn-preview-freeform" class="lws-btn lws-btn-primary" style="margin-top: 8px;">
                                <i class="fa-solid fa-eye"></i> Analyze Freeform Text
                            </button>
                        </div>
                    </div>

                    <!-- Stage 2: Preview & Commit (Initially Hidden) -->
                    <div id="lws-import-stage-2" style="display:none; margin-top: 16px;">
                        <h4>Stage 2: Preview & Conflict Review</h4>
                        <div id="lws-preview-summary" style="margin-bottom: 8px;"></div>
                        <div class="lws-form-group">
                            <label class="lws-form-label" for="lws-conflict-policy">Conflict Resolution Policy</label>
                            <select id="lws-conflict-policy" class="lws-select">
                                <option value="REJECT">REJECT (Fail on any name conflict)</option>
                                <option value="RENAME" selected>RENAME (Append counter to conflicting entities)</option>
                                <option value="REPLACE">REPLACE (Overwrite existing entity in-place)</option>
                                <option value="MERGE">MERGE (Merge attributes where applicable)</option>
                            </select>
                        </div>
                        <pre id="lws-preview-diff" class="lws-diff-preview"></pre>
                        <div style="display:flex; gap:8px; margin-top: 12px;">
                            <button id="lws-btn-commit-import" class="lws-btn lws-btn-primary">
                                <i class="fa-solid fa-check"></i> Commit Import (HMAC Verified)
                            </button>
                            <button id="lws-btn-cancel-import" class="lws-btn">Cancel</button>
                        </div>
                    </div>
                </div>
            </div>
        `;

        this._attachListeners();
    }

    _attachListeners() {
        if (!this.container) return;

        const typeSelect = this.container.querySelector('#lws-import-type-select');
        const dropzone = this.container.querySelector('#lws-import-dropzone');
        const fileInput = this.container.querySelector('#lws-import-file-input');
        const freeformContainer = this.container.querySelector('#lws-freeform-input-container');

        typeSelect.addEventListener('change', () => {
            this.importType = typeSelect.value;
            if (this.importType === 'freeform') {
                dropzone.style.display = 'none';
                freeformContainer.style.display = 'block';
            } else {
                dropzone.style.display = 'block';
                freeformContainer.style.display = 'none';
            }
        });

        dropzone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (file) {
                await this._handleFileUpload(file);
            }
        });

        const btnPreviewFreeform = this.container.querySelector('#lws-btn-preview-freeform');
        if (btnPreviewFreeform) {
            btnPreviewFreeform.addEventListener('click', async () => {
                const text = this.container.querySelector('#lws-freeform-text').value;
                if (!text.trim()) return;
                const worldId = this.state.getState().world_lws_id;
                const preview = await this.api.previewFreeform({ text, world_lws_id: worldId });
                this._displayPreview(preview);
            });
        }

        const btnCommit = this.container.querySelector('#lws-btn-commit-import');
        if (btnCommit) {
            btnCommit.addEventListener('click', async () => {
                await this._commitCurrentImport();
            });
        }

        const btnCancel = this.container.querySelector('#lws-btn-cancel-import');
        if (btnCancel) {
            btnCancel.addEventListener('click', () => {
                this.currentPreview = null;
                this.render();
            });
        }
    }

    async _handleFileUpload(file) {
        const worldId = this.state.getState().world_lws_id;
        const formData = new FormData();
        formData.append('file', file);
        if (worldId) formData.append('world_lws_id', worldId);

        let preview = null;
        if (this.importType === 'card') {
            preview = await this.api.previewCharacterCard(formData);
        } else if (this.importType === 'worldinfo') {
            preview = await this.api.previewWorldInfo(formData);
        } else if (this.importType === 'manifest') {
            const text = await file.text();
            preview = await this.api.previewManifest(text, file.name.endsWith('.yaml') || file.name.endsWith('.yml') ? 'yaml' : 'json');
        }

        this._displayPreview(preview);
    }

    _displayPreview(preview) {
        this.currentPreview = preview;
        const stage1 = this.container.querySelector('#lws-import-stage-1');
        const stage2 = this.container.querySelector('#lws-import-stage-2');
        const summary = this.container.querySelector('#lws-preview-summary');
        const diff = this.container.querySelector('#lws-preview-diff');

        if (stage1) stage1.style.display = 'none';
        if (stage2) stage2.style.display = 'block';

        if (summary) {
            summary.innerHTML = `
                <div class="lws-badge lws-badge-accent">Preview Token: ${escapeHtml(preview?.preview_token?.slice(0, 16) || 'N/A')}...</div>
                <div style="margin-top: 6px;">Total entities parsed: ${preview?.candidate_entities ? Object.keys(preview.candidate_entities).length : 1}</div>
            `;
        }

        if (diff) {
            diff.textContent = JSON.stringify(preview?.candidate_entities || preview?.character || preview, null, 2);
        }
    }

    async _commitCurrentImport() {
        if (!this.currentPreview) return;
        const worldId = this.state.getState().world_lws_id;
        const policy = this.container.querySelector('#lws-conflict-policy').value || 'RENAME';
        const token = this.currentPreview.preview_token;

        if (this.importType === 'card') {
            await this.api.commitCharacterCard(worldId, {
                preview_token: token,
                conflict_policy: policy,
            });
        } else if (this.importType === 'worldinfo') {
            await this.api.commitWorldInfo(worldId, {
                preview_token: token,
                conflict_policy: policy,
            });
        } else if (this.importType === 'freeform') {
            await this.api.commitFreeform(worldId, {
                preview_token: token,
                conflict_policy: policy,
            });
        } else if (this.importType === 'manifest') {
            await this.api.commitManifest({
                preview_token: token,
                conflict_policy: policy,
            });
        }

        alert('Import committed successfully!');
        this.currentPreview = null;
        this.render();
    }
}
