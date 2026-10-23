/** Current external platform API-key prefix. */
export const AREX_API_KEY_PREFIX = "sk_arex";
export const AREX_API_KEY_SECRET_LENGTH = 32;

const API_KEY_PATTERN = /^sk_arex_[A-Za-z0-9_-]{32}$/;

/** Return true when a value matches the current external API-key wire format. */
export function isArexApiKey(value: string): boolean {
	return API_KEY_PATTERN.test(value);
}
