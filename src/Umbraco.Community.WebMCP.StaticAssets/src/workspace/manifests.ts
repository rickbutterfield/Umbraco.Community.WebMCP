import { UMB_DOCUMENT_WORKSPACE_ALIAS } from '@umbraco-cms/backoffice/document';
import { UMB_WORKSPACE_CONDITION_ALIAS } from '@umbraco-cms/backoffice/workspace';

/** Permits an extension while the open content workspace's type has a Block List or Block Grid property. */
export const UMB_WEBMCP_HAS_BLOCK_PROPERTY_CONDITION_ALIAS = 'Umbraco.Community.WebMCP.Condition.HasBlockProperty';

export const manifests: Array<UmbExtensionManifest> = [
	{
		// No conditions, so it is created in every workspace.
		type: 'workspaceContext',
		alias: 'Umbraco.Community.WebMCP.WorkspaceContext',
		name: 'WebMCP Workspace Context',
		api: () => import('./webmcp.workspace-context.ts'),
	},
	{
		type: 'webMcpWorkspaceToolset',
		alias: 'Umbraco.Community.WebMCP.WorkspaceToolset.Document',
		name: 'WebMCP Document Workspace Toolset',
		api: () => import('./document.workspace-toolset.ts'),
		conditions: [{ alias: UMB_WORKSPACE_CONDITION_ALIAS, match: UMB_DOCUMENT_WORKSPACE_ALIAS }],
	},
	{
		type: 'condition',
		alias: UMB_WEBMCP_HAS_BLOCK_PROPERTY_CONDITION_ALIAS,
		name: 'WebMCP Has Block Property Condition',
		api: () => import('./has-block-property.condition.ts'),
	},
	{
		// Only for document types with a Block List or Block Grid property, so other documents don't carry the tools
		type: 'webMcpWorkspaceToolset',
		alias: 'Umbraco.Community.WebMCP.WorkspaceToolset.Blocks',
		name: 'WebMCP Block Editor Workspace Toolset',
		api: () => import('./block.workspace-toolset.ts'),
		conditions: [
			{ alias: UMB_WORKSPACE_CONDITION_ALIAS, match: UMB_DOCUMENT_WORKSPACE_ALIAS },
			{ alias: UMB_WEBMCP_HAS_BLOCK_PROPERTY_CONDITION_ALIAS },
		],
	},
];
