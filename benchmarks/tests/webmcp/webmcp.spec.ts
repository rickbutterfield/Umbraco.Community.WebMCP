import { expect } from '@playwright/test';
import { ConstantHelper, test } from '@umbraco-cms/acceptance-test-helpers';
import path from 'node:path';
import { BENCH_FOLDER, BENCH_FOLDER_ID, BENCH_FORM, FormsApi } from '../agent/forms-api';
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

test('sets question settings, conditions and workflows with the example Forms toolset', async ({
	page,
	umbracoApi,
}) => {
	const forms = new FormsApi(umbracoApi);
	await forms.cleanUp(BENCH_FORM);
	try {
		const formId = await forms.createForm(BENCH_FORM);
		await page.goto('/umbraco/section/forms');
		const opened = await callWebMcp(page, 'umbraco_open_entity', { entityType: 'forms-form', unique: formId });
		expect(opened.workspaceTools).toContain('umbraco_forms_add_workflow');

		await callWebMcp(page, 'umbraco_forms_add_fields', {
			fields: [
				{ fieldType: 'Dropdown', caption: 'Contact me by', options: ['Email', 'Phone'] },
				{ fieldType: 'Short answer', caption: 'Phone number' },
			],
		});

		// Question settings
		const before = await callWebMcp(page, 'umbraco_forms_get_field_settings', { field: 'Phone number' });
		expect(before.fieldTypeSupports).toEqual({ mandatory: true, regex: true, options: false });
		expect(before.availableSettings.map((x: any) => x.alias)).toContain('Placeholder');
		const unknown = await callWebMcp(page, 'umbraco_forms_set_field_settings', {
			field: 'phoneNumber',
			settings: { Colour: 'red' },
		});
		expect(unknown.error).toContain('has no setting "Colour"');
		const noOptions = await callWebMcp(page, 'umbraco_forms_set_field_settings', {
			field: 'phoneNumber',
			options: ['a'],
		});
		expect(noOptions.error).toContain("don't take options");
		const set = await callWebMcp(page, 'umbraco_forms_set_field_settings', {
			field: 'phoneNumber',
			mandatory: true,
			requiredErrorMessage: 'We need your number',
			regex: '^[0-9 +]+$',
			invalidErrorMessage: 'Digits only',
			settings: { Placeholder: '+45 12 34 56 78' },
		});
		expect(set.mandatory).toBe(true);
		expect(set.settings.Placeholder).toBe('+45 12 34 56 78');

		// Conditions on a question and its group
		const badValue = await callWebMcp(page, 'umbraco_forms_set_condition', {
			id: 'Phone number',
			rules: [{ field: 'Contact me by', value: 'Fax' }],
		});
		expect(badValue.error).toContain('has the options Email, Phone');
		const fieldCondition = await callWebMcp(page, 'umbraco_forms_set_condition', {
			id: 'Phone number',
			rules: [{ field: 'Contact me by', operator: 'Is', value: 'Phone' }],
		});
		expect(fieldCondition.appliesTo).toBe('field');
		const design = await callWebMcp(page, 'umbraco_forms_get_form_design');
		const groupId = design.pages[0].groups[0].id;
		const groupCondition = await callWebMcp(page, 'umbraco_forms_set_condition', {
			id: groupId,
			action: 'Hide',
			logic: 'Any',
			rules: [{ field: 'contactMeBy', operator: 'IsNot', value: 'Email' }],
		});
		expect(groupCondition.appliesTo).toBe('group');

		// Workflows
		const types = await callWebMcp(page, 'umbraco_forms_list_workflow_types');
		const sendEmail = types.find((x: any) => x.name === 'Send email');
		expect(sendEmail.settings.filter((x: any) => x.mandatory).map((x: any) => x.alias)).toEqual([
			'Email',
			'Subject',
			'Message',
		]);
		const missing = await callWebMcp(page, 'umbraco_forms_add_workflow', {
			workflowType: 'Send email',
			settings: { Email: 'a@example.com' },
		});
		expect(missing.error).toContain('needs these settings: Subject, Message');
		const email = await callWebMcp(page, 'umbraco_forms_add_workflow', {
			workflowType: 'sendEmail',
			name: 'Notify the team',
			settings: {
				Email: 'team@example.com',
				Subject: 'New enquiry',
				Message: 'Someone got in touch.',
				Attachment: true,
			},
		});
		expect(email.stage).toBe('onSubmit');
		const xml = await callWebMcp(page, 'umbraco_forms_add_workflow', {
			workflowType: 'Post as XML',
			settings: { Url: 'https://example.com/hook', Method: 'PUT' },
		});
		const badMethod = await callWebMcp(page, 'umbraco_forms_set_workflow', {
			workflow: xml.id,
			settings: { Method: 'PATCH' },
		});
		expect(badMethod.error).toContain('takes POST, GET, PUT, DELETE');
		const changed = await callWebMcp(page, 'umbraco_forms_set_workflow', {
			workflow: 'Notify the team',
			active: false,
			settings: { Subject: 'New enquiry from the site' },
		});
		expect(changed.active).toBe(false);
		await callWebMcp(page, 'umbraco_forms_set_condition', {
			id: email.id,
			rules: [{ field: 'Contact me by', value: 'Email' }],
		});
		const removed = await callWebMcp(page, 'umbraco_forms_remove_workflow', { workflow: xml.id });
		expect(removed.removed).toBe(xml.id);
		const listed = await callWebMcp(page, 'umbraco_forms_list_workflows');
		// The blank form's scaffold already sends a template email
		expect(listed.onSubmit.map((x: any) => x.name)).toEqual([
			expect.stringContaining('Send template email'),
			'Notify the team',
		]);
		// Whitespace counts as empty, as on the server
		const blank = await callWebMcp(page, 'umbraco_forms_set_workflow', {
			workflow: email.id,
			settings: { Subject: '  ' },
		});
		expect(blank.error).toContain('needs these settings: Subject');

		const saved = await callWebMcp(page, 'umbraco_run_workspace_action', { action: 'Forms.WorkspaceAction.Form.Save' });
		expect(saved.completed).toBe(true);

		// What Forms saved
		const form = await forms.getFormByName(BENCH_FORM);
		const fields = FormsApi.fields(form);
		const contact = fields.find((x) => x.alias === 'contactMeBy');
		const phone = fields.find((x) => x.alias === 'phoneNumber');
		expect(phone).toMatchObject({
			mandatory: true,
			requiredErrorMessage: 'We need your number',
			regex: '^[0-9 +]+$',
			invalidErrorMessage: 'Digits only',
		});
		expect(phone.settings.Placeholder).toBe('+45 12 34 56 78');
		expect(phone.condition).toMatchObject({
			enabled: true,
			actionType: 'Show',
			logicType: 'All',
			rules: [{ field: contact.id, operator: 'Is', value: 'Phone' }],
		});
		const fieldset = form.pages[0].fieldSets[0];
		expect(fieldset.condition).toMatchObject({
			enabled: true,
			actionType: 'Hide',
			logicType: 'Any',
			rules: [{ field: contact.id, operator: 'IsNot', value: 'Email' }],
		});
		expect(form.formWorkflows.onSubmit).toHaveLength(2);
		expect(form.formWorkflows.onSubmit[1]).toMatchObject({
			name: 'Notify the team',
			active: false,
			settings: { Email: 'team@example.com', Subject: 'New enquiry from the site', Attachment: 'True' },
			condition: { enabled: true, rules: [{ field: contact.id, value: 'Email' }] },
		});
	} finally {
		await forms.cleanUp(BENCH_FORM);
	}
});

