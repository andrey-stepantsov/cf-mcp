import { IKeyVaultManager } from "../core/Interfaces";

export class CloudflareSecretVault implements IKeyVaultManager {
    constructor(private env: any) {}

    public async fetchKey(tenantId: string): Promise<string> {
        try {
            if (!this.env.TENANT_VAULT) {
                throw new Error("TENANT_VAULT binding is missing.");
            }
            const key = await this.env.TENANT_VAULT.get(tenantId);
            if (key) return key;
        } catch (e) {
            console.warn(`[SecretVault] Failed to retrieve key from KV for tenant ${tenantId}`, e);
        }
        
        throw new Error(`[SecretVault] Adapter Error: Missing key mapping for tenant ${tenantId}.`);
    }
}
