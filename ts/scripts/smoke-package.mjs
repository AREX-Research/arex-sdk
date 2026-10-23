// Smoke test for the INSTALLED npm artifact. check-package.mjs copies this file
// into a clean project, installs the tarball there and runs it under the
// runtime being verified (`node` or `bun`), so `@arex-research/ts-sdk` can only
// resolve to node_modules. Calls go through the public API to a local HTTP
// server that replays the shared wire fixtures; nothing reaches the live API.
//
//   <runtime> smoke-package.mjs --runtime node|bun --version X.Y.Z --fixtures DIR

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
	options: {
		runtime: { type: "string" },
		version: { type: "string" },
		fixtures: { type: "string" },
	},
});
assert(args.runtime && args.version && args.fixtures, "missing arguments");

if (args.runtime === "bun") {
	assert(process.versions.bun, "expected to run under Bun");
} else {
	assert.equal(args.runtime, "node");
	assert(!process.versions.bun, "expected to run under Node.js");
	assert(process.versions.node, "expected to run under Node.js");
}

const PACKAGE = "@arex-research/ts-sdk";
const API_KEY = `sk_arex_${"a".repeat(32)}`;
const RUN_ID = "0f7c3b3e-2d3a-4b7e-9a1c-6f0d2b8c4e5a";

const checks = [];
async function check(name, run) {
	await run();
	checks.push(name);
}

