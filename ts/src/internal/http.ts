import {
	ArexError,
	ArexNetworkError,
	ArexTimeoutError,
	apiErrorFromResponse,
	parseRetryAfter,
	RateLimitError,
	ServiceUnavailableError,
} from "../errors.js";
import {
	DEFAULT_MAX_RETRIES,
	DEFAULT_RETRY_DELAY_MS,
	type FetchLike,
} from "../types.js";
import { MAX_TIMER_MS } from "../validate.js";

export interface HttpClientOptions {
	apiKey: string;
	baseUrl: string;
	fetch?: FetchLike;
	maxRetries?: number;
	retryUnavailable?: boolean;
}

export interface RequestInput {
	body?: unknown;
	headers?: Record<string, string>;
	signal?: AbortSignal;
	timeoutMs: number;
}

export interface HttpResult<T> {
	data: T;
	/** `Retry-After` of a successful response, honored by the poller. */
	retryAfterMs?: number;
}

/**
 * The single place that talks to the API: auth header, per-call deadline,
 * caller abort forwarding, error mapping and the retry policy
 * from `CONTRACT.md`.
 */
export class HttpClient {
	private readonly apiKey: string;
	private readonly baseUrl: URL;
	private readonly fetch: FetchLike;
	private readonly maxRetries: number;
	private readonly retryUnavailable: boolean;

	constructor(options: HttpClientOptions) {
		this.apiKey = options.apiKey;
		this.baseUrl = normalizedBaseUrl(options.baseUrl);
		this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
		if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) {
			throw new TypeError("maxRetries must be a non-negative integer");
		}
		this.retryUnavailable = options.retryUnavailable ?? false;

		const fetchImpl = options.fetch ?? globalThis.fetch;
		if (typeof fetchImpl !== "function") {
			throw new TypeError(
				"No fetch implementation available in this runtime. Pass options.fetch.",
			);
		}
		this.fetch = options.fetch ?? fetchImpl.bind(globalThis);
	}

	/**
	 * One wall-clock deadline (`input.timeoutMs`) covers every attempt and every
	 * retry sleep. A caller abort wins over the deadline. Callers validate
	 * `timeoutMs` (positive, at most {@link MAX_TIMER_MS}) before getting here.
	 */
	async request<T>(
		method: "GET" | "POST" | "DELETE",
		path: string,
		input: RequestInput,
	): Promise<HttpResult<T>> {
		const startedAt = performance.now();
		const controller = new AbortController();
		let timedOut = false;
		const expire = () => {
			timedOut = true;
			controller.abort();
		};
		const timer = setTimeout(expire, input.timeoutMs);
		const forwardAbort = () => controller.abort(input.signal?.reason);
		input.signal?.addEventListener("abort", forwardAbort, { once: true });

		try {
			for (let attempt = 0; ; attempt += 1) {
				const stop = stopReason(input, timedOut);
				if (stop !== undefined) throw stop;

				try {
					return await this.attempt<T>(
						method,
						path,
						input,
						controller.signal,
						attempt,
					);
				} catch (caught) {
					const error = toArexError(caught);
					const delayMs = this.retryDelayMs(error);
					if (delayMs === undefined || attempt >= this.maxRetries) throw error;
					const remainingMs = input.timeoutMs - (performance.now() - startedAt);
					if (remainingMs <= 0) {
						expire();
						throw error;
					}
					await sleep(Math.min(delayMs, remainingMs), controller.signal);
				}
			}
		} catch (error) {
			const stop = stopReason(input, timedOut);
			if (stop !== undefined) throw stop;
			throw error;
		} finally {
			clearTimeout(timer);
			input.signal?.removeEventListener("abort", forwardAbort);
		}
	}

	private async attempt<T>(
		method: "GET" | "POST" | "DELETE",
		path: string,
		input: RequestInput,
		signal: AbortSignal,
		attempt: number,
	): Promise<HttpResult<T>> {
		const headers = new Headers({
			Accept: "application/json",
			Authorization: `Bearer ${this.apiKey}`,
			...input.headers,
		});
		if (attempt > 0 && headers.get("Prefer")?.startsWith("wait=")) {
			headers.set("Prefer", "respond-async");
		}
		let body: string | undefined;
		if (input.body !== undefined) {
			headers.set("Content-Type", "application/json");
			body = JSON.stringify(input.body);
		}

		const response = await this.fetch(
			new URL(path.replace(/^\/+/, ""), this.baseUrl).toString(),
			{ method, headers, body, signal },
		);
		const payload = await readBody(response);
		if (payload !== undefined && typeof payload === "string") {
			throw new ArexNetworkError(
				"invalid_response",
				`AREX returned a non-JSON body with status ${response.status}`,
			);
		}
		if (!response.ok) {
			throw apiErrorFromResponse(response.status, payload, response.headers);
		}
		const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
		return {
			data: payload as T,
			...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
		};
	}

	/** Only the bounded rate-limit and opt-in unavailable policies trigger retries. */
	private retryDelayMs(error: unknown): number | undefined {
		const retryable =
			(error instanceof RateLimitError &&
				error.code === "rate_limit_exceeded") ||
			(this.retryUnavailable &&
				error instanceof ServiceUnavailableError &&
				error.status === 503 &&
				error.code === "temporarily_unavailable");
		if (!retryable) return undefined;
		return error.retryAfterMs ?? DEFAULT_RETRY_DELAY_MS;
	}
}

function normalizedBaseUrl(value: string): URL {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new TypeError("baseUrl must be a valid absolute URL");
	}
	if (
		(url.protocol !== "http:" && url.protocol !== "https:") ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new TypeError(
			"baseUrl must be an http(s) URL without credentials, query, or fragment",
		);
	}
	if (!url.pathname.endsWith("/")) url.pathname += "/";
	return url;
}
/** Decode JSON, preserving empty successful responses for lifecycle calls. */
async function readBody(response: Response): Promise<unknown> {
	if (response.status === 204) return undefined;
	const text = await response.text();
	if (!text && response.ok) return undefined;
	try {
		return JSON.parse(text) as unknown;
	} catch (cause) {
		throw new ArexNetworkError(
			"invalid_response",
			`AREX returned a non-JSON body with status ${response.status}`,
			{ cause },
		);
	}
}

/**
 * A delay that rejects with the abort reason instead of outliving the call.
 * Executor form because `Promise.withResolvers` is not in Node 20.
 */
export function sleep(delayMs: number, signal?: AbortSignal): Promise<void> {
	if (signal?.aborted) return Promise.reject(abortReason(signal));
	// Always a real timer, even for 0: a zero `Retry-After` must still yield to
	// the event loop so deadlines and abort listeners get to run.
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			clearTimeout(timer);
			reject(abortReason(signal));
		};
		const timer = setTimeout(
			() => {
				signal?.removeEventListener("abort", onAbort);
				resolve();
			},
			Math.min(delayMs, MAX_TIMER_MS),
		);
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

export function abortReason(signal?: AbortSignal): unknown {
	return (
		signal?.reason ??
		new DOMException("The operation was aborted", "AbortError")
	);
}

/** Why the call must stop now: a caller abort outranks the SDK deadline. */
function stopReason(input: RequestInput, timedOut: boolean): unknown {
	if (input.signal?.aborted) return abortReason(input.signal);
	if (timedOut) return new ArexTimeoutError("request", input.timeoutMs);
	return undefined;
}

function toArexError(error: unknown): ArexError {
	if (error instanceof ArexError) return error;
	return new ArexNetworkError(
		"request_failed",
		"The AREX request failed before a response was received",
		{ cause: error },
	);
}
