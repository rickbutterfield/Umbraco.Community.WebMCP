import { expect, type Page } from '@playwright/test';
import { test, type UiHelpers } from '@umbraco-cms/acceptance-test-helpers';
import { BENCH_FORM, FormsApi } from '../agent/forms-api';
import { callTool } from '../page-api';

// Three Umbraco Forms tests modelled on Forms' own acceptance suite ("Creates a form with a short answer field",
// "Deletes a form" and "Creates a form with multiple pages and groups"), with our own steps, run three ways like
// content.spec.ts. Only the Act step differs:
// - ui: clicks, including Forms' hover-to-create menu and the form designer
// - hybrid: the page API navigates (create option, entity action); the designer, Save and the confirmation are clicked
// - tools: everything through the page API, with the example Forms toolset for the designer
// Written against Umbraco Forms 18.2.1.

const SHORT_ANSWER = '3f92e01b-29e2-4a30-bf33-9df5580ed52c';

interface Steps {
	openNewForm(): Promise<void>;
	setName(name: string): Promise<void>;
	/** Adds a question to the page with this index; the first group on it. */
	addShortAnswer(caption: string, pageIndex: number): Promise<void>;
	setPageAndGroupCaptions(pageIndex: number, page: string, group: string): Promise<void>;
	addPage(): Promise<void>;
	save(): Promise<void>;
	trash(name: string): Promise<void>;
}

async function goToForms(ui: UiHelpers) {
	await ui.goToBackOffice();
	await ui.content.goToSection('Forms');
}

/** Clicks Save and waits for the create request to succeed, as Forms' own suite does. */
async function clickSave(page: Page) {
	const created = page.waitForResponse(
		(response) =>
			response.url().endsWith('/umbraco/forms/management/api/v1/form') && response.request().method() === 'POST',
	);
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	expect((await created).status()).toBe(201);
}

async function clickConfirmTrash(page: Page) {
	await page.locator('#confirm').click();
	await expect(page.locator('#confirm')).toBeHidden({ timeout: 15_000 });
}

const uiSteps = (ui: UiHelpers, page: Page): Steps => ({
	async openNewForm() {
		await goToForms(ui);
		// On Forms 18.2 the Forms heading in the sidebar has a Create button that is only revealed on hover and never
		// counts as clickable, so it needs a forced click (as Forms' own suite uses); it opens a Create dialog. If that
		// doesn't open, fall back to the create workspace's URL and record it, because the fallback is part of what
		// clicking costs.
		let opened = false;
		for (let attempt = 0; attempt < 2 && !opened; attempt++) {
			try {
				await page.getByRole('heading', { name: 'Forms', level: 3 }).hover();
				await page.getByRole('button', { name: 'Create', exact: true }).first().click({ force: true, timeout: 4000 });
				await page.getByRole('link', { name: /New Form/ }).click({ timeout: 4000 });
				opened = true;
			} catch {
				await page.keyboard.press('Escape');
			}
		}
		if (!opened) {
			test.info().annotations.push({ type: 'fallback', description: 'the Create menu did not open' });
			await page.goto('/umbraco/section/forms/workspace/forms-form/create/parent/forms-form-root/null');
		}
		await page.locator('forms-form-fieldset').first().waitFor({ state: 'visible', timeout: 30_000 });
	},
	async setName(name) {
		await page.locator('#nameInput input[aria-label="Enter a name..."]').fill(name);
	},
	async addShortAnswer(caption, pageIndex) {
		await page.locator('forms-form-page').nth(pageIndex).getByLabel('Add question', { exact: true }).click();
		const editor = page.locator('forms-field-workspace-editor');
		await editor.locator('umb-input-with-alias[id="caption-alias"] input[placeholder="Enter a name..."]').fill(caption);
		await editor.getByRole('button', { name: 'Choose answer type' }).click();
		const picker = page.locator('forms-field-type-picker-modal');
		await picker.getByRole('button', { name: 'Short answer' }).first().click({ force: true });
		await expect(picker).toBeHidden();
		await expect(editor.getByRole('button', { name: 'Choose answer type' })).toBeHidden({ timeout: 15_000 });
		await editor.getByLabel('Submit').click();
		await expect(editor).toBeHidden({ timeout: 15_000 });
	},
	async setPageAndGroupCaptions(pageIndex, pageCaption, groupCaption) {
		await page.locator('input[type="text"][placeholder="Untitled page (optional)"]').nth(pageIndex).fill(pageCaption);
		await page.locator('input[type="text"][placeholder="Untitled group (optional)"]').nth(pageIndex).fill(groupCaption);
	},
	async addPage() {
		await page.getByLabel('Add new page', { exact: true }).click();
	},
	save: () => clickSave(page),
	async trash(name) {
		await goToForms(ui);
		const item = page.locator(`uui-menu-item[label="${name}"]`);
		await item.locator('#menu-item').first().hover({ force: true });
		await item.locator('#action-modal').first().click({ force: true });
		await page
			.locator('#action-modal[open] umb-entity-action-list umb-entity-action')
			.getByTestId(/^entity-action:.*Trash$/)
			.click();
		await clickConfirmTrash(page);
	},
});

async function formsRoot(page: Page) {
	return (await callTool(page, 'umbraco_get_tree_items', { treeAlias: 'Forms.Tree.Forms' })).root;
}

