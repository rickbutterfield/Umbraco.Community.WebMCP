import { expect } from '@open-wc/testing';
import { startOutcome, UmbWebMcpNotificationLog } from './outcome.js';

const handler = (key: string, headline: string, color = 'positive') => ({ key, color, _data: { headline } });

describe('UmbWebMcpNotificationLog', () => {
	it('reports the notifications shown after a mark', () => {
		const log = new UmbWebMcpNotificationLog();
		log.record([handler('a', 'Before')]);
		const mark = log.mark();
		log.record([handler('a', 'Before'), handler('b', 'Saved')]);

		expect(log.since(mark)).to.deep.equal([{ color: 'positive', headline: 'Saved', message: null }]);
	});

	it('records each notification once, however often the list is emitted', () => {
		const log = new UmbWebMcpNotificationLog();
		log.record([handler('a', 'Saved')]);
		log.record([handler('a', 'Saved')]);

		expect(log.since(0)).to.have.length(1);
	});

	it('reads the data from the toast element when the handler has none', () => {
		const log = new UmbWebMcpNotificationLog();
		log.record([
			{ key: 'a', color: 'danger', element: { data: { headline: 'Failed', message: 'Name is required' } } } as any,
		]);

		expect(log.since(0)).to.deep.equal([{ color: 'danger', headline: 'Failed', message: 'Name is required' }]);
	});

	it('keeps only the newest entries', () => {
		const log = new UmbWebMcpNotificationLog(2);
		log.record([handler('a', 'One'), handler('b', 'Two'), handler('c', 'Three')]);

		expect(log.since(0).map((x) => x.headline)).to.deep.equal(['Two', 'Three']);
	});

	it('tells listeners about new notifications only', () => {
		const log = new UmbWebMcpNotificationLog();
		let changes = 0;
		log.onChange(() => changes++);
		log.record([handler('a', 'Saved')]);
		log.record([handler('a', 'Saved')]);

		expect(changes).to.equal(1);
	});
});

describe('startOutcome', () => {
	const original = location.pathname + location.search;
	afterEach(() => history.replaceState(null, '', original));

	it('reports notifications and leaves out navigatedTo when the path did not change', async () => {
		const log = new UmbWebMcpNotificationLog();
		const outcome = startOutcome(log);
		log.record([handler('a', 'Saved')]);

		expect(await outcome.report()).to.deep.equal({
			notifications: [{ color: 'positive', headline: 'Saved', message: null }],
		});
	});

	it('reports where the action navigated to', async () => {
		const outcome = startOutcome(new UmbWebMcpNotificationLog());
		history.pushState(null, '', '/umbraco/section/content');

		expect((await outcome.report()).navigatedTo).to.equal('/umbraco/section/content');
	});

	it('waits for a notification that arrives after the action returns', async () => {
		const log = new UmbWebMcpNotificationLog();
		const outcome = startOutcome(log);
		setTimeout(() => log.record([handler('a', 'Deleted')]), 20);

		expect((await outcome.report({ settleMs: 60, maxMs: 1000 })).notifications).to.have.length(1);
	});
});