test('describes a block list value and saves the example it gives', async ({ page, umbracoApi }) => {
	const elementTypeName = 'WebMcpE2eElementType';
	const blockListName = 'WebMcpE2eBlockList';
	await umbracoApi.dataType.ensureNameNotExists(blockListName);
	try {
		const textstring = await umbracoApi.dataType.getByName('Textstring');
		const elementTypeId = await umbracoApi.documentType.createDefaultElementType(
			elementTypeName,
			'TestGroup',
			'Textstring',
			textstring.id,
		);
		const blockListId = await umbracoApi.dataType.createBlockListDataTypeWithABlock(blockListName, elementTypeId);
		const documentTypeId = await umbracoApi.documentType.createDocumentTypeWithPropertyEditor(
			documentTypeName,
			blockListName,
			blockListId,
		);
		await callWebMcp(page, 'umbraco_open_new_document', { documentTypeKey: documentTypeId });
		const [{ alias }] = (await callWebMcp(page, 'umbraco_get_document_state')).properties;

		const shape = await callWebMcp(page, 'umbraco_get_property_value_shape', { alias });
		expect(shape.editorAlias).toBe('Umbraco.BlockList');
		expect(shape.inferred).toBe(false);
		const [blockType] = shape.blockTypes;
		expect(blockType.contentElementTypeKey).toBe(elementTypeId);
		const [elementProperty] = blockType.contentElementType.properties;
		expect(elementProperty.editorAlias).toBe('Umbraco.TextBox');
		expect(shape.example.contentData[0].contentTypeKey).toBe(elementTypeId);
		expect(shape.example.expose).toHaveLength(1);

		// A block property is described by its data type
		const propertyShape = await callWebMcp(page, 'umbraco_get_property_value_shape', {
			dataTypeKey: elementProperty.dataTypeKey,
		});
		expect(propertyShape.shape).toBe('string');

		const value = structuredClone(shape.example);
		value.contentData[0].values[0].value = 'Block headline';
		await callWebMcp(page, 'umbraco_set_document_property_value', { alias, value });
		await callWebMcp(page, 'umbraco_set_document_name', { name: documentName });
		const saved = await callWebMcp(page, 'umbraco_save_document');
		expect(saved.completed).toBe(true);

		const document = await umbracoApi.document.getByName(documentName);
		const stored = document.values.find((x: any) => x.alias === alias).value;
		expect(stored.contentData[0].values[0].value).toBe('Block headline');
		expect(stored.layout['Umbraco.BlockList']).toHaveLength(1);
	} finally {
		await umbracoApi.document.ensureNameNotExists(documentName);
		await umbracoApi.documentType.ensureNameNotExists(documentTypeName);
		await umbracoApi.dataType.ensureNameNotExists(blockListName);
		await umbracoApi.documentType.ensureNameNotExists(elementTypeName);
	}
});

