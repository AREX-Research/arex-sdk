// Verifies the npm tarball that would be released, as a consumer sees it:
// contents and metadata of the tarball itself, a clean install of exactly those
// bytes, consumer type-checking (Node runs only; needs this package's
// devDependencies) and a public-API smoke run (smoke-package.mjs) under the
// chosen runtime. `npm pack` runs the `prepack` build, so with no tarball
// argument a clean checkout is enough.
//
//   node scripts/check-package.mjs [TARBALL] [--runtime node|bun]
//        [--expected-version X.Y.Z] [--report FILE]
//
// --report writes JSON with the inputs (tarball path and sha256, runtime), the
// command to rerun the check, and every step's result, even when a step fails.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const fixturesDir = resolve(packageRoot, "..", "fixtures");
const PACKAGE = "@arex-research/ts-sdk";

const { values: options, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		runtime: { type: "string", default: "node" },
		"expected-version": { type: "string" },
		report: { type: "string" },
	},
});
if (positionals.length > 1 || !["node", "bun"].includes(options.runtime)) {
	console.error(
		"usage: check-package.mjs [TARBALL] [--runtime node|bun] [--expected-version X.Y.Z] [--report FILE]",
	);
	process.exit(2);
}
const runtime = options.runtime;
const workDir = mkdtempSync(join(tmpdir(), "arex-ts-package-"));

const results = [];
const report = {
	inputs: { runtime, packageRoot, fixtures: fixturesDir },
	rerun: {
		cwd: process.cwd(),
		argv: [
			process.execPath,
			fileURLToPath(import.meta.url),
			...process.argv.slice(2),
		],
	},
	results,
};

function run(command, args, { cwd, env } = {}) {
	const result = spawnSync(command, args, {
		cwd,
		env: env ?? process.env,
		encoding: "utf8",
	});
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} exited ${result.status}\n${result.stdout}${result.stderr}`,
		);
	}
	return result.stdout;
}

function step(name, body) {
	try {
		const detail = body();
		results.push({ name, ok: true, ...(detail ? { detail } : {}) });
		console.log(`ok   ${name}`);
	} catch (error) {
		results.push({ name, ok: false, detail: String(error.message ?? error) });
		console.error(`FAIL ${name}\n${error.message ?? error}`);
		throw error;
	}
}

function ensure(condition, message) {
	if (!condition) throw new Error(message);
}

function sha256(file) {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

// Compiled with the consumer's own tsconfig. The @ts-expect-error lines fail
// the build if the declarations degrade to `any` or leak deep imports.
const CONSUMER_TYPES = `import {
	Arex,
	ArexApiError,
	type ArexOptions,
	type ContentsDocument,
	type ContentsOptions,
	isArexApiKey,
	type ResearchRun,
	type SearchResponse,
	WIRE_LIMITS,
} from "@arex-research/ts-sdk";
// @ts-expect-error only the package root is exported
import type {} from "@arex-research/ts-sdk/dist/index.js";

const options: ArexOptions = { apiKey: "key", maxRetries: 1 };
const arex = new Arex(options);
export const search: Promise<SearchResponse> = arex.search("query", {
	limit: 1,
	publishedAfter: "2026-08-01T00:00:00Z",
	publishedBefore: "2026-09-01T00:00:00Z",
});
const contentsOptions: ContentsOptions = { tier: "flex", maxCharacters: 4000 };
export const contents: Promise<ContentsDocument> = arex.contents(
	"https://example.org", contentsOptions,
);
// @ts-expect-error usage reports are not part of the public client
arex.usage();
search.then((response) => {
	// @ts-expect-error search results do not expose accounting
	response.credits;
});
contents.then((document) => {
	// @ts-expect-error documents do not expose accounting
	document.credits;
});
// @ts-expect-error query must be a string
arex.search(1);
// @ts-expect-error unknown research mode
arex.research.create("query", { mode: "turbo" });

