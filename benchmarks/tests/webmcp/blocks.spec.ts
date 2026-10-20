import { expect, type Page } from '@playwright/test';
import { AliasHelper, ConstantHelper, test } from '@umbraco-cms/acceptance-test-helpers';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { callTool as callWebMcp, webMcpToolNames } from '../webmcp-tools';

// One block-editing job, done through WebMCP: on a page whose Block List holds a Hero ("Welcome") and a Quote ("Old
// quote"), add a Quote "Fresh quote" at the top, change the Hero's text to "Welcome back" and remove the old Quote.
// Then, in the empty Block Grid, add a Section and put a Text block in its "main" area. The job runs twice: with the
// document tools alone, which can only rewrite each property's whole stored value, and with the block tools. Each run
// records its calls and the characters of input an agent would write for them as a "job" annotation.

const names = {
	heroType: 'WebMcpE2eHeroBlock',
	quoteType: 'WebMcpE2eQuoteBlock',
	sectionType: 'WebMcpE2eSectionBlock',
	textType: 'WebMcpE2eTextBlock',
	blockList: 'WebMcpE2eBlockList',
	blockGrid: 'WebMcpE2eBlockGrid',
	documentType: 'WebMcpE2eBlocksPage',
	document: 'WebMCP blocks page',
	plainType: 'WebMcpE2ePlainPage',
	plainDocument: 'WebMCP plain page',
	compositionType: 'WebMcpE2eBlocksComposition',
	composedType: 'WebMcpE2eComposedPage',
	composedDocument: 'WebMCP composed page',
};
const blockToolNames = [
	'umbraco_list_blocks',
	'umbraco_add_block',
	'umbraco_set_block_values',
	'umbraco_remove_block',
	'umbraco_move_block',
];
// The helpers name each property after its data type
const listAlias = AliasHelper.toAlias(names.blockList);
const gridAlias = AliasHelper.toAlias(names.blockGrid);
const textAlias = AliasHelper.toAlias('Textstring');

interface Arranged {
	documentId: string;
	heroType: string;
	quoteType: string;
	sectionType: string;
	textType: string;
	heroKey: string;
	oldQuoteKey: string;
}

async function cleanUp(umbracoApi: any) {
	for (const document of [names.document, names.plainDocument, names.composedDocument]) {
		await umbracoApi.document.ensureNameNotExists(document);
	}
	for (const type of [names.documentType, names.plainType, names.composedType, names.compositionType]) {
		await umbracoApi.documentType.ensureNameNotExists(type);
	}
	await umbracoApi.dataType.ensureNameNotExists(names.blockList);
	await umbracoApi.dataType.ensureNameNotExists(names.blockGrid);
	for (const type of [names.heroType, names.quoteType, names.sectionType, names.textType]) {
		await umbracoApi.documentType.ensureNameNotExists(type);
	}
}

const textValue = (value: string) => ({
	alias: textAlias,
	editorAlias: 'Umbraco.TextBox',
	culture: null,
	segment: null,
	value,
});

/** A page whose Block List holds a Hero and a Quote, and whose Block Grid is empty. */
async function arrange(umbracoApi: any): Promise<Arranged> {
	await cleanUp(umbracoApi);
	const textstring = (await umbracoApi.dataType.getByName('Textstring')).id;
	const heroType = await umbracoApi.documentType.createDefaultElementType(names.heroType, 'Content', 'Textstring', textstring);
	const quoteType = await umbracoApi.documentType.createDefaultElementType(names.quoteType, 'Content', 'Textstring', textstring);
	const sectionType = await umbracoApi.documentType.createDefaultElementType(names.sectionType, 'Content', 'Textstring', textstring);
	const textType = await umbracoApi.documentType.createDefaultElementType(names.textType, 'Content', 'Textstring', textstring);
	const blockList = await umbracoApi.dataType.createBlockListDataTypeWithTwoBlocks(names.blockList, heroType, quoteType);
	// A Section allowed at the root only, with a "main" area 6 columns wide, and a Text block allowed at the root and in
	// areas
	const blockGrid = await umbracoApi.dataType.createBlockGridWithAnAreaInABlockWithAllowInAreasAndASecondBlock(
		names.blockGrid,
		sectionType,
		textType,
		'main',
	);
	const documentType = await umbracoApi.documentType.createDocumentTypeWithTwoPropertyEditors(
		names.documentType,
		names.blockList,
		blockList,
		names.blockGrid,
		blockGrid,
	);

	const heroKey = randomUUID();
	const oldQuoteKey = randomUUID();
	const documentId = await umbracoApi.document.create({
		documentType: { id: documentType },
		parent: null,
		template: null,
		variants: [{ culture: null, segment: null, name: names.document }],
		values: [
			{
				alias: listAlias,
				culture: null,
				segment: null,
				value: {
					layout: { 'Umbraco.BlockList': [{ contentKey: heroKey }, { contentKey: oldQuoteKey }] },
					contentData: [
						{ key: heroKey, contentTypeKey: heroType, values: [textValue('Welcome')] },
						{ key: oldQuoteKey, contentTypeKey: quoteType, values: [textValue('Old quote')] },
					],
					settingsData: [],
					expose: [
						{ contentKey: heroKey, culture: null, segment: null },
						{ contentKey: oldQuoteKey, culture: null, segment: null },
					],
				},
			},
		],
	});
	return { documentId, heroType, quoteType, sectionType, textType, heroKey, oldQuoteKey };
}

