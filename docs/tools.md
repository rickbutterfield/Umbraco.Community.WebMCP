# Tools

*Last checked: 13-10-2026, against WebMCP (W3C Community Group draft of 02-10-2026). The annotation names come from
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
| `umbraco_run_entity_action` | always | Run an action from an entity's "..." menu by label, such as Trash; lists them without one | C |
| `umbraco_run_create_option` | always | Run an option from an entity's Create dialog by label, such as New Form; lists them without one | none |
| `umbraco_list_modals` | always | Open modals, with their data, value and buttons (id and label) | R, U |
| `umbraco_click_modal_button` | always | Click a modal button by id, or by label | C |
| `umbraco_set_modal_value` | always | Change a modal's pending value | U |
| `umbraco_submit_modal` / `umbraco_close_modal` | always | Submit or dismiss a modal through its context | C / none |
| `umbraco_list_allowed_document_types` | Content section open | Allowed document types at root or under a parent | R, U |
| `umbraco_open_new_document` / `umbraco_open_document` | Content section open | Open the document workspace | none |
| `umbraco_create_document` | Content section open | Open a new document, set its name (or names by culture) and values, and save or publish it, in one call | C, U |
| `umbraco_get_workspace_info` | any workspace open | Workspace alias, entity type, key, new and unsaved state, and footer actions | R |
| `umbraco_run_workspace_action` | any workspace open | Run a workspace footer button by label, such as Save; `umbraco_get_workspace_info` lists them | C |
| `umbraco_get_document_state` | document workspace open | Key, variants, variant options (every culture, created or not), properties and current (unsaved) values | R, U |
| `umbraco_set_document_name` | document workspace open | Set the name for a variant | none |
| `umbraco_set_document_property_value` | document workspace open | Set a value by alias (stored format) | none |
| `umbraco_save_document` / `umbraco_save_and_publish_document` | document workspace open | Same as the buttons | C, U |
| `umbraco_list_blocks` | document workspace open | The blocks in a Block List or Block Grid property (keys, block types, values, settings, grid areas) and the block types that can be added | R, U |
| `umbraco_add_block` | document workspace open | Add a block of an allowed type, with values, at an index or in a Block Grid area | U |
| `umbraco_set_block_values` | document workspace open | Set a block's values or settings by its key | U |
| `umbraco_remove_block` / `umbraco_move_block` | document workspace open | Remove a block (with its area blocks), or move it to an index or into or out of a Block Grid area | U |
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
  workspace (`umbraco_set_document_*`), choosing in a modal (`umbraco_select_picker_item`, `umbraco_set_modal_value`), dismissing a modal and `umbraco_run_create_option`
  (which opens an unsaved workspace or a modal) change nothing until something is saved or submitted. Navigating away
  from unsaved changes shows the backoffice's own discard prompt. The block tools (`umbraco_add_block`,
  `umbraco_set_block_values`, `umbraco_remove_block`, `umbraco_move_block`) stage edits the same way.
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
- **Documents that vary by culture.** Saving or publishing one opens a dialog to choose the variants. Pass `cultures`
  to `umbraco_save_document`, `umbraco_save_and_publish_document` or `umbraco_create_document` (which takes `names`
  and `culturedValues` by culture) and the tool answers the dialog with those variants. It refuses cultures the
  document doesn't have or the user can't edit, and, when publishing, mandatory languages that aren't published yet
  and aren't included, which the server would reject. Without `cultures`, the tool returns `completed: false` and
  `variantDialog` with the open dialog. Scheduling and publishing with descendants still open their own dialogs.
- **Pick with `umbraco_select_picker_item`, not `umbraco_set_modal_value`.** Pickers keep their selection in their
  tree, so a changed modal value doesn't always reach them: Forms' Move to ignores it and keeps Move disabled. The
  tool selects through the tree's own selection, checks the picker's filter (such as folders only) and returns the
  selection and buttons. Items inside a collapsed folder can still be picked by their unique.
- **Edit blocks with the block tools, not the stored value.** `umbraco_set_document_property_value` can rewrite a
  Block List or Block Grid value, but the agent then has to write the stored format: new keys, an `editorAlias` per
  value and an `expose` entry per block. A block without one saves without an error but stays unexposed, and no other
  tool returns the element type keys or Block Grid area keys a new block needs. The block tools load the property into
  the backoffice's own block manager, so a new block gets the property editors' default values, its settings and its
  `expose` entries, then they write the value back to the document. They work whichever tab the property is on,
  without its editor on screen. Blocks are identified by their key (the content key) from `umbraco_list_blocks`;
  values go in by property alias, each in its property editor's stored format. For a document that varies by
  culture, pass `culture`. In a Block Grid, `parentKey` and `area` (alias or key) put a block in another block's area;
  the tools refuse block types the root or area doesn't allow, more blocks than its maximum, and moving a block into
  its own areas, and size a block to its container as the grid does. Each change returns the blocks afterwards. Blocks
  nested inside another block's own Block List property aren't reachable yet.
- **Prefer `umbraco_click_modal_button` to `umbraco_submit_modal`.** Many modals do their work in the button handler,
  so submitting through the modal's context skips it.
- **When two registrations share a tool name,** for example a document opened in a modal on top of another, the
  newest one handles calls until it closes. If its description or input schema differs from the one WebMCP holds,
  the name is registered with WebMCP again, and the previous schema comes back when it closes. Schemas that differ
  only in key order count as the same.
- **Cancelling a call stops the wait, not the work.** WebMCP passes an abort signal with each call. A call cancelled
  before it starts never runs the tool. Once an action has started, cancelling makes the tool return straight away with the abort reason, but the
  action carries on: a save that has started still saves.

## Calling tools

The tools are registered with WebMCP (`document.modelContext`). This needs Chrome 149+ with WebMCP switched on; see
the [README](../README.md#driving-it-from-claude-code) for agents.

- **WebMCP gets only the first sentence of each description,** with the full input schema. Clients such as Playwright
  MCP repeat every description in each page snapshot as well as in the agent's tool list, so full descriptions cost
  an agent thousands of tokens a turn. `umbraco_get_tool_description` returns the rest.
- **Errors come back as results.** WebMCP reports an `execute` that throws as a generic `UnknownError`, so a failed
  call resolves with `{ "error": "..." }` instead. A call missing a required parameter names the expected ones.
- **From a script,** `document.modelContext.getTools()` lists the tools and `executeTool(tool, input)` runs one:

  ```js
  const modelContext = document.modelContext;
  const tool = (await modelContext.getTools()).find((x) => x.name === 'umbraco_get_tree_items');
  const result = JSON.parse(await modelContext.executeTool(tool, { treeAlias: 'Forms.Tree.Forms' }));
  ```

  Chrome 155 deprecates passing the input as a JSON string, which Chrome 154 still needs;
  `benchmarks/tests/webmcp-tools.ts` handles both. In a browser without WebMCP, such as Playwright's bundled
  Chromium, load [Google's WebMCP polyfill](https://github.com/GoogleChromeLabs/webmcp-tools) first
  (`benchmarks/tests/webmcp/webmcp-polyfill.js`, with `page.addInitScript`).
