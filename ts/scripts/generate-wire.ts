import { readFile, writeFile } from "node:fs/promises";
import openapiTS, { astToString } from "openapi-typescript";

const source = JSON.parse(
	await readFile(
		new URL("../../openapi/arex-v1.json", import.meta.url),
		"utf8",
	),
);
const methods: Record<string, true> = {
	get: true,
	put: true,
	post: true,
	delete: true,
	options: true,
	head: true,
	patch: true,
	trace: true,
};
for (const [path, item] of Object.entries(source.paths)) {
	const operations = item as Record<string, { "x-arex-visibility"?: string }>;
	for (const method of Object.keys(operations)) {
		if (
			methods[method] &&
			operations[method]?.["x-arex-visibility"] !== "public"
		) {
			delete operations[method];
		}
	}
	if (!Object.keys(operations).some((method) => methods[method])) {
		delete source.paths[path];
	}
}

// Follow references from public paths before pruning unreferenced schemas.
const referenced = new Set<string>();
function visit(value: unknown): void {
	if (!value || typeof value !== "object") return;
	for (const [key, child] of Object.entries(value)) {
		if (
			key === "$ref" &&
			typeof child === "string" &&
			child.startsWith("#/components/")
		) {
			if (referenced.has(child)) continue;
			referenced.add(child);
			const target = child
				.slice(2)
				.split("/")
				.reduce((node, part) => node[part], source);
			visit(target);
		} else {
			visit(child);
		}
	}
}
visit(source.paths);
for (const name of Object.keys(source.components.schemas)) {
	if (!referenced.has(`#/components/schemas/${name}`))
		delete source.components.schemas[name];
}
const publicErrorCodes = new Set<string>();
for (const item of Object.values(source.paths)) {
	const operations = item as Record<
		string,
		{ responses?: Record<string, { "x-arex-error-codes"?: string[] }> }
	>;
	for (const operation of Object.values(operations)) {
		for (const response of Object.values(operation?.responses ?? {})) {
			for (const code of response["x-arex-error-codes"] ?? []) {
				publicErrorCodes.add(code);
			}
		}
	}
}
const errorCodeProperty =
	source.components.schemas.Error.properties.error.properties.code;
errorCodeProperty.enum = errorCodeProperty.enum.filter((code: string) =>
	publicErrorCodes.has(code),
);

const schemas = source.components.schemas;
const constraints = (property: Record<string, unknown>) =>
	Object.fromEntries(
		[
			"minLength",
			"maxLength",
			"minimum",
			"maximum",
			"enum",
			"maxItems",
			"default",
			"pattern",
		]
			.filter((key) => property[key] !== undefined)
			.map((key) => [key, property[key]]),
	);
const search = schemas.SearchRequest.properties;
const contents = schemas.ContentsRequest.properties;
const research = schemas.ResearchCreateRequest.properties;
const limits = {
	search: {
		query: constraints(search.query),
		limit: constraints(search.limit),
	},
	contents: {
		url: { maxLength: contents.url.maxLength },
		tier: constraints(contents.tier),
		maxCharacters: constraints(contents.max_characters),
		livecrawlTimeoutMs: constraints(contents.livecrawl_timeout_ms),
		imageUrls: constraints(schemas.ContentsResponse.properties.image_urls),
	},
	research: {
		query: constraints(research.query),
		mode: constraints(research.mode),
		runMode: constraints(schemas.ResearchRun.properties.mode),
	},
	errorCodes: schemas.Error.properties.error.properties.code.enum,
	researchFailureCodes:
		schemas.ResearchRun.properties.error.properties.code.enum,
};
const types = astToString(
	await openapiTS(source, { defaultNonNullable: false }),
);
const output = `// Generated from openapi/arex-v1.json by scripts/generate-wire.ts; do not edit.\n${types}\nexport const WIRE_LIMITS = ${JSON.stringify(limits, null, "\t")} as const;\n`;
const target = new URL("../src/wire.ts", import.meta.url);

// `--check` fails when src/wire.ts is stale instead of rewriting it.
if (process.argv.includes("--check")) {
	if ((await readFile(target, "utf8")) !== output) {
		console.error("src/wire.ts is stale; run `npm run generate:wire`.");
		process.exit(1);
	}
} else {
	await writeFile(target, output);
}
