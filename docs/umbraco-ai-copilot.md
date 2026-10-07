# Umbraco.AI Copilot frontend tools

*Last checked: 07-10-2026, against Umbraco.AI on the `v18/dev` branch (released packages: Umbraco.AI.Agent.Copilot 18.1.1, Umbraco.AI.Agent.UI 18.2.0). Check against the current Umbraco.AI release before building on it.*

How the Umbraco.AI Copilot runs tools in the browser, and how this package's tools map onto them. For why this
matters, see [Why WebMCP, beyond testing](why-webmcp.md#with-the-umbracoai-copilot).

## The design

Frontend tools are split: **the model decides on the server, the tool runs in the browser**, and the
[AG-UI](https://docs.ag-ui.com/) protocol carries the call between them.

A frontend tool is a `uaiAgentFrontendTool` extension. Its `meta` holds:

- `toolName`, the name the model calls;
- `description`;
- `parameters`, a JSON Schema;
- optional `scope`, `isDestructive` and `approval`.

Its `api` is a class with `execute(args)`. An optional `uaiAgentToolRenderer` extension with the same `toolName`
controls how the call looks in the chat (label, icon or a custom element). The Copilot's own content-editing tools
(`set_value`, `add_item`, `remove_item`, `move_item`, `clear_value`, `save`, `save_and_publish`) are registered this
way.

## One call, end to end

1. **Register.** A package adds `uaiAgentFrontendTool` manifests to the extension registry.
2. **Collect.** The chat's frontend tool manager watches the registry for that type and keeps a list of tool
   definitions.
3. **Send with every request.** Each send, resume and regenerate passes the tool list to the server alongside the
   messages. The server doesn't remember frontend tools; they arrive fresh every time.
4. **Filter by permission on the server.** Each tool becomes a server-side function that the model can see. The
   server keeps a tool only if the agent's allowed tools include its name, or its allowed scopes include the tool's
   `scope`, so the model never sees tools the agent hasn't been granted. The same manifests are listed in the agent
   permissions screen, grouped by scope.
5. **The model calls it, and the server stops.** The server-side function runs nothing. When it's invoked, it ends
   the server's tool loop. If the model calls server tools and frontend tools in the same turn, the server runs its
   own tools first, then stops.
6. **The run ends with an interrupt.** The server finishes the run with an interrupt whose reason is `tool_call`,
   with one entry per pending frontend call.
7. **The browser picks it up.** A handler registered for the `tool_call` reason finds the frontend tool calls in the
   last assistant message and runs them. The reason string has to match exactly; otherwise the call falls through to
   the default handler and never runs.
8. **Approve, then run.** Calls run one at a time:
   - If the manifest has `approval`, the chat shows an Approve/Deny prompt first and waits. If the user denies, the
     result is `{ error: "User cancelled the operation" }`.
   - Otherwise the tool's API is loaded (and cached), the arguments are parsed, and `execute(args)` is awaited.
   - A thrown error becomes an `{ error }` result instead of failing the run.
9. **Resume.** Each result becomes a `tool` message linked by its call ID. When all calls have finished, the chat
   sends a new request with the history, results included, and the tool list again. The model carries on from
   there.

## Design points that matter

- **Approval happens only in the browser.** The server knows about `isDestructive` only for permissions. The
  Approve/Deny prompt belongs to the chat, so anything that calls a tool's `execute` directly, as exposing it on WebMCP
  would, skips it.
- **Conditions aren't applied yet.** The Copilot's frontend tool manifests don't support conditions in this first
  version, so every registered tool is offered everywhere. A tool that should only exist while a workspace is open
  has to be added to and removed from the registry by hand.
- **Calls run one after another, in the chat's context.** The tool API's host is the chat element, not a workspace.
  The Copilot's entity tools reach the workspace through the Copilot's entity context.

## Mapping this package's tools

| Umbraco.WebMCP tool | `uaiAgentFrontendTool` |
|---|---|
| `name` (for example `umbraco_open_entity`) | `meta.toolName`, which must match the name the model calls |
| `description` | `meta.description` |
| `inputSchema` | `meta.parameters` (required there; default to `{ type: "object" }`) |
| `annotations.readOnlyHint` | A read `scope`, such as `backoffice-navigation`, that administrators grant per agent |
| `annotations.consequentialHint` | `isDestructive: true` plus `approval: true`, so the chat asks first |
| `execute(input)`, which returns a value | `api.execute(args)`, which returns a value that becomes the tool result |
| Workspace tools appearing and disappearing through the tool hub | Registering and unregistering manifests as the hub changes, because conditions aren't applied yet |
| Actions returning `completed: false` while a modal is open | Works as is: the result goes back to the model, which can call the modal tools on its next turn |

So the Copilot bridge needs:

1. **One generic tool API** that forwards `execute(args)` to the tool hub's `call(name, args)`.
2. **A sync** that keeps one `uaiAgentFrontendTool` manifest per tool in step with the hub.
3. **No document tools.** The Copilot's own entity tools already cover document editing, with block-aware paths.

Going the other way, putting the Copilot's tools on WebMCP, must not expose tools marked `approval` without an
equivalent confirmation.
