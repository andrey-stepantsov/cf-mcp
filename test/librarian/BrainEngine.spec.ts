import { expect, test, vi, describe } from 'vitest';
import { BrainEngine } from '../../src/librarian/core/BrainEngine';
import { IKeyVaultManager, IDatabaseProxy, ITelemetryProxy, IGenerativeAI, EncryptedMemory } from '../../src/librarian/core/Interfaces';
import { generateKeyFromString, encryptText, decryptText } from '../../src/crypto';

describe('BrainEngine Synthesis Loop', () => {
    test('should abort if telemetry threshold is not met', async () => {
        const vault = { fetchKey: vi.fn() } as unknown as IKeyVaultManager;
        const db = { getInactiveMemories: vi.fn(), saveSyntheticNode: vi.fn() } as unknown as IDatabaseProxy;
        const telemetry = { shouldTriggerSynthesis: vi.fn().mockResolvedValue(false) } as unknown as ITelemetryProxy;
        const ai = { synthesizeMemories: vi.fn() } as unknown as IGenerativeAI;

        const engine = new BrainEngine(vault, db, telemetry, ai);
        await engine.runSynthesisLoop('tenant123');

        expect(telemetry.shouldTriggerSynthesis).toHaveBeenCalledWith('tenant123');
        expect(db.getInactiveMemories).not.toHaveBeenCalled();
    });

    test('should abort if no inactive memories are found', async () => {
        const vault = { fetchKey: vi.fn() } as unknown as IKeyVaultManager;
        const db = { getInactiveMemories: vi.fn().mockResolvedValue([]), saveSyntheticNode: vi.fn() } as unknown as IDatabaseProxy;
        const telemetry = { shouldTriggerSynthesis: vi.fn().mockResolvedValue(true) } as unknown as ITelemetryProxy;
        const ai = { synthesizeMemories: vi.fn() } as unknown as IGenerativeAI;

        const engine = new BrainEngine(vault, db, telemetry, ai);
        await engine.runSynthesisLoop('tenant123');

        expect(vault.fetchKey).not.toHaveBeenCalled();
    });

    test('should execute full synthesis loop successfully', async () => {
        const mockKey = "SecureMockKey123";
        const cryptoKey = await generateKeyFromString(mockKey);
        const encryptedContent = await encryptText("I am a raw memory of learning vi.", cryptoKey);

        const mockMemories: EncryptedMemory[] = [
            { id: "mem1", content: encryptedContent, is_encrypted: true, namespace: "personal" }
        ];

        const vault = { fetchKey: vi.fn().mockResolvedValue(mockKey) } as unknown as IKeyVaultManager;
        const db = { getInactiveMemories: vi.fn().mockResolvedValue(mockMemories), saveSyntheticNode: vi.fn().mockResolvedValue(undefined) } as unknown as IDatabaseProxy;
        const telemetry = { shouldTriggerSynthesis: vi.fn().mockResolvedValue(true) } as unknown as ITelemetryProxy;
        const ai = { synthesizeMemories: vi.fn().mockResolvedValue("Synthesized: The user is learning vi.") } as unknown as IGenerativeAI;

        const engine = new BrainEngine(vault, db, telemetry, ai);
        await engine.runSynthesisLoop('tenant123');

        expect(ai.synthesizeMemories).toHaveBeenCalledWith(["I am a raw memory of learning vi."]);
        expect(db.saveSyntheticNode).toHaveBeenCalledWith(
            expect.stringContaining("skill_node_"),
            "personal",
            expect.any(String), // The encrypted synthesized text
            ["synthesis", "cron_generated"]
        );

        // Verify that the string passed to saveSyntheticNode is indeed encrypted synthesized thought
        const saveCall = (db.saveSyntheticNode as any).mock.calls[0];
        const encryptedPayload = saveCall[2];
        const decryptedPayload = await decryptText(encryptedPayload, cryptoKey);
        expect(decryptedPayload).toBe("Synthesized: The user is learning vi.");
    });

    test('should throw if vault cannot fetch key', async () => {
        const vault = { fetchKey: vi.fn().mockResolvedValue(undefined) } as unknown as IKeyVaultManager;
        const db = { getInactiveMemories: vi.fn().mockResolvedValue([{ id: "1", content: "hi", is_encrypted: false, namespace: "personal" }]) } as unknown as IDatabaseProxy;
        const telemetry = { shouldTriggerSynthesis: vi.fn().mockResolvedValue(true) } as unknown as ITelemetryProxy;
        const ai = {} as unknown as IGenerativeAI;
        const engine = new BrainEngine(vault, db, telemetry, ai);
        await expect(engine.runSynthesisLoop('tenant123')).rejects.toThrow(/Fatal: KeyVault failed/);
    });

    test('should ignore memory decryption failures', async () => {
        const mockKey = "SecureMockKey123";
        const cryptoKey = await generateKeyFromString(mockKey);
        
        const mockMemories: EncryptedMemory[] = [
            { id: "mem1", content: "invalid_encrypted_string_that_fails_crypto", is_encrypted: true, namespace: "personal" }
        ];

        const vault = { fetchKey: vi.fn().mockResolvedValue(mockKey) } as unknown as IKeyVaultManager;
        const db = { getInactiveMemories: vi.fn().mockResolvedValue(mockMemories) } as unknown as IDatabaseProxy;
        const telemetry = { shouldTriggerSynthesis: vi.fn().mockResolvedValue(true) } as unknown as ITelemetryProxy;
        const ai = { synthesizeMemories: vi.fn() } as unknown as IGenerativeAI;

        const engine = new BrainEngine(vault, db, telemetry, ai);
        await engine.runSynthesisLoop('tenant123');
        expect(ai.synthesizeMemories).not.toHaveBeenCalled();
    });
});
