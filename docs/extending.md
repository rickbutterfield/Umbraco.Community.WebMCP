# Adding tools from a package

*Last checked: 08-10-2026, against WebMCP (W3C Community Group draft of 02-10-2026). The annotation names come from
the draft and may change.*

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
`annotations` and an `execute(input, call)` that returns a JSON-serialisable result. `call.signal` aborts when the
caller cancels; see the guidelines.
`src/Umbraco.Community.WebMCP.StaticAssets/src/workspace/document.workspace-toolset.ts` is a complete example.

## Example: the Forms designer

The test site ships a toolset for the Umbraco Forms designer, as Forms itself could
(`examples/Umbraco.Community.WebMCP.TestSite/wwwroot/App_Plugins/WebMcpFormsExample`). It is plain JavaScript, depends
on neither this package nor Forms' code, and works on the form workspace context it is given. The designer edits a
question, condition or workflow in a dialog whose Submit button only copies its value back to the form workspace,
after asking the server to validate the settings; so these tools write to the form workspace directly and call the
same validation, and nothing opens a dialog. Like the designer, they only stage changes, so none is consequential: the
agent saves with `umbraco_run_workspace_action`. Written against Umbraco Forms 18.2.1.

| Tool | What it does | Hints |
|------|--------------|-------|
| `umbraco_forms_get_form_design` | Pages, groups, containers and questions, with any switched-on conditions | R, U |
| `umbraco_forms_list_field_types` | Field types, whether they take options, and their setting aliases | R |
| `umbraco_forms_set_form_name` / `umbraco_forms_set_caption` | Name the form; caption a page or group | none |
| `umbraco_forms_add_page` / `umbraco_forms_add_group` | Add a page (with a group and questions) or a group | none |
| `umbraco_forms_add_field` / `umbraco_forms_add_fields` | Add one or several questions | none |
| `umbraco_forms_get_field_settings` | A question's settings, plus the settings, regex patterns and options its field type offers | R, U |
| `umbraco_forms_set_field_settings` | Change mandatory, messages, regex, options or field type settings, after Forms validates them | U |
| `umbraco_forms_set_condition` | Show or hide a question, group or workflow, or a page's buttons, by rules on other answers | none |
| `umbraco_forms_list_workflow_types` | Workflow types, with their settings and whether they are configured | R |
| `umbraco_forms_list_workflows` | The form's workflows by stage (onSubmit, onApprove, onReject) | R, U |
| `umbraco_forms_add_workflow` | Add a workflow to a stage with its settings, after Forms validates them | U |
| `umbraco_forms_set_workflow` / `umbraco_forms_remove_workflow` | Change a workflow's name, settings, stage or active flag; remove it | U / none |

Questions are found by id, alias or caption, and workflows by id or name. Setting values are stored as Forms stores
them: strings, with `True`/`False` for toggles and commas between list values. A page's condition is Forms' button
condition: it shows or hides the page's buttons, not the page.

## Guidelines

- **Prefix tool names with your package,** for example `myshop_…`. Tool names share one namespace, and the newest
  registration of a name wins, so `umbraco_…` names would replace this package's tools.
- **Name tools `<package>_<verb>_<thing>`,** for example `myshop_publish_order`, not `myshop_order_publish`. This
  package uses the same verb-first shape (`umbraco_list_modals`, `umbraco_save_document`), so an agent scanning the
  tool list sees one pattern, and a `list_…` tool pairs with a `run_…` tool.
- **Mark read-only tools `readOnlyHint`,** but only tools that change nothing, not even what's on screen.
- **Mark a tool `consequentialHint` if any input can save, delete, move or publish.** Hosts such as the Copilot bridge
  ask the editor to approve every call to a consequential tool, without looking at the input. So if a tool runs
  Delete for one input and Cancel for another, mark it; if the harmless uses are common, split it into two tools and
  mark only the one that changes data. Tools that only stage edits in the open workspace, which the editor still has
  to save, aren't consequential. [Tools](tools.md#annotations) shows how this package applies the rule.
- **Run the backoffice's own code.** Call the same actions, repositories and contexts the UI uses, so tools respect
  permissions and do the same work as a click.
- **Don't block on modals.** If a tool opens a modal, return before it closes, so the agent can drive it with the
  modal tools.
- **Workspace toolsets don't need to wait for the workspace.** Their tools are registered only once the workspace
  has loaded, and the tools that open a workspace report them to the agent as `workspaceTools`. If an action can make
  the workspace reload, check it has data again before setting values, or the backoffice fails with "Data is missing".
- **Say what happened.** Return what the action changed, such as the saved state or where it navigated, so the agent
  doesn't need another call or a screenshot to check.
- **Mark output containing editor-written content `untrustedContentHint`.** Anything an editor typed (names,
  property values, a modal's value) may contain text written to manipulate an agent. That includes tools that change
  data and return the result, such as a save that returns the saved values. Output made only of aliases, keys, flags
  and manifest labels doesn't need it.
- **Honour `call.signal`.** If your tool waits for a modal, a request or conditions to settle, stop waiting and reject
  with `signal.reason` when the signal aborts. This package's `runWithoutBlocking` and `waitForQuiet`
  (`src/Umbraco.Community.WebMCP.StaticAssets/src/utils.ts`) show the pattern, including clearing timers. They aren't exported,
  because packages shouldn't depend on this one. Cancelling ends the wait; it can't undo an action that has started.
- **Keep a shared name's schema stable.** When the newest registration of a name has a different description or
  input schema, the name is registered with WebMCP again so agents see the change, and the old schema is restored when
  that registration goes. Each change refreshes the agent's tool list, so don't build descriptions from data that
  changes on every registration.

The toolset types are at version 0.x and may change before 1.0.
