import { afterEach, describe, expect, it, vi } from "vitest";

import {
	Arex,
	ArexNetworkError,
	ArexTimeoutError,
	InvalidRequestError,
	ResearchRunCancelledError,
	ResearchRunFailedError,
} from "../src/index.js";
import {
	fixtureResponse,
	loadFixture,
	type StubFetch,
	stubFetch,
	TEST_API_KEY,
	TEST_RUN_ID,
} from "./fixtures.js";

function client(fetch: StubFetch): Arex {
	return new Arex({ apiKey: TEST_API_KEY, fetch });
}

interface Settled {
	value: unknown;
	elapsedMs: number;
}

/** Run a poll-driven call to settlement on fake timers. */
async function settle(promise: Promise<unknown>): Promise<Settled> {
	const startedAt = Date.now();
	const settled = promise.then(
		(value) => ({ value: value as unknown, elapsedMs: Date.now() - startedAt }),
		(error: unknown) => ({ value: error, elapsedMs: Date.now() - startedAt }),
	);
	await vi.advanceTimersByTimeAsync(400_000);
	return settled;
}

describe("research lifecycle", () => {
	it("maps the created run", async () => {
		const fetch = stubFetch("research.create");
		const run = await client(fetch).research.create("agent evaluation", {
			mode: "auto",
		});

		expect(run).toEqual({
			id: TEST_RUN_ID,
			mode: "deep",
			requestedMode: "auto",
			status: "queued",
			createdAt: "2026-09-21T09:00:00.000Z",
		});
		expect(fetch.calls[0]?.method).toBe("POST");
		expect(fetch.calls[0]?.url).toBe(
			"https://api.arex-research.com/v1/research",
		);
		expect(fetch.calls[0]?.body).toEqual({
			query: "agent evaluation",
			mode: "auto",
		});
	});

	it("maps a synchronously completed run from create (200)", async () => {
		const fetch = stubFetch("research.get.completed");
		const run = await client(fetch).research.create("agent evaluation", {
			mode: "fast",
		});

		expect(run.status).toBe("completed");
		if (run.status !== "completed") throw new Error("unreachable");
		expect(run.result.answer).toBe("Agents are evaluated by ...");
		expect(fetch.calls[0]?.headers.get("prefer")).toBeNull();
	});

	it("maps message on queued and running runs and omits it on terminal runs", async () => {
		const queued = loadFixture("research.create").body as Record<
			string,
			unknown
		>;
		const completed = loadFixture("research.get.completed").body as Record<
			string,
			unknown
		>;
		const fetch = stubFetch(
			async () =>
				new Response(
					JSON.stringify({
						...queued,
						message: "Poll GET /v1/research/id every 2s.",
					}),
					{ status: 202 },
				),
			async () =>
				new Response(
					JSON.stringify({
						...completed,
						message: "Should be ignored on terminal state.",
					}),
					{ status: 200 },
				),
		);
		const arex = client(fetch);

		const pending = await arex.research.create("agent evaluation");
		expect(pending.message).toBe("Poll GET /v1/research/id every 2s.");

		const done = await arex.research.get(TEST_RUN_ID);
		expect(done.message).toBeUndefined();
		expect("message" in done).toBe(false);
	});

	it("sends Prefer: respond-async when detach is true", async () => {
		const fetch = stubFetch("research.create");
		await client(fetch).research.create("agent evaluation", {
			detach: true,
			timeoutMs: 5_000,
		});

		expect(fetch.calls[0]?.headers.get("prefer")).toBe("respond-async");
	});

	it("sends Prefer: respond-async under 3s and Prefer: wait=N from 3s to <22s when not detached", async () => {
		for (const [timeoutMs, expected] of [
			[1_000, "respond-async"],
			[2_500, "respond-async"],
			[2_999, "respond-async"],
			[3_000, "wait=1"],
			[10_000, "wait=8"],
			[21_999, "wait=19"],
			[22_000, null],
			[30_000, null],
		] as const) {
			const fetch = stubFetch("research.create");
			await client(fetch).research.create("agent evaluation", { timeoutMs });
			expect(fetch.calls[0]?.headers.get("prefer")).toBe(expected);
		}
	});

	it("replaces Prefer: wait=N with Prefer: respond-async when create is retried after 429", async () => {
		vi.useFakeTimers();
		try {
			const fetch = stubFetch("error.rate-limit", "research.create");
			await settle(
				client(fetch).research.create("agent evaluation", {
					timeoutMs: 10_000,
				}),
			);

			expect(fetch.calls).toHaveLength(2);
			expect(fetch.calls[0]?.headers.get("prefer")).toBe("wait=8");
			expect(fetch.calls[1]?.headers.get("prefer")).toBe("respond-async");
		} finally {
			vi.useRealTimers();
		}
	});

	it("maps a completed run, camelCasing the timestamps and sources", async () => {
		const run = await client(stubFetch("research.get.completed")).research.get(
			TEST_RUN_ID,
		);

		expect(run).toEqual({
			id: TEST_RUN_ID,
			mode: "deep",
			requestedMode: "auto",
			status: "completed",
			createdAt: "2026-09-21T09:00:00.000Z",
			startedAt: "2026-09-21T09:00:03.000Z",
			completedAt: "2026-09-21T09:01:40.000Z",
			result: {
				answer: "Agents are evaluated by ...",
				sources: [
					{
						title: "AI agent evaluation survey",
						url: "https://example.org/agents",
					},
				],
			},
		});
	});

	it("maps a failed run's error block", async () => {
		const run = await client(stubFetch("research.get.failed")).research.get(
			TEST_RUN_ID,
		);
		expect(run.status).toBe("failed");
		if (run.status !== "failed") throw new Error("unreachable");
		expect(run.error).toEqual({ code: "timeout", retryable: true });
	});

	it.each(["deep", "auto", "pro"])(
		"preserves response mode %s and a new requested mode across lifecycle calls",
		async (mode) => {
			const body = {
				...(loadFixture("research.create").body as object),
				mode,
				requested_mode: "adaptive",
			};
			const fetch = stubFetch(async () => Response.json(body));
			const research = client(fetch).research;
			for (const run of [
				await research.create("agents"),
				await research.get(TEST_RUN_ID),
				await research.cancel(TEST_RUN_ID),
				await research.delete(TEST_RUN_ID),
			]) {
				expect(run).toMatchObject({ mode, requestedMode: "adaptive" });
			}
		},
	);

	it("preserves a new failure code on a failed run", async () => {
		const fetch = stubFetch(async () =>
			Response.json({
				...(loadFixture("research.get.failed").body as object),
				error: { code: "quota_reclaimed", retryable: false },
			}),
		);
		const run = await client(fetch).research.get(TEST_RUN_ID);
		expect(run.status).toBe("failed");
		if (run.status !== "failed") throw new Error("unreachable");
		expect(run.error).toEqual({ code: "quota_reclaimed", retryable: false });
	});

	it("gets an unknown status without terminal payloads and keeps its message", async () => {
		const fetch = stubFetch(async () =>
			Response.json({
				...(loadFixture("research.get.running").body as object),
				status: "paused",
				message: "Waiting to resume",
			}),
		);
		const run = await client(fetch).research.get(TEST_RUN_ID);
		expect(run).toMatchObject({
			id: TEST_RUN_ID,
			status: "paused",
			message: "Waiting to resume",
		});
		expect("result" in run).toBe(false);
		expect("error" in run).toBe(false);
	});

	it("returns the run from cancel", async () => {
		const fetch = stubFetch("research.cancel.done");
		const run = await client(fetch).research.cancel(TEST_RUN_ID);
		expect(run.status).toBe("cancelled");
		expect(fetch.calls[0]?.method).toBe("POST");
		expect(fetch.calls[0]?.url).toBe(
			`https://api.arex-research.com/v1/research/${TEST_RUN_ID}/cancel`,
		);
	});

	it("returns undefined when delete removes the run outright", async () => {
		const fetch = stubFetch("research.delete.done");
		expect(await client(fetch).research.delete(TEST_RUN_ID)).toBeUndefined();
		expect(fetch.calls[0]?.method).toBe("DELETE");
	});

	it("returns the pending run when delete has to cancel first", async () => {
		const run = await client(
			stubFetch("research.delete.pending"),
		).research.delete(TEST_RUN_ID);
		expect(run?.status).toBe("running");
	});
});

