import { IDatabaseProxy, EncryptedMemory } from "../core/Interfaces";

export class CloudflareD1Proxy implements IDatabaseProxy {
    // Expects the Cloudflare Fetcher mapping to cf-mcp-storage
    constructor(private storageService: any) {}

    public async getInactiveMemories(tenantId: string, limit: number = 50): Promise<EncryptedMemory[]> {
        const req = new Request('http://internal/librarian/inactive', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: tenantId, limit })
        });
        
        const res = await this.storageService.fetch(req);
        if (!res.ok) {
            console.error(`[D1Proxy] Failed to fetch inactive memories. Status: ${res.status}`);
            return [];
        }
        
        const data = await res.json();
        return data.memories || [];
    }

    public async saveSyntheticNode(nodeId: string, namespace: string, encryptedContent: string, markers: string[]): Promise<void> {
        const req = new Request('http://internal/librarian/synthesize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                node_id: nodeId, 
                namespace, 
                content: encryptedContent, 
                markers: JSON.stringify(markers) 
            })
        });

        const res = await this.storageService.fetch(req);
        if (!res.ok) {
           throw new Error(`[D1Proxy] Failed to save synthetic skill tree node. Status: ${res.status}`);
        }
    }
}
