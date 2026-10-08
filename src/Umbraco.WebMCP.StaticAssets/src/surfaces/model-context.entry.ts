import { getModelContext, umbWebMcpToolHub } from '../model-context.ts';
import type { UmbEntryPointOnInit, UmbEntryPointOnUnload } from '@umbraco-cms/backoffice/extension-api';

// The WebMCP surface: registers the tools with document.modelContext. Served only when Umbraco:WebMCP:ModelContext
// (or Enabled) allows it, separately from the page API and the tools themselves.

let detach: (() => void) | undefined;

export const onInit: UmbEntryPointOnInit = () => {
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
};
