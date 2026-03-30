import { IKeyVaultManager, IDatabaseProxy, ITelemetryProxy, IGenerativeAI, EncryptedMemory } from "./Interfaces";
import { generateKeyFromString, encryptText, decryptText } from "../../crypto";

export class BrainEngine {
    constructor(
        private vaultManager: IKeyVaultManager,
        private dbProxy: IDatabaseProxy,
        private telemetryProxy: ITelemetryProxy,
        private generativeAI: IGenerativeAI
    ) {}

    /**
     * Executes the secure background clustering pipeline strictly adhering to Hexagonal boundaries.
     */
    public async runSynthesisLoop(tenantId: string): Promise<void> {
        // 1. Smart Triggering (Telemetry Handshake)
        const shouldRun = await this.telemetryProxy.shouldTriggerSynthesis(tenantId);
        if (!shouldRun) {
            console.log(`[BrainEngine] Telemetry threshold not met for tenant ${tenantId}. Aborting synthesis run to save compute.`);
            return;
        }

        console.log(`[BrainEngine] Telemetry threshold met. Commencing synthesis sequence for tenant ${tenantId}.`);

        // 2. Blind Fetch of Stale Metadata (D1 DB limit check)
        const memories = await this.dbProxy.getInactiveMemories(tenantId, 50);
        if (memories.length === 0) {
            console.log(`[BrainEngine] No inactive memories to process.`);
            return;
        }

        // 3. Vault Handshake (The Secret Manager)
        const rawKey = await this.vaultManager.fetchKey(tenantId);
        if (!rawKey) {
            throw new Error(`[BrainEngine] Fatal: KeyVault failed to provide key for tenant ${tenantId}.`);
        }

        // 4. Transform string to mathematical CryptoKey within temporary RAM
        const cryptoKey = await generateKeyFromString(rawKey);

        // 5. Decrypt Payload into Volatile State
        const decryptedTexts: string[] = [];
        for (const memory of memories) {
            if (memory.is_encrypted && memory.content) {
                try {
                    const decrypted = await decryptText(memory.content, cryptoKey);
                    decryptedTexts.push(decrypted);
                } catch (e) {
                    console.error(`[BrainEngine] Failed to decrypt memory ${memory.id}. Key mismatch or corruption.`);
                }
            } else {
                decryptedTexts.push(memory.content);
            }
        }

        if (decryptedTexts.length === 0) {
            console.log(`[BrainEngine] Decryption yielded zero usable nodes. Aborting.`);
            return;
        }

        // 6. Generative Insight (The Model Handshake)
        console.log(`[BrainEngine] Dispatching ${decryptedTexts.length} semantic layers to the Autonomous LLM...`);
        const syntheticThought = await this.generativeAI.synthesizeMemories(decryptedTexts);

        // 7. Secure Synthesis Formatting (Generating Graph Nodes)
        const encryptedThought = await encryptText(syntheticThought, cryptoKey);
        
        // 8. Output Persistance (Shattering the RAM context)
        const newConceptualNodeId = "skill_node_" + Date.now().toString(); 
        const markers = ["synthesis", "cron_generated"]; 
        
        await this.dbProxy.saveSyntheticNode(
            newConceptualNodeId,
            memories[0]?.namespace || "personal", // Inherit tenant namespace
            encryptedThought,
            markers
        );

        console.log(`[BrainEngine] Synthesis crystallized. TEE Volatile RAM released.`);
    }
}
