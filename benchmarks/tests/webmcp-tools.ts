import { expect, type Page } from '@playwright/test';

// Calls the backoffice's tools through WebMCP (document.modelContext): Chrome's own, launched with WebMCP switched on,
// or Google's polyfill in browsers without it. getTools() returns the registered tools, and executeTool(tool, input)
// runs one and resolves with its JSON result.

export async function webMcpToolNames(page: Page): Promise<Array<string>> {
	return page.evaluate(async () =>
		(await ((document as any).modelContext?.getTools() ?? [])).map((tool: any) => tool.name),
	);
}

/**
 * Calls a tool through WebMCP, waiting until it is registered first, because workspace tools only register once their
 * workspace has loaded.
 */
export async function callTool<T = any>(page: Page, name: string, input: object = {}): Promise<T> {
	await expect.poll(() => webMcpToolNames(page), { message: `Waiting for the ${name} tool` }).toContain(name);
	return page.evaluate(
		async ({ name, input }) => {
			const modelContext = (document as any).modelContext;
			const tool = (await modelContext.getTools()).find((x: any) => x.name === name);
			try {
				return JSON.parse(await modelContext.executeTool(tool, input));
			} catch (error) {
				// Chrome 155 deprecates passing the input as a JSON string, which Chrome 154 still needs
				if (!String((error as Error)?.message).startsWith('Failed to parse input')) throw error;
				return JSON.parse(await modelContext.executeTool(tool, JSON.stringify(input)));
			}
		},
		{ name, input },
	);
}
