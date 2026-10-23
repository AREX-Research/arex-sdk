import { ArexNetworkError } from "./errors.js";
import { HttpClient } from "./internal/http.js";
import { ResearchResource } from "./resources/research.js";
import {
	type ArexOptions,
	CONTENTS_AUTO_TIMEOUT_MS,
	CONTENTS_FLEX_TIMEOUT_MS,
	type ContentsDocument,
	type ContentsOptions,
	DEFAULT_BASE_URL,
	DEFAULT_LIVECRAWL_TIMEOUT_AUTO_MS,
	DEFAULT_LIVECRAWL_TIMEOUT_FLEX_MS,
	LIVECRAWL_TIMEOUT_MARGIN_MS,
	SEARCH_TIMEOUT_MS,
	type SearchOptions,
	type SearchResponse,
	type SearchResult,
} from "./types.js";
import { MAX_TIMER_MS, validateContents, validateSearch } from "./validate.js";
import { type components, WIRE_LIMITS } from "./wire.js";

/** Client for the AREX public API: Search, Contents, Research. */
export class Arex {
	readonly research: ResearchResource;
	private readonly http: HttpClient;
	private readonly timeoutMs?: number;

	constructor(options: ArexOptions = {}) {
		const apiKey = options.apiKey ?? environmentApiKey();
		if (!apiKey) {
			throw new TypeError(
				"An AREX API key is required: pass options.apiKey or set AREX_API_KEY.",
			);
		}
		if (options.timeoutMs !== undefined) {
			if (
				!Number.isFinite(options.timeoutMs) ||
				options.timeoutMs <= 0 ||
				options.timeoutMs > MAX_TIMER_MS
			) {
				throw new TypeError(
					`timeoutMs must be a positive number up to ${MAX_TIMER_MS}`,
				);
			}
			this.timeoutMs = options.timeoutMs;
		}

		this.http = new HttpClient({
			apiKey,
			baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
			...(options.fetch !== undefined ? { fetch: options.fetch } : {}),
			...(options.maxRetries !== undefined
				? { maxRetries: options.maxRetries }
				: {}),
			...(options.retryUnavailable !== undefined
				? { retryUnavailable: options.retryUnavailable }
				: {}),
		});
		this.research = new ResearchResource(
			this.http,
			(derived, override) => override ?? this.timeoutMs ?? derived,
		);
	}

	/** Search the web. */
	async search(
		query: string,
		options: SearchOptions = {},
	): Promise<SearchResponse> {
		validateSearch(query, options);
		const result = await this.http.request<
			components["schemas"]["SearchResponse"]
		>("POST", "/v1/search", {
			body: {
				query,
				...(options.limit !== undefined ? { limit: options.limit } : {}),
				...(options.publishedAfter !== undefined
					? { published_after: options.publishedAfter }
					: {}),
				...(options.publishedBefore !== undefined
					? { published_before: options.publishedBefore }
					: {}),
			} satisfies components["schemas"]["SearchRequest"],
			...(options.signal !== undefined ? { signal: options.signal } : {}),
			timeoutMs: options.timeoutMs ?? this.timeoutMs ?? SEARCH_TIMEOUT_MS,
		});

		const rows = result.data?.results;
		if (!Array.isArray(rows)) {
			throw new ArexNetworkError(
				"invalid_response",
				"AREX search response has no results array",
			);
		}
		const results: SearchResult[] = rows.map((row) => {
			const raw = row;
			if (typeof raw?.title !== "string" || typeof raw?.url !== "string") {
				throw new ArexNetworkError(
					"invalid_response",
					"AREX search result is missing title or url",
				);
			}
			if (
				(raw.snippet !== undefined && typeof raw.snippet !== "string") ||
				(raw.published_at !== undefined && typeof raw.published_at !== "string")
			) {
				throw new ArexNetworkError(
					"invalid_response",
					"AREX search result has invalid metadata",
				);
			}
			return {
				title: raw.title,
				url: raw.url,
				...(raw.snippet !== undefined ? { snippet: raw.snippet } : {}),
				...(raw.published_at !== undefined
					? { publishedAt: raw.published_at }
					: {}),
			};
		});
		return { results };
	}

	/** Read a source's contents. */
	async contents(
		url: string,
		options: ContentsOptions = {},
	): Promise<ContentsDocument> {
		validateContents(url, options);
		const result = await this.http.request<
			components["schemas"]["ContentsResponse"]
		>("POST", "/v1/contents", {
			body: {
				url,
				...(options.tier !== undefined ? { tier: options.tier } : {}),
				...(options.livecrawl !== undefined
					? { livecrawl: options.livecrawl }
					: {}),
				...(options.livecrawlTimeoutMs !== undefined
					? { livecrawl_timeout_ms: options.livecrawlTimeoutMs }
					: {}),
				...(options.maxCharacters !== undefined
					? { max_characters: options.maxCharacters }
					: {}),
			} satisfies components["schemas"]["ContentsRequest"],
			...(options.signal !== undefined ? { signal: options.signal } : {}),
			timeoutMs:
				options.timeoutMs ?? this.timeoutMs ?? contentsTimeoutMs(options),
		});

		const raw = result.data;
		if (
			typeof raw?.content !== "string" ||
			typeof raw.truncated !== "boolean"
		) {
			throw new ArexNetworkError(
				"invalid_response",
				"AREX contents response is missing content or truncated",
			);
		}
		const imageUrls = raw.image_urls;
		if (
			imageUrls !== undefined &&
			(!Array.isArray(imageUrls) ||
				imageUrls.length > WIRE_LIMITS.contents.imageUrls.maxItems ||
				imageUrls.some((entry) => typeof entry !== "string"))
		) {
			throw new ArexNetworkError(
				"invalid_response",
				"AREX contents response has an invalid image_urls list",
			);
		}
		return {
			url: typeof raw.url === "string" ? raw.url : url,
			...(typeof raw.title === "string" ? { title: raw.title } : {}),
			...(typeof raw.published_at === "string"
				? { publishedAt: raw.published_at }
				: {}),
			...(typeof raw.image_url === "string" ? { imageUrl: raw.image_url } : {}),
			...(imageUrls !== undefined ? { imageUrls } : {}),
			content: raw.content,
			truncated: raw.truncated,
		};
	}
}

/**
 * Server deadline plus 10s. With `livecrawl` the deadline is the livecrawl
 * budget itself, which defaults per tier when the caller omits it.
 */
function contentsTimeoutMs(options: ContentsOptions): number {
	const tier = options.tier ?? WIRE_LIMITS.contents.tier.default;
	if (options.livecrawl === true) {
		const livecrawlMs =
			options.livecrawlTimeoutMs ??
			(tier === "flex"
				? DEFAULT_LIVECRAWL_TIMEOUT_FLEX_MS
				: DEFAULT_LIVECRAWL_TIMEOUT_AUTO_MS);
		return livecrawlMs + LIVECRAWL_TIMEOUT_MARGIN_MS;
	}
	return tier === "flex" ? CONTENTS_FLEX_TIMEOUT_MS : CONTENTS_AUTO_TIMEOUT_MS;
}

/** Read `AREX_API_KEY` without importing `node:process`, so Workers still load. */
function environmentApiKey(): string | undefined {
	const scope = globalThis as {
		process?: { env?: Record<string, string | undefined> };
	};
	return scope.process?.env?.AREX_API_KEY;
}
