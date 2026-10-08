import { expect } from '@playwright/test';
import { test, type ApiHelpers } from '@umbraco-cms/acceptance-test-helpers';

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
