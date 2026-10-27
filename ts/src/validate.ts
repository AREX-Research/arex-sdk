import { InvalidRequestError } from "./errors.js";
import type {
	CallOptions,
	ContentsOptions,
	ResearchCreateOptions,
	ResearchWaitOptions,
	SearchOptions,
} from "./types.js";

/** UUID v1 through v8, matching the server's `parseRunId`. */
const RUN_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Calendar-valid UTC ISO-8601 timestamp (`YYYY-MM-DDTHH:MM:SS(.sss)?Z`). */
const UTC_TIMESTAMP_PATTERN =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** Largest delay `setTimeout` honours; anything longer fires immediately. */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** Per-call checks shared by every call: the deadline must fit a timer. */
export function validateCallOptions(options: CallOptions): void {
	checkPositive(options.timeoutMs, "timeoutMs");
}

export function validateSearch(
	query: string,
	options: SearchOptions = {},
): void {
	checkString(query, "query");
	if (options.limit !== undefined) checkInteger(options.limit, "limit");
	const afterSeconds =
		options.publishedAfter !== undefined
			? checkUtcTimestamp(options.publishedAfter, "publishedAfter")
			: undefined;
	const beforeSeconds =
		options.publishedBefore !== undefined
			? checkUtcTimestamp(options.publishedBefore, "publishedBefore")
			: undefined;
	if (
		afterSeconds !== undefined &&
		beforeSeconds !== undefined &&
		afterSeconds >= beforeSeconds
	) {
		fail(
			"publishedBefore must be after publishedAfter at whole-second granularity",
			"publishedBefore",
		);
	}
	validateCallOptions(options);
}

export function validateContents(url: string, options: ContentsOptions): void {
	checkString(url, "url");

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		fail("url must be an absolute http: or https: URL", "url");
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		fail("url must be an absolute http: or https: URL", "url");
	}
	if (parsed.username || parsed.password) {
		fail("url must not contain credentials", "url");
	}

	if (options.tier !== undefined) checkString(options.tier, "tier");
	if (
		options.livecrawl !== undefined &&
		typeof options.livecrawl !== "boolean"
	) {
		fail("livecrawl must be a boolean", "livecrawl");
	}
	if (options.livecrawlTimeoutMs !== undefined) {
		if (options.livecrawl !== true) {
			fail("livecrawlTimeoutMs requires livecrawl: true", "livecrawlTimeoutMs");
		}
		checkInteger(options.livecrawlTimeoutMs, "livecrawlTimeoutMs");
	}
	if (options.maxCharacters !== undefined) {
		checkInteger(options.maxCharacters, "maxCharacters");
	}
	validateCallOptions(options);
}

export function validateResearchCreate(
	query: string,
	options: ResearchCreateOptions,
): void {
	checkString(query, "query");
	if (options.mode !== undefined) checkString(options.mode, "mode");
	if (options.detach !== undefined && typeof options.detach !== "boolean") {
		fail("detach must be a boolean", "detach");
	}
	validateCallOptions(options);
}

export function validateRunId(runId: string): void {
	if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
		fail("runId must be a UUID", "runId");
	}
}

/** Runs before `create` in `run`, so a bad poll setting never pays for a run it cannot wait for. */
export function validateResearchWait(options: ResearchWaitOptions): void {
	checkPositive(options.pollIntervalMs, "pollIntervalMs");
	checkPositive(options.timeoutMs, "timeoutMs");
}

function checkString(value: string, field: string): void {
	if (typeof value !== "string") fail(`${field} must be a string`, field);
}

function checkInteger(value: number, field: string): void {
	if (!Number.isInteger(value)) fail(`${field} must be an integer`, field);
}

function checkPositive(value: number | undefined, field: string): void {
	if (
		value !== undefined &&
		!(Number.isFinite(value) && value > 0 && value <= MAX_TIMER_MS)
	) {
		fail(`${field} must be a positive number up to ${MAX_TIMER_MS}`, field);
	}
}

function checkUtcTimestamp(value: string, field: string): number {
	if (typeof value === "string" && UTC_TIMESTAMP_PATTERN.test(value)) {
		const ms = Date.parse(value);
		if (
			Number.isFinite(ms) &&
			new Date(ms).toISOString().slice(0, 19) === value.slice(0, 19)
		) {
			return Math.floor(ms / 1000);
		}
	}
	fail(`${field} must be a UTC ISO-8601 timestamp`, field);
}

function fail(message: string, param: string): never {
	throw new InvalidRequestError({
		status: 0,
		code: "invalid_request",
		message,
		param,
	});
}
