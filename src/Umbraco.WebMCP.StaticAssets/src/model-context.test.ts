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
	signal?: AbortSignal;
	execute(input: object): Promise<string>;
}

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

	describe('with WebMCP available', () => {
		let fake: ReturnType<typeof installFakeModelContext>;

		beforeEach(() => (fake = installFakeModelContext()));
		afterEach(() => fake.uninstall());

		it('registers each name with WebMCP once', () => {
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
