import { expect } from '@playwright/test';
import { test, type ApiHelpers } from '@umbraco-cms/acceptance-test-helpers';
import { BENCH_FOLDER, BENCH_FOLDER_ID, BENCH_FORM, FormsApi } from './forms-api';

// Arranges, verifies and cleans up one agent case (agent/cases.json) through the Management API, so the agent's
// own work is the only thing measured. agent/run.mjs picks the case with BENCH_CASE and the step with --grep.

const documentTypeName = 'BenchPage';
const dataTypeName = 'Textstring';
const pageName = 'Bench page';
const draftName = 'Bench draft name';
const text = 'Hello from the benchmark';

async function createDocumentType(api: ApiHelpers) {
	const dataType = await api.dataType.getByName(dataTypeName);
	return api.documentType.createDocumentTypeWithPropertyEditor(documentTypeName, dataTypeName, dataType.id);
}

const cases: Record<string, { arrange(api: ApiHelpers): Promise<void>; verify(api: ApiHelpers): Promise<void> }> = {
	'create-content': {
		async arrange(api) {
			await createDocumentType(api);
		},
		async verify(api) {
			const page = await api.document.getByName(pageName);
			expect(page, 'The page exists').toBeTruthy();
			expect(page.values[0]?.value).toBe(text);
			expect(page.variants[0].state).toBe('Draft');
		},
	},
	'publish-content': {
		async arrange(api) {
			const documentTypeId = await createDocumentType(api);
			await api.document.createDocumentWithTextContent(pageName, documentTypeId, text, dataTypeName);
		},
		async verify(api) {
			expect((await api.document.getByName(pageName)).variants[0].state).toBe('Published');
		},
	},
	'rename-content': {
		async arrange(api) {
			const documentTypeId = await createDocumentType(api);
			await api.document.createDocumentWithTextContent(draftName, documentTypeId, text, dataTypeName);
		},
		async verify(api) {
			expect(await api.document.doesNameExist(pageName), 'The renamed page exists').toBeTruthy();
			expect(await api.document.doesNameExist(draftName), 'The old name is gone').toBeFalsy();
		},
	},
	'forms-delete': {
		async arrange(api) {
			await new FormsApi(api).createForm(BENCH_FORM);
		},
		async verify(api) {
			expect(await new FormsApi(api).getFormByName(BENCH_FORM), 'The form is gone').toBeNull();
		},
	},
	'forms-move': {
		async arrange(api) {
			const forms = new FormsApi(api);
			await forms.createFolder(BENCH_FOLDER_ID, BENCH_FOLDER);
			await forms.createForm(BENCH_FORM);
		},
		async verify(api) {
			const form = await new FormsApi(api).getFormByName(BENCH_FORM);
			expect(form?.parentUnique, 'The form is in the folder').toBe(BENCH_FOLDER_ID);
		},
	},
	'forms-build': {
		async arrange() {},
		async verify(api) {
			const form = await new FormsApi(api).getFormByName(BENCH_FORM);
			expect(form, 'The form exists').toBeTruthy();
			const byCaption = Object.fromEntries(FormsApi.fields(form).map((field) => [field.caption, field]));
			expect(byCaption['Name']?.fieldTypeId, 'Name is a short answer').toBe('3f92e01b-29e2-4a30-bf33-9df5580ed52c');
			expect(byCaption['Name']?.mandatory, 'Name is mandatory').toBe(true);
			expect(byCaption['Message']?.fieldTypeId, 'Message is a long answer').toBe('023f09ac-1445-4bcb-b8fa-ab49f33bd046');
			expect(byCaption['Topic']?.fieldTypeId, 'Topic is a dropdown').toBe('0dd29d42-a6a5-11de-a2f2-222256d89593');
			expect(byCaption['Topic']?.preValues.map((x: any) => x.value), 'Topic has its options').toEqual([
				'Sales',
				'Support',
				'Other',
			]);
		},
	},
	'forms-pages': {
		async arrange(api) {
			await new FormsApi(api).createForm(BENCH_FORM);
		},
		async verify(api) {
			const form = await new FormsApi(api).getFormByName(BENCH_FORM);
			expect(form?.pages, 'The form has two pages').toHaveLength(2);
			const page = form.pages[1];
			expect(page.caption, 'The second page caption').toBe('Details');
			const group = page.fieldSets.find((fieldset: any) => fieldset.caption === 'About you');
			expect(group, 'The second page has the About you group').toBeTruthy();
			const fields = group.containers.flatMap((container: any) => container.fields);
			expect(
				fields.some((field: any) => field.caption === 'Company' && field.fieldTypeId === '3f92e01b-29e2-4a30-bf33-9df5580ed52c'),
				'The group has a Company short answer',
			).toBe(true);
		},
	},
	'trash-content': {
		async arrange(api) {
			const documentTypeId = await createDocumentType(api);
			await api.document.createDocumentWithTextContent(pageName, documentTypeId, text, dataTypeName);
		},
		async verify(api) {
			expect(await api.document.doesItemExistInRecycleBin(pageName)).toBeTruthy();
		},
	},
};

const benchCase = cases[process.env.BENCH_CASE ?? ''];

async function cleanUp(api: ApiHelpers) {
	await api.document.ensureNameNotExists(pageName);
	await api.document.ensureNameNotExists(draftName);
	await api.document.emptyRecycleBin();
	await api.documentType.ensureNameNotExists(documentTypeName);
	await new FormsApi(api).cleanUp(BENCH_FORM);
}

test('arrange', async ({ umbracoApi }) => {
	expect(benchCase, `Unknown BENCH_CASE "${process.env.BENCH_CASE}"`).toBeTruthy();
	await cleanUp(umbracoApi);
	await benchCase.arrange(umbracoApi);
});

test('verify', async ({ umbracoApi }) => {
	await benchCase.verify(umbracoApi);
});

test('clean-up', async ({ umbracoApi }) => {
	await cleanUp(umbracoApi);
});