const hybridSteps = (ui: UiHelpers, page: Page): Steps => ({
	...uiSteps(ui, page),
	async openNewForm() {
		await goToForms(ui);
		await callTool(page, 'umbraco_run_create_option', { ...(await formsRoot(page)), action: 'New Form' });
	},
	async trash(name) {
		await goToForms(ui);
		const { matches } = await callTool(page, 'umbraco_search_entities', { query: name, entityType: 'forms-form' });
		const form = matches.find((match: { name: string; isTrashed?: boolean }) => match.name === name && !match.isTrashed);
		await callTool(page, 'umbraco_run_entity_action', { entityType: 'forms-form', unique: form.unique, action: 'Trash' });
		await clickConfirmTrash(page);
	},
});

const toolSteps = (ui: UiHelpers, page: Page): Steps => ({
	...hybridSteps(ui, page),
	async setName(name) {
		await callTool(page, 'forms_set_form_name', { name });
	},
	async addShortAnswer(caption, pageIndex) {
		const design = await callTool(page, 'forms_get_form_design');
		const containerId = design.pages[pageIndex].groups[0].containers[0].id;
		await callTool(page, 'forms_add_field', { fieldType: 'Short answer', caption, containerId });
	},
	async setPageAndGroupCaptions(pageIndex, pageCaption, groupCaption) {
		const design = await callTool(page, 'forms_get_form_design');
		const target = design.pages[pageIndex];
		await callTool(page, 'forms_set_caption', { id: target.id, caption: pageCaption });
		await callTool(page, 'forms_set_caption', { id: target.groups[0].id, caption: groupCaption });
	},
	async addPage() {
		await callTool(page, 'forms_add_page');
	},
	async save() {
		const result = await callTool(page, 'umbraco_run_workspace_action', { action: 'Forms.WorkspaceAction.Form.Save' });
		expect(result.completed).toBe(true);
	},
	async trash(name) {
		await goToForms(ui);
		const { matches } = await callTool(page, 'umbraco_search_entities', { query: name, entityType: 'forms-form' });
		const form = matches.find((match: { name: string; isTrashed?: boolean }) => match.name === name && !match.isTrashed);
		await callTool(page, 'umbraco_run_entity_action', { entityType: 'forms-form', unique: form.unique, action: 'Trash' });
		const modal = (await callTool(page, 'umbraco_list_modals')).at(-1);
		const clicked = await callTool(page, 'umbraco_click_modal_button', { key: modal.key, id: 'confirm' });
		expect(clicked.closed).toBe(true);
	},
});

const variants = { ui: uiSteps, hybrid: hybridSteps, tools: toolSteps };

async function act(work: () => Promise<void>) {
	const start = performance.now();
	await work();
	test.info().annotations.push({ type: 'act-ms', description: String(Math.round(performance.now() - start)) });
}

test.beforeEach(async ({ umbracoApi }) => {
	await new FormsApi(umbracoApi).cleanUp(BENCH_FORM);
});

test.afterEach(async ({ umbracoApi }) => {
	await new FormsApi(umbracoApi).cleanUp(BENCH_FORM);
});

for (const [variant, createSteps] of Object.entries(variants)) {
	test.describe(variant, () => {
		test('forms: creates a form with a short answer field', async ({ umbracoApi, umbracoUi, page }) => {
			const steps = createSteps(umbracoUi, page);

			await act(async () => {
				await steps.openNewForm();
				await steps.setName(BENCH_FORM);
				await steps.addShortAnswer('Test Question', 0);
				await steps.save();
			});

			const form = await new FormsApi(umbracoApi).getFormByName(BENCH_FORM);
			const field = FormsApi.fields(form).find((x) => x.caption === 'Test Question');
			expect(field?.alias).toBe('testQuestion');
			expect(field?.fieldTypeId).toBe(SHORT_ANSWER);
		});

		test('forms: deletes a form', async ({ umbracoApi, umbracoUi, page }) => {
			const steps = createSteps(umbracoUi, page);
			await new FormsApi(umbracoApi).createForm(BENCH_FORM);

			await act(() => steps.trash(BENCH_FORM));

			await expect.poll(() => new FormsApi(umbracoApi).getFormByName(BENCH_FORM)).toBeNull();
		});

		test('forms: creates a form with multiple pages and groups', async ({ umbracoApi, umbracoUi, page }) => {
			const steps = createSteps(umbracoUi, page);

			await act(async () => {
				await steps.openNewForm();
				await steps.setName(BENCH_FORM);
				await steps.setPageAndGroupCaptions(0, 'Page One', 'Group One');
				await steps.addPage();
				await steps.setPageAndGroupCaptions(1, 'Page Two', 'Group Two');
				await steps.addShortAnswer('Test Question', 1);
				await steps.save();
			});

			const form = await new FormsApi(umbracoApi).getFormByName(BENCH_FORM);
			expect(form.pages).toHaveLength(2);
			expect(form.pages[0].caption).toBe('Page One');
			expect(form.pages[0].fieldSets[0].caption).toBe('Group One');
			expect(form.pages[1].caption).toBe('Page Two');
			expect(form.pages[1].fieldSets[0].caption).toBe('Group Two');
			expect(form.pages[1].fieldSets[0].containers[0].fields[0].caption).toBe('Test Question');
		});
	});
}
