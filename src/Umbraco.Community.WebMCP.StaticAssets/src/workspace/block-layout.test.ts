import { expect } from '@open-wc/testing';
import {
	allowedGridBlockTypes,
	blockAndDescendants,
	entriesAt,
	findBlock,
	findBlockType,
	fitColumnSpan,
	gridLayoutDefaults,
	hasBlockEditor,
	insertBlock,
	mergeValues,
	removeBlock,
	valuesForVariant,
	type UmbBlockLayoutEntry,
} from './block-layout.js';

/** A grid: a section with a "main" area holding two texts, then a text at the root. */
function grid(): Array<UmbBlockLayoutEntry> {
	return Object.freeze([
		Object.freeze({
			contentKey: 'section',
			areas: Object.freeze([
				Object.freeze({ key: 'main', items: Object.freeze([{ contentKey: 'a' }, { contentKey: 'b' }]) }),
			]),
		}),
		Object.freeze({ contentKey: 'root-text' }),
	]) as unknown as Array<UmbBlockLayoutEntry>;
}

const keys = (entries: ReadonlyArray<UmbBlockLayoutEntry> | undefined) => entries?.map((x) => x.contentKey);

describe('block layout', () => {
	describe('findBlock', () => {
		it('finds a block at the root and one in an area, with where it sits', () => {
			expect(findBlock(grid(), 'root-text')).to.include({ parentKey: null, areaKey: null, index: 1 });
			expect(findBlock(grid(), 'b')).to.include({ parentKey: 'section', areaKey: 'main', index: 1 });
		});

		it('returns undefined for a key that is not there', () => {
			expect(findBlock(grid(), 'missing')).to.equal(undefined);
		});
	});

	describe('blockAndDescendants', () => {
		it('lists a block and every block in its areas', () => {
			expect(keys(blockAndDescendants(grid()[0]))).to.deep.equal(['section', 'a', 'b']);
		});
	});

	describe('entriesAt', () => {
		it('returns the root, an area, an empty area and nothing for a missing parent', () => {
			expect(keys(entriesAt(grid(), null, null))).to.deep.equal(['section', 'root-text']);
			expect(keys(entriesAt(grid(), 'section', 'main'))).to.deep.equal(['a', 'b']);
			expect(keys(entriesAt(grid(), 'root-text', 'main'))).to.deep.equal([]);
			expect(entriesAt(grid(), 'missing', 'main')).to.equal(undefined);
		});
	});

	describe('removeBlock', () => {
		it('removes a block from an area without changing the frozen input', () => {
			const layouts = grid();
			const { layouts: result, removed } = removeBlock(layouts, 'a');

			expect(removed.contentKey).to.equal('a');
			expect(keys(entriesAt(result, 'section', 'main'))).to.deep.equal(['b']);
			expect(keys(entriesAt(layouts, 'section', 'main'))).to.deep.equal(['a', 'b']);
		});

		it('removes a block with the blocks in its areas', () => {
			const { layouts, removed } = removeBlock(grid(), 'section');

			expect(keys(layouts)).to.deep.equal(['root-text']);
			expect(keys(blockAndDescendants(removed))).to.deep.equal(['section', 'a', 'b']);
		});

		it('throws for a key that is not there', () => {
			expect(() => removeBlock(grid(), 'missing')).to.throw('There is no block with key "missing"');
		});
	});

	describe('insertBlock', () => {
		it('inserts at an index of the root, and appends for -1 or an index past the end', () => {
			const entry = { contentKey: 'new' };

			expect(keys(insertBlock(grid(), entry, { parentKey: null, areaKey: null, index: 0 }))).to.deep.equal([
				'new',
				'section',
				'root-text',
			]);
			expect(keys(insertBlock(grid(), entry, { parentKey: null, areaKey: null, index: -1 }))?.at(-1)).to.equal('new');
			expect(keys(insertBlock(grid(), entry, { parentKey: null, areaKey: null, index: 9 }))?.at(-1)).to.equal('new');
		});

		it('inserts into an area of a block', () => {
			const result = insertBlock(grid(), { contentKey: 'new' }, { parentKey: 'section', areaKey: 'main', index: 1 });

			expect(keys(entriesAt(result, 'section', 'main'))).to.deep.equal(['a', 'new', 'b']);
		});

		it('creates the area entry when the block has none yet', () => {
			const result = insertBlock(grid(), { contentKey: 'new' }, { parentKey: 'root-text', areaKey: 'side', index: -1 });

			expect(findBlock(result, 'root-text')!.entry.areas).to.deep.equal([
				{ key: 'side', items: [{ contentKey: 'new' }] },
			]);
		});

		it('throws for a parent that is not there, or a parent without an area', () => {
			const entry = { contentKey: 'new' };

			expect(() => insertBlock(grid(), entry, { parentKey: 'missing', areaKey: 'main', index: 0 })).to.throw(
				'There is no block with key "missing"',
			);
			expect(() => insertBlock(grid(), entry, { parentKey: 'section', areaKey: null, index: 0 })).to.throw(
				'Pass the area',
			);
		});
	});

	describe('valuesForVariant', () => {
		const values = [
			{ alias: 'title', culture: null, segment: null, value: 'Invariant' },
			{ alias: 'text', culture: 'en-US', segment: null, value: 'English' },
			{ alias: 'text', culture: 'da', segment: null, value: 'Dansk' },
			{ alias: 'text', culture: 'da', segment: 'vip', value: 'Dansk VIP' },
		];

		it('picks the culture and segment asked for, then the culture, then the invariant value', () => {
			expect(valuesForVariant(values, 'da', 'vip')).to.deep.equal({ title: 'Invariant', text: 'Dansk VIP' });
			expect(valuesForVariant(values, 'da', null)).to.deep.equal({ title: 'Invariant', text: 'Dansk' });
			expect(valuesForVariant(values, null, null)).to.deep.equal({ title: 'Invariant' });
		});
	});

	describe('mergeValues', () => {
		it('replaces the value with the same alias and variant and adds the rest', () => {
			const values = [
				{ alias: 'title', culture: null, segment: null, value: 'Old', editorAlias: 'Umbraco.TextBox' },
				{ alias: 'text', culture: 'da', segment: null, value: 'Dansk', editorAlias: 'Umbraco.TextBox' },
			];
			const result = mergeValues(values, [
				{ alias: 'title', culture: null, segment: null, value: 'New', editorAlias: 'Umbraco.TextBox' },
				{ alias: 'text', culture: 'en-US', segment: null, value: 'English', editorAlias: 'Umbraco.TextBox' },
			]);

			expect(result.map((x) => [x.alias, x.culture, x.value])).to.deep.equal([
				['title', null, 'New'],
				['text', 'da', 'Dansk'],
				['text', 'en-US', 'English'],
			]);
		});
	});

	describe('findBlockType', () => {
		const types = [{ contentElementTypeKey: 'k1' }, { contentElementTypeKey: 'k2' }];
		const names: Record<string, string> = { k1: 'Hero', k2: 'Quote' };

		it('finds a block type by key or by name, ignoring case', () => {
			expect(findBlockType(types, 'k2', (x) => names[x.contentElementTypeKey])).to.equal(types[1]);
			expect(findBlockType(types, 'quote', (x) => names[x.contentElementTypeKey])).to.equal(types[1]);
		});

		it('names the block types there are when none matches', () => {
			expect(() => findBlockType(types, 'Video', (x) => names[x.contentElementTypeKey], 'at the root')).to.throw(
				'"Video" is not a block type you can add at the root. Block types: Hero, Quote.',
			);
		});
	});

	describe('allowedGridBlockTypes', () => {
		const types = [
			{ contentElementTypeKey: 'section', allowAtRoot: true, allowInAreas: false },
			{ contentElementTypeKey: 'text', allowAtRoot: true, allowInAreas: true, groupKey: 'g1' },
			{ contentElementTypeKey: 'image', allowAtRoot: false, allowInAreas: true },
		];
		const typeKeys = (list: Array<{ contentElementTypeKey: string }>) => list.map((x) => x.contentElementTypeKey);

		it('allows the types allowed at the root, or in areas when the area specifies nothing', () => {
			expect(typeKeys(allowedGridBlockTypes(types, null))).to.deep.equal(['section', 'text']);
			expect(typeKeys(allowedGridBlockTypes(types, { key: 'a', alias: 'main' }))).to.deep.equal(['text', 'image']);
		});

		it("allows only an area's specified element types and groups", () => {
			const area = { key: 'a', alias: 'main', specifiedAllowance: [{ groupKey: 'g1' }, { elementTypeKey: 'section' }] };

			expect(typeKeys(allowedGridBlockTypes(types, area))).to.deep.equal(['section', 'text']);
		});
	});

	describe('grid sizes', () => {
		it('gives a new block the full width, the smallest row span and an empty entry per area', () => {
			const blockType = {
				contentElementTypeKey: 'section',
				rowMinSpan: 2,
				rowMaxSpan: 4,
				areas: [{ key: 'a', alias: 'main' }],
			};

			expect(gridLayoutDefaults(blockType, 12)).to.deep.equal({
				columnSpan: 12,
				rowSpan: 2,
				areas: [{ key: 'a', items: [] }],
			});
		});

		it('fits the column span to the nearest option that fits the container', () => {
			const blockType = {
				contentElementTypeKey: 'text',
				columnSpanOptions: [{ columnSpan: 4 }, { columnSpan: 8 }, { columnSpan: 12 }],
			};

			expect(fitColumnSpan(blockType, undefined, 12)).to.equal(12);
			expect(fitColumnSpan(blockType, 12, 6)).to.equal(4);
			expect(fitColumnSpan({ contentElementTypeKey: 'text' }, 12, 6)).to.equal(6);
		});
	});

	describe('hasBlockEditor', () => {
		it('is true when a Block List or Block Grid data type is among them, and false otherwise', () => {
			expect(hasBlockEditor(['Umbraco.TextBox', 'Umbraco.BlockList'])).to.equal(true);
			expect(hasBlockEditor([undefined, 'Umbraco.BlockGrid'])).to.equal(true);
			expect(hasBlockEditor(['Umbraco.TextBox', 'Umbraco.RichText', null])).to.equal(false);
			expect(hasBlockEditor([])).to.equal(false);
		});
	});
});
