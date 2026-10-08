import { expect, type Page } from '@playwright/test';
import { ConstantHelper, test } from '@umbraco-cms/acceptance-test-helpers';

// Drives the tools through Chrome's real WebMCP implementation (document.modelContext), not the page API. Needs Google
// Chrome 149 or later; the project launches it with WebMCP switched on. As of Chrome 154, getTools() returns the
// registered tools and executeTool(tool, inputJson) runs one and resolves with its JSON result.

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
			return JSON.parse(await modelContext.executeTool(tool, JSON.stringify(input)));
		},
		{ name, input },
	);
}

test.beforeEach(async ({ umbracoApi, umbracoUi }) => {
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
			readOnly: tool.annotations.readOnlyHint,
			consequential: tool.annotations.consequentialHint,
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
