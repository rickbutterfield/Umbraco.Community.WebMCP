import './extension-types.ts';
import type { UmbWebMcpToolsetApi } from './extension-types.ts';
import { registerTools } from './model-context.ts';
import { UmbWebMcpNotificationWatcher } from './notification-watcher.ts';
import { createEntityActionTools } from './tools/entity-action.tools.ts';
import { createModalTools } from './tools/modal.tools.ts';
import { createNavigationTools } from './tools/navigation.tools.ts';
import { manifests as workspaceManifests } from './workspace/manifests.ts';
import { UmbExtensionsApiInitializer } from '@umbraco-cms/backoffice/extension-api';
import type { UmbEntryPointOnInit, UmbEntryPointOnUnload } from '@umbraco-cms/backoffice/extension-api';

export type * from './extension-types.ts';
export type { UmbWebMcpTool, UmbWebMcpToolAnnotations } from './model-context.ts';

const abortController = new AbortController();
let toolsetAbortController: AbortController | undefined;

// The tools themselves. They only become reachable through a surface, each its own entry point that the server serves
// only when that surface is enabled: surfaces/model-context.entry.ts (WebMCP) and surfaces/page-api.entry.ts.
export const onInit: UmbEntryPointOnInit = (host, extensionRegistry) => {
	new UmbWebMcpNotificationWatcher(host);
	registerTools(
		[...createNavigationTools(host), ...createEntityActionTools(host), ...createModalTools(host)],
		abortController.signal,
	);
	extensionRegistry.registerMany(workspaceManifests);

	// Toolsets that products register for the whole backoffice.
	new UmbExtensionsApiInitializer(host, extensionRegistry as any, 'webMcpToolset', [host], undefined, (controllers) => {
		toolsetAbortController?.abort();
		toolsetAbortController = new AbortController();
		for (const { api } of controllers) {
			if (api) registerTools((api as UmbWebMcpToolsetApi).getTools(), toolsetAbortController.signal);
		}
	});
};

export const onUnload: UmbEntryPointOnUnload = () => {
	abortController.abort();
	toolsetAbortController?.abort();
};
