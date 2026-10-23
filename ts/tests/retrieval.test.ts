import { afterEach, describe, expect, it, vi } from "vitest";

import { Arex, ArexTimeoutError, type FetchLike } from "../src/index.js";
import { pendingUntilAbort, stubFetch, TEST_API_KEY } from "./fixtures.js";

function client(fetch: FetchLike, options: { timeoutMs?: number } = {}): Arex {
	return new Arex({ apiKey: TEST_API_KEY, fetch, ...options });
}

describe("search", () => {
	it("maps search results", async () => {
		const fetch = stubFetch("search.ok");
		const response = await client(fetch).search("agent evaluation", {
			limit: 2,
			publishedAfter: "2026-08-01T00:00:00Z",
			publishedBefore: "2026-09-01T00:00:00Z",
		});

		expect(response.results).toEqual([
			{
				title: "AI agent evaluation survey",
				url: "https://example.org/agents",
				snippet: "A survey of evaluation methods.",
				publishedAt: "2026-09-01T00:00:00.000Z",
			},
			{ title: "Untitled result", url: "https://example.org/no-snippet" },
		]);

		const call = fetch.calls[0];
		expect(call?.method).toBe("POST");
		expect(call?.url).toBe("https://api.arex-research.com/v1/search");
		expect(call?.headers.get("Authorization")).toBe(`Bearer ${TEST_API_KEY}`);
		expect(call?.body).toEqual({
			query: "agent evaluation",
			limit: 2,
			published_after: "2026-08-01T00:00:00Z",
			published_before: "2026-09-01T00:00:00Z",
		});
	});

	it("omits optional fields from the wire request when the caller omits them", async () => {
		const fetch = stubFetch("search.ok");
		await client(fetch).search("agent evaluation");
		expect(fetch.calls[0]?.body).toEqual({ query: "agent evaluation" });
	});

	it("rejects a 200 without a results array", async () => {
		const fetch = stubFetch(
			async () =>
				new Response("{}", {
					status: 200,
					headers: {
						"Content-Type": "application/json",
					},
				}),
		);
		await expect(client(fetch).search("agents")).rejects.toMatchObject({
			name: "ArexNetworkError",
			code: "invalid_response",
		});
	});

	it("rejects a search result with mistyped metadata", async () => {
		const fetch = stubFetch(
			async () =>
				new Response(
					JSON.stringify({
						results: [
							{
								title: "AI agent evaluation survey",
								url: "https://example.org/agents",
								published_at: 123,
							},
						],
					}),
					{
						status: 200,
						headers: {
							"Content-Type": "application/json",
						},
					},
				),
		);
		await expect(client(fetch).search("agents")).rejects.toMatchObject({
			name: "ArexNetworkError",
			code: "invalid_response",
		});
	});
});

describe("contents", () => {
	it("maps a full document", async () => {
		const fetch = stubFetch("contents.ok");
		const document = await client(fetch).contents(
			"https://example.org/agents",
			{
				tier: "flex",
				maxCharacters: 5000,
			},
		);

		expect(document).toEqual({
			url: "https://example.org/agents",
			title: "AI agent evaluation survey",
			publishedAt: "2026-09-01T00:00:00.000Z",
			imageUrl: "https://example.org/hero.png",
			imageUrls: ["https://example.org/a.png"],
			content: "Body text.",
			truncated: false,
		});
		expect(fetch.calls[0]?.body).toEqual({
			url: "https://example.org/agents",
			tier: "flex",
			max_characters: 5000,
		});
	});

	it("rejects a 200 without content", async () => {
		const fetch = stubFetch(
			async () =>
				new Response(JSON.stringify({ url: "https://example.org" }), {
					status: 200,
					headers: {
						"Content-Type": "application/json",
					},
				}),
		);
		await expect(
			client(fetch).contents("https://example.org"),
		).rejects.toMatchObject({
			name: "ArexNetworkError",
			code: "invalid_response",
		});
	});

	it("leaves optional metadata absent on a minimal document", async () => {
		const fetch = stubFetch("contents.minimal");
		const document = await client(fetch).contents("https://example.org/plain");

		expect(document.title).toBeUndefined();
		expect(document.imageUrls).toBeUndefined();
		expect(document.imageUrl).toBeUndefined();
		expect(document.publishedAt).toBeUndefined();
		expect(document.content).toBe("Plain.");
		expect(document.truncated).toBe(true);
	});

	it("sends livecrawlTimeoutMs as livecrawl_timeout_ms", async () => {
		const fetch = stubFetch("contents.ok");
		await client(fetch).contents("https://example.org/agents", {
			livecrawl: true,
			livecrawlTimeoutMs: 5000,
		});
		expect(fetch.calls[0]?.body).toEqual({
			url: "https://example.org/agents",
			livecrawl: true,
			livecrawl_timeout_ms: 5000,
		});
	});
});

