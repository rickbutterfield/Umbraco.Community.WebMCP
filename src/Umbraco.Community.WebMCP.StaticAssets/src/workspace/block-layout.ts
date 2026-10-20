// Pure functions over the layout of a Block List or Block Grid value. A Block List layout is a flat list of entries; a
// Block Grid entry can hold areas, each with its own list of entries. The backoffice keeps these arrays frozen, so every
// function returns new arrays and objects and leaves its input alone.

/** The property editor schema aliases of Block List and Block Grid. */
export const BLOCK_EDITOR_ALIASES = ['Umbraco.BlockList', 'Umbraco.BlockGrid'];

/** Whether any of these property editor schema aliases is Block List or Block Grid. */
export function hasBlockEditor(editorAliases: ReadonlyArray<string | null | undefined>) {
	return editorAliases.some((alias) => BLOCK_EDITOR_ALIASES.includes(alias ?? ''));
}

export interface UmbBlockLayoutArea {
	key: string;
	items: Array<UmbBlockLayoutEntry>;
}

export interface UmbBlockLayoutEntry {
	contentKey: string;
	settingsKey?: string | null;
	columnSpan?: number;
	rowSpan?: number;
	areas?: Array<UmbBlockLayoutArea>;
	[key: string]: unknown;
}

/** Where a block sits: at the root (parentKey and areaKey null) or in an area of a Block Grid block. */
export interface UmbBlockPosition {
	parentKey: string | null;
	areaKey: string | null;
	index: number;
}

export interface UmbBlockValueEntry {
	alias: string;
	culture: string | null;
	segment: string | null;
	value?: unknown;
}

/** The parts of a Block Grid block type these functions read. */
export interface UmbBlockGridTypeLike {
	contentElementTypeKey: string;
	groupKey?: string | null;
	allowAtRoot?: boolean;
	allowInAreas?: boolean;
	columnSpanOptions?: Array<{ columnSpan: number }>;
	rowMinSpan?: number;
	rowMaxSpan?: number;
	areas?: Array<UmbBlockGridAreaTypeLike>;
}

export interface UmbBlockGridAreaTypeLike {
	key: string;
	alias: string;
	columnSpan?: number;
	maxAllowed?: number;
	specifiedAllowance?: Array<{ elementTypeKey?: string; groupKey?: string }>;
}

/** Finds a block anywhere in the layout, with where it sits. */
export function findBlock(
	layouts: ReadonlyArray<UmbBlockLayoutEntry>,
	contentKey: string,
	parentKey: string | null = null,
	areaKey: string | null = null,
): (UmbBlockPosition & { entry: UmbBlockLayoutEntry }) | undefined {
	for (const [index, entry] of layouts.entries()) {
		if (entry.contentKey === contentKey) return { entry, parentKey, areaKey, index };
		for (const area of entry.areas ?? []) {
			const found = findBlock(area.items, contentKey, entry.contentKey, area.key);
			if (found) return found;
		}
	}
	return undefined;
}

/** The entry and every entry nested in its areas, depth first. */
export function blockAndDescendants(entry: UmbBlockLayoutEntry): Array<UmbBlockLayoutEntry> {
	return [entry, ...(entry.areas ?? []).flatMap((area) => area.items.flatMap(blockAndDescendants))];
}

/** The entries of one container: the root, or one area of a block. Undefined when the parent block doesn't exist. */
export function entriesAt(
	layouts: ReadonlyArray<UmbBlockLayoutEntry>,
	parentKey: string | null,
	areaKey: string | null,
): ReadonlyArray<UmbBlockLayoutEntry> | undefined {
	if (parentKey === null) return layouts;
	const parent = findBlock(layouts, parentKey)?.entry;
	if (!parent) return undefined;
	return parent.areas?.find((area) => area.key === areaKey)?.items ?? [];
}

/** Removes a block, with everything in its areas. Throws when it isn't in the layout. */
export function removeBlock(layouts: ReadonlyArray<UmbBlockLayoutEntry>, contentKey: string) {
	let removed: UmbBlockLayoutEntry | undefined;
	const without = (entries: ReadonlyArray<UmbBlockLayoutEntry>): Array<UmbBlockLayoutEntry> =>
		entries
			.filter((entry) => {
				if (entry.contentKey !== contentKey) return true;
				removed = entry;
				return false;
			})
			.map((entry) =>
				entry.areas ? { ...entry, areas: entry.areas.map((area) => ({ ...area, items: without(area.items) })) } : entry,
			);
	const result = without(layouts);
	if (!removed) throw new Error(`There is no block with key "${contentKey}".`);
	return { layouts: result, removed };
}

/**
 * Inserts an entry at a position: at the root, or in an area of a block, creating the area's entry if the block has
 * none yet (the backoffice creates it when the area is first shown). An index below 0 or past the end appends.
 */
export function insertBlock(
	layouts: ReadonlyArray<UmbBlockLayoutEntry>,
	entry: UmbBlockLayoutEntry,
	{ parentKey, areaKey, index }: UmbBlockPosition,
): Array<UmbBlockLayoutEntry> {
	const insertAt = (entries: ReadonlyArray<UmbBlockLayoutEntry>) => {
		const result = [...entries];
		result.splice(index < 0 || index > result.length ? result.length : index, 0, entry);
		return result;
	};
	if (parentKey === null) return insertAt(layouts);
	if (areaKey === null) throw new Error('Pass the area to put the block in.');

	let found = false;
	const into = (entries: ReadonlyArray<UmbBlockLayoutEntry>): Array<UmbBlockLayoutEntry> =>
		entries.map((current) => {
			if (current.contentKey === parentKey) {
				found = true;
				const areas = current.areas ?? [];
				const area = areas.find((x) => x.key === areaKey);
				return {
					...current,
					areas: area
						? areas.map((x) => (x === area ? { ...x, items: insertAt(x.items) } : x))
						: [...areas, { key: areaKey, items: insertAt([]) }],
				};
			}
			return current.areas
				? { ...current, areas: current.areas.map((area) => ({ ...area, items: into(area.items) })) }
				: current;
		});
	const result = into(layouts);
	if (!found) throw new Error(`There is no block with key "${parentKey}" to put the block in.`);
	return result;
}

