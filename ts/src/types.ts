import type { components } from "./wire.js";

export type ArexErrorCode = components["schemas"]["Error"]["error"]["code"];
export type ResearchFailureCode =
	| NonNullable<components["schemas"]["ResearchRun"]["error"]>["code"]
	| (string & {});

/** Default AREX API origin. */
export const DEFAULT_BASE_URL = "https://api.arex-research.com";

/** Server-side livecrawl deadline applied when the caller omits one. */
export const DEFAULT_LIVECRAWL_TIMEOUT_AUTO_MS = 20000;
export const DEFAULT_LIVECRAWL_TIMEOUT_FLEX_MS = 90000;

/** Per-call request timeouts: server deadline plus 10s, or a fixed value. */
export const SEARCH_TIMEOUT_MS = 30000;
export const CONTENTS_AUTO_TIMEOUT_MS = 30000;
export const CONTENTS_FLEX_TIMEOUT_MS = 70000;
export const RESEARCH_REQUEST_TIMEOUT_MS = 30000;
/** Margin added to the livecrawl deadline when deriving a contents timeout. */
export const LIVECRAWL_TIMEOUT_MARGIN_MS = 10000;

/** Polling: fixed interval, deadline is the server deadline plus 30s. */
export const DEFAULT_POLL_INTERVAL_MS = 2000;
export const FAST_POLL_TIMEOUT_MS = 150000;
export const DEEP_POLL_TIMEOUT_MS = 180000;

/** Retry policy: rate limits, plus opt-in 503. */
export const DEFAULT_MAX_RETRIES = 2;
export const DEFAULT_RETRY_DELAY_MS = 1000;

export type ContentsTier = NonNullable<
	components["schemas"]["ContentsRequest"]["tier"]
>;
export type ResearchMode =
	| components["schemas"]["ResearchRun"]["mode"]
	| (string & {});
/** Response-side requested mode; request options use the generated closed enum. */
export type ResearchModeRequest =
	| components["schemas"]["ResearchRun"]["requested_mode"]
	| (string & {});
export type ResearchStatus = components["schemas"]["ResearchRun"]["status"];

export interface SearchResult {
	title: string;
	url: string;
	snippet?: string;
	publishedAt?: string;
}

export interface SearchResponse {
	results: SearchResult[];
}

export interface ContentsDocument {
	url: string;
	title?: string;
	publishedAt?: string;
	imageUrl?: string;
	imageUrls?: string[];
	content: string;
	truncated: boolean;
}

export interface ResearchSource {
	title: string;
	url: string;
}

export interface ResearchResult {
	answer: string;
	sources: ResearchSource[];
}

export interface ResearchRunBase {
	id: string;
	mode: ResearchMode;
	requestedMode: ResearchModeRequest;
	createdAt: string;
	startedAt?: string;
	completedAt?: string;
	message?: string;
}

export type CompletedResearchRun = ResearchRunBase & {
	status: "completed";
	result: ResearchResult;
};

/**
 * Known statuses remain a discriminated union for result/error narrowing.
 * A newer server may return an unknown status at runtime; treat it as in progress.
 */
export type ResearchRun =
	| (ResearchRunBase & { status: "queued" | "running" | "cancelled" })
	| CompletedResearchRun
	| (ResearchRunBase & {
			status: "failed";
			error: { code: ResearchFailureCode; retryable: boolean };
	  });

/** Minimal `fetch` shape the client depends on. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface ArexOptions {
	/** Defaults to `AREX_API_KEY` from the environment. */
	apiKey?: string;
	/** Defaults to {@link DEFAULT_BASE_URL}. */
	baseUrl?: string;
	fetch?: FetchLike;
	/** Overrides every derived per-call request timeout. */
	timeoutMs?: number;
	/** Defaults to {@link DEFAULT_MAX_RETRIES}. */
	maxRetries?: number;
	/** Extends the retry policy to 503 `temporarily_unavailable`. */
	retryUnavailable?: boolean;
}

export interface CallOptions {
	signal?: AbortSignal;
	timeoutMs?: number;
}

export interface SearchOptions extends CallOptions {
	limit?: number;
	publishedAfter?: string;
	publishedBefore?: string;
}

export interface ContentsOptions extends CallOptions {
	tier?: ContentsTier;
	livecrawl?: boolean;
	livecrawlTimeoutMs?: number;
	maxCharacters?: number;
}

export interface ResearchCreateOptions extends CallOptions {
	mode?: NonNullable<components["schemas"]["ResearchCreateRequest"]["mode"]>;
	detach?: boolean;
}

export interface ResearchWaitOptions {
	signal?: AbortSignal;
	/** Defaults to {@link DEFAULT_POLL_INTERVAL_MS}; `Retry-After` wins. */
	pollIntervalMs?: number;
	/** Deadline for the whole poll loop, not for a single request. */
	timeoutMs?: number;
}

export interface ResearchRunOptions extends ResearchWaitOptions {
	mode?: NonNullable<components["schemas"]["ResearchCreateRequest"]["mode"]>;
}
