# Tools

*Last checked: 08-10-2026, against WebMCP (W3C Community Group draft of 02-10-2026). The annotation names come from
the draft and may change.*

The tools this package registers, and how to call them. Most tools read the backoffice extension registry, so they
work for packages such as Umbraco Forms without any package-specific code.

In the Hints column, R is `readOnlyHint`, C is `consequentialHint` and U is `untrustedContentHint`; see
[Annotations](#annotations). Where a row has two tools, the hints before and after the slash are for each in turn.

| Tool | When registered | What it does | Hints |
|------|-----------------|--------------|-------|
| `umbraco_get_location` | always | Current path, section and open workspace | R |
| `umbraco_navigate` | always | Push a `/umbraco/...` path | none |
| `umbraco_list_sections` | always | Sections the current user can access | R |
| `umbraco_list_section_menu` | always | A section's sidebar menu items, with their tree alias or entity type | R |
| `umbraco_get_tree_items` | always | Root entity and root items of a tree, or the children of an item | R, U |
| `umbraco_search_entities` | always | Find entities by name with the backoffice search; returns their paths | R, U |
| `umbraco_open_entity` | always | Open `section/{section}/workspace/{entityType}/edit/{unique}` | none |
| `umbraco_list_entity_actions` / `umbraco_run_entity_action` | always | The "..." menu of an entity | R / C |
| `umbraco_list_create_options` / `umbraco_run_create_option` | always | The options in an entity's Create dialog | R / none |
| `umbraco_list_modals` | always | Open modals, with their data, value and buttons (id and label) | R, U |
| `umbraco_click_modal_button` | always | Click a modal button by id, or by label | C |
| `umbraco_set_modal_value` | always | Change a modal's pending value | U |
| `umbraco_submit_modal` / `umbraco_close_modal` | always | Submit or dismiss a modal through its context | C / none |
| `umbraco_list_allowed_document_types` | always | Allowed document types at root or under a parent | R, U |
| `umbraco_open_new_document` / `umbraco_open_document` | always | Open the document workspace | none |
| `umbraco_get_workspace_info` | any workspace open | Workspace alias, entity type, key, new and unsaved state | R |
| `umbraco_list_workspace_actions` / `umbraco_run_workspace_action` | any workspace open | The workspace footer buttons, such as Save | R / C |
| `umbraco_get_document_state` | document workspace open | Key, variants, properties and current (unsaved) values | R, U |
| `umbraco_set_document_name` | document workspace open | Set the name for a variant | none |
| `umbraco_set_document_property_value` | document workspace open | Set a value by alias (stored format) | none |
| `umbraco_save_document` / `umbraco_save_and_publish_document` | document workspace open | Same as the buttons | C, U |
| `umbraco_get_tool_description` | WebMCP surface enabled | A tool's full description (WebMCP gets the first sentence only) | R |

Packages can add their own tools; see [Adding tools from a package](extending.md).

## Annotations

Annotations are hints to the agent and its host, not restrictions. The tools enforce nothing themselves, and the
current user's permissions still apply. The host decides what to do with them; for example, the
[Copilot bridge](umbraco-ai-copilot.md) asks the editor to approve consequential calls.

- **`readOnlyHint`:** the tool only reads. It changes nothing, not even what's on screen.
- **`consequentialHint`:** a call may save, delete, move or publish something. A tool is marked if *any* input can do
  that. The four tools whose effect depends on the input are always marked, failing closed rather than guessing from
  the input:
  - `umbraco_run_entity_action`: Delete, Trash and Move change data; Reload doesn't.
  - `umbraco_click_modal_button`: Delete or Submit change data; Cancel or Close don't.
  - `umbraco_submit_modal`: whatever opened the modal acts on the value.
  - `umbraco_run_workspace_action`: Save, Save and publish, and Save and preview all persist.
- **Not consequential:** tools that only change what's on screen. Navigating, opening, staging edits in the open
  workspace (`umbraco_set_document_*`, `umbraco_set_modal_value`), dismissing a modal and `umbraco_run_create_option`
  (which opens an unsaved workspace or a modal) change nothing until something is saved or submitted. Navigating away
  from unsaved changes shows the backoffice's own discard prompt.
- **`untrustedContentHint`:** the result can contain text that editors wrote, such as names, property values or a
  modal's value, and that text may have been written to manipulate an agent. Tools that return only aliases, keys,
  flags and labels from extension manifests aren't marked. It's a label, not a defence; the defence is approval on
  consequential calls.
- **`debugging`:** set on every tool, because this package is for development and testing.

## Behaviour

- **Opening a workspace waits for it, and says what it added.** `umbraco_navigate`, the `umbraco_open_*` tools, and
  create options and entity actions that navigate wait until the workspace has loaded (up to 10 s), then return
  `workspaceReady` and `workspaceTools`: the tools that exist only while that workspace is open. Workspace tools are
  only registered once the workspace has loaded, so one that appears can be called straight away.
- **Actions report what happened.** `umbraco_run_entity_action`, `umbraco_run_workspace_action` and the document save
  tools return the `notifications` the backoffice showed during the action, and `navigatedTo` when the path changed.
  Umbraco 18 shows no notification for routine saves, trashes or deletes, so the list is often empty; validation
  failures come back as an error instead.
- **Modal buttons report the modal closing.** `umbraco_click_modal_button`, `umbraco_submit_modal` and
  `umbraco_close_modal` wait up to 2 s for the modal to close, then briefly for notifications, and return `closed`
  with them. A modal that stays open (a validation error, or a second step) returns `closed: false`.
- **Match modal buttons by `id`.** `umbraco_list_modals` returns each button's `id` (for example `confirm` and
  `cancel` in confirmation dialogs) and label. Labels change when the backoffice is translated; ids don't.
