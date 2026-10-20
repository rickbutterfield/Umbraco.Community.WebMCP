import type { UmbWebMcpToolsetApi } from '../extension-types.ts';
import type { UmbWebMcpTool, UmbWebMcpToolCall } from '../model-context.ts';
import { waitForQuiet, waitUntil, whenWorkspaceReady } from '../utils.ts';
import {
	allowedGridBlockTypes,
	blockAndDescendants,
	entriesAt,
	findBlock,
	findBlockType,
	fitColumnSpan,
	gridLayoutDefaults,
	insertBlock,
	mergeValues,
	removeBlock,
	valuesForVariant,
	type UmbBlockGridAreaTypeLike,
	type UmbBlockGridTypeLike,
	type UmbBlockLayoutEntry,
} from './block-layout.ts';
import { UmbWebMcpBlockManager } from './block-manager.ts';
import type { UmbBlockDataModel, UmbBlockDataValueModel, UmbBlockValueType } from '@umbraco-cms/backoffice/block';
import { UMB_BLOCK_GRID_PROPERTY_EDITOR_SCHEMA_ALIAS } from '@umbraco-cms/backoffice/block-grid';
import { UMB_BLOCK_LIST_PROPERTY_EDITOR_SCHEMA_ALIAS } from '@umbraco-cms/backoffice/block-list';
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import { UmbElementControllerHost, type UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbDataTypeDetailRepository } from '@umbraco-cms/backoffice/data-type';
import { UMB_DOCUMENT_WORKSPACE_CONTEXT, type UmbDocumentWorkspaceContext } from '@umbraco-cms/backoffice/document';
import { UmbPropertyEditorConfigCollection } from '@umbraco-cms/backoffice/property-editor';
import { UmbVariantId } from '@umbraco-cms/backoffice/variant';

type UmbBlockType = UmbBlockGridTypeLike & { settingsElementTypeKey?: string };

interface UmbBlockPropertyInput {
	alias: string;
	culture?: string | null;
	segment?: string | null;
}

interface UmbBlockTargetInput {
	index?: number;
	parentKey?: string;
	area?: string;
}

/** One Block List or Block Grid property, loaded into a block manager for the length of one tool call. */
interface UmbBlockEditorSession {
	editorAlias: string;
	isGrid: boolean;
	manager: UmbWebMcpBlockManager;
	config: UmbPropertyEditorConfigCollection;
	/** The document variant being edited, as the editor's variant context gives it. */
	variant: UmbVariantId;
	/** Writes the manager's blocks back to the property, as the editor does after every change. */
	write(): Promise<void>;
}

const PROPERTY_INPUT = {
	alias: {
		type: 'string',
		description: 'The alias of the Block List or Block Grid property, from umbraco_get_document_state.',
	},
	culture: {
		type: ['string', 'null'],
		description: 'The culture being edited, such as en-US. Required when the document varies by culture.',
	},
	segment: { type: ['string', 'null'], description: 'The segment. Omit unless the document varies by segment.' },
};

const TARGET_INPUT = {
	index: {
		type: 'integer',
		description: 'The position among the blocks there, 0 for first. Omit to put it last.',
	},
	parentKey: {
		type: 'string',
		description: 'Block Grid only: the key of the block whose area to put it in. Omit for the root of the property.',
	},
	area: {
		type: 'string',
		description:
			'Block Grid only: the alias or key of the area of parentKey. Can be omitted when that block has one area.',
	},
};

const VALUES_INPUT = {
	values: {
		type: 'object',
		description:
			'Property values of the block by alias, each in the stored format of its property editor, such as { "title": "Hello" }.',
	},
	settings: { type: 'object', description: 'Settings values of the block by alias, in the same format.' },
};

const isBlockEditor = (editorAlias: string | undefined) =>
	editorAlias === UMB_BLOCK_LIST_PROPERTY_EDITOR_SCHEMA_ALIAS ||
	editorAlias === UMB_BLOCK_GRID_PROPERTY_EDITOR_SCHEMA_ALIAS;

/**
 * Block tools, registered as a `webMcpWorkspaceToolset` so they exist only while a document workspace is open. Each
 * call loads the property's value into the backoffice's block manager, makes the change through it and writes the
 * value back to the document, as the Block List and Block Grid editors do. Nothing is saved until the document is.
 *
 * The manager runs without the property editor, so the tools work whichever tab the property is on.
 */
