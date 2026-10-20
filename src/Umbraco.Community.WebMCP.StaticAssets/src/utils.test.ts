import { expect } from '@open-wc/testing';
import { findAction, isWorkspaceReady, runWithoutBlocking, toPlain, waitForQuiet, whenWorkspaceReady } from './utils.js';

/**
 * Counts the timers started through window.setTimeout and not yet fired or cleared, for the duration of a test.
 */
function trackTimers() {
	const pending = new Set<number>();
	const originalSet = window.setTimeout;
	const originalClear = window.clearTimeout;
	window.setTimeout = ((handler: () => void, ms?: number) => {
		const id = originalSet(() => {
			pending.delete(id);
			handler();
		}, ms);
		pending.add(id);
		return id;
	}) as typeof window.setTimeout;
	window.clearTimeout = ((id?: number) => {
		if (id !== undefined) pending.delete(id);
		originalClear(id);
	}) as typeof window.clearTimeout;
	return {
		pending: () => pending.size,
		restore: () => {
			window.setTimeout = originalSet;
			window.clearTimeout = originalClear;
		},
	};
}

/**
 * Resolves with what the promise rejected with, or fails the test if it resolved.
 */
async function rejectionOf(promise: Promise<unknown>) {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error('Expected the promise to reject.');
}

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

	describe('with a signal', () => {
		let timers: ReturnType<typeof trackTimers>;

		beforeEach(() => (timers = trackTimers()));
		afterEach(() => timers.restore());

		it('rejects with the abort reason when the caller cancels', async () => {
			const controller = new AbortController();
			const waiting = runWithoutBlocking(() => new Promise(() => {}), 10_000, controller.signal);
			controller.abort(new Error('cancelled'));

			expect(((await rejectionOf(waiting)) as Error).message).to.equal('cancelled');
		});

		it('leaves no timer running after the caller cancels', async () => {
			const controller = new AbortController();
			const waiting = runWithoutBlocking(() => new Promise(() => {}), 10_000, controller.signal);
			controller.abort();
			await rejectionOf(waiting);

			expect(timers.pending()).to.equal(0);
		});

		it('does not start the work when the signal has already aborted', async () => {
			let started = false;
			const controller = new AbortController();
			controller.abort();
			await rejectionOf(
				runWithoutBlocking(
					async () => {
						started = true;
					},
					100,
					controller.signal,
				),
			);

			expect(started).to.equal(false);
		});

		it('leaves no timer running when the work finishes first', async () => {
			await runWithoutBlocking(async () => 'done', 10_000, new AbortController().signal);

			expect(timers.pending()).to.equal(0);
		});
	});
});

describe('waitForQuiet', () => {
	let timers: ReturnType<typeof trackTimers>;

	beforeEach(() => (timers = trackTimers()));
	afterEach(() => timers.restore());

	it('resolves once changes stop', async () => {
		let settled = false;
		await waitForQuiet(() => {}, 10).then(() => (settled = true));

		expect(settled).to.equal(true);
	});

	it('leaves no timer running after it resolves', async () => {
		await waitForQuiet(() => {}, 10, 1000);

		expect(timers.pending()).to.equal(0);
	});

	it('ignores changes after it has resolved', async () => {
		let change!: () => void;
		await waitForQuiet((onChange) => (change = onChange), 10, 1000);
		change();

		expect(timers.pending()).to.equal(0);
	});

	it('rejects with the abort reason when the caller cancels', async () => {
		const controller = new AbortController();
		const waiting = waitForQuiet(() => {}, 10_000, 20_000, controller.signal);
		controller.abort(new Error('cancelled'));

		expect(((await rejectionOf(waiting)) as Error).message).to.equal('cancelled');
	});

	it('leaves no timer running after the caller cancels', async () => {
		const controller = new AbortController();
		const waiting = waitForQuiet(() => {}, 10_000, 20_000, controller.signal);
		controller.abort();
		await rejectionOf(waiting);

		expect(timers.pending()).to.equal(0);
	});

	it('unsubscribes once it has resolved', async () => {
		let unsubscribed = false;
		await waitForQuiet(
			() => () => {
				unsubscribed = true;
			},
			10,
			1000,
		);

		expect(unsubscribed).to.equal(true);
	});

	it('unsubscribes when the caller cancels', async () => {
		let unsubscribed = false;
		const controller = new AbortController();
		const waiting = waitForQuiet(
			() => () => {
				unsubscribed = true;
			},
			10_000,
			20_000,
			controller.signal,
		);
		controller.abort();
		await rejectionOf(waiting);

		expect(unsubscribed).to.equal(true);
	});

	it('does not subscribe when the signal has already aborted', async () => {
		let subscribed = false;
		const controller = new AbortController();
		controller.abort();
		await rejectionOf(
			waitForQuiet(
				() => {
					subscribed = true;
				},
				10,
				1000,
				controller.signal,
			),
		);

		expect(subscribed).to.equal(false);
	});
});

