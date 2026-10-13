// Summarises results/scripted.json (Playwright) and results/agent.jsonl (agent/run.mjs) as Markdown tables, printed and
// written to results/summary.md.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const resultsDir = path.join(import.meta.dirname, 'results');

const median = (values) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const percentile = (values, p) => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const format = (value, digits = 0) => (value === null || value === undefined ? 'n/a' : value.toFixed(digits));
const groupBy = (items, key) =>
	items.reduce((groups, item) => groups.set(key(item), [...(groups.get(key(item)) ?? []), item]), new Map());

const lines = [];

function summariseScripted() {
	// One file per run or per round (scripted.json, scripted-round-1.json, ...)
	const files = readdirSync(resultsDir).filter((name) => /^scripted.*\.json$/.test(name));
	if (!files.length) return;
	const reports = files.map((name) => JSON.parse(readFileSync(path.join(resultsDir, name), 'utf8')));

	const runs = [];
	const walk = (suite, titles) => {
		for (const child of suite.suites ?? []) walk(child, [...titles, child.title]);
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests) {
				if (test.projectName !== 'scripted') continue;
				for (const result of test.results) {
					const act = result.annotations?.find((a) => a.type === 'act-ms') ??
						test.annotations?.find((a) => a.type === 'act-ms');
					runs.push({
						variant: titles[titles.length - 1],
						test: spec.title,
						passed: result.status === 'passed',
						durationMs: result.duration,
						actMs: result.status === 'passed' && act ? Number(act.description) : null,
						fallback: (result.annotations ?? []).some((a) => a.type === 'fallback'),
						error: result.status === 'passed' ? null : (result.error?.message ?? '').split('\n')[0],
					});
				}
			}
		}
	};
	for (const report of reports) for (const suite of report.suites) walk(suite, []);

	lines.push('## Scripted: the same tests, three ways', '');
	lines.push('Act time is the Act step only, for passing runs. Arrange and clean-up go through the API in every variant.', '');
	lines.push('| Test | Variant | Runs | Passed | Median Act (ms) | p90 Act (ms) | Median test (ms) | UI fallbacks |');
	lines.push('|---|---|---|---|---|---|---|---|');
	for (const [key, group] of groupBy(runs, (r) => `${r.test}|${r.variant}`)) {
		const [test, variant] = key.split('|');
		const acts = group.map((r) => r.actMs).filter((v) => v !== null);
		lines.push(
			`| ${test} | ${variant} | ${group.length} | ${group.filter((r) => r.passed).length} | ${format(median(acts))} | ${format(percentile(acts, 90))} | ${format(median(group.map((r) => r.durationMs)))} | ${group.filter((r) => r.fallback).length} |`,
		);
	}
	lines.push('', '| Variant | Runs | Pass rate | Median Act (ms) |', '|---|---|---|---|');
	for (const [variant, group] of groupBy(runs, (r) => r.variant)) {
		const passed = group.filter((r) => r.passed).length;
		const acts = group.map((r) => r.actMs).filter((v) => v !== null);
		lines.push(`| ${variant} | ${group.length} | ${format((100 * passed) / group.length)}% | ${format(median(acts))} |`);
	}
	const failures = groupBy(
		runs.filter((r) => !r.passed),
		(r) => `${r.variant} › ${r.test}: ${r.error}`,
	);
	if (failures.size) {
		lines.push('', '**Failures**', '');
		for (const [failure, group] of failures) lines.push(`- ${group.length}× ${failure}`);
	}
	lines.push('');
}

function summariseAgent() {
	const file = path.join(resultsDir, 'agent.jsonl');
	if (!existsSync(file)) return;
	const runs = readFileSync(file, 'utf8')
		.split('\n')
		.filter(Boolean)
		.map((line) => JSON.parse(line));
	const tokens = (r) =>
		(r.inputTokens ?? 0) + (r.cacheReadTokens ?? 0) + (r.cacheCreationTokens ?? 0) + (r.outputTokens ?? 0);

	lines.push('## Agent: the same tasks, with and without WebMCP', '');
	lines.push(`Models: ${[...new Set(runs.map((r) => r.model))].join(', ')}.`, '');
	lines.push('| Case | Variant | Runs | Passed | Median turns | Median time (s) | Median tokens | Mean cost (USD) |');
	lines.push('|---|---|---|---|---|---|---|---|');
	for (const [key, group] of groupBy(runs, (r) => `${r.case}|${r.variant}`)) {
		const [benchCase, variant] = key.split('|');
		lines.push(
			`| ${benchCase} | ${variant} | ${group.length} | ${group.filter((r) => r.passed).length} | ${format(median(group.map((r) => r.turns).filter((v) => v !== null)))} | ${format(median(group.map((r) => r.wallMs / 1000)))} | ${format(median(group.map(tokens)))} | ${format(mean(group.map((r) => r.costUsd).filter((v) => v !== null)), 3)} |`,
		);
	}
	lines.push('', '| Variant | Runs | Pass rate | Median turns | Median time (s) | Mean cost (USD) |', '|---|---|---|---|---|---|');
	for (const [variant, group] of groupBy(runs, (r) => r.variant)) {
		const passed = group.filter((r) => r.passed).length;
		lines.push(
			`| ${variant} | ${group.length} | ${format((100 * passed) / group.length)}% | ${format(median(group.map((r) => r.turns).filter((v) => v !== null)))} | ${format(median(group.map((r) => r.wallMs / 1000)))} | ${format(mean(group.map((r) => r.costUsd).filter((v) => v !== null)), 3)} |`,
		);
	}
	lines.push('');
}

summariseScripted();
summariseAgent();
const output = lines.join('\n');
console.log(output || 'No results yet. Run npm run scripted or npm run agent first.');
if (output) writeFileSync(path.join(resultsDir, 'summary.md'), `# Benchmark summary\n\n${output}`);