export function answer(run: ResearchRun): string {
	// @ts-expect-error research runs do not expose accounting
	run.credits;
	return run.status === "completed" ? run.result.answer : run.status;
}
export const isKey: boolean = isArexApiKey("sk");
export const limit: number = WIRE_LIMITS.search.limit.maximum;
export const failure = (error: unknown): boolean => error instanceof ArexApiError;
`;

let failed = false;
try {
	let tarball;
	if (positionals[0] !== undefined) {
		tarball = resolve(positionals[0]);
	} else {
		step("npm pack builds and packs a clean checkout", () => {
			const dest = join(workDir, "pack");
			mkdirSync(dest);
			run("npm", ["pack", "--pack-destination", dest], { cwd: packageRoot });
			const packed = readdirSync(dest).filter((file) => file.endsWith(".tgz"));
			ensure(packed.length === 1, `expected one tarball, found ${packed}`);
			tarball = join(dest, packed[0]);
			return packed[0];
		});
	}
	report.inputs.tarball = tarball;
	report.inputs.sha256 = sha256(tarball);
	report.inputs.bytes = readFileSync(tarball).length;
	console.log(`checking ${tarball} (sha256 ${report.inputs.sha256})`);

	const unpacked = join(workDir, "unpacked");
	let manifest;
	step("tarball contents and metadata", () => {
		const listing = run("tar", ["-tzf", tarball])
			.split("\n")
			.filter(Boolean)
			.filter((entry) => !entry.endsWith("/"));
		const allowed = [
			"package/package.json",
			"package/README.md",
			"package/LICENSE",
		];
		for (const entry of listing) {
			// Sources are not shipped, so maps would point consumers at missing files.
			ensure(
				(allowed.includes(entry) || entry.startsWith("package/dist/")) &&
					!entry.endsWith(".map"),
				`unexpected file in tarball: ${entry}`,
			);
		}
		for (const required of [
			...allowed,
			"package/dist/index.js",
			"package/dist/index.d.ts",
		]) {
			ensure(listing.includes(required), `tarball is missing ${required}`);
		}
		mkdirSync(unpacked);
		run("tar", ["-xzf", tarball, "-C", unpacked]);
		const root = join(unpacked, "package");
		manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		ensure(manifest.name === PACKAGE, `name is ${manifest.name}`);
		ensure(manifest.license === "Apache-2.0", `license is ${manifest.license}`);
		ensure(manifest.type === "module", "package is not ESM");
		ensure(!manifest.dependencies, "tarball must have no runtime dependencies");
		const entry = manifest.exports?.["."];
		ensure(
			entry?.types === "./dist/index.d.ts" &&
				entry?.default === "./dist/index.js" &&
				Object.keys(manifest.exports).length === 1,
			`exports must expose only "." with types and default: ${JSON.stringify(manifest.exports)}`,
		);
		if (options["expected-version"]) {
			ensure(
				manifest.version === options["expected-version"],
				`version ${manifest.version} is not ${options["expected-version"]}`,
			);
		}
		const license = readFileSync(join(root, "LICENSE"), "utf8");
		ensure(
			/Apache License\s+Version 2\.0, January 2004/.test(license),
			"LICENSE is not the Apache License 2.0",
		);
		return `${manifest.name}@${manifest.version}, ${listing.length} files`;
	});

	const consumer = join(workDir, "consumer");
	step(`clean install under ${runtime}`, () => {
		mkdirSync(consumer);
		writeFileSync(
			join(consumer, "package.json"),
			JSON.stringify({ name: "consumer", private: true, type: "module" }),
		);
		if (runtime === "bun") {
			run("bun", ["add", "--ignore-scripts", tarball], { cwd: consumer });
		} else {
			run(
				"npm",
				["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
				{ cwd: consumer },
			);
		}
		const installed = readdirSync(join(consumer, "node_modules")).filter(
			(name) => !name.startsWith("."),
		);
		ensure(
			installed.length === 1 && installed[0] === "@arex-research",
			`install pulled in unexpected packages: ${installed}`,
		);
		return `installed ${PACKAGE}@${manifest.version}`;
	});

	if (runtime === "node") {
		step("consumer type-check (strict, NodeNext, no skipLibCheck)", () => {
			const tsc = join(packageRoot, "node_modules", ".bin", "tsc");
			ensure(existsSync(tsc), "typescript is not installed: run npm ci first");
			writeFileSync(
				join(consumer, "tsconfig.json"),
				JSON.stringify({
					compilerOptions: {
						target: "ES2022",
						module: "NodeNext",
						moduleResolution: "NodeNext",
						lib: ["ES2022", "DOM"],
						types: [],
						strict: true,
						skipLibCheck: false,
						noEmit: true,
					},
					include: ["consumer.ts"],
				}),
			);
			writeFileSync(join(consumer, "consumer.ts"), CONSUMER_TYPES);
			run(tsc, ["-p", "tsconfig.json"], { cwd: consumer });
		});
	}

	step(`public API smoke under ${runtime}`, () => {
		copyFileSync(join(here, "smoke-package.mjs"), join(consumer, "smoke.mjs"));
		const env = { ...process.env };
		delete env.AREX_API_KEY;
		const command = runtime === "bun" ? "bun" : process.execPath;
		const stdout = run(
			command,
			[
				"smoke.mjs",
				"--runtime",
				runtime,
				"--version",
				manifest.version,
				"--fixtures",
				fixturesDir,
			],
			{ cwd: consumer, env },
		);
		const summary = JSON.parse(stdout.trim().split("\n").at(-1));
		ensure(summary.checks.length > 0, "smoke ran no checks");
		return summary;
	});
} catch (error) {
	console.error(error);
	failed = true;
} finally {
	if (options.report) {
		mkdirSync(dirname(resolve(options.report)), { recursive: true });
		writeFileSync(
			options.report,
			`${JSON.stringify({ ...report, passed: !failed }, null, 2)}\n`,
		);
		console.log(`report: ${options.report} (${basename(options.report)})`);
	}
	rmSync(workDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
