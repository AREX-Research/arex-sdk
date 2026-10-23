import { describe, expect, it } from "vitest";

import { NotFoundError } from "../../src/index.js";
import { liveApiKey, liveClient } from "./client.js";

describe.skipIf(!liveApiKey)("live research", () => {
	it("runs a fast research job to completion", async () => {
		const run = await liveClient().research.run(
			"What is retrieval augmented generation?",
			{ mode: "fast" },
		);

		expect(run.status).toBe("completed");
		expect(run.result.answer.length).toBeGreaterThan(0);
	});

	it("cancels and deletes a deep run", async () => {
		const arex = liveClient();
		const created = await arex.research.create(
			"Survey every agent benchmark published in 2026",
			{ mode: "deep" },
		);
		expect(created.id).toMatch(/^[0-9a-f-]{36}$/);

		await arex.research.cancel(created.id);
		await arex.research.delete(created.id);
		await expect(arex.research.get(created.id)).rejects.toBeInstanceOf(
			NotFoundError,
		);
	});
});
