import { getModelContext, registerTools, umbWebMcpToolHub } from '../model-context.ts';
import type { UmbEntryPointOnInit, UmbEntryPointOnUnload } from '@umbraco-cms/backoffice/extension-api';

// The WebMCP surface: registers the tools with document.modelContext. Served only when Umbraco:Community:WebMCP:ModelContext
// (or Enabled) allows it, separately from the tools themselves.

let detach: (() => void) | undefined;
const abortController = new AbortController();

export const onInit: UmbEntryPointOnInit = () => {
	// WebMCP gets only the first sentence of each description, so give agents a way to read the rest
	registerTools(
		[
			{
				name: 'umbraco_get_tool_description',
				title: 'Get tool description',
				description:
					"Returns the full description of an Umbraco tool, which WebMCP lists by its first sentence only. Call it when a tool's first sentence and input schema don't say enough to use it.",
				inputSchema: {
					type: 'object',
					properties: { name: { type: 'string', description: 'The tool name, such as umbraco_open_document.' } },
					required: ['name'],
				},
				annotations: { readOnlyHint: true },
				async execute({ name }: { name: string }) {
					return umbWebMcpToolHub.describe(String(name).replace(/^webmcp_/, '')).description;
				},
			},
		],
		abortController.signal,
	);
	if (!getModelContext()) {
		console.info(
			'[WebMCP] document.modelContext is not available, so the tools are not registered with WebMCP. Enable chrome://flags/#enable-webmcp-testing for WebMCP.',
		);
	}
	detach = umbWebMcpToolHub.attachModelContext();
};

export const onUnload: UmbEntryPointOnUnload = () => {
	detach?.();
	detach = undefined;
	abortController.abort();
};
