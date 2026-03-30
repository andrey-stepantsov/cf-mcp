import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { CloudflareWebSocketTransport } from "./CloudflareWebSocketTransport";
import { Env } from "../index";

export class McpDurableObject {
    private mcpServer: Server;
    private env: Env;
    private state: DurableObjectState;

    constructor(state: DurableObjectState, env: Env) {
        this.state = state;
        this.env = env;

        this.mcpServer = new Server({
            name: "cf-mcp-brain",
            version: "1.0.0"
        }, {
            capabilities: {
                tools: {}
            }
        });

        this.setupTools();
    }

    private setupTools() {
        this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "save_memory",
                        description: "Saves a raw memory node and embeds it.",
                        inputSchema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] }
                    },
                    {
                        name: "semantic_search",
                        description: "Searches for memories by semantic vector proximity.",
                        inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] }
                    },
                    {
                        name: "get_brain_metrics",
                        description: "Returns vault metrics and node counts.",
                        inputSchema: { type: "object", properties: {} }
                    },
                    {
                        name: "export_brain",
                        description: "Exports all decrypted memories.",
                        inputSchema: { type: "object", properties: {} }
                    }
                ]
            };
        });

        this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
            if (!this.authHeader || !this.blindKey) {
                return { isError: true, content: [{ type: "text", text: "Missing auth/encryption context in WebSocket upgrade." }] };
            }

            // Loopback to the stateless CF Worker router to leverage existing encryption/storage logic
            const loopbackReq = new Request("http://internal/mcp-router", {
                method: "POST",
                headers: {
                    "Authorization": this.authHeader,
                    "X-Blind-Key": this.blindKey,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    tool: request.params.name,
                    params: request.params.arguments || {}
                })
            });

            try {
                // To avoid circular imports, construct the handler manually or import dynamically
                const { default: worker } = await import("../index");
                // Mock ExecutionContext since waitUntil isn't strictly required in DO sync tools
                const mockCtx = { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as ExecutionContext;
                
                const response = await worker.fetch(loopbackReq, this.env, mockCtx);
                const text = await response.text();
                
                return {
                    isError: !response.ok,
                    content: [{ type: "text", text: text }]
                };
            } catch (err: any) {
                return { isError: true, content: [{ type: "text", text: `Tool crashed: ${err.message}` }] };
            }
        });
    }

    private authHeader?: string;
    private blindKey?: string;

    async fetch(request: Request): Promise<Response> {
        if (request.headers.get("Upgrade") !== "websocket") {
            return new Response("Expected Upgrade: websocket", { status: 426 });
        }

        this.authHeader = request.headers.get("Authorization") || undefined;
        this.blindKey = request.headers.get("X-Blind-Key") || undefined;

        const [client, server] = Object.values(new WebSocketPair());

        server.accept();
        const transport = new CloudflareWebSocketTransport(server);
        await this.mcpServer.connect(transport);

        return new Response(null, {
            status: 101,
            webSocket: client
        });
    }
}
