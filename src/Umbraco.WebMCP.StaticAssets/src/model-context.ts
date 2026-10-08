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

interface UmbToolEntry {
	tool: UmbWebMcpTool;
	signal: AbortSignal;
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
			? Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]]))
			: entry,
	);
}

/**
 * What an agent sees of a tool and so what decides whether WebMCP needs the tool registered again.
 */
function schemaOf(tool: UmbWebMcpTool) {
	return stableStringify({ description: tool.description, inputSchema: tool.inputSchema ?? null });
}

/**
 * Holds every registered tool and exposes each name once, to WebMCP when the browser supports it and to the
 * page API (`window.__umbWebMcp`). When two registrations share a name (for example a document open in a modal on top of
 * another document), the newest one handles calls until it is aborted, then the previous one takes over. WebMCP keeps
 * the description and input schema it was registered with, so when the handling registration's schema differs, the
 * name is registered again with the current one.
 */
class UmbWebMcpToolHub {
	#stacks = new Map<string, Array<UmbToolEntry>>();
	#modelContextRegistrations = new Map<string, UmbModelContextRegistration>();

	register(tools: Array<UmbWebMcpTool>, signal: AbortSignal) {
		if (signal.aborted) return;
		for (const tool of tools) {
			const entry: UmbToolEntry = { tool, signal };
			const stack = this.#stacks.get(tool.name) ?? [];
			stack.push(entry);
			this.#stacks.set(tool.name, stack);
			signal.addEventListener('abort', () => this.#remove(tool.name, entry), { once: true });
			this.#syncWithModelContext(tool);
		}
	}

	list() {
		return [...this.#stacks.values()].map((stack) => {
			const { name, title, description, inputSchema, annotations } = stack[stack.length - 1].tool;
			return { name, title, description, inputSchema, annotations };
		});
	}

	async call(name: string, input?: object, call: UmbWebMcpToolCall = {}) {
		call.signal?.throwIfAborted();
		const stack = this.#stacks.get(name);
		if (!stack?.length) throw new Error(`No WebMCP tool named "${name}" is registered right now.`);
		return (await stack[stack.length - 1].tool.execute(input ?? {}, call)) ?? null;
	}

	#remove(name: string, entry: UmbToolEntry) {
		const stack = this.#stacks.get(name);
		if (!stack) return;
		const remaining = stack.filter((x) => x !== entry);
		if (remaining.length) {
			this.#stacks.set(name, remaining);
			// The registration that takes over may describe the tool differently
			this.#syncWithModelContext(remaining[remaining.length - 1].tool);
			return;
		}
		this.#stacks.delete(name);
		this.#unregisterFromModelContext(name);
	}

	/**
	 * Makes WebMCP describe `tool` (the registration now handling its name): registers it if the name is new, and
	 * registers it again if WebMCP holds a different description or input schema for the name.
	 */
	#syncWithModelContext(tool: UmbWebMcpTool) {
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
					description: tool.description,
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
export function registerTools(tools: Array<UmbWebMcpTool>, signal: AbortSignal) {
	umbWebMcpToolHub.register(tools, signal);
}

/**
 * Exposes the same tools to page scripts, so Playwright (`page.evaluate`, Playwright MCP's `browser_evaluate`) and
 * browsers without WebMCP can call them. Only loaded when the package is enabled.
 */
export function exposePageApi() {
	(window as any).__umbWebMcp = {
		list: () => umbWebMcpToolHub.list(),
		call: (name: string, input?: object, call?: UmbWebMcpToolCall) => umbWebMcpToolHub.call(name, input, call),
	};
}
