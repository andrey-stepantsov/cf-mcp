import { expect, test, vi, describe } from 'vitest';
import { CloudflareD1Proxy } from '../../src/librarian/adapters/CloudflareD1Proxy';
import { CloudflareSecretVault } from '../../src/librarian/adapters/CloudflareSecretVault';
import { CloudflareTelemetryProxy } from '../../src/librarian/adapters/CloudflareTelemetryProxy';
import { CloudflareGenerativeAI } from '../../src/librarian/adapters/CloudflareGenerativeAI';

describe('Cloudflare Adapters', () => {
    test('CloudflareSecretVault should fetch key if available', async () => {
        const env = { TENANT_VAULT: { get: vi.fn().mockResolvedValue("key-xyz") } };
        const vault = new CloudflareSecretVault(env);
        const key = await vault.fetchKey("tenant-1");
        expect(key).toBe("key-xyz");
        expect(env.TENANT_VAULT.get).toHaveBeenCalledWith("tenant-1");
    });

    test('CloudflareSecretVault should throw on missing key', async () => {
        const env = { TENANT_VAULT: { get: vi.fn().mockResolvedValue(null) } };
        const vault = new CloudflareSecretVault(env);
        await expect(vault.fetchKey("tenant-unknown")).rejects.toThrow(/Adapter Error/);
    });

    test('CloudflareD1Proxy should format inactive memories payload', async () => {
        const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ memories: [{ id: '1' }] }), { status: 200 }));
        const proxy = new CloudflareD1Proxy({ fetch: fetchSpy });

        const memories = await proxy.getInactiveMemories("tenant-xyz", 10);
        expect(memories).toEqual([{ id: '1' }]);
        
        const req = fetchSpy.mock.calls[0][0] as Request;
        expect(req.url).toContain('/librarian/inactive');
        const body = await req.json() as any;
        expect(body.user_id).toBe("tenant-xyz");
        expect(body.limit).toBe(10);
    });

    test('CloudflareTelemetryProxy should return true if criteria met', async () => {
        const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ shouldTrigger: true }), { status: 200 }));
        const proxy = new CloudflareTelemetryProxy({ fetch: fetchSpy });
        const should = await proxy.shouldTriggerSynthesis("tenant-xyz");
        expect(should).toBe(true);
    });

    test('CloudflareTelemetryProxy should return false on HTTP error', async () => {
        const fetchSpy = vi.fn().mockResolvedValue(new Response("Failure", { status: 500 }));
        const proxy = new CloudflareTelemetryProxy({ fetch: fetchSpy });
        const should = await proxy.shouldTriggerSynthesis("tenant-xyz");
        expect(should).toBe(false);
    });

    test('CloudflareD1Proxy should format synthetic node payload', async () => {
        const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 'success' }), { status: 200 }));
        const proxy = new CloudflareD1Proxy({ fetch: fetchSpy });
        await proxy.saveSyntheticNode("node1", "personal", "encrypted", ["marker1"]);
        
        const req = fetchSpy.mock.calls[0][0] as Request;
        expect(req.url).toContain('/librarian/synthesize');
        const body = await req.json() as any;
        expect(body.node_id).toBe("node1");
    });

    test('CloudflareD1Proxy should handle HTTP errors on inactive memories', async () => {
        const fetchSpy = vi.fn().mockResolvedValue(new Response("Error", { status: 500 }));
        const proxy = new CloudflareD1Proxy({ fetch: fetchSpy });
        const memories = await proxy.getInactiveMemories("tenant-xyz", 10);
        expect(memories).toEqual([]);
    });

    test('CloudflareD1Proxy should handle HTTP errors on saveSyntheticNode', async () => {
        const fetchSpy = vi.fn().mockResolvedValue(new Response("Error", { status: 500 }));
        const proxy = new CloudflareD1Proxy({ fetch: fetchSpy });
        await expect(proxy.saveSyntheticNode("node1", "personal", "encrypted", ["marker1"])).rejects.toThrow(/Failed to save synthetic/);
    });

    test('CloudflareSecretVault should handle KV errors gracefully', async () => {
        const env = { TENANT_VAULT: { get: vi.fn().mockRejectedValue(new Error("Network Error")) } };
        const vault = new CloudflareSecretVault(env);
        await expect(vault.fetchKey("tenant")).rejects.toThrow(/Adapter Error/);
    });

    test('CloudflareTelemetryProxy should handle exception on fetch', async () => {
        const fetchSpy = vi.fn().mockRejectedValue(new Error("Network Error"));
        const proxy = new CloudflareTelemetryProxy({ fetch: fetchSpy });
        const should = await proxy.shouldTriggerSynthesis("tenant-xyz");
        expect(should).toBe(false);
    });

    test('CloudflareGenerativeAI should synthesize memories', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            candidates: [{ content: { parts: [{ text: "insight" }] } }]
        }), { status: 200 }));
        const env = { GEMINI_API_KEY: "mock_key" };
        const ai = new CloudflareGenerativeAI(env);
        const res = await ai.synthesizeMemories(["mem1", "mem2"]);
        expect(res).toBe("insight");
    });

    test('CloudflareGenerativeAI should handle execution failure', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response("Crash", { status: 500 }));
        const env = { GEMINI_API_KEY: "mock_key" };
        const ai = new CloudflareGenerativeAI(env);
        await expect(ai.synthesizeMemories(["mem1"])).rejects.toThrow(/Synthesis generation failed/);
    });
});
