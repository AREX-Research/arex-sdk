import { describe, expect, it } from "vitest";

import { Arex, type ResearchCreateOptions } from "../src/index.js";
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

/** The server's answer for a value past one of its limits. */
async function sentAndRejectedByServer(
	run: (arex: Arex) => Promise<unknown>,
	field: string,
): Promise<void> {
	const fetch = stubFetch("error.invalid-request");
	const arex = new Arex({ apiKey: TEST_API_KEY, fetch });
	await expect(run(arex)).rejects.toMatchObject({
		name: "InvalidRequestError",
		status: 400,
		code: "invalid_request",
		requestId: "req_9f1c2e7a",
	});
	expect(fetch.calls).toHaveLength(1);
	expect(fetch.calls[0]?.body).toHaveProperty(field);
}

describe("client-side validation", () => {
	it("leaves value limits to the server and surfaces its rejection", async () => {
		await sentAndRejectedByServer((arex) => arex.search(""), "query");
		await sentAndRejectedByServer(
			(arex) => arex.search("x".repeat(2001)),
			"query",
		);
		await sentAndRejectedByServer(
			(arex) => arex.search("q", { limit: 0 }),
			"limit",
		);
		await sentAndRejectedByServer(
			(arex) => arex.contents(`https://a.test/${"p".repeat(8192)}`),
			"url",
		);
		await sentAndRejectedByServer(
			(arex) =>
				arex.contents("https://example.org", {
					tier: "priority",
				} as never),
			"tier",
		);
		await sentAndRejectedByServer(
			(arex) =>
				arex.contents("https://example.org", {
					livecrawl: true,
					livecrawlTimeoutMs: 999,
				}),
			"livecrawl_timeout_ms",
		);
		await sentAndRejectedByServer(
			(arex) =>
				arex.contents("https://example.org", { maxCharacters: 10 ** 9 }),
			"max_characters",
		);
		await sentAndRejectedByServer(
			(arex) => arex.research.create("x".repeat(2001)),
			"query",
		);
		await sentAndRejectedByServer(
			(arex) =>
				arex.research.create("q", {
					mode: "turbo",
				} as unknown as ResearchCreateOptions),
			"mode",
		);
	});

	it("rejects arguments of the wrong type before sending", async () => {
		await rejectsLocally((arex) => arex.search("q", { limit: 1.5 }), "limit");
		await rejectsLocally(
			(arex) =>
				arex.contents("https://example.org", {
					maxCharacters: "600" as unknown as number,
				}),
			"maxCharacters",
		);
		await rejectsLocally(
			(arex) => arex.search(42 as unknown as string),
			"query",
		);
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

	it("rejects URLs a request cannot be built from", async () => {
		for (const url of [
			"",
			"ftp://example.org",
			"/relative",
			"https://user:pw@example.org",
		]) {
			await rejectsLocally((arex) => arex.contents(url), "url");
		}
	});

	it("requires livecrawl for a livecrawl timeout", async () => {
		for (const livecrawl of [undefined, false]) {
			await rejectsLocally(
				(arex) =>
					arex.contents("https://example.org", {
						...(livecrawl !== undefined ? { livecrawl } : {}),
						livecrawlTimeoutMs: 5000,
					}),
				"livecrawlTimeoutMs",
			);
		}
	});

	it("requires a boolean research detach", async () => {
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