// A scripted server: each route replays its fixtures in order and repeats the last.
const requests = [];
const routes = new Map();
function script(scenario) {
	routes.clear();
	for (const [route, fixtures] of Object.entries(scenario)) {
		routes.set(route, [...fixtures]);
	}
	requests.length = 0;
}
const server = http.createServer(async (req, res) => {
	const chunks = [];
	for await (const chunk of req) chunks.push(chunk);
	const text = Buffer.concat(chunks).toString("utf8");
	const route = `${req.method} ${req.url}`;
	requests.push({
		route,
		headers: req.headers,
		body: text === "" ? undefined : JSON.parse(text),
	});
	const queue = routes.get(route);
	const name = queue && (queue.length > 1 ? queue.shift() : queue[0]);
	if (name === undefined) {
		res.writeHead(404).end();
		return;
	}
	const fixture = JSON.parse(
		readFileSync(join(args.fixtures, `${name}.json`), "utf8"),
	);
	res.writeHead(fixture.status, fixture.headers);
	res.end(fixture.body === null ? undefined : JSON.stringify(fixture.body));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

try {
	// Resolution must land in the installed copy, never a source checkout.
	const entry = fileURLToPath(import.meta.resolve(PACKAGE));
	const installedRoot = join(dirname(entry), "..");
	assert(
		/[\\/]node_modules[\\/]/.test(entry),
		`${PACKAGE} resolved outside node_modules: ${entry}`,
	);
	const sdk = await import(PACKAGE);

	await check("installed version matches the tarball", () => {
		const installed = JSON.parse(
			readFileSync(join(installedRoot, "package.json"), "utf8"),
		);
		assert.equal(installed.name, PACKAGE);
		assert.equal(installed.version, args.version);
		assert.equal(installed.license, "Apache-2.0");
	});

	await check("exports are the documented ESM entry only", async () => {
		for (const name of [
			"Arex",
			"ArexError",
			"ArexApiError",
			"ArexNetworkError",
			"ArexTimeoutError",
			"AuthenticationError",
			"InvalidRequestError",
			"RateLimitError",
			"ResearchResource",
			"isArexApiKey",
			"validateSearch",
			"DEFAULT_BASE_URL",
			"WIRE_LIMITS",
		]) {
			assert(name in sdk, `missing export ${name}`);
		}
		assert.equal(typeof sdk.Arex, "function");
		assert.equal("USAGE_TIMEOUT_MS" in sdk, false);
		assert.equal("usage" in sdk.Arex.prototype, false);
		assert(sdk.isArexApiKey(API_KEY));
		// Bun serves `package.json` regardless of `exports`, so only internal
		// modules are asserted.
		for (const deep of [
			`${PACKAGE}/dist/index.js`,
			`${PACKAGE}/dist/client.js`,
		]) {
			await assert.rejects(
				() => import(deep),
				undefined,
				`${deep} must not be importable`,
			);
		}
	});

	const { Arex } = sdk;
	const arex = new Arex({ apiKey: API_KEY, baseUrl });

	await check("a missing API key is rejected without a request", () => {
		const saved = process.env.AREX_API_KEY;
		delete process.env.AREX_API_KEY;
		try {
			assert.throws(() => new Arex({ baseUrl }), TypeError);
		} finally {
			if (saved !== undefined) process.env.AREX_API_KEY = saved;
		}
	});

	await check("search", async () => {
		script({ "POST /v1/search": ["search.ok"] });
		const response = await arex.search("agent evaluation", {
			limit: 2,
			publishedAfter: "2026-08-01T00:00:00Z",
			publishedBefore: "2026-09-01T00:00:00Z",
		});
		assert.equal(response.results.length, 2);
		assert.equal(
			response.results[0].snippet,
			"A survey of evaluation methods.",
		);
		assert.equal(response.results[0].publishedAt, "2026-09-01T00:00:00.000Z");
		assert.equal("snippet" in response.results[1], false);
		assert.equal("publishedAt" in response.results[1], false);
		assert.equal("credits" in response, false);
		const [request] = requests;
		assert.equal(request.headers.authorization, `Bearer ${API_KEY}`);
		assert.deepEqual(request.body, {
			query: "agent evaluation",
			limit: 2,
			published_after: "2026-08-01T00:00:00Z",
			published_before: "2026-09-01T00:00:00Z",
		});
	});

	await check("contents", async () => {
		script({ "POST /v1/contents": ["contents.ok"] });
		const page = await arex.contents("https://example.org/agents", {
			maxCharacters: 4000,
		});
		assert.equal(page.content, "Body text.");
		assert.equal(page.truncated, false);
		assert.equal(page.publishedAt, "2026-09-01T00:00:00.000Z");
		assert.equal("credits" in page, false);
		assert.deepEqual(requests[0].body, {
			url: "https://example.org/agents",
			max_characters: 4000,
		});
	});

	await check("research.run polls to a completed run", async () => {
		script({
			"POST /v1/research": ["research.create.fast"],
			[`GET /v1/research/${RUN_ID}`]: [
				"research.get.running",
				"research.get.completed",
			],
		});
		const run = await arex.research.run("Compare agent evaluation benchmarks", {
			mode: "fast",
			pollIntervalMs: 10,
		});
		assert.equal(run.status, "completed");
		assert.equal(run.result.answer, "Agents are evaluated by ...");
		assert.equal("credits" in run, false);
		const [create, ...polls] = requests;
		assert.equal(create.route, "POST /v1/research");
		assert.deepEqual(create.body, {
			query: "Compare agent evaluation benchmarks",
			mode: "fast",
		});
		assert.equal(polls.length, 2);
	});

	await check("API errors map onto the typed hierarchy", async () => {
		script({ "POST /v1/search": ["error.unauthorized"] });
		await assert.rejects(
			() => arex.search("agents"),
			(error) => {
				assert(error instanceof sdk.AuthenticationError);
				assert(error instanceof sdk.ArexApiError);
				assert(error instanceof sdk.ArexError);
				assert.equal(error.code, "unauthorized");
				assert.equal(error.status, 401);
				return true;
			},
		);
	});

	await check("a rate limit is retried until the call succeeds", async () => {
		script({ "POST /v1/search": ["error.rate-limit", "search.ok"] });
		const response = await arex.search("agent evaluation");
		assert.equal(response.results.length, 2);
		assert.equal(requests.length, 2);
	});

	await check("client-side validation fails before any request", async () => {
		script({ "POST /v1/search": ["search.ok"] });
		await assert.rejects(() => arex.search(""), sdk.InvalidRequestError);
		assert.equal(requests.length, 0);
	});
} finally {
	server.close();
	server.closeAllConnections?.();
}

console.log(
	JSON.stringify({
		runtime: process.versions.bun
			? `bun ${process.versions.bun}`
			: `node ${process.versions.node}`,
		package: PACKAGE,
		version: args.version,
		checks,
	}),
);
