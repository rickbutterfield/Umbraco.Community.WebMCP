import { expect } from '@playwright/test';
import { ConstantHelper, test } from '@umbraco-cms/acceptance-test-helpers';
import path from 'node:path';
import { callTool as callWebMcp, webMcpToolNames } from '../webmcp-tools';

// Checks the tools through WebMCP (document.modelContext). The webmcp project uses Chrome's own implementation
// (Google Chrome 149 or later, launched with WebMCP switched on); webmcp-polyfill runs the same tests in Playwright's
// bundled Chromium with Google's polyfill.

const documentTypeName = 'WebMcpE2eDocumentType';
const documentName = 'WebMCP end-to-end page';

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

test('creates a document in two cultures and publishes one', async ({ page, umbracoApi }) => {
	const variantTypeName = 'WebMcpE2eVariantDocumentType';
	const englishName = 'WebMCP variant page';
	await umbracoApi.language.ensureIsoCodeNotExists('da');
	try {
		await umbracoApi.language.createDanishLanguage();
		await umbracoApi.documentType.createDocumentTypeWithAllowVaryByCulture(variantTypeName);
		// The backoffice reads the languages when it loads
		await page.reload();
		await expect.poll(() => webMcpToolNames(page)).toContain('umbraco_create_document');

		const created = await callWebMcp(page, 'umbraco_create_document', {
			documentType: variantTypeName,
			names: { 'en-US': englishName, da: 'WebMCP variant side' },
		});
		expect(created.completed).toBe(true);
		const options = Object.fromEntries(created.state.variantOptions.map((x: any) => [x.culture, x.state]));
		expect(options).toEqual({ 'en-US': 'Draft', da: 'Draft' });

		const refused = await callWebMcp(page, 'umbraco_save_and_publish_document', { cultures: ['fr'] });
		expect(refused.error).toContain('is not a culture of this document');

		const published = await callWebMcp(page, 'umbraco_save_and_publish_document', { cultures: ['en-US'] });
		expect(published.completed).toBe(true);
		const states = Object.fromEntries(published.state.variants.map((x: any) => [x.culture, x.state]));
		expect(states).toEqual({ 'en-US': 'Published', da: 'Draft' });
	} finally {
		await umbracoApi.document.ensureNameNotExists(englishName);
		await umbracoApi.documentType.ensureNameNotExists(variantTypeName);
		await umbracoApi.language.ensureIsoCodeNotExists('da');
	}
});
