export interface UmbWebMcpToolAnnotations {
	readOnlyHint?: boolean;
	consequentialHint?: boolean;
	untrustedContentHint?: boolean;
	debugging?: boolean;
}

export interface UmbWebMcpTool<TInput = any> {
	name: string;
	title?: string;
	description: string;
	inputSchema?: object;
	annotations?: UmbWebMcpToolAnnotations;
	execute(input: TInput): Promise<unknown>;
}

interface ModelContext {
	registerTool(
		tool: Omit<UmbWebMcpTool, 'execute'> & { execute(input: object): Promise<string> },
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

/**
 * Holds every registered tool and exposes each name once, to WebMCP when the browser supports it and to the
 * page API (`window.__umbWebMcp`). When two registrations share a name (for example a document open in a modal on top of
 * another document), the newest one handles calls until it is aborted, then the previous one takes over.
 */
class UmbWebMcpToolHub {
	#stacks = new Map<string, Array<UmbToolEntry>>();
	#modelContextRegistrations = new Map<string, AbortController>();

	register(tools: Array<UmbWebMcpTool>, signal: AbortSignal) {
		if (signal.aborted) return;
		for (const tool of tools) {
			const entry: UmbToolEntry = { tool, signal };
			const stack = this.#stacks.get(tool.name) ?? [];
			stack.push(entry);
			this.#stacks.set(tool.name, stack);
			signal.addEventListener('abort', () => this.#remove(tool.name, entry), { once: true });
			if (stack.length === 1) this.#registerWithModelContext(tool);
		}
	}

	list() {
		return [...this.#stacks.values()].map((stack) => {
			const { name, title, description, inputSchema, annotations } = stack[stack.length - 1].tool;
			return { name, title, description, inputSchema, annotations };
		});
	}

	async call(name: string, input?: object) {
		const stack = this.#stacks.get(name);
		if (!stack?.length) throw new Error(`No WebMCP tool named "${name}" is registered right now.`);
		return (await stack[stack.length - 1].tool.execute(input ?? {})) ?? null;
	}

	#remove(name: string, entry: UmbToolEntry) {
		const stack = this.#stacks.get(name);
		if (!stack) return;
		const remaining = stack.filter((x) => x !== entry);
		if (remaining.length) {
			this.#stacks.set(name, remaining);
			return;
		}
		this.#stacks.delete(name);
		this.#unregisterFromModelContext(name);
	}

	async #registerWithModelContext(tool: UmbWebMcpTool) {
		const modelContext = getModelContext();
		if (!modelContext) return;

		const controller = new AbortController();
		this.#modelContextRegistrations.set(tool.name, controller);
		try {
			await modelContext.registerTool(
				{
					name: tool.name,
					title: tool.title,
					description: tool.description,
					inputSchema: tool.inputSchema,
					annotations: { debugging: true, ...tool.annotations },
					execute: async (input) => JSON.stringify(await this.call(tool.name, input)),
				},
				{ signal: controller.signal },
			);
		} catch (error) {
			console.warn(`[WebMCP] Could not register tool "${tool.name}".`, error);
		}
	}

	#unregisterFromModelContext(name: string) {
		const controller = this.#modelContextRegistrations.get(name);
		if (!controller) return;
		this.#modelContextRegistrations.delete(name);
		controller.abort();
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
		call: (name: string, input?: object) => umbWebMcpToolHub.call(name, input),
	};
}
