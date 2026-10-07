# Tools

The tools this package registers, and how to call them. Most tools read the backoffice extension registry, so they
work for packages such as Umbraco Forms without any package-specific code.

| Tool | When registered | What it does |
|------|-----------------|--------------|
| `umbraco_get_location` | always | Current path, section and open workspace |
| `umbraco_navigate` | always | Push a `/umbraco/...` path |
| `umbraco_list_sections` | always | Sections the current user can access |
| `umbraco_list_section_menu` | always | A section's sidebar menu items, with their tree alias or entity type |
| `umbraco_get_tree_items` | always | Root entity and root items of a tree, or the children of an item |
| `umbraco_open_entity` | always | Open `section/{section}/workspace/{entityType}/edit/{unique}` |
| `umbraco_list_entity_actions` / `umbraco_run_entity_action` | always | The "..." menu of an entity |
| `umbraco_list_create_options` / `umbraco_run_create_option` | always | The options in an entity's Create dialog |
| `umbraco_list_modals` | always | Open modals, with their data, value and button labels |
| `umbraco_click_modal_button` | always | Click a modal button by label |
| `umbraco_set_modal_value` / `umbraco_submit_modal` / `umbraco_close_modal` | always | Drive a modal through its context |
| `umbraco_list_allowed_document_types` | always | Allowed document types at root or under a parent |
| `umbraco_open_new_document` / `umbraco_open_document` | always | Open the document workspace |
| `umbraco_get_workspace_info` | any workspace open | Workspace alias, entity type, key, new and unsaved state |
| `umbraco_list_workspace_actions` / `umbraco_run_workspace_action` | any workspace open | The workspace footer buttons, such as Save |
| `umbraco_get_document_state` | document workspace open | Key, variants, properties and current (unsaved) values |
| `umbraco_set_document_name` | document workspace open | Set the name for a variant |
| `umbraco_set_document_property_value` | document workspace open | Set a value by alias (stored format) |
| `umbraco_save_document` / `umbraco_save_and_publish_document` | document workspace open | Same as the buttons |

Packages can add their own tools; see [Adding tools from a package](extending.md).

## Behaviour

- **Read-only tools are marked `readOnlyHint`; tools that change data are marked `consequentialHint`.** These are
  hints to the agent, not restrictions.
- **Actions that open a modal don't wait for it.** They return straight away with `completed: false`, so the agent
  can finish the modal with the modal tools.
- **Prefer `umbraco_click_modal_button` to `umbraco_submit_modal`.** Many modals do their work in the button handler,
  so submitting through the modal's context skips it.
- **When two registrations share a tool name,** for example a document opened in a modal on top of another, the
  newest one handles calls until it closes.

## Calling tools

The same tools are available two ways, whenever the package is enabled:

- **WebMCP** (`document.modelContext`), for in-browser agents. This needs Chrome 149+ with WebMCP switched on; see
  the [README](../README.md#driving-it-from-claude-code).
- **The page API** (`window.__umbWebMcp`), for page scripts. It works with or without the Chrome flag:

  ```js
  await window.__umbWebMcp.call('umbraco_get_tree_items', { treeAlias: 'Forms.Tree.Forms' });
  window.__umbWebMcp.list();
  ```

  Use it from Playwright's `page.evaluate`, or from Playwright MCP's `browser_evaluate`.
