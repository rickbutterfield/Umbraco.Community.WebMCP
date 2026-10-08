import { expect, test } from '@playwright/test';

// Checks which surfaces the server served, for the settings the site was started with. Run with BENCH_SURFACES set to
// the expected entry points, for example "model-context,page-api" (the Development default) or "model-context".

const expected = (process.env.BENCH_SURFACES ?? 'model-context,page-api').split(',').filter(Boolean);

test('serves only the enabled surfaces', async ({ page }) => {
	const scripts: Array<string> = [];
	page.on('request', (request) => {
		const match = request.url().match(/\/App_Plugins\/Umbraco\.WebMCP\/umbraco-webmcp(?:-([a-z-]+))?\.js/);
		if (match) scripts.push(match[1] ?? 'tools');
	});

	await page.goto('/umbraco/section/content');
	await expect(page.getByRole('tab', { name: 'Content' })).toBeVisible({ timeout: 30_000 });
	await page.waitForTimeout(2000);

	expect(scripts.sort()).toEqual(expected.length ? ['tools', ...expected].sort() : []);
	expect(await page.evaluate(() => typeof (window as any).__umbWebMcp)).toBe(
		expected.includes('page-api') ? 'object' : 'undefined',
	);
});
