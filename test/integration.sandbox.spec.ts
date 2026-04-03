import { test, expect, beforeAll, afterAll, describe, vi } from "vitest";
import { unstable_dev, UnstableDevWorker } from "wrangler";
import path from "path";
import { processSynthesisQueue } from "../src/queue/Synthesizer";

describe("API-Only D1 Integration Sandbox", () => {
    let storageWorker: UnstableDevWorker;

    // Boot the authentic cf-mcp-storage Worker using Wrangler's programmatic API
    beforeAll(async () => {
        const storagePath = path.resolve(__dirname, "../../cf-mcp-storage/src/index.ts");
        const persistPath = path.resolve(__dirname, "../../cf-mcp-storage/.wrangler/state/v3/sandbox");
        
        // Ensure clean D1 schema
        const { execSync } = require('child_process');
        execSync(`rm -rf "${persistPath}"`);
        execSync(`npx wrangler d1 execute DB --local --persist-to="${persistPath}" --file="../cf-mcp/schema.sql"`, { 
            cwd: path.resolve(__dirname, "../../cf-mcp-storage"),
            stdio: 'ignore'
        });
        
        // Boot the storage boundary which actively wraps our local D1 Database 'DB'
        storageWorker = await unstable_dev(storagePath, {
            experimental: { disableExperimentalWarning: true },
            config: path.resolve(__dirname, "../../cf-mcp-storage/wrangler.toml"),
            persistTo: persistPath
        });
    }, 15000);

    afterAll(async () => {
        if (storageWorker) {
            await storageWorker.stop();
        }
    });

    test("Synthesizer perfectly integrates across the network D1 bindings", async () => {
        // Construct the Env injection 
        const mockEnv: any = {
            AI: { run: vi.fn().mockResolvedValue({ 
                response: "Sandbox mock extraction",
                data: [new Array(384).fill(0.99)] 
            })},
            SEMANTIC_INDEX: { upsert: vi.fn(), deleteByIds: vi.fn() },
            // Most critical hook: Point STORAGE_SERVICE dynamically to the booted unstable_dev fetcher!
            STORAGE_SERVICE: { fetch: async (req: Request) => await storageWorker.fetch(req.url, {
                method: req.method,
                headers: Object.fromEntries(req.headers),
                body: req.body ? await req.text() : undefined
            })}
        };

        const mockAck = vi.fn();
        const testEventId = "test-sandbox-id-" + Date.now();
        
        // 1. First, we inject a raw Event into the Storage ledger natively to prime the D1 Constraints
        const primeReq = new Request('http://internal/events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                event_id: testEventId,
                session_id: "sandbox_session",
                timestamp: Date.now(),
                actor: "QA_Agent",
                type: "SANDBOX_TEST",
                payload: JSON.stringify({ hello: "world" }),
                sync_status: "synced"
            })
        });
        const primeResp = await mockEnv.STORAGE_SERVICE.fetch(primeReq);
        if (!primeResp.ok) {
            console.error("D1 Prime Fail:", await primeResp.text());
        }
        expect(primeResp.ok).toBe(true);

        // 2. We execute the Synthesizer worker loop
        const batch: any = {
            messages: [{
                body: {
                    event_id: testEventId,
                    session_id: "sandbox_session",
                    type: "SANDBOX_TEST",
                    payload: { hello: "world" }
                },
                ack: mockAck,
                retry: vi.fn()
            }]
        };

        await processSynthesisQueue(batch, mockEnv);

        // 3. We assert the Async worker succeeded internally
        expect(mockAck).toHaveBeenCalled();

        // 4. We execute a manual Decay Cron Job to assert it finds the D1 row.
        const decayReq = new Request('http://internal/cron/decay', { method: 'POST', body: JSON.stringify({}) });
        const decayResp = await mockEnv.STORAGE_SERVICE.fetch(decayReq);
        
        let decayText = "";
        try {
            decayText = await decayResp.text();
            const decayJson: any = JSON.parse(decayText);
            
            expect(decayResp.ok).toBe(true);
            expect(decayJson.status).toBe("success");
        } catch (e) {
            console.error("Decay error text:", decayText);
            throw e;
        }
    });
});
