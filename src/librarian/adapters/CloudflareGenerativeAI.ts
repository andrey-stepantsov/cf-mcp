import { IGenerativeAI } from "../core/Interfaces";

export class CloudflareGenerativeAI implements IGenerativeAI {
    // Expects passes env.AI from Cloudflare Workers
    constructor(private aiBinding: any) {}

    public async synthesizeMemories(decryptedMemories: string[]): Promise<string> {
        const systemPrompt = `You are the Omni Librarian, an autonomous semantic synthesis agent. Analyze the following decrypted memories and generate a cohesive conceptual insight that links the ideas together into a unified framework. Respond ONLY with the synthesized structured insight. Do not use conversational filler.`;
        
        const userPrompt = `Raw Memories for Synthesis:\n${decryptedMemories.map((m, i) => `[Node ${i}]: ${m}`).join('\n\n')}`;

        const messages = [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt }
        ];

        try {
            // Using a standard capable LLM on CF Workers AI for the Mock Vault
            const response = await this.aiBinding.run('@cf/meta/llama-3.1-8b-instruct', {
                messages
            });
            return response.response;
        } catch (e) {
            console.error(`[GenerativeAI] Cloudflare Workers LLM execution failed.`, e);
            throw new Error("Synthesis generation failed");
        }
    }
}
