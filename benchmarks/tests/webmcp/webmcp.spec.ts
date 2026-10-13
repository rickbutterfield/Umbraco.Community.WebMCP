import { expect, type Page } from '@playwright/test';
import { ConstantHelper, test } from '@umbraco-cms/acceptance-test-helpers';
import path from 'node:path';

// Drives the tools through WebMCP (document.modelContext), not the page API. The webmcp project uses Chrome's own
// implementation (Google Chrome 149 or later, launched with WebMCP switched on); webmcp-polyfill runs the same tests in
// Playwright's bundled Chromium with Google's polyfill. getTools() returns the registered tools and
// executeTool(tool, input) runs one and resolves with its JSON result. Chrome 155 deprecates passing the input as a
// JSON string, which Chrome 154 still needs, so callWebMcp tries an object first.

const documentTypeName = 'WebMcpE2eDocumentType';
const documentName = 'WebMCP end-to-end page';

async function webMcpToolNames(page: Page): Promise<Array<string>> {
	return page.evaluate(async () => (await (document as any).modelContext.getTools()).map((tool: any) => tool.name));
}

/**
 * Calls a tool through WebMCP, waiting until it is registered, because workspace tools only appear once their
 * workspace has loaded.
 */
async function callWebMcp(page: Page, name: string, input: object = {}) {
	await expect.poll(() => webMcpToolNames(page), { message: `Waiting for ${name} on WebMCP` }).toContain(name);
	return page.evaluate(
		async ({ name, input }) => {
			const modelContext = (document as any).modelContext;
			const tool = (await modelContext.getTools()).find((x: any) => x.name === name);
			try {
				return JSON.parse(await modelContext.executeTool(tool, input));
			} catch (error) {
				// Only a Chrome that still wants a JSON string; anything else is a real failure
				if (!String((error as Error)?.message).startsWith('Failed to parse input')) throw error;
				return JSON.parse(await modelContext.executeTool(tool, JSON.stringify(input)));
			}
		},
		{ name, input },
	);
}

test.beforeEach(async ({ page, umbracoApi, umbracoUi }, testInfo) => {
	if (testInfo.project.name === 'webmcp-polyfill') {
		await page.addInitScript({ path: path.join(import.meta.dirname, 'webmcp-polyfill.js') });
	}
	await umbracoApi.document.ensureNameNotExists(documentName);
	await umbracoApi.documentType.ensureNameNotExists(documentTypeName);
	await umbracoUi.goToBackOffice();
	await umbracoUi.content.goToSection(ConstantHelper.sections.content);
});

test.afterEach(async ({ umbracoApi }) => {
	await umbracoApi.document.ensureNameNotExists(documentName);
	await umbracoApi.documentType.ensureNameNotExists(documentTypeName);
});

test('registers the tools with their annotations', async ({ page }) => {
	await expect.poll(() => webMcpToolNames(page)).toContain('umbraco_search_entities');
	const tools = await page.evaluate(async () =>
		(await (document as any).modelContext.getTools()).map((tool: any) => ({
			name: tool.name,
			// An omitted hint means false; Chrome fills it in, the polyfill leaves it out
			readOnly: tool.annotations?.readOnlyHint ?? false,
			consequential: tool.annotations?.consequentialHint ?? false,
		})),
	);
	const byName = Object.fromEntries(tools.map((tool: any) => [tool.name, tool]));

	expect(byName['umbraco_get_location'].readOnly).toBe(true);
	expect(byName['umbraco_run_entity_action'].consequential).toBe(true);
	expect(byName['umbraco_run_create_option'].consequential).toBe(false);
	expect(byName['umbraco_search_entities']).toBeTruthy();
});

test('finds the Forms tree through the extension registry', async ({ page }) => {
	const result = await callWebMcp(page, 'umbraco_get_tree_items', { treeAlias: 'Forms.Tree.Forms' });

	expect(result.root.entityType).toBe('forms-form-root');
});

test('returns a tool error to the caller instead of an UnknownError', async ({ page }) => {
	const result = await callWebMcp(page, 'umbraco_get_tree_items', {});

	expect(result.error).toContain('needs treeAlias');
});

test('creates and saves a document through WebMCP alone', async ({ page, umbracoApi }) => {
	const documentTypeId = await umbracoApi.documentType.createDefaultDocumentTypeWithAllowAsRoot(documentTypeName);

	const opened = await callWebMcp(page, 'umbraco_open_new_document', { documentTypeKey: documentTypeId });
	expect(opened.workspaceReady).toBe(true);
	expect(opened.workspaceTools).toContain('umbraco_set_document_name');
	// The workspace tools reached WebMCP too, not only the hub
	expect(await webMcpToolNames(page)).toContain('umbraco_save_document');

	await callWebMcp(page, 'umbraco_set_document_name', { name: documentName });
	const saved = await callWebMcp(page, 'umbraco_save_document');

	expect(saved.completed).toBe(true);
	await expect.poll(() => umbracoApi.document.doesNameExist(documentName)).toBeTruthy();
});
