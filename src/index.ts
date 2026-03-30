import { identifyTenant } from "cf-contracts";
import { generateKeyFromString, encryptText, decryptText } from "./crypto";

export interface Env {
  AI: any; // Ai mapping from Cloudflare
  MCP_SECRET_TOKEN: string;
  TELEMETRY_SERVICE: Fetcher;
  STORAGE_SERVICE: Fetcher;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 1. Authorization Check (Multi-Tenant)
    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return new Response("Unauthorized", { status: 401 });
    }

    const tenant = identifyTenant(authHeader);
    if (!tenant) {
      return new Response("Forbidden: Invalid Tenant Token", { status: 403 });
    }

    // 2. Encryption Key Extraction
    const blindKeyHeader = request.headers.get("X-Blind-Key");
    if (!blindKeyHeader) {
        return new Response("Forbidden: X-Blind-Key header required for E2EE", { status: 403 });
    }

    const cryptoKey = await generateKeyFromString(blindKeyHeader);

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

        // Generate embedding
        const embeddings = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [content] });
        const vector = embeddings.data[0];

        // Encrypt the plaintext payload
        const encryptedContent = await encryptText(content, cryptoKey);

        // Send to Storage Service (Blind Database)
        const storageResp = await env.STORAGE_SERVICE.fetch(new Request('http://internal/upsert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                id: id,
                user_id: tenant.userId,
                namespace: tenant.namespace,
                encrypted_content: encryptedContent,
                vector: Array.from(vector)
            })
        }));

        if (!storageResp.ok) {
            throw new Error(`Storage Service Error: await storageResp.text()`);
        }

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
        // Query storage service for count
        const storageResp = await env.STORAGE_SERVICE.fetch(new Request('http://internal/metrics', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: tenant.userId })
        }));
        
        let vectorCount = 0;
        if (storageResp.ok) {
            const data: any = await storageResp.json();
            vectorCount = data.total_memories;
        }

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
           total_memories: vectorCount,
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

        // Query Storage Service
        const storageResp = await env.STORAGE_SERVICE.fetch(new Request('http://internal/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: tenant.userId,
                vector: Array.from(vector),
                limit: limit
            })
        }));

        let results: any[] = [];
        let debug_matches: any[] = [];
        if (storageResp.ok) {
            const data: any = await storageResp.json();
            const encryptedResults = data.results || [];
            debug_matches = data.debug_matches || [];
            
            // Decrypt results
            for (const item of encryptedResults) {
                if (item.encrypted_content) {
                    try {
                        const decryptedContent = await decryptText(item.encrypted_content, cryptoKey);
                        results.push({
                            id: item.id,
                            score: item.score,
                            content: decryptedContent
                        });
                    } catch (decErr) {
                        console.error(`Failed to decrypt matching content ${item.id}`, decErr);
                        // Skip if it fails due to legacy unencrypted data or incorrect key.
                    }
                }
            }
        }

        const latencyMs = Date.now() - startTime;

        // Log telemetry via execution context
        const debugInfo = `${query} | SHAPE: ${JSON.stringify(embeddings.shape)} | DATA_LEN: ${embeddings.data.length} | TYPE0: ${typeof embeddings.data[0]}`;
        ctx.waitUntil(
          env.TELEMETRY_SERVICE.fetch(new Request('http://internal/log/search', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ query: debugInfo, latency_ms: latencyMs })
          }))
        );

        return Response.json({ results, latency_ms: latencyMs, debug_matches });
      } else if (tool === "export_brain") {
        const storageResp = await env.STORAGE_SERVICE.fetch(new Request('http://internal/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: tenant.userId })
        }));

        let summaries: any[] = [];
        if (storageResp.ok) {
            const data: any = await storageResp.json();
            const rawSummaries = data.summaries || [];
            
            for (const row of rawSummaries) {
               try {
                   const decrypted = await decryptText(row.content, cryptoKey);
                   summaries.push({
                       ...row,
                       content: decrypted
                   });
               } catch(ex) {
                   // Ignore decrypt failures
               }
            }
        }

        return Response.json({ summaries });
      }

      return new Response("Tool not found", { status: 404 });

    } catch (err: any) {
      return new Response(`Internal error: ${err.message}`, { status: 500 });
    }
  },

  async scheduled(event: any, env: Env, ctx: ExecutionContext): Promise<void> {
    const { BrainEngine } = await import("./librarian/core/BrainEngine");
    const { CloudflareSecretVault } = await import("./librarian/adapters/CloudflareSecretVault");
    const { CloudflareD1Proxy } = await import("./librarian/adapters/CloudflareD1Proxy");
    const { CloudflareTelemetryProxy } = await import("./librarian/adapters/CloudflareTelemetryProxy");
    const { CloudflareGenerativeAI } = await import("./librarian/adapters/CloudflareGenerativeAI");

    const vault = new CloudflareSecretVault(env);
    const db = new CloudflareD1Proxy(env.STORAGE_SERVICE);
    const telemetry = new CloudflareTelemetryProxy(env.TELEMETRY_SERVICE);
    const ai = new CloudflareGenerativeAI(env.AI);

    const engine = new BrainEngine(vault, db, telemetry, ai);

    let activeTenants = ["default_tenant"];
    if ((env as any).ACTIVE_TENANTS) {
        try { activeTenants = JSON.parse((env as any).ACTIVE_TENANTS); } catch(e) {}
    }

    for (const tenantId of activeTenants) {
        ctx.waitUntil(engine.runSynthesisLoop(tenantId));
    }
  }
};