describe("request headers", () => {
	it("sends every create operation as a plain request with no dedup header", async () => {
		const fetch = stubFetch(
			"search.ok",
			"contents.ok",
			"research.create",
			"research.get.completed",
		);
		const arex = client(fetch);
		await arex.search("agents");
		await arex.contents("https://example.org/agents");
		await arex.research.create("agents");
		await arex.research.run("agents");
		const posts = fetch.calls.filter((call) => call.method === "POST");
		expect(posts).toHaveLength(4);
		for (const call of posts) {
			expect([...call.headers.keys()].sort()).toEqual([
				"accept",
				"authorization",
				"content-type",
			]);
		}
	});

	it("accepts a search response with only its results", async () => {
		const fetch = stubFetch(
			async () =>
				new Response(JSON.stringify({ results: [] }), { status: 200 }),
		);
		await expect(client(fetch).search("agents")).resolves.toEqual({
			results: [],
		});
	});
});

describe("per-call timeouts", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	async function derivedTimeoutMs(
		run: (arex: Arex) => Promise<unknown>,
		options: { timeoutMs?: number } = {},
	): Promise<number> {
		vi.useFakeTimers();
		const arex = client(stubFetch(pendingUntilAbort), options);
		const settled = run(arex).then(
			() => undefined,
			(error: unknown) => error,
		);
		await vi.advanceTimersByTimeAsync(300_000);
		const error = await settled;
		if (!(error instanceof ArexTimeoutError)) {
			throw new Error(`expected ArexTimeoutError, got ${String(error)}`);
		}
		expect(error.phase).toBe("request");
		return error.timeoutMs;
	}

	it("derives search and research lifecycle timeouts as 30s", async () => {
		expect(await derivedTimeoutMs((arex) => arex.search("q"))).toBe(30_000);
		expect(await derivedTimeoutMs((arex) => arex.research.create("q"))).toBe(
			30_000,
		);
	});

	it("derives contents from the tier and the livecrawl budget", async () => {
		const url = "https://example.org/a";
		expect(await derivedTimeoutMs((arex) => arex.contents(url))).toBe(30_000);
		expect(
			await derivedTimeoutMs((arex) => arex.contents(url, { tier: "flex" })),
		).toBe(70_000);
		expect(
			await derivedTimeoutMs((arex) => arex.contents(url, { livecrawl: true })),
		).toBe(30_000);
		expect(
			await derivedTimeoutMs((arex) =>
				arex.contents(url, { tier: "flex", livecrawl: true }),
			),
		).toBe(100_000);
		expect(
			await derivedTimeoutMs((arex) =>
				arex.contents(url, { livecrawl: true, livecrawlTimeoutMs: 45_000 }),
			),
		).toBe(55_000);
	});

	it("lets the client option override the derived default, and the call override both", async () => {
		expect(
			await derivedTimeoutMs((arex) => arex.search("q"), {
				timeoutMs: 5_000,
			}),
		).toBe(5_000);
		expect(
			await derivedTimeoutMs((arex) => arex.search("q", { timeoutMs: 1_000 }), {
				timeoutMs: 5_000,
			}),
		).toBe(1_000);
	});

	it("aborts the in-flight request only once the deadline elapses", async () => {
		vi.useFakeTimers();
		const fetch = stubFetch(pendingUntilAbort);
		const settled = client(fetch)
			.search("q")
			.then(
				() => undefined,
				(error: unknown) => error,
			);

		await vi.advanceTimersByTimeAsync(29_999);
		expect(fetch.calls[0]?.signal?.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(fetch.calls[0]?.signal?.aborted).toBe(true);
		expect(await settled).toBeInstanceOf(ArexTimeoutError);
	});
});

describe("configuration", () => {
	it("falls back to AREX_API_KEY and refuses to construct without a key", () => {
		const previous = process.env.AREX_API_KEY;
		try {
			process.env.AREX_API_KEY = TEST_API_KEY;
			const arex = new Arex({ fetch: stubFetch("search.ok") });
			expect(arex).toBeInstanceOf(Arex);

			delete process.env.AREX_API_KEY;
			expect(() => new Arex({ fetch: stubFetch("search.ok") })).toThrow(
				TypeError,
			);
		} finally {
			if (previous === undefined) delete process.env.AREX_API_KEY;
			else process.env.AREX_API_KEY = previous;
		}
	});

	it("sends requests to a custom baseUrl", async () => {
		const fetch = stubFetch("search.ok");
		await new Arex({
			apiKey: TEST_API_KEY,
			baseUrl: "https://staging.example.org/api",
			fetch,
		}).search("agents");
		expect(fetch.calls[0]?.url).toBe(
			"https://staging.example.org/api/v1/search",
		);
	});
});

describe("contents response mapping", () => {
	function contentsWith(extra: Record<string, unknown>): Arex {
		return client(
			stubFetch(
				async () =>
					new Response(
						JSON.stringify({ content: "c", truncated: false, ...extra }),
						{ status: 200 },
					),
			),
		);
	}

	it("rejects image_urls with non-string entries", async () => {
		await expect(
			contentsWith({ image_urls: ["https://example.org/a.png", 5] }).contents(
				"https://example.org",
			),
		).rejects.toMatchObject({
			name: "ArexNetworkError",
			code: "invalid_response",
		});
	});

	it("rejects image_urls beyond the contract's item limit", async () => {
		const urls = Array.from(
			{ length: 51 },
			(_, i) => `https://example.org/${i}.png`,
		);
		await expect(
			contentsWith({ image_urls: urls }).contents("https://example.org"),
		).rejects.toMatchObject({
			name: "ArexNetworkError",
			code: "invalid_response",
		});
	});
});