/** The saved value of a block property, read through the Management API. */
async function savedValue(umbracoApi: any, documentId: string, alias: string) {
	const document = await umbracoApi.document.get(documentId);
	return document.values.find((x: any) => x.alias === alias)?.value;
}

/** What the saved Block List holds, in order: each block's content type and text, and whether it is exposed. */
async function savedList(umbracoApi: any, documentId: string) {
	const value = await savedValue(umbracoApi, documentId, listAlias);
	return (value?.layout?.['Umbraco.BlockList'] ?? []).map((layout: any) => {
		const content = value.contentData.find((x: any) => x.key === layout.contentKey);
		return {
			contentTypeKey: content?.contentTypeKey,
			text: content?.values.find((x: any) => x.alias === textAlias)?.value,
			exposed: value.expose.some((x: any) => x.contentKey === layout.contentKey),
		};
	});
}

/** What the saved Block Grid holds: each root block with the blocks in its areas. */
async function savedGrid(umbracoApi: any, documentId: string) {
	const value = await savedValue(umbracoApi, documentId, gridAlias);
	const describe = (layout: any): any => {
		const content = value.contentData.find((x: any) => x.key === layout.contentKey);
		return {
			contentTypeKey: content?.contentTypeKey,
			text: content?.values.find((x: any) => x.alias === textAlias)?.value ?? null,
			areas: (layout.areas ?? []).filter((area: any) => area.items.length).map((area: any) => area.items.map(describe)),
		};
	};
	return (value?.layout?.['Umbraco.BlockGrid'] ?? []).map(describe);
}

/** Calls tools, counting the calls and the characters of input an agent would have to write for them. */
function meter(page: Page) {
	const counts = { calls: 0, inputChars: 0 };
	return {
		counts,
		call: async <T = any>(name: string, input: object = {}) => {
			counts.calls++;
			counts.inputChars += JSON.stringify(input).length;
			return callWebMcp<T>(page, name, input);
		},
	};
}

test.beforeEach(async ({ page, umbracoUi }, testInfo) => {
	if (testInfo.project.name === 'webmcp-polyfill') {
		await page.addInitScript({ path: path.join(import.meta.dirname, 'webmcp-polyfill.js') });
	}
	await umbracoUi.goToBackOffice();
	await umbracoUi.content.goToSection(ConstantHelper.sections.content);
});

test.afterEach(async ({ umbracoApi }) => {
	await cleanUp(umbracoApi);
});

test('does the job with the document tools alone, by rewriting the stored values', async ({ page, umbracoApi }, testInfo) => {
	const arranged = await arrange(umbracoApi);
	// No other WebMCP tool returns a data type's block types or areas, so an agent with only WebMCP can't find the
	// Section and Text element type keys (no block of either exists yet) or the key of the "main" area. This test reads
	// them from the Management API instead.
	const areaKey = await umbracoApi.dataType.getBlockGridAreaKeyFromBlock(names.blockGrid, arranged.sectionType, 'main');
	const { call, counts } = meter(page);

	await call('umbraco_open_document', { documentKey: arranged.documentId });
	const state = await call('umbraco_get_document_state');
	const current = state.values.find((x: any) => x.alias === listAlias).value;

	// The agent has to write the stored format: a layout keyed by the editor alias, content data with new keys and an
	// expose entry for every block (the next test shows what happens without one)
	const freshKey = randomUUID();
	const hero = current.contentData.find((x: any) => x.key === arranged.heroKey);
	await call('umbraco_set_document_property_value', {
		alias: listAlias,
		value: {
			layout: { 'Umbraco.BlockList': [{ contentKey: freshKey }, { contentKey: arranged.heroKey }] },
			contentData: [
				{ key: freshKey, contentTypeKey: arranged.quoteType, values: [textValue('Fresh quote')] },
				{ ...hero, values: [textValue('Welcome back')] },
			],
			settingsData: [],
			expose: [
				{ contentKey: freshKey, culture: null, segment: null },
				{ contentKey: arranged.heroKey, culture: null, segment: null },
			],
		},
	});
	const sectionKey = randomUUID();
	const textKey = randomUUID();
	await call('umbraco_set_document_property_value', {
		alias: gridAlias,
		value: {
			layout: {
				'Umbraco.BlockGrid': [{ contentKey: sectionKey, areas: [{ key: areaKey, items: [{ contentKey: textKey }] }] }],
			},
			contentData: [
				{ key: sectionKey, contentTypeKey: arranged.sectionType, values: [textValue('Section')] },
				{ key: textKey, contentTypeKey: arranged.textType, values: [textValue('In the area')] },
			],
			settingsData: [],
			expose: [
				{ contentKey: sectionKey, culture: null, segment: null },
				{ contentKey: textKey, culture: null, segment: null },
			],
		},
	});
	const saved = await call('umbraco_save_document');
	expect(saved.completed).toBe(true);

	expect(await savedList(umbracoApi, arranged.documentId)).toEqual([
		{ contentTypeKey: arranged.quoteType, text: 'Fresh quote', exposed: true },
		{ contentTypeKey: arranged.heroType, text: 'Welcome back', exposed: true },
	]);
	expect(await savedGrid(umbracoApi, arranged.documentId)).toEqual([
		{
			contentTypeKey: arranged.sectionType,
			text: 'Section',
			areas: [[{ contentTypeKey: arranged.textType, text: 'In the area', areas: [] }]],
		},
	]);
	testInfo.annotations.push({ type: 'job', description: `${counts.calls} calls, ${counts.inputChars} characters of input` });
});

