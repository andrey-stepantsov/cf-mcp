import { expect, test, vi, describe, beforeEach } from "vitest";
import { processDecayCron } from "../src/cron/DecayJob";
import { Env } from "../src/index";

describe("Semantic Decay Cron Job", () => {
    let mockEnv: any;
    let mockStorageFetch: any;
    let mockVectorizeDelete: any;

    beforeEach(() => {
        mockStorageFetch = vi.fn();
        mockVectorizeDelete = vi.fn();

        mockEnv = {
            SEMANTIC_INDEX: { deleteByIds: mockVectorizeDelete },
            STORAGE_SERVICE: { fetch: mockStorageFetch }
        };
    });

    test("Decays memory and accurately purges specific IDs from Vector Index", async () => {
        mockStorageFetch.mockResolvedValueOnce({ 
            ok: true, 
            json: async () => ({ status: "success", purged_ids: ["dead-marker-uuid-1", "dead-marker-uuid-2"] }) 
        });

        await processDecayCron(mockEnv);

        expect(mockStorageFetch).toHaveBeenCalledTimes(1);
        const req = mockStorageFetch.mock.calls[0][0];
        expect(req.url).toContain("http://internal/cron/decay");

        expect(mockVectorizeDelete).toHaveBeenCalledTimes(1);
        expect(mockVectorizeDelete).toHaveBeenCalledWith(["dead-marker-uuid-1", "dead-marker-uuid-2"]);
    });

    test("Avoids unnecessary Vectorize API calls if nothing was purged from D1", async () => {
        mockStorageFetch.mockResolvedValueOnce({ 
            ok: true, 
            json: async () => ({ status: "success", purged_ids: [] }) 
        });

        await processDecayCron(mockEnv);

        expect(mockStorageFetch).toHaveBeenCalledTimes(1);
        expect(mockVectorizeDelete).not.toHaveBeenCalled(); // Saving index compute cycles
    });

    test("Logs an error gracefully if Storage Service connection drops", async () => {
        mockStorageFetch.mockResolvedValueOnce({ 
            ok: false, 
            text: async () => "Internal Server Error Connection Refused" 
        });

        await processDecayCron(mockEnv);

        expect(mockStorageFetch).toHaveBeenCalledTimes(1);
        expect(mockVectorizeDelete).not.toHaveBeenCalled();
    });
});
