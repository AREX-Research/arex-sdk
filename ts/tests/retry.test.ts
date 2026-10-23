import { afterEach, describe, expect, it, vi } from "vitest";

import {
	Arex,
	type ArexOptions,
	ArexTimeoutError,
	CreditsExhaustedError,
	RateLimitError,
	ServiceUnavailableError,
} from "../src/index.js";
import {
	pendingUntilAbort,
	type StubFetch,
	type StubResponse,
	stubFetch,
	TEST_API_KEY,
} from "./fixtures.js";

interface Attempt {
	fetch: StubFetch;
	error: unknown;
	elapsedMs: number;
}

/**
 * Drive a search through the retry loop on fake timers and report how many
 * requests went out and how long the loop slept in total.
 */
async function searchWithRetries(
	responses: StubResponse[],
	options: Omit<ArexOptions, "apiKey" | "fetch"> = {},
): Promise<Attempt> {
	vi.useFakeTimers();
	const fetch = stubFetch(...responses);
	const arex = new Arex({ apiKey: TEST_API_KEY, fetch, ...options });
	const startedAt = Date.now();
	const settled = arex.search("agents").then(
		(value) => ({ error: value as unknown, elapsedMs: Date.now() - startedAt }),
		(error: unknown) => ({ error, elapsedMs: Date.now() - startedAt }),
	);
	await vi.advanceTimersByTimeAsync(60_000);
	return { fetch, ...(await settled) };
}

describe("retry policy", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("retries rate_limit_exceeded, honours Retry-After and returns the success", async () => {
		const { fetch, error, elapsedMs } = await searchWithRetries([
			"error.rate-limit",
			"search.ok",
		]);

		expect(fetch.calls.length).toBe(2);
		// Retry-After: 1 in the fixture, not the 1000ms default.
		expect(elapsedMs).toBe(1000);
		expect(error).toMatchObject({ results: expect.any(Array) });
		// A retry is a fresh request carrying no deduplication header.
		for (const call of fetch.calls) {
			expect([...call.headers.keys()].sort()).toEqual([
				"accept",
				"authorization",
				"content-type",
			]);
		}
	});

	it("uses the 1s default when the 429 carries no Retry-After", async () => {
		const { fetch, elapsedMs } = await searchWithRetries([
			async () =>
				new Response(
					JSON.stringify({
						error: {
							code: "rate_limit_exceeded",
							message: "Slow down",
							request_id: "req_retry",
							retryable: true,
						},
					}),
					{ status: 429 },
				),
			"search.ok",
		]);

		expect(fetch.calls.length).toBe(2);
		expect(elapsedMs).toBe(1000);
	});

	it("stops after maxRetries and throws the last rate limit error", async () => {
		const { fetch, error } = await searchWithRetries(["error.rate-limit"]);
		expect(fetch.calls.length).toBe(3);
		expect(error).toBeInstanceOf(RateLimitError);
	});

	it("honours a custom maxRetries", async () => {
		const { fetch } = await searchWithRetries(["error.rate-limit"], {
			maxRetries: 0,
		});
		expect(fetch.calls.length).toBe(1);
	});

	it.each([
		["error.outstanding-run-limit", RateLimitError],
		["error.daily-credits-exhausted", CreditsExhaustedError],
		["error.weekly-credits-exhausted", CreditsExhaustedError],
	] as const)("never retries %s", async (fixture, ErrorClass) => {
		const { fetch, error } = await searchWithRetries([fixture]);
		expect(fetch.calls.length).toBe(1);
		expect(error).toBeInstanceOf(ErrorClass);
	});

	it("does not opt into unavailable retries by default", async () => {
		const { fetch, error } = await searchWithRetries([
			"error.temporarily-unavailable",
		]);
		expect(fetch.calls.length).toBe(1);
		expect(error).toBeInstanceOf(ServiceUnavailableError);
	});

	it("retries 503 when retryUnavailable is opted in", async () => {
		const { fetch, elapsedMs } = await searchWithRetries(
			["error.temporarily-unavailable", "search.ok"],
			{ retryUnavailable: true },
		);
		expect(fetch.calls.length).toBe(2);
		expect(elapsedMs).toBe(5000);
	});

	it("never retries 500 internal_error, even with retryUnavailable", async () => {
		const { fetch } = await searchWithRetries(["error.internal"], {
			retryUnavailable: true,
		});
		expect(fetch.calls.length).toBe(1);
	});

	it("never retries a 4xx that is not a rate limit", async () => {
		const { fetch } = await searchWithRetries(["error.unauthorized"]);
		expect(fetch.calls.length).toBe(1);
	});

	describe("one wall-clock deadline per call", () => {
		const limited =
			(retryAfter: string): StubResponse =>
			async () =>
				new Response(
					JSON.stringify({
						error: {
							code: "rate_limit_exceeded",
							message: "Slow down",
							request_id: "req_limited",
							retryable: true,
						},
					}),
					{ status: 429, headers: { "Retry-After": retryAfter } },
				);

		async function timed(
			fetch: StubFetch,
			options: { timeoutMs: number; signal?: AbortSignal },
			advanceMs = 60_000,
		) {
			vi.useFakeTimers();
			const startedAt = Date.now();
			const settled = new Arex({ apiKey: TEST_API_KEY, fetch, maxRetries: 5 })
				.search("agents", options)
				.then(
					() => undefined,
					(error: unknown) => ({ error, elapsedMs: Date.now() - startedAt }),
				);
			await vi.advanceTimersByTimeAsync(advanceMs);
			return settled;
		}

		it("spends the same budget on retry sleeps, capping the last one", async () => {
			const fetch = stubFetch(limited("2"));
			const result = await timed(fetch, { timeoutMs: 3000 });
			expect(result?.error).toBeInstanceOf(ArexTimeoutError);
			expect(result?.elapsedMs).toBe(3000);
			expect(fetch.calls).toHaveLength(2);
		});

		it("bounds a retried attempt by what is left of the budget", async () => {
			const fetch = stubFetch(limited("1"), pendingUntilAbort);
			const result = await timed(fetch, { timeoutMs: 3000 });
			expect(result?.error).toMatchObject({
				phase: "request",
				timeoutMs: 3000,
			});
			expect(result?.elapsedMs).toBe(3000);
		});

		it("caps an enormous Retry-After instead of overflowing the timer", async () => {
			const fetch = stubFetch(limited("99999999999"));
			const result = await timed(fetch, { timeoutMs: 5000 });
			expect(result?.error).toBeInstanceOf(ArexTimeoutError);
			expect(result?.elapsedMs).toBe(5000);
			expect(fetch.calls).toHaveLength(1);
		});

		it("lets a caller abort during a retry sleep win over the deadline", async () => {
			const fetch = stubFetch(limited("2"));
			const controller = new AbortController();
			const reason = new Error("caller gave up");
			vi.useFakeTimers();
			const settled = new Arex({ apiKey: TEST_API_KEY, fetch })
				.search("agents", { timeoutMs: 1500, signal: controller.signal })
				.catch((error: unknown) => error);
			await vi.advanceTimersByTimeAsync(1000);
			controller.abort(reason);
			await vi.advanceTimersByTimeAsync(5000);
			expect(await settled).toBe(reason);
			expect(fetch.calls).toHaveLength(1);
		});
	});
});