describe("research polling", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("polls queued then running then completed", async () => {
		vi.useFakeTimers();
		const fetch = stubFetch(
			"research.create",
			"research.get.queued",
			"research.get.running",
			"research.get.completed",
		);
		const { value: run, elapsedMs } = await settle(
			client(fetch).research.run("agent evaluation"),
		);

		expect(run).toMatchObject({
			id: TEST_RUN_ID,
			status: "completed",
		});
		expect(fetch.calls.map((call) => call.method)).toEqual([
			"POST",
			"GET",
			"GET",
			"GET",
		]);
		// Two 2s sleeps between the three polls.
		expect(elapsedMs).toBe(4000);
	});

	it("short-circuits in run() when create returns 200 completed", async () => {
		const fetch = stubFetch("research.get.completed");
		const run = await client(fetch).research.run("agent evaluation", {
			mode: "fast",
		});

		expect(run.status).toBe("completed");
		expect(run.result.answer).toBe("Agents are evaluated by ...");
		expect(fetch.calls).toHaveLength(1);
		expect(fetch.calls[0]?.method).toBe("POST");
	});

	it("short-circuits in run() when create returns 200 failed or cancelled", async () => {
		const failedFetch = stubFetch("research.get.failed");
		const failedError = await client(failedFetch)
			.research.run("agent evaluation")
			.catch((caught: unknown) => caught);
		expect(failedError).toBeInstanceOf(ResearchRunFailedError);
		expect(failedFetch.calls).toHaveLength(1);

		const cancelledFetch = stubFetch("research.get.cancelled");
		const cancelledError = await client(cancelledFetch)
			.research.run("agent evaluation")
			.catch((caught: unknown) => caught);
		expect(cancelledError).toBeInstanceOf(ResearchRunCancelledError);
		expect(cancelledFetch.calls).toHaveLength(1);
	});

	it("caps the create timeout in run() and sends Prefer: wait=N on short poll budgets", async () => {
		const fetch = stubFetch("research.get.completed");
		await client(fetch).research.run("agent evaluation", { timeoutMs: 8_000 });

		expect(fetch.calls[0]?.headers.get("prefer")).toBe("wait=6");
	});

	it("lets Retry-After on a poll response override the fixed interval", async () => {
		vi.useFakeTimers();
		const running = loadFixture("research.get.running");
		const fetch = stubFetch(
			async () =>
				new Response(JSON.stringify(running.body), {
					status: 200,
					headers: { "Retry-After": "7" },
				}),
			"research.get.completed",
		);
		const { elapsedMs } = await settle(
			client(fetch).research.wait(TEST_RUN_ID),
		);
		expect(elapsedMs).toBe(7000);
	});

	it.each(["wait", "run"] as const)(
		"%s polls an unknown status until completed and respects Retry-After",
		async (method) => {
			vi.useFakeTimers();
			const paused = {
				...(loadFixture("research.get.running").body as object),
				mode: "pro",
				requested_mode: "adaptive",
				status: "paused",
			};
			const fetch = stubFetch(
				...(method === "run" ? [async () => Response.json(paused)] : []),
				async () => Response.json(paused, { headers: { "Retry-After": "7" } }),
				"research.get.completed",
			);
			const { value: run, elapsedMs } = await settle(
				client(fetch).research[method](
					method === "wait" ? TEST_RUN_ID : "agents",
					{ pollIntervalMs: 1000 },
				),
			);
			expect(run).toMatchObject({
				status: "completed",
				result: { answer: "Agents are evaluated by ..." },
			});
			expect(elapsedMs).toBe(7000);
			expect(fetch.calls.map((call) => call.method)).toEqual(
				method === "run" ? ["POST", "GET", "GET"] : ["GET", "GET"],
			);
		},
	);

	it.each(["wait", "run"] as const)(
		"%s raises a failed-run error preserving a new failure code",
		async (method) => {
			const fetch = stubFetch(async () =>
				Response.json({
					...(loadFixture("research.get.failed").body as object),
					error: { code: "quota_reclaimed", retryable: false },
				}),
			);
			await expect(
				client(fetch).research[method](
					method === "wait" ? TEST_RUN_ID : "agents",
				),
			).rejects.toMatchObject({
				name: "ResearchRunFailedError",
				runId: TEST_RUN_ID,
				run: { error: { code: "quota_reclaimed", retryable: false } },
			});
		},
	);

	it("throws ResearchRunFailedError carrying the run", async () => {
		vi.useFakeTimers();
		const { value: error } = await settle(
			client(stubFetch("research.create", "research.get.failed")).research.run(
				"agent evaluation",
			),
		);

		expect(error).toBeInstanceOf(ResearchRunFailedError);
		if (!(error instanceof ResearchRunFailedError)) throw error;
		expect(error.run.id).toBe(TEST_RUN_ID);
		expect(error.run.status).toBe("failed");
	});

	it("throws ResearchRunCancelledError carrying the run", async () => {
		vi.useFakeTimers();
		const { value: error } = await settle(
			client(stubFetch("research.get.cancelled")).research.wait(TEST_RUN_ID),
		);

		expect(error).toBeInstanceOf(ResearchRunCancelledError);
		if (!(error instanceof ResearchRunCancelledError)) throw error;
		expect(error.run.status).toBe("cancelled");
	});

	it("throws ResearchRunCancelledError carrying the run from run()", async () => {
		vi.useFakeTimers();
		const { value: error } = await settle(
			client(
				stubFetch("research.create", "research.get.cancelled"),
			).research.run("agent evaluation"),
		);
		expect(error).toBeInstanceOf(ResearchRunCancelledError);
		if (!(error instanceof ResearchRunCancelledError)) throw error;
		expect(error.run.id).toBe(TEST_RUN_ID);
		expect(error.run.status).toBe("cancelled");
	});

	it("yields to the event loop when Retry-After is 0 so the deadline can fire", async () => {
		vi.useFakeTimers();
		const running = loadFixture("research.get.running");
		const fetch = stubFetch(
			async () =>
				new Response(JSON.stringify(running.body), {
					status: 200,
					headers: { "Retry-After": "0" },
				}),
		);
		const { value: error } = await settle(
			client(fetch).research.wait(TEST_RUN_ID, { timeoutMs: 50 }),
		);
		expect(error).toBeInstanceOf(ArexTimeoutError);
	});

	it("caps an enormous Retry-After instead of overflowing the timer", async () => {
		vi.useFakeTimers();
		const running = loadFixture("research.get.running");
		const fetch = stubFetch(
			async () =>
				new Response(JSON.stringify(running.body), {
					status: 200,
					headers: { "Retry-After": "99999999999" },
				}),
		);
		const { value: error, elapsedMs } = await settle(
			client(fetch).research.wait(TEST_RUN_ID, { timeoutMs: 5000 }),
		);
		expect(error).toBeInstanceOf(ArexTimeoutError);
		expect(elapsedMs).toBe(5000);
		expect(fetch.calls).toHaveLength(1);
	});

	it("sends a best-effort cancel on caller abort and rethrows the abort reason", async () => {
		vi.useFakeTimers();
		const fetch = stubFetch("research.get.running", "research.cancel.pending");
		const controller = new AbortController();
		const reason = new Error("caller gave up");

		const settled = client(fetch)
			.research.wait(TEST_RUN_ID, { signal: controller.signal })
			.then(
				() => undefined,
				(error: unknown) => error,
			);
		await vi.advanceTimersByTimeAsync(3000);
		controller.abort(reason);
		await vi.advanceTimersByTimeAsync(10);

		expect(await settled).toBe(reason);
		expect(
			fetch.calls.some(
				(call) => call.method === "POST" && call.url.endsWith("/cancel"),
			),
		).toBe(true);
	});

	it.each([
		["wait", "running"],
		["wait", "paused"],
		["run", "paused"],
	] as const)(
		"%s times out %s without cancelling, so the caller can wait again",
		async (method, status) => {
			vi.useFakeTimers();
			const fetch = stubFetch(async () =>
				Response.json({
					...(loadFixture("research.get.running").body as object),
					status,
				}),
			);
			const { value: error } = await settle(
				client(fetch).research[method](
					method === "wait" ? TEST_RUN_ID : "agents",
					{ timeoutMs: 5000 },
				),
			);

			expect(error).toBeInstanceOf(ArexTimeoutError);
			if (!(error instanceof ArexTimeoutError)) throw error;
			expect(error.phase).toBe("poll");
			expect(error.timeoutMs).toBe(5000);
			expect(error.runId).toBe(TEST_RUN_ID);
			expect(fetch.calls.map((call) => call.method)).toEqual(
				method === "wait"
					? ["GET", "GET", "GET"]
					: ["POST", "GET", "GET", "GET"],
			);
		},
	);

	it("gives run a mode-derived poll deadline: fast 150s, auto and deep 180s", async () => {
		vi.useFakeTimers();
		for (const [mode, expected] of [
			["fast", 150_000],
			["deep", 180_000],
			[undefined, 180_000],
		] as const) {
			const fetch = stubFetch(
				async () => fixtureResponse("research.create"),
				"research.get.running",
			);
			const { value: error } = await settle(
				client(fetch).research.run("agents", {
					...(mode !== undefined ? { mode } : {}),
				}),
			);
			expect(error).toBeInstanceOf(ArexTimeoutError);
			if (!(error instanceof ArexTimeoutError)) throw error;
			expect(error.timeoutMs).toBe(expected);
		}
	});

	it("rejects a bad poll interval before paying for the create", async () => {
		const fetch = stubFetch("research.create");
		await expect(
			client(fetch).research.run("agents", { pollIntervalMs: 0 }),
		).rejects.toBeInstanceOf(InvalidRequestError);
		expect(fetch.calls).toHaveLength(0);
	});

	it("names the run on a network failure while polling", async () => {
		vi.useFakeTimers();
		const fetch = stubFetch(
			async () => fixtureResponse("research.create"),
			async () => {
				throw new TypeError("socket hang up");
			},
		);
		const { value: error } = await settle(client(fetch).research.run("agents"));

		expect(error).toBeInstanceOf(ArexNetworkError);
		if (!(error instanceof ArexNetworkError)) throw error;
		expect(error.code).toBe("request_failed");
		expect(error.runId).toBe(TEST_RUN_ID);
	});
});

