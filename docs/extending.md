# Adding tools from a package

Packages add tools by registering toolset extensions. If this package isn't installed, nothing reads those manifests,
and their code is only loaded when a toolset is used. So a product can ship them in its `umbraco-package.json` at no
cost and without a dependency.

## Toolset types

| Type | Available | Conditions are evaluated | Constructor arguments |
|---|---|---|---|
| `webMcpToolset` | Anywhere in the backoffice, while its conditions are met | On the backoffice element, so section and user-permission conditions work; workspace conditions don't | The host |
| `webMcpWorkspaceToolset` | While a matching workspace is open | Inside the workspace, so `Umb.Condition.WorkspaceAlias` works | The host, then the workspace context |

## Example

```ts
{
	type: 'webMcpWorkspaceToolset', // or 'webMcpToolset' for tools available anywhere
	alias: 'My.WebMcpToolset.Order',
	name: 'Order WebMCP tools',
	api: () => import('./order.webmcp-toolset.js'),
	conditions: [{ alias: 'Umb.Condition.WorkspaceAlias', match: 'My.Workspace.Order' }],
}
```

The module exports `api`, a class with `getTools()`, which returns the tools:

```ts
export class MyOrderWebMcpToolset extends UmbControllerBase {
	getTools() {
		return [
			{
				name: 'myshop_get_order_status',
				description: 'Returns the status of the open order.',
				annotations: { readOnlyHint: true },
				execute: async () => ({ status: '…' }),
			},
		];
	}
}

export { MyOrderWebMcpToolset as api };
```

Each tool has a `name`, a `description` written for an agent, an optional JSON Schema `inputSchema`, optional
`annotations` and an `execute(input)` that returns a JSON-serialisable result.
`src/Umbraco.WebMCP.StaticAssets/src/workspace/document.workspace-toolset.ts` is a complete example.

## Guidelines

- **Prefix tool names with your package,** for example `myshop_…`. Tool names share one namespace, and the newest
  registration of a name wins, so `umbraco_…` names would replace this package's tools.
- **Name tools `<package>_<verb>_<thing>`,** for example `myshop_publish_order`, not `myshop_order_publish`. This
  package uses the same verb-first shape (`umbraco_list_modals`, `umbraco_save_document`), so an agent scanning the
  tool list sees one pattern, and a `list_…` tool pairs with a `run_…` tool.
- **Mark read-only tools `readOnlyHint` and tools that change data `consequentialHint`.**
- **Run the backoffice's own code.** Call the same actions, repositories and contexts the UI uses, so tools respect
  permissions and do the same work as a click.
- **Don't block on modals.** If a tool opens a modal, return before it closes, so the agent can drive it with the
  modal tools.
- **Mark output containing editor-written content `untrustedContentHint`.** It may contain text written to
  manipulate an agent.

The toolset types are at version 0.x and may change before 1.0.
