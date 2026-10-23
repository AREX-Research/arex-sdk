import { Arex } from "../../src/index.js";

export const liveApiKey = process.env.AREX_API_KEY;

/**
 * Built per test, not at collection time: the suite is skipped without a key,
 * but Vitest still evaluates every `describe` body.
 */
export function liveClient(): Arex {
	const baseUrl = process.env.AREX_API_BASE;
	return new Arex({
		apiKey: liveApiKey ?? "",
		...(baseUrl !== undefined ? { baseUrl } : {}),
	});
}
