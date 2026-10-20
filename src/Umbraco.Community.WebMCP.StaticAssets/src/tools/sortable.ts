import { walk } from './modal-buttons.ts';

/** A row of an umb-table: its id is the item's unique, and its cells are in `data`, one per column. */
export interface UmbWebMcpTableItem {
	id: string;
	data: Array<{ columnAlias: string; value: unknown }>;
}

/** The parts of umb-table that a sort modal reads after a drag: its items, in their new order. */
export interface UmbWebMcpSortableTable extends HTMLElement {
	items: Array<UmbWebMcpTableItem>;
	sortable: boolean;
	columns: Array<{ alias: string }>;
}

export interface UmbWebMcpSortableItem {
	unique: string;
	name: string;
}

/**
 * The text of a table cell. The Sort children modal renders names as strings or as Lit templates such as
 * html`${name}`, so templates are flattened to their strings and values.
 */
export function cellText(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value !== 'object') return String(value);
	const { strings, values } = value as { strings?: ReadonlyArray<string>; values?: ReadonlyArray<unknown> };
	if (!Array.isArray(strings)) return '';
	return strings
		.map((text, i) => text + (i < (values?.length ?? 0) ? cellText(values![i]) : ''))
		.join('')
		.trim();
}

/**
 * Finds the sortable table an open modal renders, such as the one in Sort children, whose rows are dragged to reorder
 * them. Tables in modals opened on top are left out. Returns undefined when there is none, or it isn't sortable yet
 * because its items are still loading.
 */
export function findSortableTable(modalElement: Element): UmbWebMcpSortableTable | undefined {
	const isOtherModal = (element: Element) => element !== modalElement && (element as any).modalContext !== undefined;
	for (const element of walk(modalElement, isOtherModal)) {
		if (element.localName === 'umb-table' && (element as UmbWebMcpSortableTable).sortable) {
			return element as UmbWebMcpSortableTable;
		}
	}
	return undefined;
}

/** The table's items in their current order, named by their name column, or else their first column. */
export function getSortableItems(table: UmbWebMcpSortableTable): Array<UmbWebMcpSortableItem> {
	const nameAlias = table.columns.find((x) => x.alias === 'name')?.alias ?? table.columns[0]?.alias;
	return table.items.map((item) => ({
		unique: item.id,
		name: cellText(item.data.find((x) => x.columnAlias === nameAlias)?.value),
	}));
}

/**
 * Puts `items` in a new order. Each entry of `order` is an item's unique, or else its name, ignoring case. The items
 * listed come first, in that order, and the rest keep their order after them. Throws an error that lists the items to
 * choose from.
 */
export function orderItems<T extends UmbWebMcpSortableItem>(items: Array<T>, order: Array<string>): Array<T> {
	if (!order.length) throw new Error('Pass the items in their new order.');
	const shown = () => items.map((x) => `${x.name} (${x.unique})`).join(', ') || 'none';
	const listed: Array<T> = [];
	for (const entry of order) {
		let item = items.find((x) => x.unique === entry);
		if (!item) {
			const matches = items.filter((x) => x.name.toLowerCase() === entry.toLowerCase());
			if (matches.length > 1)
				throw new Error(`More than one item is named "${entry}": pass its unique. Shown: ${shown()}.`);
			item = matches[0];
		}
		if (!item) throw new Error(`No item "${entry}" is shown in the modal. Shown: ${shown()}.`);
		if (listed.includes(item)) throw new Error(`"${entry}" is listed more than once.`);
		listed.push(item);
	}
	return [...listed, ...items.filter((x) => !listed.includes(x))];
}

/**
 * Gives the table its items in the new order, as its sorter does after a drag, then sends one sorted event per item,
 * as the sorter does when a drag ends. The modal listens for these: it reads the table's items and records each item
 * as moved, so its Sort button saves the position of every item. `createSortedEvent` makes umb-table's own
 * UmbTableSortedEvent.
 */
export function applyOrder(
	table: UmbWebMcpSortableTable,
	uniques: Array<string>,
	createSortedEvent: (itemId: string) => Event,
) {
	const old = table.items;
	table.items = uniques.map((unique) => old.find((x) => x.id === unique)!);
	(table as any).requestUpdate?.('items', old);
	for (const unique of uniques) table.dispatchEvent(createSortedEvent(unique));
}
