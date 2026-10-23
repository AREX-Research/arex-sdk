/**
 * Search and contents in one pass.
 *
 * AREX_API_KEY=sk_arex_... npx tsx examples/basic.ts
 */
import { Arex } from "@arex-research/ts-sdk";

const arex = new Arex();

const search = await arex.search("how are AI agents evaluated", { limit: 5 });
console.log(`${search.results.length} results`);
for (const result of search.results) {
	console.log(`- ${result.title} ${result.url}`);
}

const top = search.results[0];
if (top !== undefined) {
	const page = await arex.contents(top.url, { maxCharacters: 4000 });
	console.log(
		`\n${page.title ?? page.url}${page.truncated ? " (truncated)" : ""}`,
	);
	console.log(page.content.slice(0, 500));
}
