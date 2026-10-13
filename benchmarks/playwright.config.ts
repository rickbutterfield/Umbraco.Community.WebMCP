import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';
import path from 'node:path';

export const STORAGE_STATE = path.resolve('playwright/.auth/user.json');
// The helpers save refreshed cookies here after each test
process.env.STORAGE_STATE_PATH = STORAGE_STATE;

export default defineConfig({
	testDir: './tests/',
	timeout: 60_000,
	expect: { timeout: 10_000 },
	// No retries: a flaky run is a result, not something to hide
	retries: 0,
	// The tests share one site and its content, so run them one at a time
	workers: 1,
	outputDir: './results/test-output',
	reporter: [['list'], ['json', { outputFile: process.env.BENCH_JSON ?? 'results/scripted.json' }]],
	use: {
		baseURL: process.env.URL,
		ignoreHTTPSErrors: true,
		testIdAttribute: 'data-mark',
		trace: 'retain-on-failure',
	},
	projects: [
		{ name: 'setup', testMatch: 'auth.setup.ts' },
		{
			// Every variant runs in Google Chrome with WebMCP switched on, so only the Act step differs
			name: 'scripted',
			testMatch: 'scripted/**/*.spec.ts',
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				channel: 'chrome',
				launchOptions: { args: ['--enable-features=WebMCP,WebMCPTesting'] },
				ignoreHTTPSErrors: true,
				storageState: STORAGE_STATE,
			},
		},
		{
			// Drives the tools through Chrome's real WebMCP; needs Google Chrome 149 or later installed
			name: 'webmcp',
			testMatch: 'webmcp/**/*.spec.ts',
			dependencies: ['setup'],
			use: {
				...devices['Desktop Chrome'],
				channel: 'chrome',
				launchOptions: { args: ['--enable-features=WebMCP,WebMCPTesting'] },
				ignoreHTTPSErrors: true,
				storageState: STORAGE_STATE,
			},
		},
		{
			// The same WebMCP tests in Playwright's bundled Chromium, with Google's WebMCP polyfill instead of Chrome's
			name: 'webmcp-polyfill',
			testMatch: 'webmcp/**/*.spec.ts',
			dependencies: ['setup'],
			use: { ...devices['Desktop Chrome'], ignoreHTTPSErrors: true, storageState: STORAGE_STATE },
		},
		{
			// Checks the server serves only the enabled surfaces; see tests/surfaces/surfaces.spec.ts
			name: 'surfaces',
			testMatch: 'surfaces/**/*.spec.ts',
			dependencies: ['setup'],
			use: { ...devices['Desktop Chrome'], ignoreHTTPSErrors: true, storageState: STORAGE_STATE },
		},
		{
			// Arranges, verifies and cleans up for agent/run.mjs; not a benchmark itself
			name: 'agent-fixture',
			testMatch: 'agent/**/*.spec.ts',
			use: { ...devices['Desktop Chrome'], ignoreHTTPSErrors: true, storageState: STORAGE_STATE },
		},
	],
});
