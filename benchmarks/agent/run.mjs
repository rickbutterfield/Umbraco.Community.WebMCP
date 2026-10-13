// Runs each agent case (cases.json) with and without WebMCP and records what each run cost.
//
//   node agent/run.mjs [--runs 3] [--from 1] [--cases create-content,forms-build] [--variants playwright,webmcp,webmcp-devtools]
//
// Every variant drives a headless Google Chrome, logged in from playwright/.auth/user.json, and none may run scripts in
// the page, so the agent either clicks or calls the tools the page registers:
// - "playwright": without WebMCP. Playwright MCP, Chrome launched without WebMCP, so the agent works through the UI.
// - "webmcp": with WebMCP, through Playwright MCP. Chrome launches with WebMCP switched on, and Playwright MCP gives the
//   agent each tool the page registers as its own webmcp_* tool.
// - "webmcp-devtools": with WebMCP, through Chrome DevTools MCP. It gives the agent list_webmcp_tools and
//   execute_webmcp_tool, and lists the page's tools after each navigation, instead of a tool of its own per page tool.
// Each run is arranged, verified and cleaned up through the Management API (tests/agent/fixture.spec.ts). The result,
// with a count of the tools called, is appended to results/agent.jsonl, and the full transcript is saved in
// results/transcripts.
//
// Settings (environment or .env): URL, BENCH_MODEL (default sonnet), BENCH_MAX_USD per run (default 1).
import 'dotenv/config';
import { chromium } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
	options: {
		runs: { type: 'string', default: '3' },
		// The first run number, to carry on after an interrupted session
		from: { type: 'string', default: '1' },
		cases: { type: 'string' },
		variants: { type: 'string', default: 'playwright,webmcp,webmcp-devtools' },
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

const WEBMCP_FEATURES = '--enable-features=WebMCP,WebMCPTesting';
const WORKSPACE_TOOLS =
	'Tools that open a workspace return workspaceTools: the tools that only exist while it is open.';
const VARIANT_PROMPTS = {
	playwright: 'Work through the UI with the Playwright browser tools.',
	webmcp: `The backoffice registers WebMCP tools for agents. They are listed in each page snapshot, and you can call them as your own tools named webmcp_<tool name>; prefer them to clicking. ${WORKSPACE_TOOLS} They appear after the next snapshot.`,
	'webmcp-devtools': `The backoffice registers WebMCP tools for agents. list_webmcp_tools lists them and execute_webmcp_tool calls one; prefer them to clicking. ${WORKSPACE_TOOLS}`,
};
// Tools that run scripts in the page, which no variant may use
const PAGE_SCRIPT_TOOLS = {
	playwright: ['mcp__playwright__browser_evaluate', 'mcp__playwright__browser_run_code_unsafe'],
	devtools: ['mcp__chrome-devtools__evaluate_script'],
};

mkdirSync(resultsDir, { recursive: true });
// Run the agent outside the repo, so no project CLAUDE.md or settings shape its behaviour
const agentCwd = path.join(tmpdir(), 'umbraco-webmcp-bench');
mkdirSync(agentCwd, { recursive: true });

const npx = process.platform === 'win32' ? { command: 'cmd', args: ['/c', 'npx'] } : { command: 'npx', args: [] };
function writeMcpConfig(file, name, packageArgs) {
	writeFileSync(
		file,
		JSON.stringify({ mcpServers: { [name]: { command: npx.command, args: [...npx.args, '-y', ...packageArgs] } } }),
	);
	return file;
}
const playwrightArgs = ['@playwright/mcp@0.0.83', '--headless', '--isolated', '--ignore-https-errors', '--browser', 'chrome', '--storage-state', storageState];
const webMcpBrowserConfig = path.join(resultsDir, 'playwright-mcp-webmcp.json');
writeFileSync(webMcpBrowserConfig, JSON.stringify({ browser: { launchOptions: { args: [WEBMCP_FEATURES] } } }));
const mcpConfigs = {
	playwright: writeMcpConfig(path.join(resultsDir, 'mcp-playwright.json'), 'playwright', playwrightArgs),
	webmcp: writeMcpConfig(path.join(resultsDir, 'mcp-webmcp.json'), 'playwright', [
		...playwrightArgs,
		'--config',
		webMcpBrowserConfig,
	]),
};

/**
 * Chrome DevTools MCP can't load a saved login, so each run gets a fresh Chrome profile with the login copied in.
 */
async function devtoolsMcpConfig() {
	const profile = mkdtempSync(path.join(tmpdir(), 'umbraco-webmcp-devtools-'));
	const { cookies, origins } = JSON.parse(readFileSync(storageState, 'utf8'));
	const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, ignoreHTTPSErrors: true });
	await context.addCookies(cookies);
	const page = context.pages()[0] ?? (await context.newPage());
	for (const { origin, localStorage } of origins) {
		await page.goto(origin);
		await page.evaluate((items) => items.forEach(({ name, value }) => window.localStorage.setItem(name, value)), localStorage);
	}
	await context.close();
	const file = writeMcpConfig(path.join(resultsDir, 'mcp-webmcp-devtools.json'), 'chrome-devtools', [
		'chrome-devtools-mcp@1.10.1',
		'--headless',
		'--userDataDir',
		profile,
		'--acceptInsecureCerts',
		'--categoryExperimentalWebmcp',
		`--chromeArg=${WEBMCP_FEATURES}`,
		'--no-usage-statistics',
		'--no-performance-crux',
	]);
	return { file, cleanUp: () => rmSync(profile, { recursive: true, force: true, maxRetries: 5 }) };
}

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
 * the next run would start logged out. Tries twice, because the test site's SQLite database is sometimes locked for a
 * moment by a background job.
 */
