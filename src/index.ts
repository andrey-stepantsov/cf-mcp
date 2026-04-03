import { identifyTenant } from "cf-contracts";
import { generateKeyFromString, encryptText, decryptText } from "./crypto";

export interface Env {
  PHANTOMACHINE_URL: string;
  MCP_SECRET_TOKEN: string;
  TELEMETRY_SERVICE: Fetcher;
  STORAGE_SERVICE: Fetcher;
  MCP_DO: DurableObjectNamespace;
  AI: any; // Cloudflare Workers AI binding
  SEMANTIC_INDEX: any; // VectorizeIndex
  SYNTHESIS_QUEUE: any; // Queue
}

export { McpDurableObject } from "./mcp/McpDurableObject";
import { processSynthesisQueue } from "./queue/Synthesizer";
import { processDecayCron } from "./cron/DecayJob";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 0. WebSocket Upgrade handler (Durable Object Routing)
    if (request.headers.get("Upgrade") === "websocket") {
        const url = new URL(request.url);
        // Map user to their own Durable Object based on auth string,
        // or just a single brain namespace for now:
        const id = env.MCP_DO.idFromName(url.hostname);
        const obj = env.MCP_DO.get(id);
        return obj.fetch(request);
    }

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

      if (tool === "propose_patch" || tool === "write_file_keyframe") {
        const startTime = Date.now();
        const eventId = crypto.randomUUID();

        // Encrypt the plaintext payload
        const payloadString = JSON.stringify(params || {});
        const encryptedPayload = await encryptText(payloadString, cryptoKey);

        // Send to Storage Service (Artefact Ledger)
        const storageResp = await env.STORAGE_SERVICE.fetch(new Request('http://internal/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_id: eventId,
                session_id: tenant.namespace || "default_session",
                timestamp: startTime,
                actor: tenant.userId,
                type: tool,
                payload: encryptedPayload,
                previous_event_id: null,
                sync_status: 'synced'
            })
        }));

        if (!storageResp.ok) {
            throw new Error(`Storage Service Error: ${await storageResp.text()}`);
        }

        // Phase 5.2: Dispatch to Semantic Synthesis Background Queue
        // We offload the heavy graph marker embedding to a DLQ-safe worker.
        try {
            await env.SYNTHESIS_QUEUE.send({
                event_id: eventId,
                session_id: tenant.namespace || "default_session",
                timestamp: startTime,
                type: tool,
                payload: params || {}
            });
        } catch (queueErr) {
            console.error("Failed to enqueue event for semantic synthesis:", queueErr);
        }

        const latencyMs = Date.now() - startTime;
        ctx.waitUntil(
          env.TELEMETRY_SERVICE.fetch(new Request('http://internal/log/artefact_write', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ event_id: eventId, tool: tool, latency_ms: latencyMs })
          }))
        );

        return Response.json({ status: "success", event_id: eventId });

      } else if (tool === "read_vfs_file") {
        const startTime = Date.now();
        
        // Query Storage Service for Artefact State
        const storageResp = await env.STORAGE_SERVICE.fetch(new Request('http://internal/artefact/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: tenant.userId,
                session_id: tenant.namespace || "default_session",
                file_path: params?.path
            })
        }));

        let content = "";
        if (storageResp.ok) {
            const data: any = await storageResp.json();
            if (data.encrypted_payload) {
                try {
                    content = await decryptText(data.encrypted_payload, cryptoKey);
                } catch (decErr) {
                    console.error(`Failed to decrypt artefact content`, decErr);
                }
            }
        }

        const latencyMs = Date.now() - startTime;
        ctx.waitUntil(
          env.TELEMETRY_SERVICE.fetch(new Request('http://internal/log/artefact_read', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ tool: tool, latency_ms: latencyMs })
          }))
        );

        return Response.json({ status: "success", content });
      }

      return new Response("Tool not found", { status: 404 });

    } catch (err: any) {
      return new Response(`Internal error: ${err.message}`, { status: 500 });
    }
  },

  async scheduled(event: any, env: Env, ctx: ExecutionContext): Promise<void> {
    // Phase 5.2: Semantic Decay Task
    console.log("[SemanticCron] Running memory decay procedure...");
    await processDecayCron(env);
  },

  async queue(batch: any, env: Env, ctx: ExecutionContext): Promise<void> {
    // Process items via DLQ-safe asynchronous AI vector generator
    await processSynthesisQueue(batch, env);
  }
};

