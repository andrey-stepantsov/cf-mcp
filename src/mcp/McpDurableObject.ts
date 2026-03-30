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
            name: "cf-mcp-artefact-manager",
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
                        name: "read_vfs_file",
                        description: "Reads a file from the virtual file system.",
                        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }
                    },
                    {
                        name: "propose_patch",
                        description: "Proposes a diff patch to the artefact ledger.",
                        inputSchema: { type: "object", properties: { file: { type: "string" }, patch: { type: "string" } }, required: ["file", "patch"] }
                    },
                    {
                        name: "write_file_keyframe",
                        description: "Writes a complete file keyframe to the ledger.",
                        inputSchema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }
                    },
                    {
                        name: "execute_sandbox",
                        description: "Executes a command directly in the Phantomachine T2 Node Daemon.",
                        inputSchema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] }
                    }
                ]
            };
        });

        this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
            if (!this.authHeader || !this.blindKey) {
                return { isError: true, content: [{ type: "text", text: "Missing auth/encryption context in WebSocket upgrade." }] };
            }

            if (request.params.name === "execute_sandbox") {
                try {
                    const wsUrl = this.env.PHANTOMACHINE_URL || "ws://127.0.0.1:4000";
                    const wsResp = await fetch(wsUrl, {
                        headers: {
                            "Upgrade": "websocket",
                            "Authorization": this.authHeader
                        }
                    });

                    if (wsResp.status === 101) {
                        const ws = wsResp.webSocket;
                        if (!ws) throw new Error("No websocket in response");
                        
                        ws.accept();
                        let executionResult = "";

                        await new Promise<void>((resolve, reject) => {
                            ws.addEventListener('message', (msg) => {
                                executionResult += msg.data + "\n";
                            });
                            ws.addEventListener('close', () => resolve());
                            ws.addEventListener('error', (e) => reject(e));
                            
                            // Send execution request formatted for Phantomachine
                            ws.send(JSON.stringify({ 
                                event: "EXECUTION_REQUESTED", 
                                command: request.params.arguments?.command 
                            }));
                            
                            // Close and timeout after reasonable wait for sync MCP
                            setTimeout(() => { ws.close(); resolve(); }, 10000);
                        });
                        
                        return { isError: false, content: [{ type: "text", text: executionResult || "Execution completed with no output." }] };
                    } else {
                        return { isError: true, content: [{ type: "text", text: `Failed to connect to Phantomachine: ${wsResp.status}` }] };
                    }
                } catch (err: any) {
                    return { isError: true, content: [{ type: "text", text: `execute_sandbox proxy failed: ${err.message}` }] };
                }
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
                const mockCtx = { waitUntil: (p: Promise<any>) => p.catch(() => {}) } as unknown as ExecutionContext;
                
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
