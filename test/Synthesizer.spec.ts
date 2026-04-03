import { expect, test, vi, describe, beforeEach } from "vitest";
import { processSynthesisQueue } from "../src/queue/Synthesizer";
import { Env } from "../src/index";

describe("Semantic Synthesizer Queue", () => {
    let mockEnv: any;
    let mockAiRun: any;
    let mockStorageFetch: any;
    let mockVectorizeUpsert: any;

    beforeEach(() => {
        mockAiRun = vi.fn();
        mockStorageFetch = vi.fn();
        mockVectorizeUpsert = vi.fn();

        mockEnv = {
            AI: { run: mockAiRun },
            SEMANTIC_INDEX: { upsert: mockVectorizeUpsert },
            STORAGE_SERVICE: { fetch: mockStorageFetch }
        };
    });

    test("Successfully synthesizes, embeds, and saves marker to D1 and Vectorize", async () => {
        // Mock LLaMa text extractor
        mockAiRun.mockResolvedValueOnce({ response: "Analyzed successfully." });
        // Mock BGE Embedding model
        mockAiRun.mockResolvedValueOnce({ data: [new Array(384).fill(0.123)] });
        // Mock D1 Storage API success
        mockStorageFetch.mockResolvedValueOnce({ ok: true });

        const mockAck = vi.fn();
        const mockRetry = vi.fn();

        const mockBatch: any = {
            messages: [{
                body: {
                    event_id: "evt-123",
                    session_id: "test-session",
                    type: "ARTEFACT_PROPOSED",
                    payload: { foo: "bar" }
                },
                ack: mockAck,
                retry: mockRetry
            }]
        };

        await processSynthesisQueue(mockBatch, mockEnv);

        expect(mockAiRun).toHaveBeenCalledTimes(2);
        
        expect(mockVectorizeUpsert).toHaveBeenCalledTimes(1);
        const upsertArg = mockVectorizeUpsert.mock.calls[0][0][0];
        expect(upsertArg.namespace).toBe("test-session");
        expect(upsertArg.metadata.temporal_ledger_id).toBe("evt-123");

        expect(mockStorageFetch).toHaveBeenCalledTimes(1);
        const postReqUrl = mockStorageFetch.mock.calls[0][0].url;
        expect(postReqUrl).toContain("http://internal/markers");

        expect(mockAck).toHaveBeenCalled();
        expect(mockRetry).not.toHaveBeenCalled();
    });

    test("Invokes DLQ retry upon D1 database write failure", async () => {
        // Mock LLaMa and BGE success
        mockAiRun.mockResolvedValueOnce({ response: "Analyzed successfully." });
        mockAiRun.mockResolvedValueOnce({ data: [new Array(384).fill(0.123)] });
        // Mock D1 Storage API FAILURE
        mockStorageFetch.mockResolvedValueOnce({ ok: false, text: async () => "SQLITE_CONSTRAINT_PK" });

        const mockAck = vi.fn();
        const mockRetry = vi.fn();

        const mockBatch: any = {
            messages: [{
                body: { event_id: "evt-404" },
                ack: mockAck,
                retry: mockRetry
            }]
        };

        await processSynthesisQueue(mockBatch, mockEnv);

        expect(mockAck).not.toHaveBeenCalled();
        expect(mockRetry).toHaveBeenCalled(); // Ensure DLQ trap works
    });
});
