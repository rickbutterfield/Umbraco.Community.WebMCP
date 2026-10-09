import { navigate, waitForQuiet } from './utils.ts';

export interface UmbWebMcpToolAnnotations {
	readOnlyHint?: boolean;
	consequentialHint?: boolean;
	untrustedContentHint?: boolean;
	debugging?: boolean;
}

/**
 * What a tool is told about the call it's handling.
 */
export interface UmbWebMcpToolCall {
	/** Aborts when the caller cancels the call. Stop waiting when it does. */
	signal?: AbortSignal;
}

export interface UmbWebMcpTool<TInput = any> {
	name: string;
	title?: string;
	description: string;
	inputSchema?: object;
	annotations?: UmbWebMcpToolAnnotations;
	execute(input: TInput, call?: UmbWebMcpToolCall): Promise<unknown>;
}

interface ModelContext {
	registerTool(
		tool: Omit<UmbWebMcpTool, 'execute'> & {
			execute(input: object, client?: { signal?: AbortSignal }): Promise<string>;
		},
		options?: { signal?: AbortSignal },
	): Promise<void> | void;
	// Early Chrome previews exposed this instead of honouring the abort signal.
	unregisterTool?(name: string): void;
}

/**
 * The spec places the API on `document`; early Chrome previews and polyfills put it on `navigator`.
 */
export function getModelContext(): ModelContext | undefined {
	return (document as any).modelContext ?? (navigator as any).modelContext;
}

/**
 * Where a registration comes from. Tools registered by a workspace are scoped to `workspace`, so tools that open one
 * can wait for them.
 */
export type UmbWebMcpToolScope = 'workspace';

interface UmbToolEntry {
	tool: UmbWebMcpTool;
	signal: AbortSignal;
	scope?: UmbWebMcpToolScope;
	generation: number;
}

interface UmbModelContextRegistration {
	controller: AbortController;
	schema: string;
}

/**
 * JSON with object keys sorted at every level, so two schemas that differ only in key order compare equal.
 */
function stableStringify(value: unknown): string {
	return JSON.stringify(value, (_key, entry) =>
		entry && typeof entry === 'object' && !Array.isArray(entry)
			? Object.fromEntries(
					Object.keys(entry)
						.sort()
						.map((key) => [key, entry[key]]),
				)
			: entry,
	);
}

/**
 * A tool's input parameters in one short line, such as "entityType, unique, alias, section?": optional ones end in ?.
 * Agents read this from list() instead of guessing names; describe() has the full schema.
 */
export function summariseInput(inputSchema?: object) {
	const schema = inputSchema as { properties?: Record<string, unknown>; required?: Array<string> } | undefined;
	const names = Object.keys(schema?.properties ?? {});
	if (!names.length) return undefined;
	return names.map((name) => (schema?.required?.includes(name) ? name : `${name}?`)).join(', ');
}

/**
 * Throws an error that names the expected parameters when `input` lacks a required one, because agents guess names
 * (actionAlias for alias, buttonId for id) and otherwise get an error from deep inside the tool.
 */
export function checkInput(name: string, inputSchema: object | undefined, input: object) {
	const schema = inputSchema as { properties?: Record<string, unknown>; required?: Array<string> } | undefined;
	const missing = (schema?.required ?? []).filter((key) => (input as Record<string, unknown>)[key] === undefined);
	if (!missing.length) return;
	const unknown = Object.keys(input).filter((key) => !(key in (schema?.properties ?? {})));
	throw new Error(
		`${name} needs ${missing.join(', ')}.` +
			(unknown.length ? ` It doesn't take ${unknown.join(', ')}.` : '') +
			` Its parameters are: ${summariseInput(inputSchema)}.`,
	);
}

/**
 * The first sentence of a description, or all of it if it has only one.
 */
export function firstSentence(description: string) {
	return description.match(/^.+?[.!?](?=\s|$)/s)?.[0] ?? description;
}

/**
 * What WebMCP gets as a tool's description: only the first sentence. Clients such as Playwright MCP repeat every tool's
 * description and input schema in each page snapshot as well as in the agent's tool list, so full descriptions cost an
 * agent thousands of tokens a turn. The rest is one call away, through umbraco_get_tool_description.
 */