describe('workspace readiness', () => {
	const workspace = ({ loading = false, hasData = true } = {}) => ({
		loading: { getIsOn: () => loading },
		getData: () => (hasData ? {} : undefined),
	});

	it('is ready when nothing is loading and the data is there', () => {
		expect(isWorkspaceReady(workspace())).to.equal(true);
	});

	it('is not ready while loading', () => {
		expect(isWorkspaceReady(workspace({ loading: true }))).to.equal(false);
	});

	it('is not ready before the data has arrived', () => {
		expect(isWorkspaceReady(workspace({ hasData: false }))).to.equal(false);
	});

	it('is ready when the workspace holds no data', () => {
		expect(isWorkspaceReady({})).to.equal(true);
	});

	it("is not ready until the structure has loaded its properties' data types", () => {
		const details: Record<string, object | undefined> = { textstring: {}, blockList: undefined };
		const structure = {
			getContentTypeDataTypeUniques: () => Object.keys(details),
			// Gives its current value on subscribe, as the backoffice's states do
			contentTypeDataTypeDetailOf: (unique: string) => ({
				subscribe: (next: (detail: unknown) => void) => {
					next(details[unique]);
					return { unsubscribe: () => {} };
				},
			}),
		};

		expect(isWorkspaceReady({ ...workspace(), structure })).to.equal(false);
		details.blockList = {};
		expect(isWorkspaceReady({ ...workspace(), structure })).to.equal(true);
	});

	it('waits until the workspace has loaded', async () => {
		const loading = workspace({ loading: true });
		setTimeout(() => (loading.loading.getIsOn = () => false), 30);

		expect(await whenWorkspaceReady(loading, undefined, 1000, 5)).to.equal(true);
	});

	it('gives up after the time allowed', async () => {
		expect(await whenWorkspaceReady(workspace({ loading: true }), undefined, 30, 5)).to.equal(false);
	});

	it('rejects with the abort reason when the caller cancels', async () => {
		const controller = new AbortController();
		const waiting = whenWorkspaceReady(workspace({ loading: true }), controller.signal, 10_000, 5);
		controller.abort(new Error('cancelled'));

		expect(((await rejectionOf(waiting)) as Error).message).to.equal('cancelled');
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

describe('findAction', () => {
	const actions = [
		{ alias: 'Umb.EntityAction.Document.Trash', label: 'Trash' },
		{ alias: 'Umb.EntityAction.Document.Move', label: 'Move to...' },
	];

	it('finds an action by alias', () => {
		expect(findAction(actions, 'Umb.EntityAction.Document.Trash', 'here').label).to.equal('Trash');
	});

	it('finds an action by label, ignoring case and a trailing ellipsis', () => {
		expect(findAction(actions, 'move to', 'here').alias).to.equal('Umb.EntityAction.Document.Move');
	});

	it('names the available labels when nothing matches', () => {
		expect(() => findAction(actions, 'Delete', 'for this entity')).to.throw(
			'"Delete" is not available for this entity. Available: Trash, Move to....',
		);
	});
});
