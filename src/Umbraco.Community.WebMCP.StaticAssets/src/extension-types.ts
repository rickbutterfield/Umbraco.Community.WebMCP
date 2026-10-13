import type { UmbWebMcpTool } from './model-context.ts';
import type { ManifestApi, ManifestWithDynamicConditions, UmbApi } from '@umbraco-cms/backoffice/extension-api';

/**
 * The API a toolset extension exports. It is constructed with the host it runs in, so it can consume contexts.
 */
export interface UmbWebMcpToolsetApi extends UmbApi {
	getTools(): Array<UmbWebMcpTool>;
}

/**
 * Tools that are available anywhere in the backoffice while the manifest's conditions are met. Conditions are
 * evaluated on the backoffice element, so section and user-permission conditions work; workspace conditions don't.
 *
 * Products can register these without depending on this package: without it, the manifest is never read.
 */
export interface ManifestWebMcpToolset
	extends ManifestApi<UmbWebMcpToolsetApi>, ManifestWithDynamicConditions<UmbExtensionConditionConfig> {
	type: 'webMcpToolset';
}

/**
 * Tools that exist while a matching workspace is open. The API is constructed with the workspace context as its only
 * argument, and conditions are evaluated inside the workspace, so `Umb.Condition.WorkspaceAlias` works.
 */
export interface ManifestWebMcpWorkspaceToolset
	extends ManifestApi<UmbWebMcpToolsetApi>, ManifestWithDynamicConditions<UmbExtensionConditionConfig> {
	type: 'webMcpWorkspaceToolset';
}

declare global {
	interface UmbExtensionManifestMap {
		umbWebMcpToolset: ManifestWebMcpToolset;
		umbWebMcpWorkspaceToolset: ManifestWebMcpWorkspaceToolset;
	}
}
