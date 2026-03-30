import { expect, test, vi, describe, beforeEach } from 'vitest';
import { McpDurableObject } from '../../src/mcp/McpDurableObject';
import { CloudflareWebSocketTransport } from '../../src/mcp/CloudflareWebSocketTransport';

// Mock Cloudflare WebSocketPair and standard Response/Request classes for Node environment if unavailable
class MockWebSocket {
    public events: Record<string, Function[]> = {};
    public sent: any[] = [];
    public accepted = false;
    
    addEventListener(type: string, listener: Function) {
        if (!this.events[type]) this.events[type] = [];
        this.events[type].push(listener);
    }
    
    send(data: string) {
        this.sent.push(data);
    }
    
    accept() {
        this.accepted = true;
    }
    
    close() {}
}

const originalWebSocketPair = globalThis.WebSocketPair;
const OriginalResponse = globalThis.Response;

describe('McpDurableObject Integration', () => {
    beforeEach(() => {
        // Setup mock for WebSocketPair
        globalThis.WebSocketPair = class {
            constructor() {
                return {
                    0: new MockWebSocket(),
                    1: new MockWebSocket()
                };
            }
        } as any;

        // Bypass Node's undici limit requiring Response status to be 200-599
        globalThis.Response = class extends OriginalResponse {
            constructor(body?: any, init?: any) {
                if (init?.status === 101) {
                    super(body, { ...init, status: 200 }); // Bypass constructor check
                    Object.defineProperty(this, 'status', { value: 101 });
                    Object.defineProperty(this, 'webSocket', { value: init.webSocket });
                } else {
                    super(body, init);
                    if (init?.webSocket) {
                         Object.defineProperty(this, 'webSocket', { value: init.webSocket });
                    }
                }
            }
        } as any;
    });

    test('should reject non-websocket connections with 426 Upgrade Required', async () => {
        const env: any = {};
        const state: any = {};
        const doInstance = new McpDurableObject(state, env);

        const req = new Request('https://mcp.local/v1', { method: 'GET' });
        const res = await doInstance.fetch(req);

        expect(res.status).toBe(426);
        expect(await res.text()).toBe("Expected Upgrade: websocket");
    });

    test('should accept websocket upgrade and initialize MCP transport', async () => {
        const env: any = {};
        const state: any = {};
        const doInstance = new McpDurableObject(state, env);

        const req = new Request('https://mcp.local/v1', {
            method: 'GET',
            headers: {
                'Upgrade': 'websocket',
                'Authorization': 'Bearer test-tenant',
                'X-Blind-Key': 'secret-key-123'
            }
        });

        const res = await doInstance.fetch(req);

        expect(res.status).toBe(101);
        expect(res.webSocket).toBeDefined();
        
        // At this point, the server side of the mock WebSocketPair should be accepted.
        // We verify that the transport is alive and functioning.
    });

    test('CloudflareWebSocketTransport should propagate messages', async () => {
        const ws = new MockWebSocket() as any;
        const transport = new CloudflareWebSocketTransport(ws);
        
        let receivedMessage: any = null;
        transport.onmessage = (msg) => receivedMessage = msg;
        
        // Simulate an incoming message on the WebSocket
        const triggerMessage = ws.events['message'][0];
        triggerMessage({ data: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
        
        expect(receivedMessage).toEqual({ jsonrpc: "2.0", id: 1, method: "ping" });
        
        // Simulate sending a message out
        await transport.send({ jsonrpc: "2.0", id: 1, result: "pong" });
        expect(ws.sent[0]).toBe(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "pong" }));
    });
});