export class UmbBlockWebMcpToolset extends UmbControllerBase implements UmbWebMcpToolsetApi {
	#workspace?: UmbDocumentWorkspaceContext;
	#dataTypes = new UmbDataTypeDetailRepository(this);

	constructor(host: UmbControllerHost) {
		super(host);
		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			this.#workspace = workspace;
		});
	}

	async #getReadyWorkspace(signal?: AbortSignal) {
		const workspace = this.#workspace;
		if (!workspace) throw new Error('No document workspace is open.');
		if (!(await whenWorkspaceReady(workspace, signal)))
			throw new Error('The document is still loading. Try again shortly.');
		return workspace;
	}

	async #getDataType(unique: string) {
		const { data, error } = await this.#dataTypes.requestByUnique(unique);
		if (error || !data) throw new Error(`Data type "${unique}" could not be loaded.`);
		return data;
	}

	/**
	 * Loads the property into a block manager, runs `work` and cleans up. The manager is hosted by an element of its
	 * own inside the workspace, so it can reach the backoffice's contexts without being offered as the block manager
	 * of anything else in the workspace.
	 */
	async #withEditor<T>(
		input: UmbBlockPropertyInput,
		signal: AbortSignal | undefined,
		work: (session: UmbBlockEditorSession) => Promise<T>,
	): Promise<T> {
		const workspace = await this.#getReadyWorkspace(signal);
		const property = await workspace.structure.getPropertyStructureByAlias(input.alias);
		if (!property) {
			const aliases = (await workspace.structure.getContentTypeProperties()).map((x) => x.alias).join(', ');
			throw new Error(`"${input.alias}" is not a property of this document. Properties: ${aliases}.`);
		}
		const dataType = await this.#getDataType(property.dataType.unique);
		const editorAlias = dataType.editorAlias;
		if (!editorAlias || !isBlockEditor(editorAlias)) {
			throw new Error(
				`"${input.alias}" is not a Block List or Block Grid property. Its editor is ${editorAlias ?? 'unknown'}.`,
			);
		}
		const variesByCulture = workspace.getVariesByCulture() ?? false;
		if (variesByCulture && !input.culture)
			throw new Error('This document varies by culture: pass culture, such as en-US.');
		const variant = new UmbVariantId(
			variesByCulture ? (input.culture ?? null) : null,
			workspace.getVariesBySegment() ? (input.segment ?? null) : null,
		);
		const propertyVariant = variant.toVariant(property.variesByCulture, property.variesBySegment);

		const element = document.createElement('div');
		element.hidden = true;
		this.getHostElement().appendChild(element);
		const host = new UmbElementControllerHost(element);
		host.hostConnected();
		try {
			const manager = new UmbWebMcpBlockManager(host);
			const config = new UmbPropertyEditorConfigCollection(dataType.values);
			manager.setEditorConfiguration(config);
			manager.setBlockTypes(config.getValueByAlias('blocks') ?? []);
			manager.setVariantId(variant);
			const value = workspace.getPropertyValue<UmbBlockValueType<UmbBlockLayoutEntry>>(input.alias, propertyVariant);
			manager.setLayouts(value?.layout?.[editorAlias] ?? []);
			manager.setContents(value?.contentData ?? []);
			manager.setSettings(value?.settingsData ?? []);
			manager.setExposes(value?.expose ?? []);
			await manager.contentTypesLoaded;

			return await work({
				editorAlias,
				isGrid: editorAlias === UMB_BLOCK_GRID_PROPERTY_EDITOR_SCHEMA_ALIAS,
				manager,
				config,
				variant,
				write: async () => {
					const layouts = manager.getLayouts();
					// The editors store no value at all once the last block is gone
					const next = layouts.length
						? {
								...value,
								layout: { [editorAlias]: layouts },
								contentData: manager.getContents(),
								settingsData: manager.getSettings(),
								expose: manager.getExposes(),
							}
						: undefined;
					await workspace.setPropertyValue(input.alias, next, propertyVariant);
				},
			});
		} finally {
			host.destroy();
			element.remove();
		}
	}

	#blockTypes(session: UmbBlockEditorSession) {
		return session.manager.getBlockTypes() as Array<UmbBlockType>;
	}

	#nameOf(session: UmbBlockEditorSession, contentTypeKey: string | undefined) {
		return contentTypeKey ? (session.manager.getContentTypeNameOf(contentTypeKey) ?? null) : null;
	}

	#gridColumns(session: UmbBlockEditorSession) {
		const value = session.config.getValueByAlias<number | string>('gridColumns');
		return parseInt(value !== undefined && value !== '' ? String(value) : '12');
	}

	/** The blocks and the block types, as the agent sees them. */
	#describe(session: UmbBlockEditorSession) {
		const { manager, isGrid, variant } = session;
		const blockTypes = this.#blockTypes(session);
		const valuesOf = (data: UmbBlockDataModel | undefined) =>
			data ? valuesForVariant(data.values, variant.culture, variant.segment) : {};
		const describeBlock = (entry: UmbBlockLayoutEntry, index: number): Record<string, unknown> => {
			const content = manager.getContentOf(entry.contentKey);
			const blockType = blockTypes.find((x) => x.contentElementTypeKey === content?.contentTypeKey);
			const settings = entry.settingsKey ? manager.getSettingsOf(entry.settingsKey) : undefined;
			return {
				key: entry.contentKey,
				index,
				blockType: this.#nameOf(session, content?.contentTypeKey),
				contentTypeKey: content?.contentTypeKey ?? null,
				values: valuesOf(content),
				...(settings ? { settings: valuesOf(settings) } : {}),
				...(isGrid
					? {
							columnSpan: entry.columnSpan ?? null,
							rowSpan: entry.rowSpan ?? null,
							areas: (blockType?.areas ?? []).map((area) => ({
								key: area.key,
								alias: area.alias,
								blocks: (entry.areas?.find((x) => x.key === area.key)?.items ?? []).map(describeBlock),
							})),
						}
					: {}),
			};
		};
		const limit = session.config.getValueByAlias<{ min?: number; max?: number }>('validationLimit');
		return {
			editor: session.editorAlias,
			min: limit?.min ?? null,
			max: limit?.max ?? null,
			blockTypes: blockTypes.map((x) => ({
				contentTypeKey: x.contentElementTypeKey,
				name: this.#nameOf(session, x.contentElementTypeKey),
				hasSettings: Boolean(x.settingsElementTypeKey),
				...(isGrid
					? {
							allowAtRoot: Boolean(x.allowAtRoot),
							allowInAreas: Boolean(x.allowInAreas),
							areas: (x.areas ?? []).map((area) => ({ key: area.key, alias: area.alias })),
						}
					: {}),
			})),
			blocks: manager.getLayouts().map(describeBlock),
		};
	}

	/**
	 * Value entries for a block's element type, by alias, for the variant being edited: culture and segment only where
	 * the element type and property vary by them, as the block workspace stores them.
	 */
	async #toValueEntries(session: UmbBlockEditorSession, contentTypeKey: string, values: Record<string, unknown>) {
		const structure = session.manager.getStructure(contentTypeKey);
		if (!structure) throw new Error(`The element type "${contentTypeKey}" is not loaded.`);
		await structure.whenLoaded();
		const properties = await structure.getContentTypeProperties();
		const entries: Array<UmbBlockDataValueModel> = [];
		for (const [alias, value] of Object.entries(values)) {
			const property = properties.find((x) => x.alias === alias);
			if (!property) {
				const name = this.#nameOf(session, contentTypeKey) ?? contentTypeKey;
				throw new Error(
					`"${alias}" is not a property of ${name}. Properties: ${properties.map((x) => x.alias).join(', ') || 'none'}.`,
				);
			}
			const editorAlias = (await this.#getDataType(property.dataType.unique)).editorAlias;
			if (!editorAlias) throw new Error(`The data type of "${alias}" has no property editor.`);
			const variantId = session.variant.toVariant(
				property.variesByCulture && Boolean(structure.getVariesByCulture()),
				property.variesBySegment && Boolean(structure.getVariesBySegment()),
			);
			entries.push({ editorAlias, ...variantId.toObject(), alias, value });
		}
		return entries;
	}

	/** Exposes a block in the variant being edited, as submitting the block workspace does. */
	#expose(session: UmbBlockEditorSession, contentKey: string, contentTypeKey: string) {
		const structure = session.manager.getStructure(contentTypeKey);
		const variantId = session.variant.toVariant(
			Boolean(structure?.getVariesByCulture()),
			Boolean(structure?.getVariesBySegment()),
		);
		session.manager.setOneExpose(contentKey, variantId);
	}

	/**
	 * Where a block goes: the root, or an area of a Block Grid block, given by alias or key (or left out when the block
	 * has only one area). Returns the area's configuration, or null for the root.
	 */
	#resolveArea(
		session: UmbBlockEditorSession,
		{ parentKey, area }: UmbBlockTargetInput,
	): UmbBlockGridAreaTypeLike | null {
		if (!parentKey) {
			if (area) throw new Error('Pass parentKey too: the key of the block the area belongs to.');
			return null;
		}
		if (!session.isGrid) throw new Error('Only Block Grid blocks have areas. Leave out parentKey for a Block List.');
		if (!findBlock(session.manager.getLayouts(), parentKey))
			throw new Error(`There is no block with key "${parentKey}".`);
		const contentTypeKey = session.manager.getContentOf(parentKey)?.contentTypeKey;
		const areas = this.#blockTypes(session).find((x) => x.contentElementTypeKey === contentTypeKey)?.areas ?? [];
		const name = this.#nameOf(session, contentTypeKey) ?? 'parent';
		if (!areas.length) throw new Error(`The ${name} block has no areas.`);
		const aliases = areas.map((x) => x.alias).join(', ');
		if (!area) {
			if (areas.length === 1) return areas[0];
			throw new Error(`The ${name} block has several areas: pass area, one of ${aliases}.`);
		}
		const found = areas.find((x) => x.key === area || x.alias.toLowerCase() === area.toLowerCase());
		if (!found) throw new Error(`The ${name} block has no area "${area}". Areas: ${aliases}.`);
		return found;
	}

	/** Throws when the container already holds as many blocks as it allows. */
	#checkRoom(session: UmbBlockEditorSession, parentKey: string | null, area: UmbBlockGridAreaTypeLike | null) {
		const max = area ? area.maxAllowed : session.config.getValueByAlias<{ max?: number }>('validationLimit')?.max;
		const count = entriesAt(session.manager.getLayouts(), parentKey, area?.key ?? null)?.length ?? 0;
		if (max && count >= max) {
			throw new Error(
				`${area ? `The "${area.alias}" area` : 'This property'} already holds the most blocks it allows (${max}).`,
			);
		}
	}

	/** The width, in columns, of the container a Block Grid block is in. */
	#layoutColumns(session: UmbBlockEditorSession, area: UmbBlockGridAreaTypeLike | null) {
		return area?.columnSpan ?? this.#gridColumns(session);
	}

	getTools(): Array<UmbWebMcpTool> {
		return [
			{
				name: 'umbraco_list_blocks',
				title: 'List blocks',
				description:
					"Lists the blocks in a Block List or Block Grid property of the open document, including unsaved edits: each block's key, block type, values and settings, and in a Block Grid its size and areas with the blocks in them. Also returns the block types that can be added (with their areas) and the minimum and maximum number of blocks. Values are for the culture passed.",
				annotations: { readOnlyHint: true, untrustedContentHint: true },
				inputSchema: { type: 'object', properties: PROPERTY_INPUT, required: ['alias'] },
				execute: (input: UmbBlockPropertyInput, call?: UmbWebMcpToolCall) =>
					this.#withEditor(input, call?.signal, async (session) => this.#describe(session)),
			},
			{
				name: 'umbraco_add_block',
				title: 'Add block',
				description:
					"Adds a block of a type the property allows to a Block List or Block Grid property of the open document, with its values, at a position or, in a Block Grid, in an area of another block. Does not save. The block is created as the editor creates one, with the property editors' default values, its settings and its expose entries, then values and settings are set on it. Returns the new block's key and the blocks.",
				annotations: { untrustedContentHint: true },
				inputSchema: {
					type: 'object',
					properties: {
						...PROPERTY_INPUT,
						blockType: {
							type: 'string',
							description: 'The block type name or element type key, from blockTypes in umbraco_list_blocks.',
						},
						...VALUES_INPUT,
						...TARGET_INPUT,
					},
					required: ['alias', 'blockType'],
				},
				execute: (
					input: UmbBlockPropertyInput &
						UmbBlockTargetInput & {
							blockType: string;
							values?: Record<string, unknown>;
							settings?: Record<string, unknown>;
						},
					call?: UmbWebMcpToolCall,
				) =>
					this.#withEditor(input, call?.signal, async (session) => {
						const { manager } = session;
						const area = this.#resolveArea(session, input);
						const parentKey = input.parentKey ?? null;
						const candidates = session.isGrid
							? allowedGridBlockTypes(this.#blockTypes(session), area)
							: this.#blockTypes(session);
						const where = area ? `in the "${area.alias}" area` : session.isGrid ? 'at the root' : 'here';
						const blockType = findBlockType(
							candidates,
							input.blockType,
							(x) => this.#nameOf(session, x.contentElementTypeKey) ?? undefined,
							where,
						);
						this.#checkRoom(session, parentKey, area);

						const created = await manager.createWithPresets(
							blockType.contentElementTypeKey,
							session.isGrid ? gridLayoutDefaults(blockType, this.#layoutColumns(session, area)) : {},
						);
						if (!created) throw new Error('The block could not be created.');
						let { content, settings } = created;
						if (input.values) {
							const updates = await this.#toValueEntries(session, content.contentTypeKey, input.values);
							content = { ...content, values: mergeValues(content.values, updates) };
						}
						if (input.settings) {
							if (!settings) throw new Error(`The ${input.blockType} block type has no settings.`);
							const updates = await this.#toValueEntries(session, settings.contentTypeKey, input.settings);
							settings = { ...settings, values: mergeValues(settings.values, updates) };
						}
						const key = created.layout.contentKey;
						manager.insert(created.layout, content, settings, {
							index: input.index ?? -1,
							parentUnique: parentKey,
							areaKey: area?.key ?? null,
						});
						// The manager exposes the block once it has checked the element type's variance and mandatory languages
						if (!(await waitUntil(() => manager.getExposes().some((x) => x.contentKey === key), call?.signal))) {
							throw new Error('The block was created but not exposed, so it was not added.');
						}
						await waitForQuiet(
							(onChange) => {
								const subscription = manager.exposes.subscribe(onChange);
								return () => subscription.unsubscribe();
							},
							100,
							2000,
							call?.signal,
						);
						await session.write();
						return { key, ...this.#describe(session) };
					}),
			},
			{
				name: 'umbraco_set_block_values',
				title: 'Set block values',
				description:
					'Sets values (and settings) of a block in a Block List or Block Grid property of the open document, by the block key from umbraco_list_blocks. Does not save. Properties not passed keep their values. Each value is in the stored format of its property editor, as for umbraco_set_document_property_value. Exposes the block in the culture passed, as saving it in the block editor does.',
				annotations: { untrustedContentHint: true },
				inputSchema: {
					type: 'object',
					properties: {
						...PROPERTY_INPUT,
						key: { type: 'string', description: 'The block key, from umbraco_list_blocks.' },
						...VALUES_INPUT,
					},
					required: ['alias', 'key'],
				},
				execute: (
					input: UmbBlockPropertyInput & {
						key: string;
						values?: Record<string, unknown>;
						settings?: Record<string, unknown>;
					},
					call?: UmbWebMcpToolCall,
				) =>
					this.#withEditor(input, call?.signal, async (session) => {
						const { manager } = session;
						if (!input.values && !input.settings) throw new Error('Pass values, settings or both.');
						const found = findBlock(manager.getLayouts(), input.key);
						const content = manager.getContentOf(input.key);
						if (!found || !content) throw new Error(`There is no block with key "${input.key}".`);
						if (input.values) {
							const updates = await this.#toValueEntries(session, content.contentTypeKey, input.values);
							manager.setOneContent({
								...content,
								values: mergeValues(content.values, updates),
							});
						}
						if (input.settings) {
							const settings = found.entry.settingsKey ? manager.getSettingsOf(found.entry.settingsKey) : undefined;
							if (!settings) throw new Error('This block has no settings.');
							const updates = await this.#toValueEntries(session, settings.contentTypeKey, input.settings);
							manager.setOneSettings({
								...settings,
								values: mergeValues(settings.values, updates),
							});
						}
						this.#expose(session, input.key, content.contentTypeKey);
						await session.write();
						return this.#describe(session);
					}),
			},
			{
				name: 'umbraco_remove_block',
				title: 'Remove block',
				description:
					'Removes a block, with any blocks in its areas, from a Block List or Block Grid property of the open document, as its Delete action does. Does not save. Returns the blocks that are left.',
				annotations: { untrustedContentHint: true },
				inputSchema: {
					type: 'object',
					properties: {
						...PROPERTY_INPUT,
						key: { type: 'string', description: 'The block key, from umbraco_list_blocks.' },
					},
					required: ['alias', 'key'],
				},
				execute: (input: UmbBlockPropertyInput & { key: string }, call?: UmbWebMcpToolCall) =>
					this.#withEditor(input, call?.signal, async (session) => {
						const { manager } = session;
						const { layouts, removed } = removeBlock(manager.getLayouts(), input.key);
						const blocks = blockAndDescendants(removed);
						manager.setLayouts(layouts);
						manager.removeManyContent(blocks.map((x) => x.contentKey));
						manager.removeManySettings(blocks.flatMap((x) => (x.settingsKey ? [x.settingsKey] : [])));
						for (const block of blocks) manager.removeExposesOf(block.contentKey);
						await session.write();
						return this.#describe(session);
					}),
			},
			{
				name: 'umbraco_move_block',
				title: 'Move block',
				description:
					'Moves a block to another position in a Block List or Block Grid property of the open document, or in a Block Grid into or out of an area of another block, as dragging it does. Does not save. index counts the blocks at the destination without the one being moved. Returns the blocks.',
				annotations: { untrustedContentHint: true },
				inputSchema: {
					type: 'object',
					properties: {
						...PROPERTY_INPUT,
						key: { type: 'string', description: 'The block key, from umbraco_list_blocks.' },
						...TARGET_INPUT,
					},
					required: ['alias', 'key'],
				},
				execute: (input: UmbBlockPropertyInput & UmbBlockTargetInput & { key: string }, call?: UmbWebMcpToolCall) =>
					this.#withEditor(input, call?.signal, async (session) => {
						const { manager } = session;
						const found = findBlock(manager.getLayouts(), input.key);
						if (!found) throw new Error(`There is no block with key "${input.key}".`);
						const parentKey = input.parentKey ?? null;
						if (parentKey && blockAndDescendants(found.entry).some((x) => x.contentKey === parentKey)) {
							throw new Error("A block can't be moved into its own areas.");
						}
						const area = this.#resolveArea(session, input);
						let entry = found.entry;
						if (session.isGrid) {
							const contentTypeKey = manager.getContentOf(input.key)?.contentTypeKey;
							const blockType = allowedGridBlockTypes(this.#blockTypes(session), area).find(
								(x) => x.contentElementTypeKey === contentTypeKey,
							);
							if (!blockType) {
								const name = this.#nameOf(session, contentTypeKey) ?? 'This';
								throw new Error(
									`${name} blocks are not allowed ${area ? `in the "${area.alias}" area` : 'at the root'}.`,
								);
							}
							// The grid fits a moved block's width to its new container
							const columnSpan = fitColumnSpan(blockType, entry.columnSpan, this.#layoutColumns(session, area));
							if (columnSpan !== entry.columnSpan) entry = { ...entry, columnSpan };
						}
						if (found.parentKey !== parentKey || found.areaKey !== (area?.key ?? null)) {
							this.#checkRoom(session, parentKey, area);
						}
						const { layouts } = removeBlock(manager.getLayouts(), input.key);
						manager.setLayouts(
							insertBlock(layouts, entry, { parentKey, areaKey: area?.key ?? null, index: input.index ?? -1 }),
						);
						await session.write();
						return this.#describe(session);
					}),
			},
		];
	}
}

export { UmbBlockWebMcpToolset as api };
