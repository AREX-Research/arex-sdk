import { describe, expect, it } from "vitest";

import { isArexApiKey } from "../src/index.js";

describe("isArexApiKey", () => {
	it("accepts sk_arex_ plus 32 base64url characters and nothing else", () => {
		expect(isArexApiKey(`sk_arex_${"a".repeat(32)}`)).toBe(true);
		expect(isArexApiKey(`sk_arex_${"a".repeat(31)}`)).toBe(false);
		expect(isArexApiKey(`sk_arex_${"a".repeat(33)}`)).toBe(false);
		expect(isArexApiKey(`sk_arex_${"a".repeat(31)}$`)).toBe(false);
		expect(isArexApiKey(`arex_${"a".repeat(32)}`)).toBe(false);
	});
});
