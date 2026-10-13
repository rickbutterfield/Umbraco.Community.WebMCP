import { expect, type Page } from '@playwright/test';
import { ConstantHelper, test, type UiHelpers } from '@umbraco-cms/acceptance-test-helpers';
import { callTool } from '../webmcp-tools';

// Adapted from Umbraco-CMS tests/Umbraco.Tests.AcceptanceTest/tests/DefaultConfig/Content/Content.spec.ts (MIT).
// Each test runs three ways, and only the Act step differs:
// - ui: the original clicks
// - hybrid: WebMCP tools navigate; the step under test (typing, Save) still goes through the UI
// - tools: everything through WebMCP tools. An upper bound on speed, but it no longer tests the UI
// The audit trail checks are left out: they test the UI after the step and would be the same in every variant.

const contentName = 'TestContent';
const documentTypeName = 'TestDocumentTypeForContent';
const dataTypeName = 'Textstring';
const contentText = 'This is test content text';

interface Steps {
	openNewDocument(documentTypeName: string, documentTypeId: string): Promise<void>;
	openDocument(name: string, id: string): Promise<void>;
	setName(name: string): Promise<void>;
	setText(text: string): Promise<void>;
	save(isNew: boolean): Promise<void>;
	saveAndPublish(): Promise<void>;
}

async function goToContent(ui: UiHelpers) {
	await ui.goToBackOffice();
	await ui.content.goToSection(ConstantHelper.sections.content);
}

const uiSteps = (ui: UiHelpers, _page: Page): Steps => ({
	async openNewDocument(documentTypeName) {
		await goToContent(ui);
		await ui.content.clickActionsMenuAtRoot();
		await ui.content.clickCreateActionMenuOption();
		await ui.content.chooseDocumentType(documentTypeName);
	},
	async openDocument(name) {
		await goToContent(ui);
		await ui.content.goToContentWithName(name);
	},
	setName: (name) => ui.content.enterContentName(name),
	setText: (text) => ui.content.enterTextstring(text),
	async save(isNew) {
		if (isNew) await ui.content.clickSaveButtonAndWaitForContentToBeCreated();
		else await ui.content.clickSaveButtonAndWaitForContentToBeUpdated();
	},
	async saveAndPublish() {
		await ui.content.clickSaveAndPublishButtonAndWaitForContentToBeCreated();
	},
});

const hybridSteps = (ui: UiHelpers, page: Page): Steps => ({
	...uiSteps(ui, page),
	async openNewDocument(_documentTypeName, documentTypeId) {
		await goToContent(ui);
		await callTool(page, 'umbraco_open_new_document', { documentTypeKey: documentTypeId });
	},
	async openDocument(_name, id) {
		await goToContent(ui);
		await callTool(page, 'umbraco_open_document', { documentKey: id });
	},
});

const toolSteps = (ui: UiHelpers, page: Page): Steps => ({
	...hybridSteps(ui, page),
	async setName(name) {
		await callTool(page, 'umbraco_set_document_name', { name });
	},
	async setText(text) {
		const state = await callTool(page, 'umbraco_get_document_state');
		await callTool(page, 'umbraco_set_document_property_value', { alias: state.properties[0].alias, value: text });
	},
	async save() {
		await callTool(page, 'umbraco_save_document');
	},
	async saveAndPublish() {
		await callTool(page, 'umbraco_save_and_publish_document');
	},
});

const variants = { ui: uiSteps, hybrid: hybridSteps, tools: toolSteps };

/**
 * Times the Act step on its own, so Arrange and clean-up through the API don't dilute the comparison.
 */
async function act(work: () => Promise<void>) {
	const start = performance.now();
	await work();
	test.info().annotations.push({ type: 'act-ms', description: String(Math.round(performance.now() - start)) });
}

test.beforeEach(async ({ umbracoApi }) => {
	await umbracoApi.document.ensureNameNotExists(contentName);
	await umbracoApi.documentType.ensureNameNotExists(documentTypeName);
});

