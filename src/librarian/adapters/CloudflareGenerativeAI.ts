import { IGenerativeAI } from "../core/Interfaces";
import { GoogleLLMProvider } from "../../GoogleLLMProvider";

export class CloudflareGenerativeAI implements IGenerativeAI {
    // env object containing env.GEMINI_API_KEY or env.GOOGLE_APPLICATION_CREDENTIALS
    constructor(private env: any) {}

    public async synthesizeMemories(decryptedMemories: string[]): Promise<string> {
        const userPrompt = `Raw Memories for Synthesis:\n${decryptedMemories.map((m, i) => `[Node ${i}]: ${m}`).join('\n\n')}`;

        try {
            const provider = new GoogleLLMProvider(this.env);
            return await provider.generateText(userPrompt);
        } catch (e) {
            console.error(`[GenerativeAI] Google LLM execution failed.`, e);
            throw new Error("Synthesis generation failed: " + (e as Error).message);
        }
    }
}