function logIn() {
	let result;
	for (let attempt = 1; attempt <= 2; attempt++) {
		result = playwright('--project=setup');
		if (result.status === 0) return;
		console.error(`Login attempt ${attempt} failed`);
	}
	console.error(result.stdout, result.stderr);
	process.exit(1);
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
				const name = part.name
					.replace(/^mcp__(playwright|chrome-devtools)__/, '')
					.replace(/^webmcp_/, 'webmcp:');
				// For Chrome DevTools MCP, count which page tool it ran
				const pageTool = name === 'execute_webmcp_tool' ? part.input?.toolName ?? part.input?.name : undefined;
				const key = pageTool ? `webmcp:${pageTool}` : name;
				toolCalls[key] = (toolCalls[key] ?? 0) + 1;
			}
		}
	}
	return { result, toolCalls };
}

function runAgent(benchCase, variant, mcpConfig, transcriptPath) {
	const prompt = [
		`You are testing the Umbraco backoffice at ${process.env.URL}/umbraco, using the browser through the ${variant === 'webmcp-devtools' ? 'Chrome DevTools' : 'Playwright'} tools. The browser is already logged in as an administrator.`,
		VARIANT_PROMPTS[variant],
		`Task: ${benchCase.task}`,
		"Do only this task and don't change anything else. When you have finished, reply with DONE, or with FAILED and the reason.",
	].join('\n\n');
	const server = variant === 'webmcp-devtools' ? 'chrome-devtools' : 'playwright';
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
		mcpConfig,
		'--strict-mcp-config',
		'--setting-sources',
		'local',
		'--no-session-persistence',
		'--tools',
		'',
		'--allowedTools',
		`mcp__${server}`,
		'--disallowedTools',
		...PAGE_SCRIPT_TOOLS[server === 'playwright' ? 'playwright' : 'devtools'],
	];

	const started = Date.now();
	const result = spawnSync('claude', claudeArgs, {
		cwd: agentCwd,
		env: process.env,
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
for (let run = Number(args.from); run <= Number(args.runs); run++) {
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
			const devtools = variant === 'webmcp-devtools' ? await devtoolsMcpConfig() : undefined;
			const transcript = path.join(transcriptsDir, `${benchCase.id}-${variant}-${run}-${Date.now()}.jsonl`);
			const agent = runAgent(benchCase, variant, devtools?.file ?? mcpConfigs[variant], transcript);
			devtools?.cleanUp();
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
