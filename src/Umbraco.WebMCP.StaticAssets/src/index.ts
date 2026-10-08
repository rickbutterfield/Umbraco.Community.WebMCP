import './extension-types.ts';
import type { UmbWebMcpToolsetApi } from './extension-types.ts';
import { exposePageApi, getModelContext, registerTools } from './model-context.ts';
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

export const onInit: UmbEntryPointOnInit = (host, extensionRegistry) => {
	if (!getModelContext()) {
		console.info(
			'[WebMCP] document.modelContext is not available, so tools are only reachable through window.__umbWebMcp. Enable chrome://flags/#enable-webmcp-testing for WebMCP.',
		);
	}

	exposePageApi();
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
	delete (window as any).__umbWebMcp;
};
