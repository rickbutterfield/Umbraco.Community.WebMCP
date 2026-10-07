import { expect } from '@open-wc/testing';
import { runWithoutBlocking, toPlain } from './utils.js';

describe('runWithoutBlocking', () => {
	it('reports completed when the work finishes in time', async () => {
		const { completed } = await runWithoutBlocking(async () => 'done', 100);

		expect(completed).to.equal(true);
	});

	it('returns without completed when the work outlasts the wait', async () => {
		const { completed } = await runWithoutBlocking(() => new Promise(() => {}), 20);

		expect(completed).to.equal(false);
	});

	it('rethrows an error raised within the wait', async () => {
		let error: unknown;
		try {
			await runWithoutBlocking(async () => {
				throw new Error('boom');
			}, 100);
		} catch (e) {
			error = e;
		}

		expect((error as Error).message).to.equal('boom');
	});

	it('lets the caller await the work after returning', async () => {
		let resolveWork!: () => void;
		const { promise } = await runWithoutBlocking(() => new Promise<void>((resolve) => (resolveWork = resolve)), 20);
		resolveWork();

		expect(await promise).to.equal(true);
	});
});

describe('toPlain', () => {
	it('drops functions', () => {
		expect(toPlain({ a: 1, f: () => 1 })).to.deep.equal({ a: 1 });
	});

	it('replaces cycles', () => {
		const value: Record<string, unknown> = { a: 1 };
		value.self = value;

		expect(toPlain(value)).to.deep.equal({ a: 1, self: '[circular]' });
	});

	it('cuts deep nesting', () => {
		expect(toPlain({ a: { b: { c: 1 } } }, 2)).to.deep.equal({ a: { b: '[…]' } });
	});

	it('describes elements by tag name', () => {
		expect(toPlain(document.createElement('uui-button'))).to.equal('<uui-button>');
	});

	it('turns undefined into null', () => {
		expect(toPlain(undefined)).to.equal(null);
	});
});
