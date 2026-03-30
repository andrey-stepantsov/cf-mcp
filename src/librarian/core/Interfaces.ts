export interface EncryptedMemory {
    id: string;
    user_id: string;
    namespace: string;
    content: string;          // Encrypted blob or plaintext based on is_encrypted
    semantic_markers?: string; // Plaintext metadata array 
    is_encrypted: boolean;
    last_accessed_at: string;
    created_at: string;
}

export interface IKeyVaultManager {
    /**
     * Retrieves the X-Blind-Key for the active tenant.
     * In Staging: Uses Cloudflare Secrets.
     * In Prod: Uses Google Secret Manager with Hardware Attestation.
     */
    fetchKey(tenantId: string): Promise<string>;
}

export interface IDatabaseProxy {
    /**
     * Retrieves memories that haven't been synthesized recently.
     */
    getInactiveMemories(tenantId: string, limit?: number): Promise<EncryptedMemory[]>;
    
    /**
     * Saves the newly generated summary/synthesis back to the Vault.
     */
    saveSyntheticNode(nodeId: string, namespace: string, encryptedContent: string, markers: string[]): Promise<void>;
}

export interface ITelemetryProxy {
    /**
     * Query to determine if there are enough 'cold' artifacts that haven't been clustered
     * or if enough 'notable' new ingestions occurred to warrant the financial cost of a LLM run.
     */
    shouldTriggerSynthesis(tenantId: string): Promise<boolean>;
}

export interface IGenerativeAI {
    /**
     * Takes an array of decrypted plaintext strings, prompts an LLM via Vertex AI or external provider,
     * and returns a synthesized summary/insight connecting the concepts.
     */
    synthesizeMemories(decryptedMemories: string[]): Promise<string>;
}