function modelContextDescription(tool: UmbWebMcpTool) {
	return firstSentence(tool.description);
}

/**
 * What an agent sees of a tool and so what decides whether WebMCP needs the tool registered again.
 */
function schemaOf(tool: UmbWebMcpTool) {
	return stableStringify({ description: modelContextDescription(tool), inputSchema: tool.inputSchema ?? null });
}

/**
 * Holds every registered tool and exposes each name once, to WebMCP when its surface is attached and the browser
 * supports it, and to the page API (`window.__umbWebMcp`) when that surface is enabled. When two registrations share a
 * name (for example a document open in a modal on top of another document), the newest one handles calls until it is
 * aborted, then the previous one takes over. WebMCP keeps the description and input schema it was registered with, so
 * when the handling registration's schema differs, the name is registered again with the current one.
 */
class UmbWebMcpToolHub {
	#stacks = new Map<string, Array<UmbToolEntry>>();
	#modelContextRegistrations = new Map<string, UmbModelContextRegistration>();
	#listeners = new Set<() => void>();
	#generation = 0;
	#modelContextAttached = false;

	/** Increases with every registration, so a caller can tell which registrations came after a point in time. */
	get generation() {
		return this.#generation;
	}

	register(tools: Array<UmbWebMcpTool>, signal: AbortSignal, scope?: UmbWebMcpToolScope) {
		if (signal.aborted || !tools.length) return;
		const generation = ++this.#generation;
		for (const tool of tools) {
			const entry: UmbToolEntry = { tool, signal, scope, generation };
			const stack = this.#stacks.get(tool.name) ?? [];
			stack.push(entry);
			this.#stacks.set(tool.name, stack);
			signal.addEventListener('abort', () => this.#remove(tool.name, entry), { once: true });
			this.#syncWithModelContext(tool);
		}
		this.#notify();
	}

	/**
	 * Calls `listener` whenever tools are registered or removed. Returns a function that unsubscribes.
	 */
	onChange(listener: () => void) {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	/**
	 * The names whose handling registration has the given scope, such as the tools of the open workspace.
	 */
	namesInScope(scope: UmbWebMcpToolScope) {
		return [...this.#stacks.entries()]
			.filter(([, stack]) => stack[stack.length - 1].scope === scope)
			.map(([name]) => name)
			.sort();
	}

	/**
	 * Resolves with true once tools with `scope` have been registered after `sinceGeneration` and registrations have
	 * then been quiet for `quietMs`, or as soon as `alreadyDone` (checked every 100 ms) returns true, or with false
	 * after `maxMs`. Rejects with the signal's reason when `signal` aborts.
	 *
	 * `alreadyDone` covers navigating within an open workspace: the backoffice reuses the workspace for another entity
	 * of the same type, so no new tools are registered.
	 */
	async waitForScope(
		scope: UmbWebMcpToolScope,
		sinceGeneration: number,
		{
			signal,
			maxMs = 10_000,
			quietMs = 250,
			alreadyDone,
		}: {
			signal?: AbortSignal;
			maxMs?: number;
			quietMs?: number;
			alreadyDone?: () => boolean | Promise<boolean>;
		} = {},
	) {
		const registered = () =>
			[...this.#stacks.values()].some((stack) =>
				stack.some((entry) => entry.scope === scope && entry.generation > sinceGeneration),
			);
		if (!registered()) {
			const outcome = await new Promise<'registered' | 'done' | 'timeout'>((resolve, reject) => {
				let finished = false;
				const finish = (result: () => void) => {
					if (finished) return;
					finished = true;
					clearTimeout(timer);
					clearInterval(poll);
					unsubscribe();
					signal?.removeEventListener('abort', onAbort);
					result();
				};
				const onAbort = () => finish(() => reject(signal!.reason));
				const timer = setTimeout(() => finish(() => resolve('timeout')), maxMs);
				const poll = setInterval(async () => {
					if (alreadyDone && (await alreadyDone())) finish(() => resolve('done'));
				}, 100);
				const unsubscribe = this.onChange(() => {
					if (registered()) finish(() => resolve('registered'));
				});
				signal?.addEventListener('abort', onAbort, { once: true });
				if (signal?.aborted) onAbort();
			});
			if (outcome === 'timeout') return false;
			if (outcome === 'done') return true;
		}
		// A workspace registers its own tools, then its toolsets', so wait until they've all arrived
		await waitForQuiet((onChange) => this.onChange(onChange), quietMs, maxMs, signal);
		return true;
	}

	list() {
		return [...this.#stacks.keys()].map((name) => this.describe(name));
	}

	/**
	 * Each tool's name, the first sentence of its description and its annotations: enough to choose a tool without
	 * paying for every input schema. Use `describe` for the rest.
	 */
	summarise() {
		return [...this.#stacks.keys()].map((name) => {
			const { description, inputSchema, annotations } = this.describe(name);
			const input = summariseInput(inputSchema);
			return { name, summary: firstSentence(description), ...(input ? { input } : {}), annotations };
		});
	}

	/**
	 * The full description of the registration handling `name`: title, description, input schema and annotations.
	 */
	describe(name: string) {
		const stack = this.#stacks.get(name);
		if (!stack?.length) throw new Error(`No WebMCP tool named "${name}" is registered right now.`);
		const { title, description, inputSchema, annotations } = stack[stack.length - 1].tool;
		return { name, title, description, inputSchema, annotations };
	}

	async call(name: string, input?: object, call: UmbWebMcpToolCall = {}) {
		call.signal?.throwIfAborted();
		const stack = this.#stacks.get(name);
		if (!stack?.length) throw new Error(`No WebMCP tool named "${name}" is registered right now.`);
		const { tool } = stack[stack.length - 1];
		checkInput(name, tool.inputSchema, input ?? {});
		return (await tool.execute(input ?? {}, call)) ?? null;
	}

	#remove(name: string, entry: UmbToolEntry) {
		const stack = this.#stacks.get(name);
		if (!stack) return;
		const remaining = stack.filter((x) => x !== entry);
		if (remaining.length) {
			this.#stacks.set(name, remaining);
			// The registration that takes over may describe the tool differently
			this.#syncWithModelContext(remaining[remaining.length - 1].tool);
		} else {
			this.#stacks.delete(name);
			this.#unregisterFromModelContext(name);
		}
		this.#notify();
	}

	#notify() {
		for (const listener of [...this.#listeners]) listener();
	}

	/**
	 * Starts registering every tool, now and later, with WebMCP (`document.modelContext`), when the browser supports it.
	 * The WebMCP surface calls this only when it is enabled; until then, tools are only reachable through the other
	 * surfaces. Returns a function that unregisters them all again.
	 */
	attachModelContext() {
		this.#modelContextAttached = true;
		for (const stack of this.#stacks.values()) this.#syncWithModelContext(stack[stack.length - 1].tool);
		return () => {
			this.#modelContextAttached = false;
			for (const name of [...this.#modelContextRegistrations.keys()]) this.#unregisterFromModelContext(name);
		};
	}

	/**
	 * Makes WebMCP describe `tool` (the registration now handling its name): registers it if the name is new, and
	 * registers it again if WebMCP holds a different description or input schema for the name.
	 */
	#syncWithModelContext(tool: UmbWebMcpTool) {
		if (!this.#modelContextAttached) return;
		const schema = schemaOf(tool);
		const current = this.#modelContextRegistrations.get(tool.name);
		if (current?.schema === schema) return;
		if (current) this.#unregisterFromModelContext(tool.name);
		this.#registerWithModelContext(tool, schema);
	}

	async #registerWithModelContext(tool: UmbWebMcpTool, schema: string) {
		const modelContext = getModelContext();
		if (!modelContext) return;

		const controller = new AbortController();
		this.#modelContextRegistrations.set(tool.name, { controller, schema });
		try {
			await modelContext.registerTool(
				{
					name: tool.name,
					title: tool.title,
					description: modelContextDescription(tool),
					inputSchema: tool.inputSchema,
					annotations: { debugging: true, ...tool.annotations },
					execute: async (input, client) =>
						JSON.stringify(await this.call(tool.name, input, { signal: client?.signal })),
				},
				{ signal: controller.signal },
			);
		} catch (error) {
			console.warn(`[WebMCP] Could not register tool "${tool.name}".`, error);
		}
	}

	#unregisterFromModelContext(name: string) {
		const registration = this.#modelContextRegistrations.get(name);
		if (!registration) return;
		this.#modelContextRegistrations.delete(name);
		registration.controller.abort();
		try {
			getModelContext()?.unregisterTool?.(name);
		} catch {
			// Already removed by the abort signal.
		}
	}
}

export const umbWebMcpToolHub = new UmbWebMcpToolHub();

/**
 * Registers tools until `signal` aborts.
 */
export function registerTools(tools: Array<UmbWebMcpTool>, signal: AbortSignal, scope?: UmbWebMcpToolScope) {
	umbWebMcpToolHub.register(tools, signal, scope);
}

/**
 * Registers tools only while the backoffice shows the section with this pathname, such as "content", and removes
 * them when the agent moves to another section, so agents aren't sent tools that don't apply where they are. Follows
 * the router's changestate event, which it fires whenever the path changes.
 */
export function registerToolsInSection(sectionPathname: string, tools: Array<UmbWebMcpTool>, signal: AbortSignal) {
	let registration: AbortController | undefined;
	const update = () => {
		const inSection = location.pathname.match(/\/section\/([^/]+)/)?.[1] === sectionPathname;
		if (inSection && !registration && !signal.aborted) {
			registration = new AbortController();
			registerTools(tools, AbortSignal.any([signal, registration.signal]));
		} else if (!inSection && registration) {
			registration.abort();
			registration = undefined;
		}
	};
	window.addEventListener('changestate', update, { signal });
	window.addEventListener('popstate', update, { signal });
	update();
}

/**
 * Exposes the same tools to page scripts, so Playwright (`page.evaluate`, Playwright MCP's `browser_evaluate`) and
 * browsers without WebMCP can call them. Only called when the page API surface is enabled.
 *
 * `list()` is kept short, because agents read it whole: each tool's name, one-sentence summary, parameter names and
 * annotations.
 * `describe(name)` returns a tool's full description and input schema, and `list({ full: true })` returns them all.
 */
export function exposePageApi() {
	(window as any).__umbWebMcp = {
		list: ({ full = false }: { full?: boolean } = {}) =>
			full ? umbWebMcpToolHub.list() : umbWebMcpToolHub.summarise(),
		describe: (name: string) => umbWebMcpToolHub.describe(name),
		call: (name: string, input?: object, call?: UmbWebMcpToolCall) => umbWebMcpToolHub.call(name, input, call),
	};
}

const WORKSPACE_PATH = /\/workspace\//;
const EDIT_WORKSPACE_PATH = /\/workspace\/[^/]+\/edit\/([^/?#]+)/;

/**
 * Whether the open workspace already shows the entity with this key and has loaded it, according to
 * umbraco_get_workspace_info.
 */
async function isOpenAndReady(unique: string) {
	if (!umbWebMcpToolHub.namesInScope('workspace').includes('umbraco_get_workspace_info')) return false;
	const info = (await umbWebMcpToolHub.call('umbraco_get_workspace_info').catch(() => null)) as {
		unique?: string | null;
		ready?: boolean;
	} | null;
	return info?.unique === unique && info.ready === true;
}

/**
 * Navigates to a backoffice path. When the path opens a workspace, waits until it has loaded and registered its
 * tools, then returns their names and the workspace info, with its footer actions, so an agent knows what it can call
 * next without listing every tool again.
 */
export async function openPath(path: string, signal?: AbortSignal) {
	const since = umbWebMcpToolHub.generation;
	const result = navigate(path);
	if (!WORKSPACE_PATH.test(result.navigatedTo)) return result;
	const unique = result.navigatedTo.match(EDIT_WORKSPACE_PATH)?.[1];
	const workspaceReady = await umbWebMcpToolHub.waitForScope('workspace', since, {
		signal,
		alreadyDone: unique ? () => isOpenAndReady(unique) : undefined,
	});
	const workspaceTools = umbWebMcpToolHub.namesInScope('workspace');
	// The workspace's footer actions come with it, so an agent can save without asking what the buttons are
	const workspace = workspaceTools.includes('umbraco_get_workspace_info')
		? await umbWebMcpToolHub.call('umbraco_get_workspace_info', {}, { signal }).catch(() => undefined)
		: undefined;
	return { ...result, workspaceReady, workspaceTools, ...(workspace ? { workspace } : {}) };
}
