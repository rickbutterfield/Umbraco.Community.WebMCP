# Vocabulary

Terms used across this repository's code and docs. Use these words, and only with these meanings.

## This package

| Term | Meaning |
|---|---|
| **Tool** | One named action an agent can call, with a description, an optional JSON Schema input and `execute`. For example `umbraco_open_entity`. |
| **Tool hub** | The in-page registry of tools (`umbWebMcpToolHub`). It exposes each tool name once, and when two registrations share a name, the newest one handles calls. |
| **Toolset** | A backoffice extension that provides tools: `webMcpToolset` (available anywhere) or `webMcpWorkspaceToolset` (while a matching workspace is open). See [Adding tools from a package](extending.md). |
| **Generic tools** | The tools this package provides for any section, tree, workspace, action or modal, discovered from the extension registry, as opposed to product-specific toolsets. |
| **Copilot bridge** | The planned feature that offers this package's tools to the Umbraco.AI Copilot as frontend tools. See [docs/plans/copilot-bridge](plans/copilot-bridge/README.md). |
| **Surface** | One way the tools reach an agent: WebMCP or the Copilot bridge. Each surface has its own switch for whether it loads in production. |
| **Landmarks and controls** | The mental model for the tools. Landmarks are where you can go (sections, menus, trees, workspaces); controls are what you can do there (entity actions, create options, workspace actions, modal buttons). A metaphor, not ARIA: these aren't ARIA landmark roles or HTML controls, though they play the same part for an agent that those play for a screen reader user. |
| **Tool name** | `umbraco_<verb>_<thing>`, verb first, for example `umbraco_list_modals`. `scripts/check-tool-names.mjs` checks the shape and compares the set against `scripts/tool-names.json`. |
| **Read-only / consequential** | The `readOnlyHint` and `consequentialHint` annotations: a tool that only reads, or one that changes data and should be confirmed. They're hints, not restrictions. |

## Umbraco backoffice

| Term | Meaning |
|---|---|
| **Extension registry** | The backoffice's list of registered extensions (`umbExtensionsRegistry`). The generic tools read it to find sections, trees, actions and workspaces. |
| **Entity action** | An action in an item's "..." menu, such as Delete or Move (`entityAction`). |
| **Create option** | An option in the dialog an item's Create action opens, such as New Form (`entityCreateOptionAction`). |
| **Workspace action** | A button in a workspace footer, such as Save (`workspaceAction`). |
| **Modal** | A dialog or sidebar opened through the modal manager. Its buttons may do work before it submits. |
| **Block** | One item in a Block List or Block Grid property: a layout entry, content data (an element type's values) and, if its block type has them, settings data. The block tools identify a block by its **block key**, the content key. |
| **Block manager** | The backoffice context that holds a block property's layouts, content, settings and exposes and creates new blocks (`UmbBlockManagerContext`). The block tools run one per call. |
| **Expose** | An entry in a block value saying a block exists in a variant (culture and segment). A block without one for a variant is stored but not exposed in it. |
| **Area** | A slot inside a Block Grid block that holds other blocks, configured per block type with an alias, a width and the block types it allows. |

## Elsewhere

| Term | Meaning |
|---|---|
| **WebMCP** | The browser API (`document.modelContext`) for pages to offer tools to in-browser agents; a W3C Community Group draft. |
| **Developer MCP** | Umbraco's server-side MCP server, which works against the Management API as an API user. See [Umbraco MCP, WebMCP and Playwright](testing-layers.md). |
| **Frontend tool** | An Umbraco.AI Copilot tool that runs in the browser (`uaiAgentFrontendTool`). See [Umbraco.AI Copilot frontend tools](umbraco-ai-copilot.md). |
| **Plan folder** | `docs/plans/<feature-slug>/`, where a feature's brief, design and plan live while it's planned and built. See `CLAUDE.md`. |