/**
 * The value of each property for a variant, by alias: an exact culture and segment match first, then the culture
 * without a segment, then the invariant value.
 */
export function valuesForVariant(
	values: ReadonlyArray<UmbBlockValueEntry>,
	culture: string | null,
	segment: string | null,
): Record<string, unknown> {
	const rank = (entry: UmbBlockValueEntry) => {
		if (entry.culture === culture && entry.segment === segment) return 3;
		if (entry.culture === culture && entry.segment === null) return 2;
		if (entry.culture === null && entry.segment === null) return 1;
		return 0;
	};
	const best = new Map<string, UmbBlockValueEntry>();
	for (const entry of values) {
		const current = best.get(entry.alias);
		if (rank(entry) > 0 && (!current || rank(entry) > rank(current))) best.set(entry.alias, entry);
	}
	return Object.fromEntries([...best].map(([alias, entry]) => [alias, entry.value]));
}

/** Sets values, replacing the entry with the same alias, culture and segment, or adding one. */
export function mergeValues<T extends UmbBlockValueEntry>(
	values: ReadonlyArray<T>,
	updates: ReadonlyArray<T>,
): Array<T> {
	const same = (a: T, b: T) => a.alias === b.alias && a.culture === b.culture && a.segment === b.segment;
	const result = values.map((entry) => {
		const update = updates.find((x) => same(x, entry));
		return update ? { ...entry, ...update } : entry;
	});
	return [...result, ...updates.filter((update) => !values.some((entry) => same(entry, update)))];
}

/** Finds a block type by its element type key or its name, ignoring case. Throws with the names there are. */
export function findBlockType<T extends { contentElementTypeKey: string }>(
	blockTypes: ReadonlyArray<T>,
	wanted: string,
	nameOf: (blockType: T) => string | undefined,
	where = 'here',
): T {
	const lower = wanted.trim().toLowerCase();
	const found =
		blockTypes.find((x) => x.contentElementTypeKey === wanted) ??
		blockTypes.find((x) => nameOf(x)?.toLowerCase() === lower);
	if (found) return found;
	const available = blockTypes.map((x) => nameOf(x) ?? x.contentElementTypeKey).join(', ') || 'none';
	throw new Error(`"${wanted}" is not a block type you can add ${where}. Block types: ${available}.`);
}

/**
 * The block types allowed in an area, or at the root when there's no area, as the Block Grid's create dialog offers
 * them: an area's specified allowance by element type or group, else every type allowed in areas.
 */
export function allowedGridBlockTypes<T extends UmbBlockGridTypeLike>(
	blockTypes: ReadonlyArray<T>,
	area: UmbBlockGridAreaTypeLike | null,
): Array<T> {
	if (!area) return blockTypes.filter((x) => x.allowAtRoot);
	if (!area.specifiedAllowance?.length) return blockTypes.filter((x) => x.allowInAreas);
	return blockTypes.filter((x) =>
		area.specifiedAllowance!.some(
			(rule) =>
				(rule.groupKey && x.groupKey === rule.groupKey) ||
				(rule.elementTypeKey && x.contentElementTypeKey === rule.elementTypeKey),
		),
	);
}

/** The column span option closest to the target, at most `max`, as the Block Grid picks one. */
function closestColumnSpan(target: number, options: Array<number>, max: number) {
	if (!options.length) return undefined;
	return options.reduce((a, b) => {
		if (a > max) return b;
		const aDiff = Math.abs(a - target);
		const bDiff = Math.abs(b - target);
		if (aDiff === bDiff) return a < b ? a : b;
		return bDiff < aDiff ? b : a;
	});
}

/**
 * The column span a Block Grid block gets in a container `layoutColumns` wide, as the grid corrects it once the block
 * is shown: the column span option nearest to `columnSpan` that fits, or the full width when the type has none.
 */
export function fitColumnSpan(blockType: UmbBlockGridTypeLike, columnSpan: number | undefined, layoutColumns: number) {
	const options = (blockType.columnSpanOptions ?? [])
		.map((x) => x.columnSpan)
		.filter((x) => x <= layoutColumns)
		.sort((a, b) => a - b);
	if (!options.length) return layoutColumns;
	return closestColumnSpan(columnSpan ?? layoutColumns, options, layoutColumns) ?? layoutColumns;
}

/**
 * The size and areas a new Block Grid block gets, as the grid sets them once the block is shown: the full width of
 * its container (or the nearest column span option), the smallest row span allowed and an empty entry per area.
 */
export function gridLayoutDefaults(blockType: UmbBlockGridTypeLike, layoutColumns: number) {
	const rowMin = blockType.rowMinSpan ?? 1;
	const rowMax = blockType.rowMaxSpan ?? 1;
	return {
		columnSpan: fitColumnSpan(blockType, undefined, layoutColumns),
		rowSpan: Math.max(rowMin, Math.min(1, rowMax)),
		areas: (blockType.areas ?? []).map((area) => ({ key: area.key, items: [] as Array<UmbBlockLayoutEntry> })),
	};
}
