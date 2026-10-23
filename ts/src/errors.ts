import type { ArexErrorCode, ResearchRun } from "./types.js";

export type { ArexErrorCode } from "./types.js";

/** Base class for every error this SDK raises on purpose. */
export class ArexError extends Error {
	/**
	 * A known research run associated with this error. Pollers attach it so the
	 * caller can resume or cancel; research response-validation errors may also set it.
	 */
	runId?: string;

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = new.target.name;
	}
}

/** Name the run on an error leaving the poll loop; errors that already know it keep it. */
export function withRunId<E>(error: E, runId: string): E {
	if (error instanceof ArexError && error.runId === undefined) {
		error.runId = runId;
	}
	return error;
}

/** Contract codes keep autocomplete; a code added server-side still arrives as a string. */
export type ArexApiErrorCode = ArexErrorCode | (string & {});

export interface ArexApiErrorInit {
	status: number;
	code: ArexApiErrorCode;
	message?: string;
	retryable?: boolean;
	retryAfterMs?: number;
	requestId?: string;
	param?: string;
	details?: Readonly<Record<string, unknown>>;
}

/** An error the API reported, or a client-side validation failure (status 0). */
export class ArexApiError extends ArexError {
	readonly status: number;
	readonly code: ArexApiErrorCode;
	readonly retryable: boolean;
	readonly retryAfterMs?: number;
	readonly requestId?: string;
	readonly param?: string;
	readonly details: Readonly<Record<string, unknown>>;

	constructor(init: ArexApiErrorInit) {
		super(
			init.message ??
				(init.status === 0
					? `Invalid AREX request: ${init.code}`
					: `AREX request failed with status ${init.status} (${init.code})`),
		);
		this.status = init.status;
		this.code = init.code;
		this.retryable = init.retryable ?? false;
		if (init.retryAfterMs !== undefined) this.retryAfterMs = init.retryAfterMs;
		if (init.requestId !== undefined) this.requestId = init.requestId;
		if (init.param !== undefined) this.param = init.param;
		this.details = init.details ?? {};
	}
}

/** 401 `unauthorized`. */
export class AuthenticationError extends ArexApiError {}

/** 403 account or feature restrictions. */
export class PermissionDeniedError extends ArexApiError {}

/** Invalid requests and client-side checks. */
export class InvalidRequestError extends ArexApiError {}

/** 422 `source_not_available`. */
export class SourceNotAvailableError extends ArexApiError {}

/** 404 `not_found`. */
export class NotFoundError extends ArexApiError {}

/** Rate limits and outstanding runs. */
export class RateLimitError extends ArexApiError {}

/** 429 `daily_credits_exhausted` / `weekly_credits_exhausted`. */
export class CreditsExhaustedError extends ArexApiError {}

/** 503 `temporarily_unavailable` and 500 `internal_error`. */
export class ServiceUnavailableError extends ArexApiError {}

/** The request never produced a usable response. */
export class ArexNetworkError extends ArexError {
	readonly code: "request_failed" | "invalid_response";

	constructor(
		code: "request_failed" | "invalid_response",
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
		this.code = code;
	}
}

/** An SDK deadline elapsed: a single request, or a whole poll loop. */
export class ArexTimeoutError extends ArexError {
	readonly phase: "request" | "poll";
	readonly timeoutMs: number;

	constructor(phase: "request" | "poll", timeoutMs: number, runId?: string) {
		super(
			runId === undefined
				? `AREX ${phase} timed out after ${timeoutMs}ms`
				: `AREX ${phase} for run ${runId} timed out after ${timeoutMs}ms`,
		);
		this.phase = phase;
		this.timeoutMs = timeoutMs;
		if (runId !== undefined) this.runId = runId;
	}
}

/** A research run reached the terminal `failed` state. */
export class ResearchRunFailedError extends ArexError {
	readonly run: ResearchRun;

	constructor(run: ResearchRun) {
		super(`Research run ${run.id} failed`);
		this.run = run;
		this.runId = run.id;
	}
}

/** A research run reached the terminal `cancelled` state. */
export class ResearchRunCancelledError extends ArexError {
	readonly run: ResearchRun;

	constructor(run: ResearchRun) {
		super(`Research run ${run.id} was cancelled`);
		this.run = run;
		this.runId = run.id;
	}
}

/**
 * Build the error class assigned to the API status and code. A JSON error
 * without the contract envelope is off contract, like a non-JSON body.
 */
export function apiErrorFromResponse(
	status: number,
	body: unknown,
	headers: Headers,
): ArexApiError | ArexNetworkError {
	const details = asRecord(asRecord(body)?.error);
	const code = stringField(details?.code);
	const message = stringField(details?.message);
	if (
		details === undefined ||
		code === undefined ||
		message === undefined ||
		typeof details.retryable !== "boolean" ||
		(details.request_id !== undefined &&
			typeof details.request_id !== "string") ||
		(details.param !== undefined && typeof details.param !== "string")
	) {
		return new ArexNetworkError(
			"invalid_response",
			`AREX returned status ${status} without a contract error envelope`,
		);
	}
	const retryAfterMs = parseRetryAfter(headers.get("Retry-After"));
	const init: ArexApiErrorInit = {
		status,
		code,
		message,
		retryable: details.retryable,
		details: {
			code,
			message,
			retryable: details.retryable,
			...(details.request_id !== undefined
				? { request_id: details.request_id }
				: {}),
			...(details.param !== undefined ? { param: details.param } : {}),
		},
		...(typeof details.request_id === "string"
			? { requestId: details.request_id }
			: {}),
		...(typeof details.param === "string" ? { param: details.param } : {}),
		...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
	};

	switch (code) {
		case "unauthorized":
			return status === 401
				? new AuthenticationError(init)
				: new ArexApiError(init);
		case "registration_required":
		case "account_deletion_pending":
			return status === 403
				? new PermissionDeniedError(init)
				: new ArexApiError(init);
		case "invalid_request":
		case "content_blocked":
			return new InvalidRequestError(init);
		case "source_not_available":
			return new SourceNotAvailableError(init);
		case "not_found":
			return new NotFoundError(init);
		case "rate_limit_exceeded":
		case "outstanding_run_limit":
			return new RateLimitError(init);
		case "daily_credits_exhausted":
		case "weekly_credits_exhausted":
			return new CreditsExhaustedError(init);
		case "temporarily_unavailable":
		case "internal_error":
			return new ServiceUnavailableError(init);
		default:
			return new ArexApiError(init);
	}
}

/** `Retry-After` in milliseconds; accepts delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null): number | undefined {
	if (!value?.trim()) return undefined;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.ceil(seconds * 1000);
	}
	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return undefined;
	return Math.max(0, timestamp - Date.now());
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function stringField(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}