test('moves a form into a folder by picking the folder in the Move to picker', async ({ page, umbracoApi }) => {
	const forms = new FormsApi(umbracoApi);
	await forms.cleanUp(BENCH_FORM);
	try {
		await forms.createFolder(BENCH_FOLDER_ID, BENCH_FOLDER);
		const formId = await forms.createForm(BENCH_FORM);
		await page.goto('/umbraco/section/forms');

		const ran = await callWebMcp(page, 'umbraco_run_entity_action', {
			entityType: 'forms-form',
			unique: formId,
			action: 'Move',
		});
		expect(ran.completed).toBe(false);
		const { key } = (await callWebMcp(page, 'umbraco_list_modals')).at(-1);

		// Forms' Move to only lets folders be picked
		const refused = await callWebMcp(page, 'umbraco_select_picker_item', { key, name: BENCH_FORM });
		expect(refused.error).toContain("can't be picked");

		const picked = await callWebMcp(page, 'umbraco_select_picker_item', { key, name: BENCH_FOLDER });
		expect(picked.selection).toEqual([{ unique: BENCH_FOLDER_ID, name: BENCH_FOLDER }]);
		// Only the modal's own buttons, not the actions on each row of the picker's tree
		expect(picked.buttons.map((button: any) => button.label)).toEqual(['Cancel', 'Move']);
		expect(picked.buttons.find((button: any) => button.label === 'Move').disabled).toBe(false);

		const moved = await callWebMcp(page, 'umbraco_click_modal_button', { key, label: 'Move' });
		expect(moved.closed).toBe(true);
		await expect.poll(async () => (await forms.getFormByName(BENCH_FORM))?.parentUnique).toBe(BENCH_FOLDER_ID);
	} finally {
		await forms.cleanUp(BENCH_FORM);
	}
});

test('sorts the children of a document in the Sort children modal', async ({ page, umbracoApi }) => {
	const parentTypeName = 'WebMcpE2eSortParentType';
	const childTypeName = 'WebMcpE2eSortChildType';
	const parentName = 'WebMCP sort parent';
	await umbracoApi.document.ensureNameNotExists(parentName);
	try {
		const childTypeId = await umbracoApi.documentType.createDefaultDocumentType(childTypeName);
		const parentTypeId = await umbracoApi.documentType.createDocumentTypeWithAllowedChildNode(parentTypeName, childTypeId);
		const parentId = await umbracoApi.document.createDefaultDocument(parentName, parentTypeId);
		for (const name of ['Alpha', 'Bravo', 'Charlie']) {
			await umbracoApi.document.createDefaultDocumentWithParent(name, childTypeId, parentId);
		}
		const childNames = async () =>
			(await umbracoApi.document.getChildren(parentId)).map((child: any) => child.variants[0].name);
		expect(await childNames()).toEqual(['Alpha', 'Bravo', 'Charlie']);

		const ran = await callWebMcp(page, 'umbraco_run_entity_action', {
			entityType: 'document',
			unique: parentId,
			action: 'Sort children',
		});
		expect(ran.completed).toBe(false);
		const { key } = (await callWebMcp(page, 'umbraco_list_modals')).at(-1);

		// The modal keeps its order in the table its rows are dragged in, not in its value, which Sort ignores
		const refused = await callWebMcp(page, 'umbraco_sort_modal_items', { key, order: ['Delta'] });
		expect(refused.error).toContain('Shown: Alpha');

		const ordered = await callWebMcp(page, 'umbraco_sort_modal_items', { key, order: ['Charlie'] });
		expect(ordered.sortableItems.map((item: any) => item.name)).toEqual(['Charlie', 'Alpha', 'Bravo']);
		expect(ordered.buttons.map((button: any) => button.label)).toEqual(['Cancel', 'Sort']);

		const sorted = await callWebMcp(page, 'umbraco_click_modal_button', { key, label: 'Sort' });
		expect(sorted.closed).toBe(true);
		await expect.poll(childNames).toEqual(['Charlie', 'Alpha', 'Bravo']);
	} finally {
		await umbracoApi.document.ensureNameNotExists(parentName);
		await umbracoApi.documentType.ensureNameNotExists(parentTypeName);
		await umbracoApi.documentType.ensureNameNotExists(childTypeName);
	}
});