describe("malformed research responses", () => {
	const completed = loadFixture("research.get.completed").body as Record<
		string,
		unknown
	>;

	function respond(body: unknown): StubFetch {
		return stubFetch(
			async () => new Response(JSON.stringify(body), { status: 200 }),
		);
	}

	const malformed: Array<[string, Record<string, unknown>]> = [
		[
			"a source that is not an object",
			{ ...completed, result: { answer: "a", sources: [null] } },
		],
		[
			"a source without a url",
			{ ...completed, result: { answer: "a", sources: [{ title: "t" }] } },
		],
		[
			"a source with a non-string title",
			{
				...completed,
				result: { answer: "a", sources: [{ title: 5, url: "https://x.org" }] },
			},
		],
		["a non-string resolved mode", { ...completed, mode: 42 }],
		["an empty resolved mode", { ...completed, mode: "" }],
		["a non-string requested mode", { ...completed, requested_mode: null }],
		["an empty requested mode", { ...completed, requested_mode: "" }],
		["a non-string status", { ...completed, status: 42 }],
		["an empty status", { ...completed, status: "" }],
		[
			"a non-string failure code",
			{
				...completed,
				status: "failed",
				error: { code: 42, retryable: false },
			},
		],
		[
			"an empty failure code",
			{
				...completed,
				status: "failed",
				error: { code: "", retryable: false },
			},
		],
	];

	it.each(malformed)(
		"get rejects %s and names the run",
		async (_name, body) => {
			const error = await client(respond(body))
				.research.get(TEST_RUN_ID)
				.catch((caught: unknown) => caught);
			expect(error).toBeInstanceOf(ArexNetworkError);
			expect(error).toMatchObject({
				code: "invalid_response",
				runId: TEST_RUN_ID,
			});
		},
	);

	it("names the run when create returns a malformed run", async () => {
		const created = loadFixture("research.create");
		const fetch = stubFetch(
			async () =>
				new Response(
					JSON.stringify({ ...(created.body as object), mode: null }),
					{
						status: 202,
						headers: created.headers,
					},
				),
		);
		const error = await client(fetch)
			.research.create("agents")
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ArexNetworkError);
		expect(error).toMatchObject({ runId: TEST_RUN_ID });
	});

	it("names the run when wait reads a malformed completed run", async () => {
		const error = await client(
			respond({ ...completed, result: { answer: "a", sources: [null] } }),
		)
			.research.wait(TEST_RUN_ID)
			.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ArexNetworkError);
		expect(error).toMatchObject({ runId: TEST_RUN_ID });
	});
});
