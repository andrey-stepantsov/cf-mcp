import { IKeyVaultManager } from "../core/Interfaces";

export class CloudflareSecretVault implements IKeyVaultManager {
    constructor(private env: any) {}

    public async fetchKey(tenantId: string): Promise<string> {
        // In the mock staging environment, we assume the environment variable 
        // stringifies a JSON map of tenant keys, or we lookup from a Bound KV/Secret.
        // For staging simplicity, if env.MOCK_TENANT_KEYS exists, parse it.
        try {
            if (this.env.MOCK_TENANT_KEYS) {
                const keys = JSON.parse(this.env.MOCK_TENANT_KEYS);
                const key = keys[tenantId];
                if (key) return key;
            }
        } catch (e) {
            console.warn("[SecretVault] Failed to parse MOCK_TENANT_KEYS JSON mapping", e);
        }
        
        // Fallback or explicit failure
        throw new Error(`[SecretVault] Adapter Error: Missing key mapping for tenant ${tenantId}.`);
    }
}
