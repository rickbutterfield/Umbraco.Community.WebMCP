// Runs each agent case (cases.json) with and without the page API and records what each run cost.
//
//   node agent/run.mjs [--runs 5] [--cases create-content,publish-content] [--variants page-api,playwright]
//
// Both variants drive the same headless browser through Playwright MCP, logged in from playwright/.auth/user.json.
// "playwright" can't run scripts in the page (browser_evaluate and browser_run_code_unsafe are disallowed), so it
// has to work through the UI; "page-api" is told about window.__umbWebMcp. Each run is arranged, verified and cleaned
// up through the Management API (tests/agent/fixture.spec.ts), and the result is appended to results/agent.jsonl.
//
// Settings (environment or .env): URL, BENCH_MODEL (default sonnet), BENCH_MAX_USD per run (default 1).
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
	options: {
		runs: { type: 'string', default: '5' },
		cases: { type: 'string' },
		variants: { type: 'string', default: 'page-api,playwright' },
	},
});

const root = path.resolve(import.meta.dirname, '..');
const resultsDir = path.join(root, 'results');
const storageState = path.join(root, 'playwright', '.auth', 'user.json');
const model = process.env.BENCH_MODEL ?? 'sonnet';
const maxUsd = process.env.BENCH_MAX_USD ?? '1';
const allCases = JSON.parse(readFileSync(path.join(import.meta.dirname, 'cases.json'), 'utf8'));
const cases = args.cases ? allCases.filter((c) => args.cases.split(',').includes(c.id)) : allCases;
const variants = args.variants.split(',');

const VARIANT_PROMPTS = {
	'page-api':
		'The backoffice exposes named tools for agents. In the page, window.__umbWebMcp.list() lists them, with their descriptions and input schemas, and await window.__umbWebMcp.call(name, input) calls one. Call them with browser_evaluate, and prefer them to clicking. Some tools only appear once a workspace is open, so list them again after opening one.',
	playwright: 'Work through the UI with the Playwright browser tools.',
};
const PAGE_SCRIPT_TOOLS = ['mcp__playwright__browser_evaluate', 'mcp__playwright__browser_run_code_unsafe'];

mkdirSync(resultsDir, { recursive: true });
// Run the agent outside the repo, so no project CLAUDE.md or settings shape its behaviour
const agentCwd = path.join(tmpdir(), 'umbraco-webmcp-bench');
mkdirSync(agentCwd, { recursive: true });

const mcpConfig = path.join(resultsDir, 'mcp.json');
const npx = process.platform === 'win32' ? { command: 'cmd', args: ['/c', 'npx'] } : { command: 'npx', args: [] };
writeFileSync(
	mcpConfig,
	JSON.stringify({
		mcpServers: {
			playwright: {
				command: npx.command,
				args: [
					...npx.args,
					'-y',
					'@playwright/mcp@0.0.83',
					'--headless',
					'--isolated',
					'--ignore-https-errors',
					'--storage-state',
					storageState,
				],
			},
		},
	}),
);

function playwright(...playwrightArgs) {
	const cli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
	return spawnSync(process.execPath, [cli, 'test', ...playwrightArgs, '--reporter=line'], {
		cwd: root,
		encoding: 'utf8',
		env: process.env,
	});
}

/**
 * Logs in again. The backoffice rotates its refresh token, so once an agent's browser has used the saved login,
 * the next run would start logged out.
 */
function logIn() {
	const result = playwright('--project=setup');
	if (result.status !== 0) {
		console.error(result.stdout, result.stderr);
		process.exit(1);
	}
}

function fixture(caseId, step) {
	process.env.BENCH_CASE = caseId;
	const result = playwright('--project=agent-fixture', '--grep', step);
	return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() };
}

function runAgent(benchCase, variant) {
	const prompt = [
		`You are testing the Umbraco backoffice at ${process.env.URL}/umbraco, using the browser through the Playwright tools. The browser is already logged in as an administrator.`,
		VARIANT_PROMPTS[variant],
		`Task: ${benchCase.task}`,
		"Do only this task and don't change anything else. When you have finished, reply with DONE, or with FAILED and the reason.",
	].join('\n\n');
	const claudeArgs = [
		'-p',
		'--output-format',
		'json',
		'--model',
		model,
		'--max-budget-usd',
		maxUsd,
		'--mcp-config',
		mcpConfig,
		'--strict-mcp-config',
		'--setting-sources',
		'local',
		'--no-session-persistence',
		'--tools',
		'',
		'--allowedTools',
		'mcp__playwright',
	];
	if (variant === 'playwright') claudeArgs.push('--disallowedTools', ...PAGE_SCRIPT_TOOLS);

	const started = Date.now();
	const result = spawnSync('claude', claudeArgs, {
		cwd: agentCwd,
		input: prompt,
		encoding: 'utf8',
		timeout: 10 * 60_000,
		maxBuffer: 64 * 1024 * 1024,
	});
	const wallMs = Date.now() - started;
	try {
		return { wallMs, ...JSON.parse(result.stdout) };
	} catch {
		return { wallMs, is_error: true, result: `${result.error ?? ''}${result.stdout}${result.stderr}`.slice(-2000) };
	}
}


const outFile = path.join(resultsDir, 'agent.jsonl');
for (let run = 1; run <= Number(args.runs); run++) {
	for (const benchCase of cases) {
		// Alternate which variant goes first, so drift over a session doesn't favour one
		const ordered = run % 2 ? variants : [...variants].reverse();
		for (const variant of ordered) {
			const arranged = fixture(benchCase.id, 'arrange');
			if (!arranged.ok) {
				console.error(`Arrange failed for ${benchCase.id}:\n${arranged.output}`);
				process.exit(1);
			}
			logIn();
			const agent = runAgent(benchCase, variant);
			const verified = fixture(benchCase.id, 'verify');
			fixture(benchCase.id, 'clean-up');

			const record = {
				at: new Date().toISOString(),
				model,
				case: benchCase.id,
				variant,
				run,
				passed: verified.ok,
				agentReply: String(agent.result ?? '').slice(0, 500),
				isError: Boolean(agent.is_error),
				turns: agent.num_turns ?? null,
				wallMs: agent.wallMs,
				durationMs: agent.duration_ms ?? null,
				costUsd: agent.total_cost_usd ?? null,
				inputTokens: agent.usage?.input_tokens ?? null,
				cacheReadTokens: agent.usage?.cache_read_input_tokens ?? null,
				cacheCreationTokens: agent.usage?.cache_creation_input_tokens ?? null,
				outputTokens: agent.usage?.output_tokens ?? null,
				verifyOutput: verified.ok ? undefined : verified.output.slice(-1000),
			};
			appendFileSync(outFile, `${JSON.stringify(record)}\n`);
			console.log(
				`${benchCase.id} ${variant} run ${run}: ${record.passed ? 'passed' : 'FAILED'}, ${record.turns} turns, ${Math.round(record.wallMs / 1000)} s, $${record.costUsd ?? '?'}`,
			);
		}
	}
}
