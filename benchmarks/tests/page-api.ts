import { expect, type Page } from '@playwright/test';

/**
 * Calls a tool through the page API (`window.__umbWebMcp`). Waits until the tool is registered first, because the
 * page API loads with the backoffice and workspace tools only register once their workspace has opened.
 */
export async function callTool<T = any>(page: Page, name: string, input: object = {}): Promise<T> {
	await expect
		.poll(
			() =>
				page.evaluate(
					(toolName) => (window as any).__umbWebMcp?.list().some((tool: { name: string }) => tool.name === toolName) ?? false,
					name,
				),
			{ message: `Waiting for the ${name} tool` },
		)
		.toBe(true);
	return page.evaluate(({ toolName, toolInput }) => (window as any).__umbWebMcp.call(toolName, toolInput), {
		toolName: name,
		toolInput: input,
	});
}
