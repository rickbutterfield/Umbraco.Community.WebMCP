import { esbuildPlugin } from '@web/dev-server-esbuild';
import { playwrightLauncher } from '@web/test-runner-playwright';

// Follows the Umbraco DXP product configs (for example Umbraco.Forms.StaticAssets), without their import maps, UUI
// setup and JUnit reporter, which these tests don't need yet.
/** @type {import('@web/test-runner').TestRunnerConfig} */
export default {
	rootDir: '.',
	files: ['./src/**/*.test.ts', '!**/node_modules/**'],
	nodeResolve: {
		exportConditions: ['development', 'browser', 'import'],
		preferBuiltins: false,
		browser: true,
	},
	browsers: [playwrightLauncher({ product: 'chromium' })],
	plugins: [esbuildPlugin({ ts: true, tsconfig: './tsconfig.json', target: 'auto' })],
};
