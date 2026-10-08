import { exposePageApi } from '../model-context.ts';
import type { UmbEntryPointOnInit, UmbEntryPointOnUnload } from '@umbraco-cms/backoffice/extension-api';

// The page API surface: exposes the tools as window.__umbWebMcp for page scripts such as Playwright. Served only when
// Umbraco:WebMCP:PageApi (or Enabled) allows it, separately from WebMCP and the tools themselves.

export const onInit: UmbEntryPointOnInit = () => {
	exposePageApi();
};

export const onUnload: UmbEntryPointOnUnload = () => {
	delete (window as any).__umbWebMcp;
};
