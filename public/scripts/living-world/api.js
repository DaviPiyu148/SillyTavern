/**
 * Living World Simulator (LWS) - Typed REST API Client
 * Wraps canonical LWS REST endpoints under /api/living-world/*
 */

export class LwsApiClient {
    constructor({ baseUrl = '', getHeaders = null } = {}) {
        this.baseUrl = baseUrl;
        this.getHeaders = getHeaders;
    }

    setBaseUrl(url) {
        this.baseUrl = url.replace(/\/$/, '');
    }

    _buildHeaders(omitContentType = false) {
        let headers = {};
        if (typeof this.getHeaders === 'function') {
            try {
                headers = { ...this.getHeaders({ omitContentType }) };
            } catch {
                // Ignore failure in non-browser context
            }
        } else if (typeof globalThis.getRequestHeaders === 'function') {
            try {
                headers = { ...globalThis.getRequestHeaders({ omitContentType }) };
            } catch {
                // Ignore failure
            }
        }

        if (!omitContentType && !headers['Content-Type']) {
            headers['Content-Type'] = 'application/json';
        }
        return headers;
    }

    async _fetch(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const omitContentType = options.body instanceof FormData || options.omitContentType;
        const headers = {
            ...this._buildHeaders(omitContentType),
            ...(options.headers || {}),
        };

        const fetchOptions = {
            ...options,
            headers,
        };

        const res = await (globalThis.fetch || fetch)(url, fetchOptions);

        if (!res.ok) {
            let errorBody = {};
            try {
                errorBody = await res.json();
            } catch {
                // Not JSON
            }
            const error = new Error(errorBody.error || `HTTP ${res.status} ${res.statusText}`);
            error.status = res.status;
            error.data = errorBody;
            throw error;
        }

        if (res.status === 204) {
            return null;
        }

        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return await res.json();
        }
        return await res.text();
    }

    // =========================================================================
    // 1. World Management
    // =========================================================================
    async listWorlds() {
        return await this._fetch('/api/living-world/worlds');
    }

    async createWorld(data) {
        return await this._fetch('/api/living-world/worlds', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getWorld(worldId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}`);
    }

    async updateWorld(worldId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async deleteWorld(worldId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}`, {
            method: 'DELETE',
        });
    }

    // =========================================================================
    // 2. Authored Roster
    // =========================================================================
    // Characters
    async listCharacters(worldId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/characters`);
    }

    async createCharacter(worldId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/characters`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getCharacter(worldId, charId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/characters/${charId}`);
    }

    async updateCharacter(worldId, charId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/characters/${charId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async deleteCharacter(worldId, charId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/characters/${charId}`, {
            method: 'DELETE',
        });
    }

    // Locations
    async listLocations(worldId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/locations`);
    }

    async createLocation(worldId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/locations`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getLocation(worldId, locId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/locations/${locId}`);
    }

    async updateLocation(worldId, locId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/locations/${locId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async deleteLocation(worldId, locId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/locations/${locId}`, {
            method: 'DELETE',
        });
    }

    // Factions
    async listFactions(worldId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/factions`);
    }

    async createFaction(worldId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/factions`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getFaction(worldId, factionId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/factions/${factionId}`);
    }

    async updateFaction(worldId, factionId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/factions/${factionId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async deleteFaction(worldId, factionId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/factions/${factionId}`, {
            method: 'DELETE',
        });
    }

    // Faction Members
    async listFactionMembers(worldId, factionId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/factions/${factionId}/members`);
    }

    async addFactionMember(worldId, factionId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/factions/${factionId}/members`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async removeFactionMember(worldId, factionId, charId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/factions/${factionId}/members/${charId}`, {
            method: 'DELETE',
        });
    }

    // World Rules
    async listWorldRules(worldId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/world-rules`);
    }

    async createWorldRule(worldId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/world-rules`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getWorldRule(worldId, ruleId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/world-rules/${ruleId}`);
    }

    async updateWorldRule(worldId, ruleId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/world-rules/${ruleId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async deleteWorldRule(worldId, ruleId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/world-rules/${ruleId}`, {
            method: 'DELETE',
        });
    }

    // Ambient Archetypes
    async listAmbientArchetypes(worldId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/ambient-archetypes`);
    }

    async createAmbientArchetype(worldId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/ambient-archetypes`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getAmbientArchetype(worldId, archetypeId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/ambient-archetypes/${archetypeId}`);
    }

    async updateAmbientArchetype(worldId, archetypeId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/ambient-archetypes/${archetypeId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async deleteAmbientArchetype(worldId, archetypeId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/ambient-archetypes/${archetypeId}`, {
            method: 'DELETE',
        });
    }

    // Scenarios
    async listScenarios(worldId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/scenarios`);
    }

    async createScenario(worldId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/scenarios`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getScenario(worldId, scenarioId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/scenarios/${scenarioId}`);
    }

    async updateScenario(worldId, scenarioId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/scenarios/${scenarioId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async deleteScenario(worldId, scenarioId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/scenarios/${scenarioId}`, {
            method: 'DELETE',
        });
    }

    // Scenario Roster
    async addScenarioCharacter(worldId, scenarioId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/scenarios/${scenarioId}/characters`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async removeScenarioCharacter(worldId, scenarioId, charId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/scenarios/${scenarioId}/characters/${charId}`, {
            method: 'DELETE',
        });
    }

    // Prompt Config
    async createPromptConfig(worldId, data = {}) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/prompt-config`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getPromptConfig(worldId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/prompt-config`);
    }

    async updatePromptConfig(worldId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/prompt-config`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    // =========================================================================
    // 3. Phase 11 Import & Export
    // =========================================================================
    async previewCharacterCard(formData) {
        return await this._fetch('/api/living-world/import/character/preview', {
            method: 'POST',
            body: formData,
        });
    }

    async commitCharacterCard(worldId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/import/character`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async previewWorldInfo(formData) {
        return await this._fetch('/api/living-world/import/worldinfo/preview', {
            method: 'POST',
            body: formData,
        });
    }

    async commitWorldInfo(worldId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/import/worldinfo`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async previewFreeform(data) {
        return await this._fetch('/api/living-world/import/freeform/preview', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async commitFreeform(worldId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/import/freeform`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async previewManifest(manifestText, format = 'json') {
        const contentType = format === 'yaml' ? 'application/x-yaml' : 'application/json';
        return await this._fetch('/api/living-world/import/manifest/preview', {
            method: 'POST',
            headers: { 'Content-Type': contentType },
            body: manifestText,
        });
    }

    async commitManifest(data) {
        return await this._fetch('/api/living-world/import/manifest/commit', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async exportManifest(worldId, format = 'json') {
        return await this._fetch(`/api/living-world/worlds/${worldId}/export/manifest?format=${format}`);
    }

    // =========================================================================
    // 4. Simulation Runtime
    // =========================================================================
    async listSimulations(worldId) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/simulations`);
    }

    async createSimulation(worldId, data) {
        return await this._fetch(`/api/living-world/worlds/${worldId}/simulations`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async getSimulation(simId) {
        return await this._fetch(`/api/living-world/simulations/${simId}`);
    }

    async updateSimulation(simId, data) {
        return await this._fetch(`/api/living-world/simulations/${simId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async deleteSimulation(simId) {
        return await this._fetch(`/api/living-world/simulations/${simId}`, {
            method: 'DELETE',
        });
    }

    async listSimulationCharacters(simId) {
        return await this._fetch(`/api/living-world/simulations/${simId}/characters`);
    }

    async getSimulationCharacter(simId, charId) {
        return await this._fetch(`/api/living-world/simulations/${simId}/characters/${charId}`);
    }

    async updateSimulationCharacter(simId, charId, data) {
        return await this._fetch(`/api/living-world/simulations/${simId}/characters/${charId}`, {
            method: 'PATCH',
            body: JSON.stringify(data),
        });
    }

    async getRoutines(simId, charId) {
        return await this._fetch(`/api/living-world/simulations/${simId}/characters/${charId}/routines`);
    }

    async updateRoutines(simId, charId, data) {
        return await this._fetch(`/api/living-world/simulations/${simId}/characters/${charId}/routines`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }

    // =========================================================================
    // 5. Camera & Perspectives
    // =========================================================================
    async getSimulationCamera(simId, cameraName = 'default') {
        return await this._fetch(`/api/living-world/simulations/${simId}/camera?camera_name=${encodeURIComponent(cameraName)}`);
    }

    async setSimulationCamera(simId, data) {
        const payload = { ...data };
        if (payload.target_character_lws_id && !payload.target_character_id) {
            payload.target_character_id = payload.target_character_lws_id;
        }
        if (payload.target_location_lws_id && !payload.target_location_id) {
            payload.target_location_id = payload.target_location_lws_id;
        }
        return await this._fetch(`/api/living-world/simulations/${simId}/camera`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    async getSubjectivePerspective(simId, charId) {
        return await this._fetch(`/api/living-world/simulations/${simId}/characters/${charId}/perspective`);
    }

    async getCharacterPerspective(simId, charId) {
        return await this.getSubjectivePerspective(simId, charId);
    }

    async getObserverPerspective(simId, cameraName = 'default') {
        return await this._fetch(`/api/living-world/simulations/${simId}/observer/perspective?camera_name=${encodeURIComponent(cameraName)}`);
    }

    // =========================================================================
    // 6. Temporal Progression
    // =========================================================================
    async advanceTime(simId, data = {}) {
        const payload = { ...data };
        if (payload.advance_seconds !== undefined && payload.duration_seconds === undefined) {
            payload.duration_seconds = payload.advance_seconds;
            delete payload.advance_seconds;
        }
        return await this._fetch(`/api/living-world/simulations/${simId}/time-advance`, {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    // =========================================================================
    // 7. Narrative Generation & Turns
    // =========================================================================
    async listTurns(simId) {
        return await this._fetch(`/api/living-world/simulations/${simId}/turns`);
    }

    async generateTurn(simId, data) {
        return await this._fetch(`/api/living-world/simulations/${simId}/generate`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    // =========================================================================
    // 8. Cognition & Director Interventions
    // =========================================================================
    async getCharacterCognition(simId, charId) {
        return await this._fetch(`/api/living-world/simulations/${simId}/characters/${charId}/cognition`);
    }

    async getCharacterNeeds(simId, charId) {
        return await this._fetch(`/api/living-world/simulations/${simId}/characters/${charId}/needs`);
    }

    async modifyNeed(simId, charId, needName, value, reason = 'Director intervention') {
        return await this._fetch(`/api/living-world/simulations/${simId}/characters/${charId}/needs/${needName}`, {
            method: 'PUT',
            body: JSON.stringify({ value, reason }),
        });
    }

    async injectBelief(simId, charId, subjectKey, beliefText, confidence = 80, evidenceType = 'DIRECTOR') {
        return await this._fetch(`/api/living-world/simulations/${simId}/characters/${charId}/beliefs/${subjectKey}`, {
            method: 'PUT',
            body: JSON.stringify({ statement: beliefText, confidence, source_basis: evidenceType }),
        });
    }

    async injectGoal(simId, charId, goalData) {
        return await this._fetch(`/api/living-world/simulations/${simId}/characters/${charId}/goals`, {
            method: 'POST',
            body: JSON.stringify(goalData),
        });
    }

    async socialIntervention(simId, data) {
        return await this._fetch(`/api/living-world/simulations/${simId}/social-interventions`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async environmentIntervention(simId, data) {
        return await this._fetch(`/api/living-world/simulations/${simId}/environment-interventions`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async promoteEntity(simId, data) {
        return await this._fetch(`/api/living-world/simulations/${simId}/promotions`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    async recordDirectorNote(simId, narrative) {
        return await this._fetch(`/api/living-world/simulations/${simId}/events`, {
            method: 'POST',
            body: JSON.stringify({
                event_type: 'DIRECTOR_NOTE',
                provenance: 'director',
                payload: { note: narrative, narrative },
            }),
        });
    }
}

export const lwsApi = new LwsApiClient();
