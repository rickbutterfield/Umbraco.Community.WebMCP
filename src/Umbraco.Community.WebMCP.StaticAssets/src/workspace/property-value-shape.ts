/**
 * Describes the stored value of a property editor: its shape, an example and notes on the data type configuration, so
 * an agent can call `umbraco_set_document_property_value` without knowing each editor's format. The shapes follow the
 * backoffice's own value types (`UmbValueTypeMap` in @umbraco-cms/backoffice 18), keyed by property editor schema
 * alias. Editors it doesn't know are described from their current value instead.
 */

/** A property of a block's element type, with its data type resolved. */
export interface UmbWebMcpElementTypeProperty {
	alias: string;
	name: string;
	dataTypeKey: string;
	editorAlias: string | null;
	editorUiAlias: string | null;
	config: Record<string, unknown>;
	variesByCulture: boolean;
	variesBySegment: boolean;
}

export interface UmbWebMcpElementType {
	key: string;
	alias: string;
	name: string;
	variesByCulture: boolean;
	variesBySegment: boolean;
	properties: Array<UmbWebMcpElementTypeProperty>;
}

export interface UmbWebMcpValueShapeInput {
	editorAlias: string | null | undefined;
	editorUiAlias?: string | null;
	/** The data type configuration, by alias. */
	config: Record<string, unknown>;
	/** The property's current value, for editors this doesn't know. */
	value?: unknown;
	/** The element types the configured blocks use, by key, for block editors and rich text with blocks. */
	elementTypes?: Map<string, UmbWebMcpElementType>;
	/** The variant the value is for, so block examples expose their content in it. */
	culture?: string | null;
	segment?: string | null;
	/** Makes the new keys (GUIDs) that block examples need. */
	newKey?: () => string;
}

export interface UmbWebMcpValueShape {
	/** The stored value's type, written as TypeScript. */
	shape: string;
	example: unknown;
	notes: Array<string>;
	/** True when the editor is unknown and the shape comes from the current value. */
	inferred: boolean;
	/** Values a choice editor accepts, from its configuration. */
	allowedValues?: Array<unknown>;
}

type UmbWebMcpShapeContext = Required<Pick<UmbWebMcpValueShapeInput, 'config' | 'newKey'>> &
	Omit<UmbWebMcpValueShapeInput, 'config' | 'newKey'>;

type UmbWebMcpShapeDescriber = (context: UmbWebMcpShapeContext) => Omit<UmbWebMcpValueShape, 'inferred'>;

/** Converts a data type's configuration, a list of { alias, value }, to an object by alias. */
export function configToObject(values: Array<{ alias: string; value: unknown }> | undefined | null) {
	return Object.fromEntries((values ?? []).map(({ alias, value }) => [alias, value]));
}

/** The keys of the element types a block editor's configuration uses: each block's content and settings types. */
export function getBlockElementTypeKeys(config: Record<string, unknown>) {
	const keys = new Set<string>();
	for (const block of getBlocks(config)) {
		if (block.contentElementTypeKey) keys.add(block.contentElementTypeKey);
		if (block.settingsElementTypeKey) keys.add(block.settingsElementTypeKey);
	}
	return [...keys];
}

/**
 * Writes the type of a value as TypeScript, such as `Array<{ key: string; crops: Array<unknown> }>`, for editors this
 * doesn't know. Arrays are typed by their first item.
 */
export function inferShape(value: unknown, depth = 4): string {
	if (value === null || value === undefined) return 'null';
	if (Array.isArray(value)) return value.length ? `Array<${inferShape(value[0], depth - 1)}>` : 'Array<unknown>';
	if (typeof value !== 'object') return typeof value;
	if (depth <= 0) return 'object';
	const entries = Object.entries(value).map(([key, entry]) => `${quoteKey(key)}: ${inferShape(entry, depth - 1)}`);
	return entries.length ? `{ ${entries.join('; ')} }` : 'object';
}

const quoteKey = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key));

/**
 * Describes the stored value for a property editor. Known editors get their shape from the backoffice's value types,
 * with an example built from the data type configuration (allowed items, block types); unknown editors are described
 * from the current value, with `inferred` set.
 */
