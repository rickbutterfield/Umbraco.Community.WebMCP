import { expect } from '@open-wc/testing';
import { exposePageApi, registerTools, umbWebMcpToolHub, type UmbWebMcpTool } from './model-context.js';

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
 * Installs a fake `document.modelContext` for the duration of a test.
 */
function installFakeModelContext() {
	const registrations: Array<FakeRegistration> = [];
	Object.defineProperty(document, 'modelContext', {
		configurable: true,
		value: {
			registerTool(registration: FakeRegistration, options?: { signal?: AbortSignal }) {
				registrations.push({ ...registration, signal: options?.signal });
			},
		},
	});
	return {
		registrations,
		active: () => registrations.filter((x) => !x.signal?.aborted),
		uninstall: () => delete (document as any).modelContext,
	};
}

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

		it('passes the signal through the page API', async () => {
			const name = uniqueName();
			const { catcher, seen } = signalCatcher(name);
			registerTools([catcher], new AbortController().signal);
			exposePageApi();
			const controller = new AbortController();
			await (window as any).__umbWebMcp.call(name, {}, { signal: controller.signal });

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

		it('lists the handling registration in the page API', () => {
			const name = uniqueName();
			registerTools([describedTool(name, 'Older description')], new AbortController().signal);
			const newer = new AbortController();
			registerTools([describedTool(name, 'Newer description')], newer.signal);
			exposePageApi();
			const listed = () => (window as any).__umbWebMcp.list().find((x: { name: string }) => x.name === name);

			expect(listed().description).to.equal('Newer description');
			newer.abort();
			expect(listed().description).to.equal('Older description');
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

	describe('page API', () => {
		it('calls tools through window.__umbWebMcp', async () => {
			const name = uniqueName();
			registerTools([tool(name, 'via page API')], new AbortController().signal);
			exposePageApi();

			expect(await (window as any).__umbWebMcp.call(name)).to.equal('via page API');
		});
	});
});
