import { expect } from '@open-wc/testing';
import {
	checkInput,
	firstSentence,
	openPath,
	registerTools,
	registerToolsInSection,
	summariseInput,
	umbWebMcpToolHub,
	type UmbWebMcpTool,
} from './model-context.js';

let toolCounter = 0;
const uniqueName = () => `test_tool_${++toolCounter}`;

const tool = (name: string, result: unknown): UmbWebMcpTool => ({
	name,
	description: `Returns ${String(result)}`,
	execute: async () => result,
});

interface FakeRegistration {
	name: string;
	description: string;
	inputSchema?: object;
	signal?: AbortSignal;
	execute(input: object, client?: { signal?: AbortSignal }): Promise<string>;
}

const describedTool = (name: string, description: string, inputSchema?: object): UmbWebMcpTool => ({
	name,
	description,
	inputSchema,
	execute: async () => description,
});

/**
 * Installs a fake `document.modelContext` for the duration of a test and, unless `attach` is false, attaches the hub to
 * it as the WebMCP surface does.
 */
function installFakeModelContext({ attach = true } = {}) {
	const registrations: Array<FakeRegistration> = [];
	Object.defineProperty(document, 'modelContext', {
		configurable: true,
		value: {
			registerTool(registration: FakeRegistration, options?: { signal?: AbortSignal }) {
				registrations.push({ ...registration, signal: options?.signal });
			},
		},
	});
	let detach = attach ? umbWebMcpToolHub.attachModelContext() : undefined;
	return {
		registrations,
		active: () => registrations.filter((x) => !x.signal?.aborted),
		attach: () => (detach = umbWebMcpToolHub.attachModelContext()),
		detach: () => detach?.(),
		uninstall: () => {
			detach?.();
			delete (document as any).modelContext;
		},
	};
}

describe('summariseInput', () => {
	it('lists the parameters, marking optional ones', () => {
		const schema = { type: 'object', properties: { key: {}, label: {} }, required: ['key'] };

		expect(summariseInput(schema)).to.equal('key, label?');
	});

	it('returns nothing for a tool without parameters', () => {
		expect(summariseInput(undefined)).to.equal(undefined);
	});
});

describe('checkInput', () => {
	const schema = { type: 'object', properties: { key: {}, id: {} }, required: ['key', 'id'] };

	it('accepts an input with every required parameter', () => {
		expect(() => checkInput('tool', schema, { key: 'a', id: 'b' })).not.to.throw();
	});

	it('names the missing and the unknown parameters', () => {
		expect(() => checkInput('tool', schema, { key: 'a', buttonId: 'b' })).to.throw(
			"tool needs id. It doesn't take buttonId. Its parameters are: key, id.",
		);
	});
});

describe('firstSentence', () => {
	it('returns the first sentence', () => {
		expect(firstSentence('Opens a thing. Then does more.')).to.equal('Opens a thing.');
	});

	it('keeps a full stop inside a path or a name', () => {
		expect(firstSentence('Opens Forms.Tree.Forms items. More.')).to.equal('Opens Forms.Tree.Forms items.');
	});

	it('returns the whole description when there is one sentence without a full stop', () => {
		expect(firstSentence('Opens a thing')).to.equal('Opens a thing');
	});
});

describe('registerToolsInSection', () => {
	const startPath = location.pathname;
	const goTo = (path: string) => {
		history.pushState(null, '', path);
		window.dispatchEvent(new Event('changestate'));
	};
	const registered = (name: string) => umbWebMcpToolHub.list().some((x) => x.name === name);
	afterEach(() => history.replaceState(null, '', startPath));

	it('registers the tools only while their section is shown', () => {
		const name = uniqueName();
		const controller = new AbortController();
		goTo('/umbraco/section/settings');
		registerToolsInSection('content', [tool(name, 'ok')], controller.signal);
		expect(registered(name)).to.equal(false);

		goTo('/umbraco/section/content/workspace/document/edit/abc');
		expect(registered(name)).to.equal(true);

		goTo('/umbraco/section/forms');
		expect(registered(name)).to.equal(false);
		controller.abort();
	});

	it('stops following the path once aborted', () => {
		const name = uniqueName();
		const controller = new AbortController();
		goTo('/umbraco/section/content');
		registerToolsInSection('content', [tool(name, 'ok')], controller.signal);
		controller.abort();
		expect(registered(name)).to.equal(false);

		goTo('/umbraco/section/settings');
		goTo('/umbraco/section/content');
		expect(registered(name)).to.equal(false);
	});
});

