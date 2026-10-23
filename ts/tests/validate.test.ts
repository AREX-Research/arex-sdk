import { describe, expect, it } from "vitest";

import { Arex, type ResearchCreateOptions } from "../src/index.js";
import { WIRE_LIMITS } from "../src/wire.js";
import { stubFetch, TEST_API_KEY, TEST_RUN_ID } from "./fixtures.js";

function client() {
	const fetch = stubFetch("search.ok");
	return { fetch, arex: new Arex({ apiKey: TEST_API_KEY, fetch }) };
}

async function rejectsLocally(
	run: (arex: Arex) => Promise<unknown>,
	param: string,
): Promise<void> {
	const { arex, fetch } = client();
	await expect(run(arex)).rejects.toMatchObject({
		name: "InvalidRequestError",
		status: 0,
		code: "invalid_request",
		param,
	});
	expect(fetch.calls).toEqual([]);
}

describe("client-side validation", () => {
	it("rejects search query and limit bounds before sending", async () => {
		await rejectsLocally((arex) => arex.search(""), "query");
		await rejectsLocally(
			(arex) => arex.search("x".repeat(WIRE_LIMITS.search.query.maxLength + 1)),
			"query",
		);
		for (const limit of [
			WIRE_LIMITS.search.limit.minimum - 1,
			WIRE_LIMITS.search.limit.maximum + 1,
			1.5,
		]) {
			await rejectsLocally((arex) => arex.search("q", { limit }), "limit");
		}
	});

	it("validates search publication bounds before sending", async () => {
		for (const publishedAfter of [
			"not a timestamp",
			"2026-02-30T00:00:00Z",
			"2026-10-01",
			"2026-10-01T00:00:00+08:00",
		]) {
			await rejectsLocally(
				(arex) => arex.search("q", { publishedAfter }),
				"publishedAfter",
			);
		}
		for (const publishedBefore of [
			"not a timestamp",
			"2026-02-30T00:00:00Z",
			"2026-10-01",
			"2026-10-01T00:00:00+08:00",
		]) {
			await rejectsLocally(
				(arex) => arex.search("q", { publishedBefore }),
				"publishedBefore",
			);
		}
		for (const [publishedAfter, publishedBefore] of [
			["2026-10-15T00:00:00Z", "2026-10-15T00:00:00Z"],
			["2026-10-16T00:00:00Z", "2026-10-15T00:00:00Z"],
			["2026-10-15T00:00:00.100Z", "2026-10-15T00:00:00.900Z"],
		] as const) {
			await rejectsLocally(
				(arex) => arex.search("q", { publishedAfter, publishedBefore }),
				"publishedBefore",
			);
		}

		const { arex, fetch } = client();
		await arex.search("q", {
			publishedAfter: "2026-10-15T00:00:00.900Z",
			publishedBefore: "2026-10-15T00:00:01.100Z",
		});
		expect(fetch.calls[0]?.body).toEqual({
			query: "q",
			published_after: "2026-10-15T00:00:00.900Z",
			published_before: "2026-10-15T00:00:01.100Z",
		});
	});

	it("counts query length in code points rather than UTF-16 units", async () => {
		const { arex, fetch } = client();
		const query = "\u{1F600}".repeat(WIRE_LIMITS.search.query.maxLength);
		await arex.search(query);
		expect(fetch.calls[0]?.body).toEqual({ query });
		await rejectsLocally((sdk) => sdk.search(`${query}x`), "query");
	});

	it("rejects invalid contents URLs and content bounds", async () => {
		for (const url of [
			"",
			`https://a.test/${"p".repeat(WIRE_LIMITS.contents.url.maxLength)}`,
			"ftp://example.org",
			"/relative",
			"https://user:pw@example.org",
		]) {
			await rejectsLocally((arex) => arex.contents(url), "url");
		}
		for (const maxCharacters of [
			WIRE_LIMITS.contents.maxCharacters.minimum - 1,
			WIRE_LIMITS.contents.maxCharacters.maximum + 1,
		]) {
			await rejectsLocally(
				(arex) => arex.contents("https://example.org", { maxCharacters }),
				"maxCharacters",
			);
		}
	});

	it("requires livecrawl and enforces its timeout bounds", async () => {
		for (const livecrawl of [undefined, false]) {
			await rejectsLocally(
				(arex) =>
					arex.contents("https://example.org", {
						...(livecrawl !== undefined ? { livecrawl } : {}),
						livecrawlTimeoutMs: WIRE_LIMITS.contents.livecrawlTimeoutMs.minimum,
					}),
				"livecrawlTimeoutMs",
			);
		}
		for (const livecrawlTimeoutMs of [
			WIRE_LIMITS.contents.livecrawlTimeoutMs.minimum - 1,
			WIRE_LIMITS.contents.livecrawlTimeoutMs.maximum + 1,
		]) {
			await rejectsLocally(
				(arex) =>
					arex.contents("https://example.org", {
						livecrawl: true,
						livecrawlTimeoutMs,
					}),
				"livecrawlTimeoutMs",
			);
		}
	});

	it("validates research query and mode", async () => {
		await rejectsLocally((arex) => arex.research.create(""), "query");
		await rejectsLocally(
			(arex) =>
				arex.research.create(
					"x".repeat(WIRE_LIMITS.research.query.maxLength + 1),
				),
			"query",
		);
		await rejectsLocally(
			(arex) =>
				arex.research.create("q", {
					mode: "turbo",
				} as unknown as ResearchCreateOptions),
			"mode",
		);
		await rejectsLocally(
			(arex) =>
				arex.research.create("q", {
					detach: "yes",
				} as unknown as ResearchCreateOptions),
			"detach",
		);
	});

	it("rejects non-UUID research ids across the lifecycle", async () => {
		for (const method of ["get", "cancel", "delete", "wait"] as const) {
			await rejectsLocally(
				(arex) => arex.research[method]("not-a-uuid"),
				"runId",
			);
		}
		const arex = new Arex({
			apiKey: TEST_API_KEY,
			fetch: stubFetch("research.get.completed"),
		});
		expect((await arex.research.get(TEST_RUN_ID)).id).toBe(TEST_RUN_ID);
	});

	it("rejects timeouts and intervals beyond the timer limit before any request", async () => {
		const tooLong = 2 ** 31;
		await rejectsLocally(
			(arex) => arex.search("q", { timeoutMs: tooLong }),
			"timeoutMs",
		);
		await rejectsLocally(
			(arex) => arex.contents("https://example.org", { timeoutMs: tooLong }),
			"timeoutMs",
		);
		await rejectsLocally(
			(arex) => arex.research.create("q", { timeoutMs: tooLong }),
			"timeoutMs",
		);
		await rejectsLocally(
			(arex) => arex.research.run("q", { timeoutMs: tooLong }),
			"timeoutMs",
		);
		await rejectsLocally(
			(arex) => arex.research.run("q", { pollIntervalMs: tooLong }),
			"pollIntervalMs",
		);
		await rejectsLocally(
			(arex) => arex.research.get(TEST_RUN_ID, { timeoutMs: tooLong }),
			"timeoutMs",
		);
		expect(
			() => new Arex({ apiKey: TEST_API_KEY, timeoutMs: tooLong }),
		).toThrow(TypeError);
	});
});
