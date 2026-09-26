import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import http from 'node:http';
import { LwsApiClient } from '../../public/scripts/living-world/api.js';

describe('LWS Typed REST API Client (lws-ui-api-client)', () => {
    let server;
    let serverUrl;
    let receivedRequests = [];
    let client;

    beforeAll(async () => {
        server = http.createServer((req, res) => {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
                receivedRequests.push({
                    method: req.method,
                    url: req.url,
                    headers: req.headers,
                    body: body ? JSON.parse(body) : null,
                });

                // Mock endpoint responses
                if (req.url === '/api/living-world/worlds' && req.method === 'GET') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ worlds: [{ lws_id: 'w-1', name: 'Avalon' }] }));
                } else if (req.url === '/api/living-world/worlds' && req.method === 'POST') {
                    res.writeHead(201, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ world: { lws_id: 'w-new', name: 'New World' } }));
                } else if (req.url.startsWith('/api/living-world/worlds/w-del') && req.method === 'DELETE') {
                    res.writeHead(204);
                    res.end();
                } else if (req.url.startsWith('/api/living-world/simulations/sim-1/time-advance') && req.method === 'POST') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ advanced_seconds: 3600 }));
                } else if (req.url.startsWith('/api/living-world/simulations/sim-1/camera') && req.method === 'GET') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ mode: 'god_view' }));
                } else if (req.url.startsWith('/api/living-world/simulations/sim-404')) {
                    res.writeHead(404, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: 'Simulation not found' }));
                } else {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ ok: true }));
                }
            });
        });

        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const addr = server.address();
        serverUrl = `http://127.0.0.1:${addr.port}`;
        client = new LwsApiClient({
            baseUrl: serverUrl,
            getHeaders: () => ({ 'X-Custom-Auth': 'test-token' }),
        });
    });

    afterAll(async () => {
        if (server) {
            await new Promise(resolve => server.close(resolve));
        }
    });

    it('attaches custom headers and serializes JSON GET request', async () => {
        receivedRequests = [];
        const res = await client.listWorlds();
        expect(res.worlds).toHaveLength(1);
        expect(res.worlds[0].name).toBe('Avalon');

        expect(receivedRequests).toHaveLength(1);
        expect(receivedRequests[0].method).toBe('GET');
        expect(receivedRequests[0].url).toBe('/api/living-world/worlds');
        expect(receivedRequests[0].headers['x-custom-auth']).toBe('test-token');
        expect(receivedRequests[0].headers['content-type']).toBe('application/json');
    });

    it('serializes POST request with JSON payload', async () => {
        receivedRequests = [];
        const res = await client.createWorld({ name: 'New World' });
        expect(res.world.name).toBe('New World');

        expect(receivedRequests).toHaveLength(1);
        expect(receivedRequests[0].method).toBe('POST');
        expect(receivedRequests[0].url).toBe('/api/living-world/worlds');
        expect(receivedRequests[0].body).toEqual({ name: 'New World' });
    });

    it('handles HTTP 204 No Content cleanly', async () => {
        receivedRequests = [];
        const res = await client.deleteWorld('w-del');
        expect(res).toBeNull();

        expect(receivedRequests).toHaveLength(1);
        expect(receivedRequests[0].method).toBe('DELETE');
        expect(receivedRequests[0].url).toBe('/api/living-world/worlds/w-del');
    });

    it('maps HTTP errors into Error objects with status and data', async () => {
        await expect(client.getSimulation('sim-404')).rejects.toThrow('Simulation not found');
        try {
            await client.getSimulation('sim-404');
        } catch (err) {
            expect(err.status).toBe(404);
            expect(err.data).toEqual({ error: 'Simulation not found' });
        }
    });

    it('dispatches temporal time advance via canonical POST /time-advance', async () => {
        receivedRequests = [];
        const res = await client.advanceTime('sim-1', { advance_seconds: 3600 });
        expect(res.advanced_seconds).toBe(3600);

        expect(receivedRequests).toHaveLength(1);
        expect(receivedRequests[0].method).toBe('POST');
        expect(receivedRequests[0].url).toBe('/api/living-world/simulations/sim-1/time-advance');
        expect(receivedRequests[0].body).toEqual({ duration_seconds: 3600 });
    });

    it('dispatches camera focus query via canonical GET /camera', async () => {
        receivedRequests = [];
        const res = await client.getSimulationCamera('sim-1', 'main');
        expect(res.mode).toBe('god_view');

        expect(receivedRequests).toHaveLength(1);
        expect(receivedRequests[0].method).toBe('GET');
        expect(receivedRequests[0].url).toContain('/api/living-world/simulations/sim-1/camera?camera_name=main');
    });
});