test('saves a block written without an expose entry, unexposed', async ({ page, umbracoApi }) => {
	const arranged = await arrange(umbracoApi);
	const { call } = meter(page);

	await call('umbraco_open_document', { documentKey: arranged.documentId });
	// What an agent writes when it copies the layout and content but forgets expose for the new block
	const freshKey = randomUUID();
	await call('umbraco_set_document_property_value', {
		alias: listAlias,
		value: {
			layout: { 'Umbraco.BlockList': [{ contentKey: freshKey }, { contentKey: arranged.heroKey }] },
			contentData: [
				{ key: freshKey, contentTypeKey: arranged.quoteType, values: [textValue('Fresh quote')] },
				{ key: arranged.heroKey, contentTypeKey: arranged.heroType, values: [textValue('Welcome back')] },
			],
			settingsData: [],
			expose: [{ contentKey: arranged.heroKey, culture: null, segment: null }],
		},
	});
	const saved = await call('umbraco_save_document');

	// Nothing reports a problem, but the new block is stored unexposed
	expect(saved.completed).toBe(true);
	const list = await savedList(umbracoApi, arranged.documentId);
	expect(list.map((x: any) => x.text)).toEqual(['Fresh quote', 'Welcome back']);
	expect(list[0].exposed).toBe(false);
});

test('does the job with the block tools', async ({ page, umbracoApi }, testInfo) => {
	const arranged = await arrange(umbracoApi);
	const { call, counts } = meter(page);

	const opened = await call('umbraco_open_document', { documentKey: arranged.documentId });
	expect(opened.workspaceTools).toEqual(expect.arrayContaining(['umbraco_list_blocks', 'umbraco_add_block']));

	const listed = await call('umbraco_list_blocks', { alias: listAlias });
	expect(listed.blockTypes.map((x: any) => x.name)).toEqual([names.heroType, names.quoteType]);
	expect(listed.blocks.map((x: any) => [x.key, x.values[textAlias]])).toEqual([
		[arranged.heroKey, 'Welcome'],
		[arranged.oldQuoteKey, 'Old quote'],
	]);

	const added = await call('umbraco_add_block', {
		alias: listAlias,
		blockType: names.quoteType,
		values: { [textAlias]: 'Fresh quote' },
		index: 0,
	});
	expect(added.blocks.map((x: any) => x.key)).toEqual([added.key, arranged.heroKey, arranged.oldQuoteKey]);
	await call('umbraco_set_block_values', { alias: listAlias, key: arranged.heroKey, values: { [textAlias]: 'Welcome back' } });
	await call('umbraco_remove_block', { alias: listAlias, key: arranged.oldQuoteKey });

	const section = await call('umbraco_add_block', {
		alias: gridAlias,
		blockType: names.sectionType,
		values: { [textAlias]: 'Section' },
	});
	const text = await call('umbraco_add_block', {
		alias: gridAlias,
		blockType: names.textType,
		values: { [textAlias]: 'In the area' },
		parentKey: section.key,
		area: 'main',
	});
	expect(text.blocks[0].areas[0].blocks.map((x: any) => x.key)).toEqual([text.key]);
	const saved = await call('umbraco_save_document');
	expect(saved.completed).toBe(true);

	expect(await savedList(umbracoApi, arranged.documentId)).toEqual([
		{ contentTypeKey: arranged.quoteType, text: 'Fresh quote', exposed: true },
		{ contentTypeKey: arranged.heroType, text: 'Welcome back', exposed: true },
	]);
	expect(await savedGrid(umbracoApi, arranged.documentId)).toEqual([
		{
			contentTypeKey: arranged.sectionType,
			text: 'Section',
			areas: [[{ contentTypeKey: arranged.textType, text: 'In the area', areas: [] }]],
		},
	]);
	// Sized as the grid sizes them: full width at the root, the area's width inside it, and both exposed
	const grid = await savedValue(umbracoApi, arranged.documentId, gridAlias);
	const root = grid.layout['Umbraco.BlockGrid'][0];
	expect([root.columnSpan, root.areas[0].items[0].columnSpan]).toEqual([12, 6]);
	expect(grid.expose.map((x: any) => x.contentKey).sort()).toEqual([section.key, text.key].sort());
	testInfo.annotations.push({ type: 'job', description: `${counts.calls} calls, ${counts.inputChars} characters of input` });
});