describe('UmbWebMcpToolHub', () => {
	describe('registering', () => {
		it('lists a registered tool', () => {
			const name = uniqueName();
			registerTools([tool(name, 1)], new AbortController().signal);

			expect(umbWebMcpToolHub.list().map((x) => x.name)).to.include(name);
		});

		it('ignores tools registered with an already aborted signal', () => {
			const name = uniqueName();
			const controller = new AbortController();
			controller.abort();
			registerTools([tool(name, 1)], controller.signal);

			expect(umbWebMcpToolHub.list().map((x) => x.name)).not.to.include(name);
		});

		it('removes a tool when its signal aborts', () => {
			const name = uniqueName();
			const controller = new AbortController();
			registerTools([tool(name, 1)], controller.signal);
			controller.abort();

			expect(umbWebMcpToolHub.list().map((x) => x.name)).not.to.include(name);
		});
	});

	describe('calling', () => {
		const signalCatcher = (name: string) => {
			const seen: { signal?: AbortSignal } = {};
			const catcher: UmbWebMcpTool = {
				name,
				description: 'Records the signal it was called with',
				execute: async (_input, call) => {
					seen.signal = call?.signal;
					return null;
				},
			};
			return { catcher, seen };
		};

		it('passes the signal of the call to the tool', async () => {
			const name = uniqueName();
			const { catcher, seen } = signalCatcher(name);
			registerTools([catcher], new AbortController().signal);
			const controller = new AbortController();
			await umbWebMcpToolHub.call(name, {}, { signal: controller.signal });

			expect(seen.signal).to.equal(controller.signal);
		});

		it('does not call the tool when the signal has already aborted', async () => {
			const name = uniqueName();
			const { catcher, seen } = signalCatcher(name);
			registerTools([catcher], new AbortController().signal);
			const controller = new AbortController();
			controller.abort();
			try {
				await umbWebMcpToolHub.call(name, {}, { signal: controller.signal });
			} catch {
				// Expected: the call is cancelled before it starts
			}

			expect(seen.signal).to.equal(undefined);
		});

		it('returns the tool result', async () => {
			const name = uniqueName();
			registerTools([tool(name, 'first')], new AbortController().signal);

			expect(await umbWebMcpToolHub.call(name)).to.equal('first');
		});

		it('returns null when the tool returns nothing', async () => {
			const name = uniqueName();
			registerTools([tool(name, undefined)], new AbortController().signal);

			expect(await umbWebMcpToolHub.call(name)).to.equal(null);
		});

		it('rejects an unknown tool name', async () => {
			let error: unknown;
			try {
				await umbWebMcpToolHub.call(uniqueName());
			} catch (e) {
				error = e;
			}

			expect(error).to.be.instanceOf(Error);
		});
	});

	describe('shared names', () => {
		it('calls the newest registration', async () => {
			const name = uniqueName();
			registerTools([tool(name, 'older')], new AbortController().signal);
			registerTools([tool(name, 'newer')], new AbortController().signal);

			expect(await umbWebMcpToolHub.call(name)).to.equal('newer');
		});

		it('falls back to the older registration when the newest aborts', async () => {
			const name = uniqueName();
			registerTools([tool(name, 'older')], new AbortController().signal);
			const newer = new AbortController();
			registerTools([tool(name, 'newer')], newer.signal);
			newer.abort();

			expect(await umbWebMcpToolHub.call(name)).to.equal('older');
		});

		it('lists the name once', () => {
			const name = uniqueName();
			registerTools([tool(name, 'older')], new AbortController().signal);
			registerTools([tool(name, 'newer')], new AbortController().signal);

			expect(umbWebMcpToolHub.list().filter((x) => x.name === name)).to.have.length(1);
		});
	});

	describe('schemas of shared names', () => {
		let fake: ReturnType<typeof installFakeModelContext>;
		const forName = (name: string) => fake.registrations.filter((x) => x.name === name);
		const activeFor = (name: string) => fake.active().filter((x) => x.name === name);

		beforeEach(() => (fake = installFakeModelContext()));
		afterEach(() => fake.uninstall());

		it('does not register again when the schema is the same', () => {
			const name = uniqueName();
			registerTools([describedTool(name, 'Opens a thing', { type: 'object' })], new AbortController().signal);
			registerTools([describedTool(name, 'Opens a thing', { type: 'object' })], new AbortController().signal);

			expect(forName(name)).to.have.length(1);
		});

		it('treats schemas that differ only in key order as the same', () => {
			const name = uniqueName();
			const first = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } } };
			const second = { properties: { b: { type: 'number' }, a: { type: 'string' } }, type: 'object' };
			registerTools([describedTool(name, 'Opens a thing', first)], new AbortController().signal);
			registerTools([describedTool(name, 'Opens a thing', second)], new AbortController().signal);

			expect(forName(name)).to.have.length(1);
		});

		it('registers only the first sentence of the description', () => {
			const name = uniqueName();
			registerTools([describedTool(name, 'Opens a thing. Then does more.')], new AbortController().signal);

			expect(activeFor(name).map((x) => x.description)).to.deep.equal(['Opens a thing.']);
			expect(umbWebMcpToolHub.describe(name).description).to.equal('Opens a thing. Then does more.');
		});

		it('does not register again when only later sentences change', () => {
			const name = uniqueName();
			registerTools([describedTool(name, 'Opens a thing. Older detail.')], new AbortController().signal);
			registerTools([describedTool(name, 'Opens a thing. Newer detail.')], new AbortController().signal);

			expect(forName(name)).to.have.length(1);
		});

		it('registers again with the newer description', () => {
			const name = uniqueName();
			registerTools([describedTool(name, 'Older description')], new AbortController().signal);
			registerTools([describedTool(name, 'Newer description')], new AbortController().signal);

			expect(activeFor(name).map((x) => x.description)).to.deep.equal(['Newer description']);
		});

		it('registers again with the newer input schema', () => {
			const name = uniqueName();
			registerTools([describedTool(name, 'Same', { type: 'object' })], new AbortController().signal);
			const newer = { type: 'object', properties: { key: { type: 'string' } } };
			registerTools([describedTool(name, 'Same', newer)], new AbortController().signal);

			expect(activeFor(name).map((x) => x.inputSchema)).to.deep.equal([newer]);
		});

		it('restores the previous schema when the newer registration aborts', () => {
			const name = uniqueName();
			registerTools([describedTool(name, 'Older description')], new AbortController().signal);
			const newer = new AbortController();
			registerTools([describedTool(name, 'Newer description')], newer.signal);
			newer.abort();

			expect(activeFor(name).map((x) => x.description)).to.deep.equal(['Older description']);
		});

		it('does not register again when the restored schema is the same', () => {
			const name = uniqueName();
			registerTools([describedTool(name, 'Same')], new AbortController().signal);
			const newer = new AbortController();
			registerTools([describedTool(name, 'Same')], newer.signal);
			newer.abort();

			expect(forName(name)).to.have.length(1);
		});

		it('describes the handling registration', () => {
			const name = uniqueName();
			registerTools([describedTool(name, 'Older description')], new AbortController().signal);
			const newer = new AbortController();
			registerTools([describedTool(name, 'Newer description')], newer.signal);

			expect(umbWebMcpToolHub.describe(name).description).to.equal('Newer description');
			newer.abort();
			expect(umbWebMcpToolHub.describe(name).description).to.equal('Older description');
		});
	});

	describe('the WebMCP surface', () => {
		it('does not register with WebMCP until the surface attaches', () => {
			const fake = installFakeModelContext({ attach: false });
			const name = uniqueName();
			registerTools([tool(name, 1)], new AbortController().signal);
			const before = fake.active().filter((x) => x.name === name).length;
			fake.attach();
			const after = fake.active().filter((x) => x.name === name).length;
			fake.uninstall();

			expect([before, after]).to.deep.equal([0, 1]);
		});

		it('unregisters every tool when the surface detaches', () => {
			const fake = installFakeModelContext();
			const name = uniqueName();
			registerTools([tool(name, 1)], new AbortController().signal);
			fake.detach();
			registerTools([tool(uniqueName(), 2)], new AbortController().signal);
			const active = fake.active().length;
			fake.uninstall();

			expect(active).to.equal(0);
		});
	});

	describe('with WebMCP available', () => {
		let fake: ReturnType<typeof installFakeModelContext>;

		beforeEach(() => (fake = installFakeModelContext()));
		afterEach(() => fake.uninstall());

		it('keeps one active WebMCP registration per name', () => {
			const name = uniqueName();
			registerTools([tool(name, 'older')], new AbortController().signal);
			registerTools([tool(name, 'newer')], new AbortController().signal);

			expect(fake.active().filter((x) => x.name === name)).to.have.length(1);
		});

		it('keeps the WebMCP registration while another registration remains', () => {
			const name = uniqueName();
			registerTools([tool(name, 'older')], new AbortController().signal);
			const newer = new AbortController();
			registerTools([tool(name, 'newer')], newer.signal);
			newer.abort();

			expect(fake.active().filter((x) => x.name === name)).to.have.length(1);
		});

		it('unregisters from WebMCP when the last registration aborts', () => {
			const name = uniqueName();
			const controller = new AbortController();
			registerTools([tool(name, 1)], controller.signal);
			controller.abort();

			expect(fake.active().filter((x) => x.name === name)).to.have.length(0);
		});

		it('returns results to WebMCP as JSON', async () => {
			const name = uniqueName();
			registerTools([tool(name, { ok: true })], new AbortController().signal);

			const registration = fake.registrations.find((x) => x.name === name)!;
			expect(await registration.execute({})).to.equal('{"ok":true}');
		});

		it('returns errors to WebMCP instead of throwing, so the agent sees the message', async () => {
			const name = uniqueName();
			registerTools(
				[
					{
						name,
						description: 'Needs a key',
						inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
						execute: async () => null,
					},
				],
				new AbortController().signal,
			);

			const registration = fake.registrations.find((x) => x.name === name)!;
			expect(JSON.parse(await registration.execute({}))).to.deep.equal({
				error: `${name} needs key. Its parameters are: key.`,
			});
		});

		it('passes the signal WebMCP calls with to the tool', async () => {
			const name = uniqueName();
			let seen: AbortSignal | undefined;
			registerTools(
				[
					{
						name,
						description: 'Records the signal it was called with',
						execute: async (_input, call) => (seen = call?.signal) && null,
					},
				],
				new AbortController().signal,
			);
			const controller = new AbortController();
			await fake.registrations.find((x) => x.name === name)!.execute({}, { signal: controller.signal });

			expect(seen).to.equal(controller.signal);
		});
	});

	describe('scopes', () => {
		it('lists the names whose handling registration is in a scope', () => {
			const name = uniqueName();
			registerTools([tool(name, 1)], new AbortController().signal, 'workspace');

			expect(umbWebMcpToolHub.namesInScope('workspace')).to.include(name);
		});

		it('leaves out a name whose newest registration has no scope', () => {
			const name = uniqueName();
			registerTools([tool(name, 1)], new AbortController().signal, 'workspace');
			registerTools([tool(name, 2)], new AbortController().signal);

			expect(umbWebMcpToolHub.namesInScope('workspace')).not.to.include(name);
		});

		it('tells listeners about registrations and removals', () => {
			let changes = 0;
			const unsubscribe = umbWebMcpToolHub.onChange(() => changes++);
			const controller = new AbortController();
			registerTools([tool(uniqueName(), 1)], controller.signal);
			controller.abort();
			unsubscribe();
			registerTools([tool(uniqueName(), 1)], new AbortController().signal);

			expect(changes).to.equal(2);
		});

		it('waits for tools registered in the scope later', async () => {
			const since = umbWebMcpToolHub.generation;
			setTimeout(() => registerTools([tool(uniqueName(), 1)], new AbortController().signal, 'workspace'), 20);

			expect(await umbWebMcpToolHub.waitForScope('workspace', since, { maxMs: 1000, quietMs: 10 })).to.equal(true);
		});

		it('does not count registrations from before', async () => {
			registerTools([tool(uniqueName(), 1)], new AbortController().signal, 'workspace');
			const since = umbWebMcpToolHub.generation;

			expect(await umbWebMcpToolHub.waitForScope('workspace', since, { maxMs: 30, quietMs: 10 })).to.equal(false);
		});

		it('stops waiting when the caller cancels', async () => {
			const controller = new AbortController();
			const waiting = umbWebMcpToolHub.waitForScope('workspace', umbWebMcpToolHub.generation, {
				signal: controller.signal,
				maxMs: 10_000,
			});
			controller.abort(new Error('cancelled'));
			let error: unknown;
			try {
				await waiting;
			} catch (e) {
				error = e;
			}

			expect((error as Error).message).to.equal('cancelled');
		});
	});

	describe('opening a path', () => {
		const original = location.pathname + location.search;
		afterEach(() => history.replaceState(null, '', original));

		it('returns straight away for a path without a workspace', async () => {
			expect(await openPath('/umbraco/section/settings')).to.deep.equal({ navigatedTo: '/umbraco/section/settings' });
		});

		it('returns straight away when the open workspace already shows the entity', async () => {
			const info = {
				name: 'umbraco_get_workspace_info',
				description: 'Returns the open workspace.',
				execute: async () => ({ unique: 'same-key', ready: true }),
			};
			const controller = new AbortController();
			registerTools([info], controller.signal, 'workspace');
			const start = Date.now();
			const result: any = await openPath('/umbraco/section/content/workspace/document/edit/same-key');
			controller.abort();

			expect(result.workspaceReady).to.equal(true);
			expect(Date.now() - start).to.be.lessThan(1000);
		});

		it('waits for the workspace and returns its tools', async () => {
			const name = uniqueName();
			setTimeout(() => registerTools([tool(name, 1)], new AbortController().signal, 'workspace'), 20);
			const result: any = await openPath('/umbraco/section/content/workspace/document/edit/abc');

			expect(result.workspaceReady).to.equal(true);
			expect(result.workspaceTools).to.include(name);
		});
	});

	describe('describing', () => {
		it('describes one tool in full', () => {
			const name = uniqueName();
			registerTools(
				[describedTool(name, 'Opens a thing. Then does more.', { type: 'object' })],
				new AbortController().signal,
			);

			expect(umbWebMcpToolHub.describe(name)).to.deep.include({
				name,
				description: 'Opens a thing. Then does more.',
				inputSchema: { type: 'object' },
			});
		});

		it('rejects describing an unknown tool', () => {
			expect(() => umbWebMcpToolHub.describe(uniqueName())).to.throw(/No WebMCP tool/);
		});
	});
});
