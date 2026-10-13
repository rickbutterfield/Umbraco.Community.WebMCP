import { expect, fixture, html } from '@open-wc/testing';
import { findPicker, findPickerItem, type UmbWebMcpTreeContext } from './picker.js';

function treeContext(selectableFilter?: (item: any) => boolean): UmbWebMcpTreeContext {
	let selection: Array<string | null> = [];
	return {
		selectableFilter,
		selection: {
			getSelection: () => selection,
			getMultiple: () => false,
			getSelectable: () => true,
			select: (unique) => (selection = [unique]),
			deselect: (unique) => (selection = selection.filter((x) => x !== unique)),
		},
	};
}

/**
 * Renders a modal element with tree items that carry an item and an api with the tree context, as
 * umb-default-tree-item does.
 */
async function renderPicker(context: UmbWebMcpTreeContext, items: Array<any>) {
	const modal = await fixture(html`<div>${items.map(() => html`<span class="item"></span>`)}</div>`);
	(modal as any).modalContext = { key: 'picker' };
	[...modal.querySelectorAll('.item')].forEach((element, i) => {
		(element as any).item = items[i];
		(element as any).api = { treeContext: context };
	});
	return modal;
}

describe('picker', () => {
	const root = { name: 'Forms', unique: null, entityType: 'forms-form-root', isFolder: true };
	const form = { name: 'Contact form', unique: 'a1', entityType: 'forms-form', isFolder: false };

	it('finds the tree context and the rendered items', async () => {
		const context = treeContext();
		const modal = await renderPicker(context, [root, form]);

		const picker = findPicker(modal)!;

		expect(picker.tree).to.equal(context);
		expect(picker.items.map((x) => x.name)).to.deep.equal(['Forms', 'Contact form']);
	});

	it("marks the items the picker's filter rejects", async () => {
		const modal = await renderPicker(
			treeContext((item) => item.isFolder),
			[root, form],
		);

		expect(findPicker(modal)!.items.map((x) => x.pickable)).to.deep.equal([true, false]);
	});

	it('leaves out the tree of a modal opened on top', async () => {
		const modal = await renderPicker(treeContext(), [root]);
		const inner = document.createElement('div');
		(inner as any).modalContext = { key: 'inner' };
		const innerItem = document.createElement('span');
		Object.assign(innerItem, { item: form, api: { treeContext: treeContext() } });
		inner.appendChild(innerItem);
		modal.appendChild(inner);

		expect(findPicker(modal)!.items.map((x) => x.name)).to.deep.equal(['Forms']);
	});

	it('localizes names such as the root header', async () => {
		const modal = await renderPicker(treeContext(), [{ ...root, name: '#treeHeaders_content' }]);

		const picker = findPicker(modal, (text) => (text === '#treeHeaders_content' ? 'Content' : text))!;

		expect(picker.items[0].name).to.equal('Content');
	});

	it('returns undefined for a modal without a tree', async () => {
		const modal = await fixture(html`<div><uui-button>Choose</uui-button></div>`);

		expect(findPicker(modal)).to.equal(undefined);
	});

	describe('finding the item to pick', () => {
		const items = [
			{ name: 'Forms', unique: null, entityType: 'forms-form-root', pickable: true },
			{ name: 'Contact form', unique: 'a1', entityType: 'forms-form', pickable: false },
		];

		it('matches the root by a null unique', () => {
			expect(findPickerItem(items, { unique: null })).to.equal(items[0]);
		});

		it('matches by name, ignoring case', () => {
			expect(findPickerItem(items, { name: 'contact FORM' })).to.equal(items[1]);
		});

		it('accepts a unique that is not rendered, such as an item in a collapsed folder', () => {
			expect(findPickerItem(items, { unique: 'b2' })).to.deep.equal({ unique: 'b2' });
		});

		it('lists the shown items when no name matches', () => {
			expect(() => findPickerItem(items, { name: 'Missing' })).to.throw('Shown: Forms (null), Contact form (a1).');
		});

		it('asks for the unique when two items share a name', () => {
			const twins = [items[1], { ...items[1], unique: 'a2' }];
			expect(() => findPickerItem(twins, { name: 'Contact form' })).to.throw('pass its unique');
		});
	});
});
