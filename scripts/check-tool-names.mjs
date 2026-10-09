// Checks that every `umbraco_*` tool name in the client source is verb-first and matches tool-names.json.
// Run `node scripts/check-tool-names.mjs --update` after deliberately adding, removing or renaming a tool,
// then update docs/tools.md and any posts that quote the names.
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src/Umbraco.WebMCP.StaticAssets/src');
const snapshotPath = join(root, 'scripts/tool-names.json');
const verbs = ['click', 'close', 'create', 'get', 'list', 'navigate', 'open', 'run', 'save', 'search', 'set', 'submit'];

const walk = (dir) =>
	readdirSync(dir).flatMap((x) => {
		const path = join(dir, x);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});

const names = new Set();
// Tool names are quoted literals, either `name: '...'` or in the { list, run } pairs of the entity action tools.
// Names that only appear inside descriptions (as references) are inside longer strings, so don't match.
for (const file of walk(srcDir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
	for (const match of readFileSync(file, 'utf8').matchAll(/(?:\bname|\blist|\brun):\s*'(umbraco_[a-z_]+)'/g)) {
		names.add(match[1]);
	}
}
const actual = [...names].sort();

const badVerb = actual.filter((x) => !verbs.includes(x.split('_')[1]));
if (badVerb.length) {
	console.error(`Tool names must be umbraco_<verb>_<thing> (verbs: ${verbs.join(', ')}):\n  ${badVerb.join('\n  ')}`);
	process.exit(1);
}

if (process.argv.includes('--update')) {
	writeFileSync(snapshotPath, JSON.stringify(actual, null, '\t') + '\n');
	console.log(`Wrote ${actual.length} tool names to scripts/tool-names.json`);
	process.exit(0);
}

const expected = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const added = actual.filter((x) => !expected.includes(x));
const removed = expected.filter((x) => !actual.includes(x));
if (added.length || removed.length) {
	console.error(
		`Tool names changed.\n  added: ${added.join(', ') || 'none'}\n  removed: ${removed.join(', ') || 'none'}\n` +
			'If that is intended, run "node scripts/check-tool-names.mjs --update" and update docs/tools.md.',
	);
	process.exit(1);
}
console.log(`${actual.length} tool names OK`);