export function describeValueShape(input: UmbWebMcpValueShapeInput): UmbWebMcpValueShape {
	const context: UmbWebMcpShapeContext = { ...input, config: input.config ?? {}, newKey: input.newKey ?? newGuid };
	const describe = input.editorAlias ? DESCRIBERS[input.editorAlias] : undefined;
	if (describe) return { ...describe(context), inferred: false };

	const hasValue = input.value !== undefined && input.value !== null && input.value !== '';
	return {
		shape: hasValue ? inferShape(input.value) : 'unknown',
		example: hasValue ? input.value : null,
		notes: [
			hasValue
				? `The shape of ${input.editorAlias ?? 'this editor'} is not known, so it is inferred from the current value, which is the example. Keep its structure.`
				: `The shape of ${input.editorAlias ?? 'this editor'} is not known and the property has no value to infer it from. Set a value in the backoffice once, then ask again.`,
		],
		inferred: true,
	};
}

const newGuid = () => crypto.randomUUID();

// Shared parts of the shapes

const BLOCK_DATA_SHAPE =
	'{ key: string; contentTypeKey: string; values: Array<{ alias: string; editorAlias: string; culture: string | null; segment: string | null; value: unknown }> }';
const BLOCK_EXPOSE_SHAPE = '{ contentKey: string; culture: string | null; segment: string | null }';
const blockValueShape = (layoutAlias: string, layoutEntry: string) =>
	`{ layout: { "${layoutAlias}": Array<${layoutEntry}> }; contentData: Array<${BLOCK_DATA_SHAPE}>; settingsData: Array<${BLOCK_DATA_SHAPE}>; expose: Array<${BLOCK_EXPOSE_SHAPE}> }`;

const BLOCK_NOTES = [
	'Each layout entry points to a contentData item by contentKey, and to a settingsData item by settingsKey when the block type has settings. Use a new GUID for each key.',
	"contentTypeKey is the block type's contentElementTypeKey (settingsElementTypeKey for settings). values holds one entry per element type property, with the property's editorAlias, each value in that editor's stored format: pass a property's dataTypeKey to this tool to get it.",
	'Add an expose entry for each block content, in each variant it appears in; culture and segment are null unless the element type varies by them. Blocks without one are left out of the published content.',
];

interface UmbWebMcpBlockConfig {
	contentElementTypeKey?: string;
	settingsElementTypeKey?: string | null;
	label?: string;
	allowAtRoot?: boolean;
	columnSpanOptions?: Array<{ columnSpan: number }>;
	areas?: Array<{ key: string; alias: string }>;
}

function getBlocks(config: Record<string, unknown>): Array<UmbWebMcpBlockConfig> {
	return Array.isArray(config.blocks) ? (config.blocks as Array<UmbWebMcpBlockConfig>) : [];
}

/** Notes for a { min, max } validation limit, as block editors and the media picker configure it. */
function limitNotes(limit: unknown, items = 'items') {
	const { min, max } = (limit ?? {}) as { min?: number | null; max?: number | null };
	const notes: Array<string> = [];
	if (typeof min === 'number' && min > 0) notes.push(`Minimum ${items}: ${min}.`);
	if (typeof max === 'number' && max > 0) notes.push(`Maximum ${items}: ${max}.`);
	return notes;
}

/** Notes for numeric minimum and maximum settings, such as minNumber and maxNumber. */
function minMaxNotes(min: unknown, max: unknown, items = 'items') {
	return limitNotes({ min: Number(min) || null, max: Number(max) || null }, items);
}

/**
 * An example block value with one block of the first configured type that has a known element type, with a values
 * entry per property of the element type. Without element types, as for a block editor inside a block, it is empty.
 */
function blockExample(
	context: UmbWebMcpShapeContext,
	layoutAlias: string,
	layoutExtra: (block: UmbWebMcpBlockConfig) => Record<string, unknown> = () => ({}),
) {
	const blocks = getBlocks(context.config);
	const block =
		blocks.find((x) => x.contentElementTypeKey && context.elementTypes?.has(x.contentElementTypeKey)) ?? blocks[0];
	if (!context.elementTypes || !block?.contentElementTypeKey) {
		return { layout: { [layoutAlias]: [] }, contentData: [], settingsData: [], expose: [] };
	}

	const blockData = (elementTypeKey: string) => {
		const elementType = context.elementTypes?.get(elementTypeKey);
		return {
			key: context.newKey(),
			contentTypeKey: elementTypeKey,
			values:
				elementType?.properties.map((property) => ({
					alias: property.alias,
					editorAlias: property.editorAlias,
					culture: property.variesByCulture ? (context.culture ?? null) : null,
					segment: property.variesBySegment ? (context.segment ?? null) : null,
					value: describeValueShape({
						editorAlias: property.editorAlias,
						editorUiAlias: property.editorUiAlias,
						config: property.config,
						newKey: context.newKey,
					}).example,
				})) ?? [],
		};
	};

	const content = blockData(block.contentElementTypeKey);
	const settings = block.settingsElementTypeKey ? blockData(block.settingsElementTypeKey) : undefined;
	const elementType = context.elementTypes?.get(block.contentElementTypeKey);
	return {
		layout: {
			[layoutAlias]: [
				{ contentKey: content.key, ...(settings ? { settingsKey: settings.key } : {}), ...layoutExtra(block) },
			],
		},
		contentData: [content],
		settingsData: settings ? [settings] : [],
		expose: [
			{
				contentKey: content.key,
				culture: elementType?.variesByCulture ? (context.culture ?? null) : null,
				segment: elementType?.variesBySegment ? (context.segment ?? null) : null,
			},
		],
	};
}

