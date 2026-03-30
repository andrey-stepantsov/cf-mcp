import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index';
import { generateKeyFromString, encryptText } from '../src/crypto';

// We don't need valid API keys for tests, we just use the mock-andrey-token from cf-contracts
const mockAuthHeader = 'Bearer mock-andrey-token';
const mockBlindKey = 'TestBlindKey123';

describe('Worker fetch handler', () => {
  let env: any;
  let ctx: any;

  beforeEach(() => {
    env = {
      MCP_SECRET_TOKEN: 'abc123secret',
      STORAGE_SERVICE: {
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "success", id: "123" }), { status: 200 }))
      },
      AI: {
        run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]], shape: [1, 3] }),
      },
      TELEMETRY_SERVICE: {
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({ avg_ingest_latency_ms: 121, avg_search_latency_ms: 80 }), { status: 200 }))
      }
    };

    ctx = {
      waitUntil: vi.fn(),
    };
  });

  const createRequest = (method: string, headers?: any, body?: any) => {
    return new Request('http://localhost/mcp/call', {
      method,
      headers: new Headers(headers || {}),
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  it('should return 401 if unauthorized', async () => {
    const req = createRequest('POST', {});
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(401);
  });

  it('should return 403 if token does not map to a logical user', async () => {
    const req = createRequest('POST', { Authorization: 'Bearer unknown-token' }, { tool: 'save_memory' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(403);
  });

  it('should return 403 if X-Blind-Key is missing', async () => {
    const req = createRequest('POST', { Authorization: mockAuthHeader }, { tool: 'save_memory' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(403);
  });

  it('should return 405 if not POST', async () => {
    const req = createRequest('GET', { Authorization: mockAuthHeader, 'X-Blind-Key': mockBlindKey });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(405);
  });

  it('should handle save_memory success and log telemetry', async () => {
    const req = createRequest('POST', { Authorization: mockAuthHeader, 'X-Blind-Key': mockBlindKey }, { tool: 'save_memory', params: { content: 'hello world' } });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.status).toBe('success');
    expect(json.id).toBeDefined();

    expect(env.STORAGE_SERVICE.fetch).toHaveBeenCalled();
    expect(env.AI.run).toHaveBeenCalledWith('@cf/baai/bge-base-en-v1.5', { text: ['hello world'] });
    expect(env.TELEMETRY_SERVICE.fetch).toHaveBeenCalled();
    expect(ctx.waitUntil).toHaveBeenCalled();
  });

  it('should handle get_brain_metrics success', async () => {
    env.STORAGE_SERVICE.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ total_memories: 42 }), { status: 200 }));
    
    const req = createRequest('POST', { Authorization: mockAuthHeader, 'X-Blind-Key': mockBlindKey }, { tool: 'get_brain_metrics' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    
    const json = await res.json() as any;
    expect(json.total_memories).toBe(42);
    expect(json.avg_ingest_latency_ms).toBe(121);
    expect(json.avg_search_latency_ms).toBe(80);
    expect(env.TELEMETRY_SERVICE.fetch).toHaveBeenCalled();
  });

  it('should return 400 if save_memory content is missing', async () => {
    const req = createRequest('POST', { Authorization: mockAuthHeader, 'X-Blind-Key': mockBlindKey }, { tool: 'save_memory', params: {} });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(400);
  });

  it('should handle semantic_search success with decrypted matches', async () => {
    const cryptoKey = await generateKeyFromString(mockBlindKey);
    const encryptedContent = await encryptText('db text content', cryptoKey);

    env.STORAGE_SERVICE.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ id: '123', score: 0.99, encrypted_content: encryptedContent }],
        debug_matches: []
    }), { status: 200 }));

    const req = createRequest('POST', { Authorization: mockAuthHeader, 'X-Blind-Key': mockBlindKey }, { tool: 'semantic_search', params: { query: 'test', limit: 2 } });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.results).toHaveLength(1);
    expect(json.results[0].content).toBe('db text content');
  });

  it('should handle export_brain success with decrypted summaries', async () => {
    const cryptoKey = await generateKeyFromString(mockBlindKey);
    const encryptedContent = await encryptText('hello', cryptoKey);

    env.STORAGE_SERVICE.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
      summaries: [{ id: '1', namespace: 'personal', content: encryptedContent }]
    }), { status: 200 }));

    const req = createRequest('POST', { Authorization: mockAuthHeader, 'X-Blind-Key': mockBlindKey }, { tool: 'export_brain' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    
    const json = await res.json() as any;
    expect(json.summaries).toHaveLength(1);
    expect(json.summaries[0].namespace).toBe('personal');
    expect(json.summaries[0].content).toBe('hello');
  });

  it('should handle semantic_search success and catch decrypt failures', async () => {
    env.STORAGE_SERVICE.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
        results: [{ id: '123', score: 0.99, encrypted_content: 'invalidly_encrypted' }],
        debug_matches: []
    }), { status: 200 }));
    const req = createRequest('POST', { Authorization: mockAuthHeader, 'X-Blind-Key': mockBlindKey }, { tool: 'semantic_search', params: { query: 'test' } });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.results).toHaveLength(0);
  });

  it('should handle export_brain success and catch decrypt failures', async () => {
    env.STORAGE_SERVICE.fetch.mockResolvedValueOnce(new Response(JSON.stringify({
        summaries: [{ id: '123', content: 'invalidly_encrypted', namespace: 'personal' }]
    }), { status: 200 }));
    const req = createRequest('POST', { Authorization: mockAuthHeader, 'X-Blind-Key': mockBlindKey }, { tool: 'export_brain' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.summaries).toHaveLength(0);
  });
  
  it('should run scheduled task successfully', async () => {
    env.STORAGE_SERVICE.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ tenants: ['tenantA'] })));
    const ctxScheduled = { waitUntil: vi.fn() };
    await worker.scheduled!({}, env, ctxScheduled);
    expect(ctxScheduled.waitUntil).toHaveBeenCalled();
  });
  
  it('should run scheduled task with default tenants on fetch error', async () => {
    env.STORAGE_SERVICE.fetch.mockRejectedValueOnce(new Error("Network Error"));
    const ctxScheduled = { waitUntil: vi.fn() };
    await worker.scheduled!({}, env, ctxScheduled);
    expect(ctxScheduled.waitUntil).toHaveBeenCalled();
  });

  it('should return 404 for unknown tool', async () => {
    const req = createRequest('POST', { Authorization: mockAuthHeader, 'X-Blind-Key': mockBlindKey }, { tool: 'unknown_tool' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(404);
  });

  it('should return 500 on internal exception', async () => {
    env.STORAGE_SERVICE.fetch.mockRejectedValue(new Error('Storage Crash'));
    
    const req = createRequest('POST', { Authorization: mockAuthHeader, 'X-Blind-Key': mockBlindKey }, { tool: 'save_memory', params: { content: 'test' } });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('Storage Crash');
  });
});
