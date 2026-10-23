import { ArexTimeoutError } from "../errors.js";
import { abortReason, sleep } from "./http.js";

export interface PollTick<T> {
	value: T;
	/** `Retry-After` from this response; overrides the fixed interval. */
	retryAfterMs?: number;
}

export interface PollInput<T> {
	poll: (signal: AbortSignal) => Promise<PollTick<T>>;
	isTerminal: (value: T) => boolean;
	intervalMs: number;
	timeoutMs: number;
	runId: string;
	signal?: AbortSignal;
}

interface CombinedSignal {
	signal: AbortSignal;
	cleanup: () => void;
}

/**
 * Poll at a fixed interval until the value is terminal. The deadline aborts the
 * in-flight request with an {@link ArexTimeoutError} as the abort reason, so the
 * caller sees the timeout rather than a bare `AbortError`. Inputs are validated
 * by the resource before any request.
 */
export async function pollUntil<T>(input: PollInput<T>): Promise<T> {
	const deadline = new AbortController();
	const timer = setTimeout(
		() =>
			deadline.abort(
				new ArexTimeoutError("poll", input.timeoutMs, input.runId),
			),
		input.timeoutMs,
	);
	const combined = combineSignals(input.signal, deadline.signal);

	try {
		while (true) {
			if (combined.signal.aborted) throw abortReason(combined.signal);
			const tick = await input.poll(combined.signal);
			if (input.isTerminal(tick.value)) return tick.value;
			await sleep(tick.retryAfterMs ?? input.intervalMs, combined.signal);
		}
	} finally {
		clearTimeout(timer);
		combined.cleanup();
	}
}

function combineSignals(
	caller: AbortSignal | undefined,
	deadline: AbortSignal,
): CombinedSignal {
	if (caller === undefined) return { signal: deadline, cleanup: () => {} };

	const controller = new AbortController();
	const onAbort = () => controller.abort(caller.reason);
	const onDeadline = () => controller.abort(deadline.reason);
	if (caller.aborted) onAbort();
	else caller.addEventListener("abort", onAbort, { once: true });
	deadline.addEventListener("abort", onDeadline, { once: true });

	return {
		signal: controller.signal,
		cleanup: () => {
			caller.removeEventListener("abort", onAbort);
			deadline.removeEventListener("abort", onDeadline);
		},
	};
}