test('moves Block Grid blocks in and out of areas, and refuses what the grid does not allow', async ({ page, umbracoApi }) => {
	const arranged = await arrange(umbracoApi);
	const { call } = meter(page);
	await call('umbraco_open_document', { documentKey: arranged.documentId });
	const section = await call('umbraco_add_block', { alias: gridAlias, blockType: names.sectionType });
	const text = await call('umbraco_add_block', { alias: gridAlias, blockType: names.textType });

	// Sections are allowed at the root only
	const refused = await call('umbraco_add_block', { alias: gridAlias, blockType: names.sectionType, parentKey: section.key });
	expect(refused.error).toContain('is not a block type you can add in the "main" area');

	const moved = await call('umbraco_move_block', { alias: gridAlias, key: text.key, parentKey: section.key });
	expect(moved.blocks.map((x: any) => x.key)).toEqual([section.key]);
	expect(moved.blocks[0].areas[0].blocks.map((x: any) => [x.key, x.columnSpan])).toEqual([[text.key, 6]]);

	const back = await call('umbraco_move_block', { alias: gridAlias, key: text.key, index: 0 });
	expect(back.blocks.map((x: any) => [x.key, x.columnSpan])).toEqual([
		[text.key, 12],
		[section.key, 12],
	]);

	const intoItself = await call('umbraco_move_block', { alias: gridAlias, key: section.key, parentKey: section.key });
	expect(intoItself.error).toContain("can't be moved into its own areas");

	const removed = await call('umbraco_remove_block', { alias: gridAlias, key: section.key });
	expect(removed.blocks.map((x: any) => x.key)).toEqual([text.key]);
});

test('offers the block tools only for document types with a block property, following the open document', async ({
	page,
	umbracoApi,
}) => {
	const arranged = await arrange(umbracoApi);
	const plainType = await umbracoApi.documentType.createDefaultDocumentTypeWithAllowAsRoot(names.plainType);
	const plainDocument = await umbracoApi.document.createDefaultDocument(names.plainDocument, plainType);
	// A document type whose only Block List property comes from a composition
	const blockList = (await umbracoApi.dataType.getByName(names.blockList)).id;
	const composition = await umbracoApi.documentType.createDocumentTypeWithPropertyEditor(
		names.compositionType,
		names.blockList,
		blockList,
	);
	const composedType = await umbracoApi.documentType.createDocumentTypeWithACompositionAndAllowAsRoot(
		names.composedType,
		composition,
	);
	const composedDocument = await umbracoApi.document.createDefaultDocument(names.composedDocument, composedType);
	const blockToolsIn = (toolNames: Array<string>) => blockToolNames.filter((name) => toolNames.includes(name));
	// Opens a document, then checks the block tools it reports and the ones WebMCP lists
	const open = async (documentKey: string, expected: Array<string>) => {
		const opened = await callWebMcp(page, 'umbraco_open_document', { documentKey });
		expect(opened.workspaceTools).toContain('umbraco_get_document_state');
		expect(blockToolsIn(opened.workspaceTools)).toEqual(expected);
		await expect.poll(async () => blockToolsIn(await webMcpToolNames(page))).toEqual(expected);
	};

	await open(plainDocument, []);
	// The document workspace stays open for each document after this, so the tools follow the document type
	await open(arranged.documentId, blockToolNames);
	await open(plainDocument, []);
	await open(composedDocument, blockToolNames);

	const listed = await callWebMcp(page, 'umbraco_list_blocks', { alias: listAlias });
	expect(listed.editor).toBe('Umbraco.BlockList');
	expect(listed.blocks).toEqual([]);
});
