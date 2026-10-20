import { expect, fixture, html } from '@open-wc/testing';
import {
	applyOrder,
	cellText,
	findSortableTable,
	getSortableItems,
	orderItems,
	type UmbWebMcpSortableTable,
} from './sortable.js';

const row = (id: string, name: unknown) => ({ id, data: [{ columnAlias: 'name', value: name }] });

/** Renders a modal element with an umb-table in it that carries items, columns and sortable, as umb-table does. */
async function renderSortModal(items: Array<any>, sortable = true) {
	const modal = await fixture(html`<div><umb-table></umb-table></div>`);
	(modal as any).modalContext = { key: 'sort' };
	const table = modal.querySelector('umb-table')!;
	Object.assign(table, { items, sortable, columns: [{ alias: 'name' }, { alias: 'createDate' }] });
	return { modal, table: table as unknown as UmbWebMcpSortableTable };
}

describe('sortable', () => {
	const items = [
		{ unique: 'a', name: 'Alpha' },
		{ unique: 'b', name: 'Bravo' },
		{ unique: 'c', name: 'Charlie' },
	];

	it('reads the text of plain and template cells', () => {
		expect(cellText('Alpha')).to.equal('Alpha');
		expect(cellText(html`${'Bravo'}`)).to.equal('Bravo');
		expect(cellText(html`<b>${'Charlie'}</b>`)).to.equal('<b>Charlie</b>');
		expect(cellText(undefined)).to.equal('');
	});

	it("finds the modal's sortable table and its items in order", async () => {
		const { modal, table } = await renderSortModal([row('a', 'Alpha'), row('b', html`${'Bravo'}`)]);

		expect(findSortableTable(modal)).to.equal(table);
		expect(getSortableItems(table)).to.deep.equal([
			{ unique: 'a', name: 'Alpha' },
			{ unique: 'b', name: 'Bravo' },
		]);
	});

	it('ignores a table that is not sortable yet', async () => {
		const { modal } = await renderSortModal([], false);

		expect(findSortableTable(modal)).to.equal(undefined);
	});

	it('leaves out the table of a modal opened on top', async () => {
		const modal = await fixture(html`<div><div class="inner"><umb-table></umb-table></div></div>`);
		(modal as any).modalContext = { key: 'outer' };
		const inner = modal.querySelector('.inner')!;
		(inner as any).modalContext = { key: 'inner' };
		Object.assign(modal.querySelector('umb-table')!, { sortable: true, items: [], columns: [] });

		expect(findSortableTable(modal)).to.equal(undefined);
	});

	it('orders by unique or name, ignoring case, and keeps the rest after the listed items', () => {
		expect(orderItems(items, ['c', 'alpha']).map((x) => x.name)).to.deep.equal(['Charlie', 'Alpha', 'Bravo']);
	});

	it('refuses an item it does not show, listing the ones it does', () => {
		expect(() => orderItems(items, ['Delta'])).to.throw('Shown: Alpha (a), Bravo (b), Charlie (c)');
	});

	it('refuses an item listed twice', () => {
		expect(() => orderItems(items, ['Alpha', 'a'])).to.throw('listed more than once');
	});

	it('asks for the unique when names repeat', () => {
		expect(() => orderItems([...items, { unique: 'd', name: 'alpha' }], ['Alpha'])).to.throw('pass its unique');
	});

	it('refuses an empty order', () => {
		expect(() => orderItems(items, [])).to.throw('new order');
	});

	it('gives the table its new order, then sends a sorted event for each item', async () => {
		const { table } = await renderSortModal([row('a', 'Alpha'), row('b', 'Bravo'), row('c', 'Charlie')]);
		const sorted: Array<{ id: string; order: Array<string> }> = [];
		table.addEventListener('sorted', (event) => {
			const target = event.target as UmbWebMcpSortableTable;
			sorted.push({ id: (event as any).itemId, order: target.items.map((x) => x.id) });
		});

		applyOrder(table, ['c', 'a', 'b'], (itemId) => Object.assign(new Event('sorted'), { itemId }));

		expect(table.items.map((x) => x.id)).to.deep.equal(['c', 'a', 'b']);
		expect(sorted).to.deep.equal([
			{ id: 'c', order: ['c', 'a', 'b'] },
			{ id: 'a', order: ['c', 'a', 'b'] },
			{ id: 'b', order: ['c', 'a', 'b'] },
		]);
	});
});