test.afterEach(async ({ umbracoApi }) => {
	await umbracoApi.document.ensureNameNotExists(contentName);
	await umbracoApi.documentType.ensureNameNotExists(documentTypeName);
});

for (const [variant, createSteps] of Object.entries(variants)) {
	test.describe(variant, () => {
		test('can create empty content', async ({ umbracoApi, umbracoUi, page }) => {
			const steps = createSteps(umbracoUi, page);
			const documentTypeId = await umbracoApi.documentType.createDefaultDocumentTypeWithAllowAsRoot(documentTypeName);

			await act(async () => {
				await steps.openNewDocument(documentTypeName, documentTypeId);
				await steps.setName(contentName);
				await steps.save(true);
			});

			await expect.poll(() => umbracoApi.document.doesNameExist(contentName)).toBeTruthy();
			const contentData = await umbracoApi.document.getByName(contentName);
			expect(contentData.variants[0].state).toBe('Draft');
		});

		test('can save and publish empty content', async ({ umbracoApi, umbracoUi, page }) => {
			const steps = createSteps(umbracoUi, page);
			const documentTypeId = await umbracoApi.documentType.createDefaultDocumentTypeWithAllowAsRoot(documentTypeName);

			await act(async () => {
				await steps.openNewDocument(documentTypeName, documentTypeId);
				await steps.setName(contentName);
				await steps.saveAndPublish();
			});

			await expect
				.poll(async () => (await umbracoApi.document.getByName(contentName))?.variants[0].state)
				.toBe('Published');
		});

		test('can create content', async ({ umbracoApi, umbracoUi, page }) => {
			const steps = createSteps(umbracoUi, page);
			const dataTypeData = await umbracoApi.dataType.getByName(dataTypeName);
			const documentTypeId = await umbracoApi.documentType.createDocumentTypeWithPropertyEditor(
				documentTypeName,
				dataTypeName,
				dataTypeData.id,
			);

			await act(async () => {
				await steps.openNewDocument(documentTypeName, documentTypeId);
				await steps.setName(contentName);
				await steps.setText(contentText);
				await steps.save(true);
			});

			await expect.poll(() => umbracoApi.document.doesNameExist(contentName)).toBeTruthy();
			const contentData = await umbracoApi.document.getByName(contentName);
			expect(contentData.values[0].value).toBe(contentText);
		});

		test('can rename content', async ({ umbracoApi, umbracoUi, page }) => {
			const steps = createSteps(umbracoUi, page);
			const wrongContentName = 'Wrong Content Name';
			await umbracoApi.document.ensureNameNotExists(wrongContentName);
			const documentTypeId = await umbracoApi.documentType.createDefaultDocumentTypeWithAllowAsRoot(documentTypeName);
			const contentId = await umbracoApi.document.createDefaultDocument(wrongContentName, documentTypeId);

			await act(async () => {
				await steps.openDocument(wrongContentName, contentId);
				await steps.setName(contentName);
				await steps.save(false);
			});

			await expect.poll(async () => (await umbracoApi.document.get(contentId)).variants[0].name).toEqual(contentName);
		});

		test('can update content', async ({ umbracoApi, umbracoUi, page }) => {
			const steps = createSteps(umbracoUi, page);
			const wrongContentText = 'This is wrong test content text';
			const dataTypeData = await umbracoApi.dataType.getByName(dataTypeName);
			const documentTypeId = await umbracoApi.documentType.createDocumentTypeWithPropertyEditor(
				documentTypeName,
				dataTypeName,
				dataTypeData.id,
			);
			const contentId = await umbracoApi.document.createDocumentWithTextContent(
				contentName,
				documentTypeId,
				wrongContentText,
				dataTypeName,
			);

			await act(async () => {
				await steps.openDocument(contentName, contentId);
				await steps.setText(contentText);
				await steps.save(false);
			});

			await expect.poll(async () => (await umbracoApi.document.get(contentId)).values[0].value).toBe(contentText);
		});
	});
}
