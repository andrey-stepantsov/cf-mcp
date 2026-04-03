import { Env } from "../index";

export async function processSynthesisQueue(batch: MessageBatch<any>, env: Env) {
    for (const msg of batch.messages) {
        try {
            const event = msg.body;
            // 1. Synthesize Marker (LLM inference using env.AI)
            const prompt = `Extract the core pragmatic intent or knowledge from the following event payload. Keep it under 20 words.\n\nPayload: ${JSON.stringify(event.payload)}`;
            
            let synthesizedContent = "Mocked intent extraction (AI unreachable)";
            try {
               const aiResponse: any = await env.AI.run('@cf/meta/llama-2-7b-chat-int8', {
                   messages: [{ role: "user", content: prompt }]
               });
               synthesizedContent = aiResponse.response || synthesizedContent;
            } catch(e) {
               console.warn("AI LLM synthesis failed, falling back to mock", e);
            }

            // 2. Generate Vector (@cf/baai/bge-small-en-v1.5)
            // Note: BGE-small uses 384 dimensions
            let vectorData = new Array(384).fill(0); 
            try {
               const aiEmbed: any = await env.AI.run('@cf/baai/bge-small-en-v1.5', {
                   text: [synthesizedContent]
               });
               if (aiEmbed && aiEmbed.data) {
                   vectorData = aiEmbed.data[0];
               }
            } catch(e) {
               console.warn("AI Vector generation failed, using zeros", e);
            }

            const markerId = crypto.randomUUID();
            
            // 3. Save to Vectorize Index
            await env.SEMANTIC_INDEX.upsert([{
                id: markerId,
                values: vectorData,
                namespace: event.session_id,
                metadata: { 
                    temporal_ledger_id: event.event_id,
                    type: event.type 
                }
            }]);

            // 4. Save to D1 (via Storage Service)
            const storageResp = await env.STORAGE_SERVICE.fetch(new Request('http://internal/markers', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    marker_id: markerId,
                    session_id: event.session_id || "default_session",
                    temporal_ledger_id: event.event_id || "unknown",
                    pragmatic_type: 'artefact_summary', // Hardcoded strictly mapped to Zod for now
                    synthesized_content: synthesizedContent,
                    has_vector_index: true
                })
            }));

            if (!storageResp.ok) {
                throw new Error(`Failed to insert marker into D1: ${await storageResp.text()}`);
            }

            // Message successfully bridged to Semantic Graph
            msg.ack();
        } catch (err) {
            console.error("Queue processing failed for message:", err);
            // Allow retry via DLQ safety
            msg.retry();
        }
    }
}