/** Allowed values of a dropdown, checkbox list or radio button list: its items, as strings or { name, value }. */
function choiceValues(config: Record<string, unknown>): Array<string> {
	const items = Array.isArray(config.items) ? config.items : [];
	return items.map((item) => (typeof item === 'string' ? item : String((item as { value?: unknown })?.value ?? '')));
}

const textDescriber: UmbWebMcpShapeDescriber = ({ config }) => ({
	shape: 'string',
	example: 'Some text',
	notes: Number(config.maxChars) > 0 ? [`At most ${config.maxChars} characters.`] : [],
});

const dateTimeDescriber =
	(example: string, note: string): UmbWebMcpShapeDescriber =>
	() => ({
		shape: '{ date: string; timeZone: null }',
		example: { date: example, timeZone: null },
		notes: [note],
	});

const DESCRIBERS: Record<string, UmbWebMcpShapeDescriber> = {
	'Umbraco.TextBox': textDescriber,
	'Umbraco.TextArea': textDescriber,
	'Umbraco.EmailAddress': () => ({ shape: 'string', example: 'name@example.com', notes: [] }),
	'Umbraco.MarkdownEditor': () => ({ shape: 'string', example: '# Heading\n\nSome **Markdown**.', notes: [] }),

	'Umbraco.RichText': ({ config }) => {
		const hasBlocks = getBlocks(config).length > 0;
		return {
			shape: `{ markup: string; blocks?: ${blockValueShape('Umbraco.RichText', '{ contentKey: string; settingsKey?: string | null }')} }`,
			example: {
				markup: '<p>Some <strong>rich</strong> text.</p>',
				blocks: { layout: {}, contentData: [], settingsData: [], expose: [] },
			},
			notes: [
				'markup is HTML.',
				...(hasBlocks
					? [
							'To add a block, put <umb-rte-block data-content-key="{contentKey}"><!--Umbraco-Block--></umb-rte-block> in markup (umb-rte-block-inline for inline blocks), and its data in blocks under layout "Umbraco.RichText". Blocks not in markup are dropped.',
							...BLOCK_NOTES.slice(1),
						]
					: []),
			],
		};
	},

	'Umbraco.MediaPicker3': ({ config, newKey }) => {
		const notes = [
			"Each entry has a new GUID as key and the media item's key as mediaKey (find it with umbraco_search_entities or umbraco_get_tree_items). mediaTypeAlias can be empty, as the backoffice sends it.",
			...limitNotes(config.validationLimit),
		];
		if (!config.multiple) notes.push('Holds one item: multiple is off.');
		if (config.filter) notes.push(`Only media of these media types (keys): ${config.filter}.`);
		return {
			shape:
				'Array<{ key: string; mediaKey: string; mediaTypeAlias: string; focalPoint: { left: number; top: number } | null; crops: Array<{ alias: string; width: number; height: number; coordinates?: { x1: number; x2: number; y1: number; y2: number } }> }>',
			example: [{ key: newKey(), mediaKey: '<media key>', mediaTypeAlias: '', focalPoint: null, crops: [] }],
			notes,
		};
	},

	'Umbraco.ContentPicker': () => ({
		shape: 'string',
		example: '<document key>',
		notes: ["The picked document's key (a GUID), from umbraco_search_entities or umbraco_get_tree_items."],
	}),

	'Umbraco.MultiNodeTreePicker': ({ config }) => {
		const startNode = (config.startNode ?? {}) as { type?: string; id?: string };
		const type = { media: 'media', member: 'member' }[startNode.type ?? ''] ?? 'document';
		const notes = [
			`type is "${type}" for this data type, and unique is the picked item's key.`,
			...minMaxNotes(config.minNumber, config.maxNumber),
		];
		if (startNode.id) notes.push(`Items come from under the ${type} with key ${startNode.id}.`);
		if (config.filter) notes.push(`Only items of these types (keys): ${config.filter}.`);
		return {
			shape: 'Array<{ type: "document" | "media" | "member"; unique: string }>',
			example: [{ type, unique: `<${type} key>` }],
			notes,
		};
	},

	'Umbraco.MultiUrlPicker': ({ config }) => ({
		shape:
			'Array<{ name?: string | null; type: "document" | "media" | "external"; unique?: string | null; url?: string | null; queryString?: string | null; target?: string | null }>',
		example: [
			{
				name: 'Umbraco',
				type: 'external',
				unique: null,
				url: 'https://umbraco.com',
				queryString: null,
				target: '_blank',
			},
			{ name: 'About us', type: 'document', unique: '<document key>', url: null, queryString: null, target: null },
		],
		notes: [
			'External links set url; document and media links set unique to the item\'s key. queryString starts with ? or #. target is "_blank" to open in a new window.',
			...minMaxNotes(config.minNumber, config.maxNumber, 'links'),
		],
	}),

	'Umbraco.BlockList': (context) => ({
		shape: blockValueShape('Umbraco.BlockList', '{ contentKey: string; settingsKey?: string | null }'),
		example: blockExample(context, 'Umbraco.BlockList'),
		notes: [...BLOCK_NOTES, ...limitNotes(context.config.validationLimit, 'blocks')],
	}),

	'Umbraco.BlockGrid': (context) => {
		const columns = Number(context.config.gridColumns) || 12;
		return {
			shape: blockValueShape(
				'Umbraco.BlockGrid',
				'{ contentKey: string; settingsKey?: string | null; columnSpan: number; rowSpan: number; areas: Array<{ key: string; items: Array<LayoutEntry> }> }',
			),
			example: blockExample(context, 'Umbraco.BlockGrid', (block) => ({
				columnSpan: columns,
				rowSpan: 1,
				areas: (block.areas ?? []).map((area) => ({ key: area.key, items: [] })),
			})),
			notes: [
				...BLOCK_NOTES,
				`The grid has ${columns} columns. columnSpan is ${columns} for full width, or one of the block type's columnSpanOptions.`,
				"Blocks inside a block go in its areas: key is an area key from the block type's areas, and items are layout entries like the root ones. Only block types with allowAtRoot go at the root.",
				...limitNotes(context.config.validationLimit, 'blocks'),
			],
		};
	},

	'Umbraco.SingleBlock': (context) => ({
		shape: blockValueShape('Umbraco.SingleBlock', '{ contentKey: string; settingsKey?: string | null }'),
		example: blockExample(context, 'Umbraco.SingleBlock'),
		notes: [...BLOCK_NOTES, 'Holds one block.'],
	}),

	'Umbraco.Tags': ({ config }) => ({
		shape: 'Array<string>',
		example: ['news', 'umbraco'],
		notes: [
			`An array of tags, whatever the storage type (${config.storageType ?? 'Json'}).`,
			...(config.group ? [`Tags are in the "${config.group}" group.`] : []),
		],
	}),

	'Umbraco.DropDown.Flexible': ({ config }) => {
		const allowed = choiceValues(config);
		return {
			shape: 'Array<string>',
			example: allowed.slice(0, 1),
			notes: [
				config.multiple ? 'One or more of allowedValues.' : 'An array with one of allowedValues: multiple is off.',
			],
			allowedValues: allowed,
		};
	},

	'Umbraco.CheckBoxList': ({ config }) => {
		const allowed = choiceValues(config);
		return {
			shape: 'Array<string>',
			example: allowed.slice(0, 1),
			notes: ['Any of allowedValues.'],
			allowedValues: allowed,
		};
	},

	'Umbraco.RadioButtonList': ({ config }) => {
		const allowed = choiceValues(config);
		return { shape: 'string', example: allowed[0] ?? '', notes: ['One of allowedValues.'], allowedValues: allowed };
	},

	'Umbraco.TrueFalse': () => ({ shape: 'boolean', example: true, notes: [] }),

	'Umbraco.Integer': ({ config }) => ({
		shape: 'number',
		example: Number(config.min) || 1,
		notes: ['A whole number.', ...numberRangeNotes(config)],
	}),

	'Umbraco.Decimal': ({ config }) => ({
		shape: 'number',
		example: Number(config.min) || 1.5,
		notes: numberRangeNotes(config),
	}),

	'Umbraco.Slider': ({ config }) => ({
		shape: '{ from: number; to: number }',
		example: {
			from: Number(config.minVal) || 0,
			to: config.enableRange ? Number(config.maxVal) || 100 : Number(config.minVal) || 0,
		},
		notes: [config.enableRange ? 'A range from from to to.' : 'from and to are the same: enableRange is off.'],
	}),

	'Umbraco.DateTime': ({ config }) => {
		const format = String(config.format ?? 'YYYY-MM-DD HH:mm:ss');
		const hasDate = /[YD]/.test(format);
		const hasTime = /[Hhms]/.test(format);
		const example = !hasDate ? '0001-01-01 14:30:00' : hasTime ? '2026-01-31 14:30:00' : '2026-01-31 00:00:00';
		return {
			shape: 'string',
			example,
			notes: [
				'"YYYY-MM-DD HH:mm:ss", whatever the display format. A date without a time uses 00:00:00; a time without a date uses 0001-01-01.',
			],
		};
	},

	'Umbraco.DateOnly': dateTimeDescriber('2026-01-31', 'date is "yyyy-MM-dd".'),
	'Umbraco.TimeOnly': dateTimeDescriber('14:30:00', 'date holds the time, "HH:mm:ss".'),
	'Umbraco.DateTimeUnspecified': dateTimeDescriber(
		'2026-01-31T14:30:00',
		'date is "yyyy-MM-ddTHH:mm:ss", with no offset.',
	),

	'Umbraco.DateTimeWithTimeZone': ({ config }) => {
		const timeZones = (config.timeZones ?? {}) as { mode?: string; timeZones?: Array<string> };
		const timeZone = timeZones.mode === 'local' ? 'UTC' : (timeZones.timeZones?.[0] ?? 'Europe/Copenhagen');
		return {
			shape: '{ date: string; timeZone: string }',
			example: { date: '2026-01-31T14:30:00+01:00', timeZone },
			notes: [
				'date is "yyyy-MM-ddTHH:mm:ss" with the offset of timeZone; timeZone is an IANA time zone.',
				timeZones.mode === 'custom' && timeZones.timeZones?.length
					? `timeZone is one of: ${timeZones.timeZones.join(', ')}.`
					: timeZones.mode === 'local'
						? 'The time zone mode is local, so timeZone is "UTC" and date is in UTC.'
						: 'Any time zone is allowed.',
			],
		};
	},

	'Umbraco.ColorPicker': ({ config }) => {
		const items = (Array.isArray(config.items) ? config.items : []) as Array<{ value?: string; label?: string }>;
		const allowed = items.map(({ value = '', label }) => ({
			label: label ?? value,
			value: /^(?:[0-9a-f]{3}){1,2}$/i.test(value) ? `#${value}` : value,
		}));
		return {
			shape: '{ label: string; value: string }',
			example: allowed[0] ?? { label: 'Red', value: '#ff0000' },
			notes: ['One of allowedValues, with label and value as they are there. Hex values start with #.'],
			allowedValues: allowed,
		};
	},

	'Umbraco.ColorPicker.EyeDropper': () => ({
		shape: 'string',
		example: '#ff0000',
		notes: ['A CSS color, such as a hex value or rgba(...).'],
	}),

	'Umbraco.MultipleTextstring': ({ config }) => ({
		shape: 'Array<string>',
		example: ['First', 'Second'],
		notes: minMaxNotes(config.min, config.max),
	}),

	'Umbraco.UploadField': ({ config }) => ({
		shape: '{ src: string; temporaryFileId?: string | null }',
		example: null,
		notes: [
			'A new file needs a temporaryFileId from a temporary file upload, which these tools cannot make; src is the path of the current file. Set null to remove the file.',
			...(Array.isArray(config.fileExtensions) && config.fileExtensions.length
				? [`Allowed file extensions: ${config.fileExtensions.join(', ')}.`]
				: []),
		],
	}),
};

function numberRangeNotes(config: Record<string, unknown>) {
	const notes: Array<string> = [];
	if (config.min !== undefined && config.min !== null && config.min !== '') notes.push(`At least ${config.min}.`);
	if (config.max !== undefined && config.max !== null && config.max !== '') notes.push(`At most ${config.max}.`);
	if (Number(config.step) > 0) notes.push(`In steps of ${config.step}.`);
	return notes;
}
