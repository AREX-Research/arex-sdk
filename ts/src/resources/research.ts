import {
	ArexNetworkError,
	ResearchRunCancelledError,
	ResearchRunFailedError,
	withRunId,
} from "../errors.js";
import { abortReason, type HttpClient } from "../internal/http.js";
import { pollUntil } from "../internal/poll.js";
import {
	type CallOptions,
	type CompletedResearchRun,
	DEEP_POLL_TIMEOUT_MS,
	DEFAULT_POLL_INTERVAL_MS,
	FAST_POLL_TIMEOUT_MS,
	RESEARCH_REQUEST_TIMEOUT_MS,
	type ResearchCreateOptions,
	type ResearchRun,
	type ResearchRunBase,
	type ResearchRunOptions,
	type ResearchWaitOptions,
} from "../types.js";
import {
	validateCallOptions,
	validateResearchCreate,
	validateResearchWait,
	validateRunId,
} from "../validate.js";
import type { components } from "../wire.js";

/** Resolves a per-call request timeout: caller override, client override, default. */
export type TimeoutResolver = (
	derived: number,
	override: number | undefined,
) => number;

export class ResearchResource {
	private readonly http: HttpClient;
	private readonly resolveTimeout: TimeoutResolver;

	constructor(http: HttpClient, resolveTimeout: TimeoutResolver) {
		this.http = http;
		this.resolveTimeout = resolveTimeout;
	}

	/** Start a run. */
	async create(
		query: string,
		options: ResearchCreateOptions = {},
	): Promise<ResearchRun> {
		validateResearchCreate(query, options);
		const timeoutMs = this.resolveTimeout(
			RESEARCH_REQUEST_TIMEOUT_MS,
			options.timeoutMs,
		);
		const prefer = createPreferHeader(options.detach, timeoutMs);
		const result = await this.http.request<unknown>("POST", "/v1/research", {
			body: {
				query,
				...(options.mode !== undefined ? { mode: options.mode } : {}),
			} satisfies components["schemas"]["ResearchCreateRequest"],
			...(prefer !== undefined ? { headers: { Prefer: prefer } } : {}),
			...(options.signal !== undefined ? { signal: options.signal } : {}),
			timeoutMs,
		});
		return toResearchRun(result.data);
	}

	async get(runId: string, options: CallOptions = {}): Promise<ResearchRun> {
		validateRunId(runId);
		const result = await this.http.request<unknown>(
			"GET",
			`/v1/research/${runId}`,
			this.lifecycleInput(options),
		);
		return toResearchRun(result.data, runId);
	}

	async cancel(runId: string, options: CallOptions = {}): Promise<ResearchRun> {
		validateRunId(runId);
		const result = await this.http.request<unknown>(
			"POST",
			`/v1/research/${runId}/cancel`,
			this.lifecycleInput(options),
		);
		return toResearchRun(result.data, runId);
	}

	/** `undefined` when the run was deleted outright (204). */
	async delete(
		runId: string,
		options: CallOptions = {},
	): Promise<ResearchRun | undefined> {
		validateRunId(runId);
		const result = await this.http.request<unknown>(
			"DELETE",
			`/v1/research/${runId}`,
			this.lifecycleInput(options),
		);
		return result.data === undefined
			? undefined
			: toResearchRun(result.data, runId);
	}

	/**
	 * Poll until the run completes. A caller abort sends a best-effort cancel
	 * and rethrows the abort reason; a poll timeout leaves the run alone so the
	 * caller can `wait(runId)` again.
	 */
	async wait(
		runId: string,
		options: ResearchWaitOptions = {},
	): Promise<CompletedResearchRun> {
		validateRunId(runId);
		validateResearchWait(options);
		return this.pollToCompletion(
			runId,
			options,
			options.timeoutMs ?? DEEP_POLL_TIMEOUT_MS,
		);
	}

	/**
	 * `create` then `wait` for the finished run.
	 * Every error raised after the create names the run in `runId`.
	 */
	async run(
		query: string,
		options: ResearchRunOptions = {},
	): Promise<CompletedResearchRun> {
		validateResearchWait(options);
		const created = await this.create(query, {
			...(options.mode !== undefined ? { mode: options.mode } : {}),
			...(options.signal !== undefined ? { signal: options.signal } : {}),
			...(options.timeoutMs !== undefined
				? {
						timeoutMs: Math.min(RESEARCH_REQUEST_TIMEOUT_MS, options.timeoutMs),
					}
				: {}),
		});
		if (created.status === "completed") return created;
		if (created.status === "failed") throw new ResearchRunFailedError(created);
		if (created.status === "cancelled") {
			throw new ResearchRunCancelledError(created);
		}
		return this.pollToCompletion(
			created.id,
			options,
			options.timeoutMs ??
				(options.mode === "fast" ? FAST_POLL_TIMEOUT_MS : DEEP_POLL_TIMEOUT_MS),
		);
	}

