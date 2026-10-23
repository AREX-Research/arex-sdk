import { describe, expect, it } from "vitest";

import { liveApiKey, liveClient } from "./client.js";

describe.skipIf(!liveApiKey)("live retrieval", () => {
	it("searches", async () => {
		const response = await liveClient().search("large language model agents", {
			limit: 3,
		});
		expect(response.results.length).toBeGreaterThan(0);
		expect(response.results.length).toBeLessThanOrEqual(3);
		for (const result of response.results) {
			expect(result.url).toMatch(/^https?:\/\//);
		}
	});

	it("reads contents", async () => {
		const document = await liveClient().contents("https://example.com", {
			maxCharacters: 2000,
		});
		expect(document.content.length).toBeGreaterThan(0);
	});
});
