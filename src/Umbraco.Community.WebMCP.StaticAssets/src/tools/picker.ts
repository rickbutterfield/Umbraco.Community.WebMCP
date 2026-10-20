import { walk } from './modal-buttons.ts';

/** The selection manager a tree's context holds, which a click on a tree item goes through. */
export interface UmbWebMcpTreeSelection {
	getSelection(): Array<string | null>;
	getMultiple(): boolean;
	getSelectable(): boolean;
	select(unique: string | null): void;
	deselect(unique: string | null): void;
}

export interface UmbWebMcpTreeContext {
	selection: UmbWebMcpTreeSelection;
	selectableFilter?: (item: any) => boolean;
}

export interface UmbWebMcpPickerItem {
	name: string;
	unique: string | null;
	entityType: string;
	/** False when the picker's filter rejects the item, such as a form when only folders can be picked. */
	pickable: boolean;
}

export interface UmbWebMcpPicker {
	tree: UmbWebMcpTreeContext;
	/** The tree items the picker has rendered: the root items, and the children of expanded items. */
	items: Array<UmbWebMcpPickerItem>;
}

/**
 * Finds the tree a picker modal renders, through the tree items in it: each one's api holds the tree context. Pickers
 * that aren't trees, such as the media picker, return undefined. Trees in modals opened on top are left out. Names such
 * as the root's "#treeHeaders_content" are passed through `localize`.
 */
export function findPicker(
	modalElement: Element,
	localize: (text: string) => string = (text) => text,
): UmbWebMcpPicker | undefined {
	const isOtherModal = (element: Element) => element !== modalElement && (element as any).modalContext !== undefined;
	let tree: UmbWebMcpTreeContext | undefined;
	const items: Array<UmbWebMcpPickerItem> = [];
	for (const element of walk(modalElement, isOtherModal)) {
		const { item, api } = element as any;
		const context = api?.treeContext as UmbWebMcpTreeContext | undefined;
		if (!item || !context?.selection) continue;
		tree ??= context;
		if (context !== tree || items.some((x) => x.unique === item.unique)) continue;
		items.push({
			name: localize(item.name ?? ''),
			unique: item.unique ?? null,
			entityType: item.entityType,
			pickable: tree.selectableFilter ? tree.selectableFilter(item) !== false : true,
		});
	}
	return tree ? { tree, items } : undefined;
}

/**
 * Finds the item to pick by its unique (null for the root), or else by its name, ignoring case, among the items the
 * picker has rendered. Throws an error that lists the names to choose from.
 */
export function findPickerItem(
	items: Array<UmbWebMcpPickerItem>,
	{ unique, name }: { unique?: string | null; name?: string },
): UmbWebMcpPickerItem | { unique: string | null } {
	const shown = () => items.map((x) => `${x.name} (${x.unique ?? 'null'})`).join(', ') || 'none';
	if (unique !== undefined) {
		// An item inside a collapsed folder isn't rendered, but can still be selected by its unique
		return items.find((x) => x.unique === unique) ?? { unique };
	}
	if (!name) throw new Error('Pass the unique or the name of the item to pick.');
	const matches = items.filter((x) => x.name.toLowerCase() === name.toLowerCase());
	if (matches.length === 1) return matches[0];
	if (matches.length > 1) throw new Error(`More than one item is named "${name}": pass its unique. Shown: ${shown()}.`);
	throw new Error(
		`No item named "${name}" is shown in the picker. Pass its unique if it is inside a collapsed folder. Shown: ${shown()}.`,
	);
}
