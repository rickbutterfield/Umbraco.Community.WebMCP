import { expect } from '@open-wc/testing';
import {
	configToObject,
	describeValueShape,
	getBlockElementTypeKeys,
	inferShape,
	type UmbWebMcpElementType,
} from './property-value-shape.js';

/** Keys in order, so examples with new keys can be compared. */
function keys() {
	let i = 0;
	return () => `key-${++i}`;
}

const heroKey = 'hero-type';
const heroSettingsKey = 'hero-settings-type';
const heroType: UmbWebMcpElementType = {
	key: heroKey,
	alias: 'hero',
	name: 'Hero',
	variesByCulture: false,
	variesBySegment: false,
	properties: [
		{
			alias: 'headline',
			name: 'Headline',
			dataTypeKey: 'textstring',
			editorAlias: 'Umbraco.TextBox',
			editorUiAlias: 'Umb.PropertyEditorUi.TextBox',
			config: {},
			variesByCulture: false,
			variesBySegment: false,
		},
	],
};
const heroSettingsType: UmbWebMcpElementType = { ...heroType, key: heroSettingsKey, alias: 'heroSettings', properties: [] };

describe('property value shape', () => {
	it('turns a data type configuration into an object by alias', () => {
		expect(configToObject([{ alias: 'maxChars', value: 50 }])).to.deep.equal({ maxChars: 50 });
		expect(configToObject(undefined)).to.deep.equal({});
	});

	it('lists the element types a block configuration uses, once each', () => {
		const config = {
			blocks: [
				{ contentElementTypeKey: 'a', settingsElementTypeKey: 'b' },
				{ contentElementTypeKey: 'a', settingsElementTypeKey: null },
			],
		};

		expect(getBlockElementTypeKeys(config)).to.deep.equal(['a', 'b']);
		expect(getBlockElementTypeKeys({})).to.deep.equal([]);
	});

	describe('inferring a shape from a value', () => {
		it('writes objects and arrays as TypeScript', () => {
			expect(inferShape([{ key: 'a', crops: [], focalPoint: null }])).to.equal(
				'Array<{ key: string; crops: Array<unknown>; focalPoint: null }>',
			);
		});

		it('quotes keys that are not identifiers', () => {
			expect(inferShape({ 'Umbraco.BlockList': 1 })).to.equal('{ "Umbraco.BlockList": number }');
		});

		it('stops at the depth limit', () => {
			expect(inferShape({ a: { b: { c: 1 } } }, 2)).to.equal('{ a: { b: object } }');
		});
	});

	describe('describing an editor', () => {
		it('describes text, with the maximum length from the configuration', () => {
			const shape = describeValueShape({ editorAlias: 'Umbraco.TextBox', config: { maxChars: 20 } });

			expect(shape.shape).to.equal('string');
			expect(shape.inferred).to.equal(false);
			expect(shape.notes).to.include('At most 20 characters.');
		});

		it('takes the allowed values of a dropdown from its items, as strings or name and value', () => {
			const strings = describeValueShape({ editorAlias: 'Umbraco.DropDown.Flexible', config: { items: ['Red', 'Blue'] } });
			const objects = describeValueShape({
				editorAlias: 'Umbraco.CheckBoxList',
				config: { items: [{ name: 'Red', value: 'r' }] },
			});

			expect(strings.allowedValues).to.deep.equal(['Red', 'Blue']);
			expect(strings.example).to.deep.equal(['Red']);
			expect(objects.allowedValues).to.deep.equal(['r']);
		});

		it('stores one radio button value as a string', () => {
			const shape = describeValueShape({ editorAlias: 'Umbraco.RadioButtonList', config: { items: ['Yes', 'No'] } });

			expect(shape.shape).to.equal('string');
			expect(shape.example).to.equal('Yes');
		});

		it('adds the # to hex colors, as the color picker stores them', () => {
			const shape = describeValueShape({
				editorAlias: 'Umbraco.ColorPicker',
				config: { items: [{ value: 'ff0000', label: 'Red' }] },
			});

			expect(shape.example).to.deep.equal({ label: 'Red', value: '#ff0000' });
		});

		it('builds a media picker entry with a new key and an empty media type alias', () => {
			const shape = describeValueShape({
				editorAlias: 'Umbraco.MediaPicker3',
				config: { multiple: false, validationLimit: { min: 1, max: null } },
				newKey: keys(),
			});

			expect(shape.example).to.deep.equal([
				{ key: 'key-1', mediaKey: '<media key>', mediaTypeAlias: '', focalPoint: null, crops: [] },
			]);
			expect(shape.notes).to.include('Minimum items: 1.');
			expect(shape.notes).to.include('Holds one item: multiple is off.');
		});

		it('picks the entity type of a multinode tree picker from its start node', () => {
			const shape = describeValueShape({
				editorAlias: 'Umbraco.MultiNodeTreePicker',
				config: { startNode: { type: 'media' }, maxNumber: 2 },
			});

			expect(shape.example).to.deep.equal([{ type: 'media', unique: '<media key>' }]);
			expect(shape.notes).to.include('Maximum items: 2.');
		});

		it('stores a date picker value with a time, whatever the display format', () => {
			const shape = describeValueShape({ editorAlias: 'Umbraco.DateTime', config: { format: 'YYYY-MM-DD' } });

			expect(shape.example).to.equal('2026-01-31 00:00:00');
		});

		it('uses the configured time zone in a date with a time zone', () => {
			const shape = describeValueShape({
				editorAlias: 'Umbraco.DateTimeWithTimeZone',
				config: { timeZones: { mode: 'custom', timeZones: ['Europe/London'] } },
			});

			expect((shape.example as any).timeZone).to.equal('Europe/London');
			expect(shape.notes).to.include('timeZone is one of: Europe/London.');
		});

		it('keeps a slider range collapsed when ranges are off', () => {
			const shape = describeValueShape({ editorAlias: 'Umbraco.Slider', config: { minVal: 5, maxVal: 50 } });

			expect(shape.example).to.deep.equal({ from: 5, to: 5 });
		});
	});

	describe('describing block editors', () => {
		const config = {
			blocks: [{ contentElementTypeKey: heroKey, settingsElementTypeKey: heroSettingsKey }],
			validationLimit: { min: null, max: 3 },
		};
		const elementTypes = new Map([
			[heroKey, heroType],
			[heroSettingsKey, heroSettingsType],
		]);

		it('builds a block list example from the first block type, with content, settings and expose', () => {
			const shape = describeValueShape({ editorAlias: 'Umbraco.BlockList', config, elementTypes, newKey: keys() });

			expect(shape.example).to.deep.equal({
				layout: { 'Umbraco.BlockList': [{ contentKey: 'key-1', settingsKey: 'key-2' }] },
				contentData: [
					{
						key: 'key-1',
						contentTypeKey: heroKey,
						values: [
							{ alias: 'headline', editorAlias: 'Umbraco.TextBox', culture: null, segment: null, value: 'Some text' },
						],
					},
				],
				settingsData: [{ key: 'key-2', contentTypeKey: heroSettingsKey, values: [] }],
				expose: [{ contentKey: 'key-1', culture: null, segment: null }],
			});
			expect(shape.notes).to.include('Maximum blocks: 3.');
		});

		it('exposes a block in the culture when its element type varies by culture', () => {
			const variant = new Map([[heroKey, { ...heroType, variesByCulture: true }]]);
			const shape = describeValueShape({
				editorAlias: 'Umbraco.BlockList',
				config: { blocks: [{ contentElementTypeKey: heroKey }] },
				elementTypes: variant,
				culture: 'da',
				newKey: keys(),
			});

			expect((shape.example as any).expose).to.deep.equal([{ contentKey: 'key-1', culture: 'da', segment: null }]);
		});

		it('gives a block grid layout entry the full width and the block type areas', () => {
			const shape = describeValueShape({
				editorAlias: 'Umbraco.BlockGrid',
				config: {
					gridColumns: 6,
					blocks: [{ contentElementTypeKey: heroKey, areas: [{ key: 'area-1', alias: 'main' }] }],
				},
				elementTypes,
				newKey: keys(),
			});

			expect((shape.example as any).layout['Umbraco.BlockGrid']).to.deep.equal([
				{ contentKey: 'key-1', columnSpan: 6, rowSpan: 1, areas: [{ key: 'area-1', items: [] }] },
			]);
		});

		it('leaves the example empty without element types, as for a block editor inside a block', () => {
			const shape = describeValueShape({ editorAlias: 'Umbraco.BlockList', config });

			expect(shape.example).to.deep.equal({
				layout: { 'Umbraco.BlockList': [] },
				contentData: [],
				settingsData: [],
				expose: [],
			});
		});

		it('explains block markup for rich text that allows blocks', () => {
			const shape = describeValueShape({ editorAlias: 'Umbraco.RichText', config });

			expect(shape.notes.some((x) => x.includes('<umb-rte-block data-content-key='))).to.equal(true);
		});
	});

	describe('describing an unknown editor', () => {
		it('infers the shape from the current value and uses it as the example', () => {
			const value = [{ id: 1, label: 'One' }];
			const shape = describeValueShape({ editorAlias: 'My.Editor', config: {}, value });

			expect(shape.inferred).to.equal(true);
			expect(shape.shape).to.equal('Array<{ id: number; label: string }>');
			expect(shape.example).to.equal(value);
		});

		it('says so when there is no value to infer from', () => {
			const shape = describeValueShape({ editorAlias: 'My.Editor', config: {} });

			expect(shape.shape).to.equal('unknown');
			expect(shape.example).to.equal(null);
			expect(shape.notes[0]).to.contain('no value to infer it from');
		});
	});
});
