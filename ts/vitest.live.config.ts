import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["tests/live/**/*.live.test.ts"],
		// Live runs hit the real API sequentially to stay inside the 5 req/s limit.
		fileParallelism: false,
		testTimeout: 240_000,
	},
});
