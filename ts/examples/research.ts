/**
 * Wait up to two minutes for a research job, retaining its id for recovery.
 * A poll timeout leaves the run alive; a caller abort would cancel it.
 *
 * AREX_API_KEY=sk_arex_... npx tsx examples/research.ts
 */
import {
	Arex,
	ArexTimeoutError,
	ResearchRunFailedError,
} from "@arex-research/ts-sdk";

const arex = new Arex({ baseUrl: process.env.AREX_BASE_URL });

try {
	const run = await arex.research.run(
		"Compare the leading agent evaluation benchmarks of 2026",
		{ mode: "fast", timeoutMs: 120_000 },
	);

	console.log(run.result.answer);
	console.log("\nSources:");
	for (const source of run.result.sources) {
		console.log(`- ${source.title} ${source.url}`);
	}
} catch (error) {
	process.exitCode = 1;
	if (error instanceof ResearchRunFailedError) {
		console.error(
			`Run ${error.run.id} failed; retry allowed: ${
				error.run.status === "failed" ? error.run.error.retryable : false
			}`,
		);
	} else if (error instanceof ArexTimeoutError) {
		if (error.runId !== undefined) {
			// Resume with arex.research.wait(error.runId); the run is still alive.
			console.error(`Stopped waiting for run ${error.runId}`);
		} else {
			console.error(
				"Create timed out before a run id was returned; a retry creates a new run.",
			);
		}
	} else {
		throw error;
	}
}
