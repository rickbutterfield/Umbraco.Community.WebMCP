import { UMB_DOCUMENT_WORKSPACE_ALIAS } from '@umbraco-cms/backoffice/document';
import { UMB_WORKSPACE_CONDITION_ALIAS } from '@umbraco-cms/backoffice/workspace';

export const manifests: Array<UmbExtensionManifest> = [
	{
		// No conditions, so it is created in every workspace.
		type: 'workspaceContext',
		alias: 'Umbraco.WebMCP.WorkspaceContext',
		name: 'WebMCP Workspace Context',
		api: () => import('./webmcp.workspace-context.ts'),
	},
	{
		type: 'webMcpWorkspaceToolset',
		alias: 'Umbraco.WebMCP.WorkspaceToolset.Document',
		name: 'WebMCP Document Workspace Toolset',
		api: () => import('./document.workspace-toolset.ts'),
		conditions: [{ alias: UMB_WORKSPACE_CONDITION_ALIAS, match: UMB_DOCUMENT_WORKSPACE_ALIAS }],
	},
];