	private async pollToCompletion(
		runId: string,
		options: ResearchWaitOptions,
		timeoutMs: number,
	): Promise<CompletedResearchRun> {
		const requestTimeoutMs = this.resolveTimeout(
			RESEARCH_REQUEST_TIMEOUT_MS,
			undefined,
		);
		let run: ResearchRun;
		try {
			run = await pollUntil<ResearchRun>({
				runId,
				intervalMs: options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
				timeoutMs,
				...(options.signal !== undefined ? { signal: options.signal } : {}),
				isTerminal: (candidate) =>
					candidate.status === "completed" ||
					candidate.status === "failed" ||
					candidate.status === "cancelled",
				poll: async (signal) => {
					const result = await this.http.request<unknown>(
						"GET",
						`/v1/research/${runId}`,
						{ signal, timeoutMs: requestTimeoutMs },
					);
					return {
						value: toResearchRun(result.data, runId),
						...(result.retryAfterMs !== undefined
							? { retryAfterMs: result.retryAfterMs }
							: {}),
					};
				},
			});
		} catch (error) {
			if (options.signal?.aborted) {
				void this.cancelQuietly(runId);
				throw abortReason(options.signal);
			}
			throw withRunId(error, runId);
		}

		if (run.status === "failed") throw new ResearchRunFailedError(run);
		if (run.status === "cancelled") throw new ResearchRunCancelledError(run);
		if (run.status !== "completed") {
			throw withRunId(
				new ArexNetworkError(
					"invalid_response",
					`AREX returned an unexpected terminal status for run ${runId}`,
				),
				runId,
			);
		}
		return run;
	}

	private lifecycleInput(options: CallOptions) {
		validateCallOptions(options);
		return {
			...(options.signal !== undefined ? { signal: options.signal } : {}),
			timeoutMs: this.resolveTimeout(
				RESEARCH_REQUEST_TIMEOUT_MS,
				options.timeoutMs,
			),
		};
	}

	/** The run is already abandoned; a failed cancel must not mask the abort. */
	private async cancelQuietly(runId: string): Promise<void> {
		try {
			await this.http.request<unknown>("POST", `/v1/research/${runId}/cancel`, {
				timeoutMs: RESEARCH_REQUEST_TIMEOUT_MS,
			});
		} catch {
			// intentionally ignored
		}
	}
}

type WireRun = Omit<
	components["schemas"]["ResearchRun"],
	"mode" | "requested_mode" | "status" | "error"
> & {
	mode: unknown;
	requested_mode: unknown;
	status: unknown;
	error?: { code?: unknown; retryable?: unknown };
};

function createPreferHeader(
	detach: boolean | undefined,
	timeoutMs: number,
): string | undefined {
	if (detach === true) return "respond-async";
	if (timeoutMs >= 22_000) return undefined;
	const waitSeconds = Math.floor((timeoutMs - 2_000) / 1_000);
	return waitSeconds < 1 ? "respond-async" : `wait=${waitSeconds}`;
}

/**
 * The single snake_case to camelCase mapping for research runs. Every
 * malformed response is an `invalid_response` that names the run when its id
 * is known, from the caller or from the body.
 */
export function toResearchRun(wire: unknown, knownRunId?: string): ResearchRun {
	const raw = (typeof wire === "object" ? wire : null) as WireRun | null;
	const runId =
		knownRunId ?? (typeof raw?.id === "string" ? raw.id : undefined);
	const invalid = (message: string): ArexNetworkError => {
		const error = new ArexNetworkError("invalid_response", message);
		if (runId !== undefined) error.runId = runId;
		return error;
	};

	if (raw === null) {
		throw invalid("AREX returned a research run that is not an object");
	}
	if (
		typeof raw.id !== "string" ||
		typeof raw.status !== "string" ||
		raw.status.length === 0 ||
		typeof raw.created_at !== "string"
	) {
		throw invalid("AREX returned a research run without its required fields");
	}
	if (typeof raw.mode !== "string" || raw.mode.length === 0) {
		throw invalid(`AREX returned run ${raw.id} without a valid mode`);
	}
	if (
		typeof raw.requested_mode !== "string" ||
		raw.requested_mode.length === 0
	) {
		throw invalid(`AREX returned run ${raw.id} without a valid requested mode`);
	}

	const base: ResearchRunBase = {
		id: raw.id,
		mode: raw.mode,
		requestedMode: raw.requested_mode,
		createdAt: raw.created_at,
	};
	if (typeof raw.started_at === "string") base.startedAt = raw.started_at;
	if (typeof raw.completed_at === "string") base.completedAt = raw.completed_at;
	if (
		raw.status !== "completed" &&
		raw.status !== "failed" &&
		raw.status !== "cancelled" &&
		typeof raw.message === "string"
	) {
		base.message = raw.message;
	}

	if (raw.status === "completed") {
		const answer = raw.result?.answer;
		const sources = raw.result?.sources;
		if (typeof answer !== "string" || !Array.isArray(sources)) {
			throw invalid(
				`AREX returned run ${raw.id} as completed without a result`,
			);
		}
		return {
			...base,
			status: "completed",
			result: {
				answer,
				sources: sources.map((source: unknown) => {
					const entry = source as { title?: unknown; url?: unknown } | null;
					if (
						typeof entry?.title !== "string" ||
						typeof entry.url !== "string"
					) {
						throw invalid(
							`AREX returned run ${raw.id} with a source missing title or url`,
						);
					}
					return { title: entry.title, url: entry.url };
				}),
			},
		};
	}

	if (raw.status === "failed") {
		if (
			!raw.error ||
			typeof raw.error.code !== "string" ||
			raw.error.code.length === 0 ||
			typeof raw.error.retryable !== "boolean"
		) {
			throw invalid(
				`AREX returned run ${raw.id} as failed without a valid error`,
			);
		}
		return {
			...base,
			status: "failed",
			error: {
				code: raw.error.code,
				retryable: raw.error.retryable,
			},
		};
	}

	// Keep the known-status union useful for narrowing while accepting new states.
	return { ...base, status: raw.status } as ResearchRun;
}