- **Actions that open a modal don't wait for it.** They return straight away with `completed: false`, so the agent
  can finish the modal with the modal tools.
- **Prefer `umbraco_click_modal_button` to `umbraco_submit_modal`.** Many modals do their work in the button handler,
  so submitting through the modal's context skips it.
- **When two registrations share a tool name,** for example a document opened in a modal on top of another, the
  newest one handles calls until it closes. If its description or input schema differs from the one WebMCP holds,
  the name is registered with WebMCP again, and the previous schema comes back when it closes. Schemas that differ
  only in key order count as the same.
- **Cancelling a call stops the wait, not the work.** WebMCP passes an abort signal with each call, and the page API
  takes one as a third argument (`call(name, input, { signal })`). A call cancelled before it starts never runs the
  tool. Once an action has started, cancelling makes the tool return straight away with the abort reason, but the
  action carries on: a save that has started still saves.

## Calling tools

The same tools are available through two surfaces. Each is its own backoffice entry point with its own setting (see
the [README](../README.md#enabling)), so enabling one never enables the other:

- **WebMCP** (`document.modelContext`), for in-browser agents. This needs Chrome 149+ with WebMCP switched on; see
  the [README](../README.md#driving-it-from-claude-code). In Chrome 154, `document.modelContext.getTools()` lists the
  tools and `executeTool(tool, inputJson)` runs one; `benchmarks/tests/webmcp` uses them. WebMCP gets only the
  first sentence of each tool's description, with the full input schema: clients such as Playwright MCP repeat every
  description in each page snapshot as well as in the agent's tool list, so full descriptions cost an agent thousands
  of tokens a turn. `umbraco_get_tool_description` returns the rest.
- **The page API** (`window.__umbWebMcp`), for page scripts. It works with or without the Chrome flag:

  ```js
  window.__umbWebMcp.list(); // name, one-sentence summary, parameter names and annotations of each tool
  window.__umbWebMcp.describe('umbraco_save_document'); // one tool in full, with its input schema
  window.__umbWebMcp.list({ full: true }); // every tool in full
  await window.__umbWebMcp.call('umbraco_get_tree_items', { treeAlias: 'Forms.Tree.Forms' });
  await window.__umbWebMcp.call('umbraco_save_document', {}, { signal: AbortSignal.timeout(10_000) });
  ```

  `list()` is short on purpose: agents read it whole, and every input schema in it costs tokens. It gives each tool's
  parameter names (`input`, with optional ones ending in `?`), and a call missing a required parameter fails with an
  error that names the expected ones, so agents rarely need `describe`. Use it from
  Playwright's `page.evaluate`, or from Playwright MCP's `browser_evaluate`.
