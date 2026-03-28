import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../src/index';

// We don't need valid API keys for tests, we just use the mock-andrey-token from cf-contracts
const mockAuthHeader = 'Bearer mock-andrey-token';

describe('Worker fetch handler', () => {
  let env: any;
  let ctx: any;

  beforeEach(() => {
    env = {
      MCP_SECRET_TOKEN: 'abc123secret',
      DB: {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        run: vi.fn().mockResolvedValue({}),
        all: vi.fn().mockResolvedValue({ results: [] }),
        first: vi.fn().mockResolvedValue(null),
      },
      VECTORIZE_INDEX: {
        upsert: vi.fn().mockResolvedValue({}),
        query: vi.fn().mockResolvedValue({ matches: [] }),
      },
      AI: {
        run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] }),
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

  it('should return 401 if unauthorized missing header', async () => {
    const req = createRequest('POST');
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(401);
  });

  it('should return 403 if token does not map to a logical user', async () => {
    const req = createRequest('POST', { Authorization: 'Bearer unknown-token' }, { tool: 'save_memory' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(403);
  });

  it('should return 405 if not POST', async () => {
    const req = createRequest('GET', { Authorization: mockAuthHeader });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(405);
  });

  it('should handle save_memory success and log telemetry', async () => {
    const req = createRequest('POST', { Authorization: mockAuthHeader }, { tool: 'save_memory', params: { content: 'hello world' } });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.status).toBe('success');
    expect(json.id).toBeDefined();

    expect(env.DB.prepare).toHaveBeenCalledWith('INSERT INTO memories (id, user_id, namespace, content) VALUES (?, ?, ?, ?)');
    expect(env.AI.run).toHaveBeenCalledWith('@cf/baai/bge-base-en-v1.5', { text: ['hello world'] });
    expect(env.VECTORIZE_INDEX.upsert).toHaveBeenCalledWith([{
       id: expect.any(String),
       values: [0.1, 0.2, 0.3],
       metadata: { user_id: 'andrey-uid', namespace: 'personal' }
    }]);
    expect(env.TELEMETRY_SERVICE.fetch).toHaveBeenCalled();
    expect(ctx.waitUntil).toHaveBeenCalled();
  });

  it('should handle get_brain_metrics success', async () => {
    env.DB.first = vi.fn().mockResolvedValueOnce({ count: 42 }); // memories
    
    env.DB.prepare = vi.fn().mockReturnValue(env.DB);

    const req = createRequest('POST', { Authorization: mockAuthHeader }, { tool: 'get_brain_metrics' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    expect(env.DB.prepare).toHaveBeenCalledWith('SELECT COUNT(*) as count FROM memories WHERE user_id = ?');
    expect(env.DB.bind).toHaveBeenCalledWith('andrey-uid');
    const json = await res.json() as any;
    expect(json.total_memories).toBe(42);
    expect(json.vector_count).toBe(42);
    expect(json.avg_ingest_latency_ms).toBe(121);
    expect(json.avg_search_latency_ms).toBe(80);
    expect(env.TELEMETRY_SERVICE.fetch).toHaveBeenCalled();
  });

  it('should handle get_brain_metrics with empty DB results', async () => {
    env.DB.first = vi.fn().mockResolvedValue(null);
    env.DB.prepare = vi.fn().mockReturnValue({ bind: vi.fn().mockReturnThis(), run: vi.fn(), all: vi.fn(), first: env.DB.first });
    env.TELEMETRY_SERVICE.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    const req = createRequest('POST', { Authorization: mockAuthHeader }, { tool: 'get_brain_metrics' });
    const res = await worker.fetch(req, env, ctx);
    const json = await res.json() as any;
    expect(json.total_memories).toBe(0);
    expect(json.vector_count).toBe(0);
    expect(json.avg_ingest_latency_ms).toBe(0);
    expect(json.avg_search_latency_ms).toBe(0);
  });

  it('should return 400 if save_memory content is missing', async () => {
    const req = createRequest('POST', { Authorization: mockAuthHeader }, { tool: 'save_memory', params: {} });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(400);
  });

  it('should return 400 if semantic_search query is missing', async () => {
    const req = createRequest('POST', { Authorization: mockAuthHeader }, { tool: 'semantic_search', params: {} });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(400);
  });

  it('should handle semantic_search success with empty matches', async () => {
    const req = createRequest('POST', { Authorization: mockAuthHeader }, { tool: 'semantic_search', params: { query: 'test' } });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.results).toEqual([]);
    expect(ctx.waitUntil).toHaveBeenCalled();
  });

  it('should handle semantic_search success with matches and missing DB rows', async () => {
    env.VECTORIZE_INDEX.query.mockResolvedValue({
      matches: [{ id: '123', score: 0.99 }]
    });
    env.DB.all.mockResolvedValue({
      results: [] // missing DB row for vector match
    });

    const req = createRequest('POST', { Authorization: mockAuthHeader }, { tool: 'semantic_search', params: { query: 'test', limit: 2 } });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.results).toHaveLength(1);
    expect(json.results[0].content).toBe(null);
  });

  it('should handle semantic_search success with matches', async () => {
    env.VECTORIZE_INDEX.query.mockResolvedValue({
      matches: [{ id: '123', score: 0.99 }]
    });
    env.DB.all.mockResolvedValue({
      results: [{ id: '123', content: 'db text content' }]
    });

    const req = createRequest('POST', { Authorization: mockAuthHeader }, { tool: 'semantic_search', params: { query: 'test', limit: 2 } });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    const json = await res.json() as any;
    expect(json.results).toHaveLength(1);
    expect(json.results[0].content).toBe('db text content');
  });

  it('should handle export_brain success', async () => {
    env.DB.all.mockResolvedValueOnce({
      results: [{ id: '1', namespace: 'personal', content: 'hello' }]
    });

    const req = createRequest('POST', { Authorization: mockAuthHeader }, { tool: 'export_brain' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(200);
    expect(env.DB.prepare).toHaveBeenCalledWith('SELECT id, user_id, namespace, content, created_at FROM memories WHERE user_id = ?');
    expect(env.DB.bind).toHaveBeenCalledWith('andrey-uid');
    
    const json = await res.json() as any;
    expect(json.summaries).toHaveLength(1);
    expect(json.summaries[0].namespace).toBe('personal');
  });
  
  it('should return 404 for unknown tool', async () => {
    const req = createRequest('POST', { Authorization: mockAuthHeader }, { tool: 'unknown_tool' });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(404);
  });

  it('should return 500 on internal exception', async () => {
    env.DB.prepare.mockImplementation(() => {
      throw new Error('DB Crash');
    });
    const req = createRequest('POST', { Authorization: mockAuthHeader }, { tool: 'save_memory', params: { content: 'test' } });
    const res = await worker.fetch(req, env, ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain('DB Crash');
  });
});
