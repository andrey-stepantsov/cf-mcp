export interface Env {
  DB: D1Database;
  VECTORIZE_INDEX: VectorizeIndex;
  AI: any; // Ai mapping from Cloudflare
  MCP_SECRET_TOKEN: string;
  TELEMETRY_SERVICE: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 1. Authorization Check
    const authHeader = request.headers.get("Authorization");
    if (!env.MCP_SECRET_TOKEN) {
      return new Response("Server not configured", { status: 500 });
    }
    if (!authHeader || authHeader !== `Bearer ${env.MCP_SECRET_TOKEN}`) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Only allow POST
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const body: any = await request.json();
      const { tool, params } = body;

      if (tool === "save_memory") {
        const startTime = Date.now();
        const content = params?.content;
        if (!content || typeof content !== "string") {
          return new Response("Bad Request: content string required", { status: 400 });
        }

        const id = crypto.randomUUID();

        // Save raw text to D1
        await env.DB.prepare("INSERT INTO memories (id, content) VALUES (?, ?)")
          .bind(id, content)
          .run();

        // Generate embedding
        const embeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [content] });
        const vector = embeddings.data[0];

        // Upsert to Vectorize
        await env.VECTORIZE_INDEX.upsert([
          {
            id: id,
            values: vector,
          }
        ]);

        const latencyMs = Date.now() - startTime;
        ctx.waitUntil(
          env.TELEMETRY_SERVICE.fetch(new Request('http://internal/log/ingestion', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ memory_id: id, latency_ms: latencyMs })
          }))
        );

        return Response.json({ status: "success", id });

      } else if (tool === "get_brain_metrics") {
        const memoryCountResult = await env.DB.prepare("SELECT COUNT(*) as count FROM memories").first();
        const vectorCount = memoryCountResult?.count || 0;
        
        let avgIngest = 0;
        let avgSearch = 0;

        try {
          const metricsRes = await env.TELEMETRY_SERVICE.fetch(new Request('http://internal/metrics', { method: 'POST' }));
          if (metricsRes.ok) {
            const mData: any = await metricsRes.json();
            avgIngest = mData.avg_ingest_latency_ms || 0;
            avgSearch = mData.avg_search_latency_ms || 0;
          }
        } catch (e) {
          console.error("Telemetry fetch failed", e);
        }

        return Response.json({
           total_memories: memoryCountResult?.count || 0,
           vector_count: vectorCount,
           avg_ingest_latency_ms: avgIngest,
           avg_search_latency_ms: avgSearch
        });
      } else if (tool === "semantic_search") {
        const query = params?.query;
        let limit = params?.limit || 3;
        if (!query || typeof query !== "string") {
          return new Response("Bad Request: query string required", { status: 400 });
        }

        const startTime = Date.now();

        // Generate query embedding
        const embeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [query] });
        const vector = embeddings.data[0];

        // Search in Vectorize
        const searchResult = await env.VECTORIZE_INDEX.query(vector, { topK: limit });

        const matchIds = searchResult.matches.map((m: any) => m.id);
        let results: any[] = [];

        if (matchIds.length > 0) {
          // Rehydrate from D1
          const placeholders = matchIds.map(() => "?").join(",");
          const { results: dbRows } = await env.DB.prepare(
            `SELECT id, content FROM memories WHERE id IN (${placeholders})`
          ).bind(...matchIds).all();

          results = searchResult.matches.map((m: any) => {
            const dbMatch = dbRows.find((r: any) => r.id === m.id);
            return {
              id: m.id,
              score: m.score,
              content: dbMatch ? dbMatch.content : null
            };
          });
        }

        const latencyMs = Date.now() - startTime;

        // Log telemetry via execution context (so it doesn't block response)
        const debugInfo = `${query} | SHAPE: ${JSON.stringify(embeddings.shape)} | DATA_LEN: ${embeddings.data.length} | TYPE0: ${typeof embeddings.data[0]}`;
        ctx.waitUntil(
          env.TELEMETRY_SERVICE.fetch(new Request('http://internal/log/search', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ query: debugInfo, latency_ms: latencyMs })
          }))
        );

        return Response.json({ results, latency_ms: latencyMs });
      }

      return new Response("Tool not found", { status: 404 });

    } catch (err: any) {
      return new Response(`Internal error: ${err.message}`, { status: 500 });
    }
  }
};
