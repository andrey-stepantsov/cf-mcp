import { expect, test } from "vitest";
import worker from "../src/index";

test("Worker handles missing authorization gracefully", async () => {
    const request = new Request("http://localhost", { method: "POST" });
    const env = {} as any;
    const ctx = { waitUntil: () => {} } as any;

    const response = await worker.fetch(request, env, ctx);
    expect(response.status).toBe(401);
});
