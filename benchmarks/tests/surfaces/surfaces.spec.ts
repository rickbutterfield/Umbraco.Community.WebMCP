import { expect, test } from '@playwright/test';

// Checks which surfaces the server served, for the settings the site was started with. Run with BENCH_SURFACES set to
// the expected entry points, for example "model-context" (the Development default) or "" for none.

const expected = (process.env.BENCH_SURFACES ?? 'model-context').split(',').filter(Boolean);

test('serves only the enabled surfaces', async ({ page }) => {
	const scripts: Array<string> = [];
	page.on('request', (request) => {
		const match = request.url().match(/\/App_Plugins\/Umbraco.Community.WebMCP\/umbraco-community-webmcp(?:-([a-z-]+))?\.js/);
		if (match) scripts.push(match[1] ?? 'tools');
	});

	await page.goto('/umbraco/section/content');
	await expect(page.getByRole('tab', { name: 'Content' })).toBeVisible({ timeout: 30_000 });
	await page.waitForTimeout(2000);

	expect(scripts.sort()).toEqual(expected.length ? ['tools', ...expected].sort() : []);
});
