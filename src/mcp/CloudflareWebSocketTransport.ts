import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export class CloudflareWebSocketTransport implements Transport {
    public onclose?: () => void;
    public onerror?: (error: Error) => void;
    public onmessage?: (message: JSONRPCMessage) => void;

    constructor(private ws: WebSocket) {
        this.ws.addEventListener("message", (event) => {
            if (this.onmessage) {
                try {
                    const message = JSON.parse(event.data as string);
                    this.onmessage(message);
                } catch (e) {
                    if (this.onerror) this.onerror(e as Error);
                }
            }
        });

        this.ws.addEventListener("close", () => {
            if (this.onclose) this.onclose();
        });

        this.ws.addEventListener("error", (event) => {
            if (this.onerror) this.onerror(new Error("WebSocket error"));
        });
    }

    public async start(): Promise<void> {
        // Nothing needed here for Cloudflare standard WebSockets, they are open upon accept
    }

    public async send(message: JSONRPCMessage): Promise<void> {
        this.ws.send(JSON.stringify(message));
    }

    public async close(): Promise<void> {
        this.ws.close();
    }
}
