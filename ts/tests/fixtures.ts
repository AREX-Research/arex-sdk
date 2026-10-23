import { readFileSync } from "node:fs";

/** Recorded wire responses shared with the Python suite: `../../fixtures`. */
export interface Fixture {
	status: number;
	headers: Record<string, string>;
	body: unknown;
}

const cache = new Map<string, Fixture>();

export function loadFixture(name: string): Fixture {
	const cached = cache.get(name);
	if (cached !== undefined) return cached;
	const url = new URL(`../../fixtures/${name}.json`, import.meta.url);
	const fixture = JSON.parse(readFileSync(url, "utf8")) as Fixture;
	cache.set(name, fixture);
	return fixture;
}

/** Turn a recorded fixture into the `Response` an injected `fetch` returns. */
export function fixtureResponse(name: string): Response {
	const fixture = loadFixture(name);
	const body =
		fixture.body === null
			? null
			: typeof fixture.body === "string"
				? fixture.body
				: JSON.stringify(fixture.body);
	return new Response(fixture.status === 204 ? null : body, {
		status: fixture.status,
		headers: fixture.headers,
	});
}

export interface RecordedCall {
	url: string;
	method: string;
	headers: Headers;
	body: unknown;
	signal: AbortSignal | undefined;
}

export interface StubFetch {
	(url: string, init: RequestInit): Promise<Response>;
	calls: RecordedCall[];
}

/** A response that never arrives, rejecting on abort the way `fetch` does. */
export function pendingUntilAbort(call: RecordedCall): Promise<Response> {
	return new Promise((_resolve, reject) => {
		call.signal?.addEventListener(
			"abort",
			() =>
				reject(
					call.signal?.reason ??
						new DOMException("The operation was aborted", "AbortError"),
				),
			{ once: true },
		);
	});
}

export type StubResponse = string | ((call: RecordedCall) => Promise<Response>);

/**
 * A `fetch` that replays the given fixtures in order and records every call.
 * The last entry repeats, and a function entry lets a test answer per call.
 */
export function stubFetch(...responses: StubResponse[]): StubFetch {
	const queue = [...responses];
	const calls: RecordedCall[] = [];

	const impl = async (url: string, init: RequestInit): Promise<Response> => {
		const call: RecordedCall = {
			url,
			method: init.method ?? "GET",
			headers: new Headers(init.headers),
			body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
			signal: init.signal ?? undefined,
		};
		calls.push(call);
		const next = queue.length > 1 ? queue.shift() : queue[0];
		if (next === undefined) {
			throw new Error(`stubFetch ran out of responses for ${url}`);
		}
		return typeof next === "string" ? fixtureResponse(next) : next(call);
	};

	return Object.assign(impl, { calls }) as StubFetch;
}

export const TEST_API_KEY = "sk_arex_0123456789abcdefghijklmnopqrstuv";
export const TEST_RUN_ID = "0f7c3b3e-2d3a-4b7e-9a1c-6f0d2b8c4e5a";
