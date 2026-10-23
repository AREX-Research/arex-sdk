import { describe, expect, it } from "vitest";

import {
	Arex,
	ArexApiError,
	ArexNetworkError,
	AuthenticationError,
	apiErrorFromResponse,
	CreditsExhaustedError,
	InvalidRequestError,
	NotFoundError,
	RateLimitError,
	ServiceUnavailableError,
	SourceNotAvailableError,
} from "../src/index.js";
import { loadFixture, stubFetch, TEST_API_KEY } from "./fixtures.js";

function errorFrom(name: string): ArexApiError {
	const fixture = loadFixture(name);
	const error = apiErrorFromResponse(
		fixture.status,
		fixture.body,
		new Headers(fixture.headers),
	);
	if (!(error instanceof ArexApiError)) throw error;
	return error;
}

describe("error mapping", () => {
	it.each([
		["error.unauthorized", AuthenticationError, 401, "unauthorized"],
		["error.invalid-request", InvalidRequestError, 400, "invalid_request"],
		["error.content-blocked", InvalidRequestError, 400, "content_blocked"],
		[
			"contents.source-not-available",
			SourceNotAvailableError,
			422,
			"source_not_available",
		],
		["error.not-found", NotFoundError, 404, "not_found"],
		["error.rate-limit", RateLimitError, 429, "rate_limit_exceeded"],
		[
			"error.outstanding-run-limit",
			RateLimitError,
			429,
			"outstanding_run_limit",
		],
		[
			"error.daily-credits-exhausted",
			CreditsExhaustedError,
			429,
			"daily_credits_exhausted",
		],
		[
			"error.weekly-credits-exhausted",
			CreditsExhaustedError,
			429,
			"weekly_credits_exhausted",
		],
		[
			"error.temporarily-unavailable",
			ServiceUnavailableError,
			503,
			"temporarily_unavailable",
		],
		["error.internal", ServiceUnavailableError, 500, "internal_error"],
	])("maps %s onto its class", (name, type, status, code) => {
		const error = errorFrom(name);
		expect(error).toBeInstanceOf(type);
		expect(error.status).toBe(status);
		expect(error.code).toBe(code);
	});

	it("surfaces 409 run_not_cancellable as a plain ArexApiError", () => {
		const error = errorFrom("error.run-not-cancellable");
		expect(error.constructor).toBe(ArexApiError);
		expect(error.status).toBe(409);
		expect(error.code).toBe("run_not_cancellable");
		expect(error.retryable).toBe(false);
	});

	it("surfaces an unknown code as a plain ArexApiError", () => {
		const error = apiErrorFromResponse(
			418,
			{
				error: {
					code: "brewing_refused",
					message: "Cannot brew",
					request_id: "req_unknown",
					retryable: true,
				},
			},
			new Headers(),
		);
		expect(error.constructor).toBe(ArexApiError);
		expect(error.code).toBe("brewing_refused");
		expect(error).toMatchObject({ retryable: true });
	});

	it("treats a JSON error without the contract envelope as invalid_response", () => {
		const error = apiErrorFromResponse(
			502,
			{ message: "bad gateway" },
			new Headers(),
		);
		expect(error).toBeInstanceOf(ArexNetworkError);
		expect(error.code).toBe("invalid_response");
	});

	it("preserves only contract error details for diagnosis", () => {
		const fixture = loadFixture("error.invalid-request");
		const body = fixture.body as {
			error: { message: string; request_id: string; param: string };
		};
		const error = apiErrorFromResponse(
			fixture.status,
			{ error: { ...body.error, resource: "private", used: 42 } },
			new Headers(fixture.headers),
		);
		if (!(error instanceof ArexApiError)) throw error;
		expect(error.message).toBe(body.error.message);
		expect(error.requestId).toBe(body.error.request_id);
		expect(error.param).toBe(body.error.param);
		expect(error.details).toEqual(body.error);
	});

	it("rejects non-JSON error responses as invalid_response", async () => {
		const fetch = stubFetch(
			async () => new Response("Forbidden", { status: 403 }),
		);
		const arex = new Arex({ apiKey: TEST_API_KEY, fetch });
		await expect(arex.search("agents")).rejects.toMatchObject({
			name: "ArexNetworkError",
			code: "invalid_response",
		});
		expect(fetch.calls).toHaveLength(1);
	});

	it("reads Retry-After as milliseconds and defaults retryable to false", () => {
		expect(errorFrom("error.rate-limit").retryAfterMs).toBe(1000);
		expect(errorFrom("error.temporarily-unavailable").retryAfterMs).toBe(5000);
		expect(errorFrom("error.rate-limit").retryable).toBe(true);
		expect(
			errorFrom("error.outstanding-run-limit").retryAfterMs,
		).toBeUndefined();
		expect(errorFrom("error.outstanding-run-limit").retryable).toBe(false);
	});

	it("preserves allowance-exhaustion messages and retry delays", () => {
		const daily = errorFrom("error.daily-credits-exhausted");
		const weekly = errorFrom("error.weekly-credits-exhausted");
		if (
			!(daily instanceof CreditsExhaustedError) ||
			!(weekly instanceof CreditsExhaustedError)
		) {
			throw new Error("expected CreditsExhaustedError");
		}

		expect(daily.message).toBe("The daily usage allowance is exhausted.");
		expect(daily.retryAfterMs).toBe(3_600_000);

		expect(weekly.message).toBe("The weekly usage allowance is exhausted.");
		expect(weekly.retryAfterMs).toBe(86_400_000);
	});
});
