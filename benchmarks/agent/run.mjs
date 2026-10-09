// Runs each agent case (cases.json) with and without the tools and records what each run cost.
//
//   node agent/run.mjs [--runs 5] [--cases create-content,publish-content] [--variants page-api,playwright,webmcp]
//
// Every variant drives a headless browser through Playwright MCP, logged in from playwright/.auth/user.json.
// "playwright" can't run scripts in the page (browser_evaluate and browser_run_code_unsafe are disallowed), so it
// has to work through the UI; "page-api" is told about window.__umbWebMcp. "webmcp" runs Google Chrome with WebMCP
// switched on, so Playwright MCP gives the agent the tools the page registers as its own webmcp_* tools; it can't run
// scripts in the page either, so it can't reach the page API. Each run is arranged, verified and cleaned
// up through the Management API (tests/agent/fixture.spec.ts). The result, with a count of the tools called, is appended
// to results/agent.jsonl, and the full transcript is saved in results/transcripts.
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
		'The backoffice exposes named tools for agents. In the page, window.__umbWebMcp.list() lists them with a one-sentence summary each, window.__umbWebMcp.describe(name) returns the full description and input schema of one tool, and await window.__umbWebMcp.call(name, input) calls one. Call them with browser_evaluate, and prefer them to clicking. Tools that open a workspace return workspaceTools: the tools that only exist while it is open.',
	playwright: 'Work through the UI with the Playwright browser tools.',
	webmcp:
		'The backoffice registers WebMCP tools for agents. They are listed in each page snapshot, and you can call them as your own tools named webmcp_<tool name>; prefer them to clicking. Tools that open a workspace return workspaceTools: the tools that only exist while it is open, which appear after the next snapshot.',
};
// Variants that may not run scripts in the page
const NO_PAGE_SCRIPTS = ['playwright', 'webmcp'];
const PAGE_SCRIPT_TOOLS = ['mcp__playwright__browser_evaluate', 'mcp__playwright__browser_run_code_unsafe'];

mkdirSync(resultsDir, { recursive: true });
// Run the agent outside the repo, so no project CLAUDE.md or settings shape its behaviour
const agentCwd = path.join(tmpdir(), 'umbraco-webmcp-bench');
mkdirSync(agentCwd, { recursive: true });

const npx = process.platform === 'win32' ? { command: 'cmd', args: ['/c', 'npx'] } : { command: 'npx', args: [] };
function writeMcpConfig(file, extraArgs = []) {
	writeFileSync(
		file,
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
						...extraArgs,
					],
				},
			},
		}),
	);
	return file;
}
// WebMCP needs Chrome 149 or later with the feature switched on; Playwright's bundled Chromium is too old
const chromeConfig = path.join(resultsDir, 'playwright-mcp-webmcp.json');
writeFileSync(
	chromeConfig,
	JSON.stringify({ browser: { launchOptions: { args: ['--enable-features=WebMCP,WebMCPTesting'] } } }),
);
const mcpConfigs = {
	default: writeMcpConfig(path.join(resultsDir, 'mcp.json')),
	webmcp: writeMcpConfig(path.join(resultsDir, 'mcp-webmcp.json'), ['--browser', 'chrome', '--config', chromeConfig]),
};

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

/**
 * Reads Claude Code's stream-json output: the final result line, plus a count of the tools the agent called.
 */
function parseStream(stdout) {
	let result;
	const toolCalls = {};
	for (const line of stdout.split('\n')) {
		if (!line.trim()) continue;
		let event;
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.type === 'result') result = event;
		if (event.type === 'assistant') {
			for (const part of event.message?.content ?? []) {
				if (part.type !== 'tool_use') continue;
				const name = part.name.replace('mcp__playwright__', '').replace(/^webmcp_/, 'webmcp:');
				// For page scripts, count the page API call they make, so the transcript shows which tools were used
				const call = String(part.input?.function ?? part.input?.code ?? '').match(/__umbWebMcp\.(call|list|describe)\(\s*['"]?([a-z_]*)/);
				const key = call ? `${name}:${call[1]}${call[2] ? `:${call[2]}` : ''}` : name;
				toolCalls[key] = (toolCalls[key] ?? 0) + 1;
			}
		}
	}
	return { result, toolCalls };
}

function runAgent(benchCase, variant, transcriptPath) {
	const prompt = [
		`You are testing the Umbraco backoffice at ${process.env.URL}/umbraco, using the browser through the Playwright tools. The browser is already logged in as an administrator.`,
		VARIANT_PROMPTS[variant],
		`Task: ${benchCase.task}`,
		"Do only this task and don't change anything else. When you have finished, reply with DONE, or with FAILED and the reason.",
	].join('\n\n');
	const claudeArgs = [
		'-p',
		'--output-format',
		'stream-json',
		'--verbose',
		'--model',
		model,
		'--max-budget-usd',
		maxUsd,
		'--mcp-config',
		mcpConfigs[variant] ?? mcpConfigs.default,
		'--strict-mcp-config',
		'--setting-sources',
		'local',
		'--no-session-persistence',
		'--tools',
		'',
		'--allowedTools',
		'mcp__playwright',
	];
	if (NO_PAGE_SCRIPTS.includes(variant)) claudeArgs.push('--disallowedTools', ...PAGE_SCRIPT_TOOLS);

	const started = Date.now();
	const result = spawnSync('claude', claudeArgs, {
		cwd: agentCwd,
		input: prompt,
		encoding: 'utf8',
		timeout: 10 * 60_000,
		maxBuffer: 64 * 1024 * 1024,
	});
	const wallMs = Date.now() - started;
	writeFileSync(transcriptPath, result.stdout ?? '');
	const { result: final, toolCalls } = parseStream(result.stdout ?? '');
	if (!final) {
		return { wallMs, toolCalls, is_error: true, result: `${result.error ?? ''}${result.stderr}`.slice(-2000) };
	}
	return { wallMs, toolCalls, ...final };
}

const outFile = path.join(resultsDir, 'agent.jsonl');
const transcriptsDir = path.join(resultsDir, 'transcripts');
mkdirSync(transcriptsDir, { recursive: true });
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
			const transcript = path.join(transcriptsDir, `${benchCase.id}-${variant}-${run}-${Date.now()}.jsonl`);
			const agent = runAgent(benchCase, variant, transcript);
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
				toolCalls: agent.toolCalls,
				transcript: path.relative(root, transcript),
				verifyOutput: verified.ok ? undefined : verified.output.slice(-1000),
			};
			appendFileSync(outFile, `${JSON.stringify(record)}\n`);
			console.log(
				`${benchCase.id} ${variant} run ${run}: ${record.passed ? 'passed' : 'FAILED'}, ${record.turns} turns, ${Math.round(record.wallMs / 1000)} s, $${record.costUsd ?? '?'}`,
			);
		}
	}
}
