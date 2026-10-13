# Brief

## Problem

The Umbraco.AI Copilot can edit the entity a user has selected (`set_value`, `add_item`, `save`,
`save_and_publish` and similar), but it can't move around the backoffice. It can't open another section, browse a tree,
open a different document or form, run an entity action from the "..." menu, use a Create dialog option, or work
through a modal. A user who asks it "open the Contact form and delete it", or "create a new form from the contact
template", has to do the navigation by hand first.

This package already has those tools for agents outside the backoffice, through WebMCP. Most of them are discovered from the backoffice extension registry, so they work for packages such as
Umbraco Forms without package-specific code. The Copilot runs browser tools of almost the same shape:
`uaiAgentFrontendTool` extensions, with a name, a description, JSON Schema parameters, a scope, an `isDestructive` flag,
optional approval and `execute(args)`. See [docs/umbraco-ai-copilot.md](../../umbraco-ai-copilot.md). Bridging the
two gives the Copilot the backoffice-wide tools.

**Who it's for:** backoffice editors using the Copilot, in production. Developers and testers benefit too, but they
aren't the target.

This changes a standing rule. Until now, the package's tools only loaded in Development, unless switched on
explicitly. The bridge has to work on production sites, so:

> ASSUMPTION: The bridge has its own opt-in setting, separate from the WebMCP tools. Switching on the Copilot bridge
> in production does **not** register tools on `document.modelContext`. That stays dev-only unless switched on
> separately.

> ASSUMPTION: In production, the safety boundary is the Copilot's agent tool permissions plus the editor's own user
> permissions. Every tool that changes data needs approval in the chat. Nothing the bridge adds lets an agent do
> anything the editor couldn't do by clicking.

**Why now:**
- **A real consumer today.** The Copilot ships now, while mainstream agents don't call WebMCP yet.
- **An internal demonstration.** It shows the DXP and Umbraco.AI teams what backoffice-wide tools could do.
- **Input to the Umbraco.AI roadmap.** It helps decide whether the Copilot should get navigation, or a shared tool
  extension type, itself.
- **Personal exploration,** and possibly a blog post.

**Success looks like:**

> ASSUMPTION: In the Umbraco.AI demo site, with Umbraco Forms installed, an agent granted the bridge's scopes can do
> each of these from a single chat prompt, with the user approving each change in the chat:
> - "Open the Contact form" lands in the form's workspace.
> - "Create a new form from the contact template and save it" creates and saves the form.
> - "Delete the Contact form" runs the Delete action and clicks Delete in its confirmation modal.

> ASSUMPTION: An agent without the bridge's scopes never sees the tools. The Copilot's existing permission filtering
> does this; the bridge only has to declare scopes.

> ASSUMPTION: On a site running in Production, with only the bridge switched on, the tools reach the Copilot.
> `document.modelContext` gets nothing.

**Constraints:**

> ASSUMPTION: Umbraco CMS 18 and Umbraco.AI 18.1 or later, the released line that has `uaiAgentFrontendTool` with
> scopes, `isDestructive` and approval. Nothing earlier.

> ASSUMPTION: This package must not take a runtime dependency on Umbraco.AI. The bridge registers manifests of the
> `uaiAgentFrontendTool` type, which do nothing when the Copilot isn't installed, the same way products can register
> `webMcpToolset` manifests without depending on this package.

> ASSUMPTION: Tools that change data go through the Copilot's own approval prompt. The bridge never calls a
> consequential tool without it.

**Riskiest unknowns:**

1. **Tools that come and go at runtime.** The Copilot's frontend tool manifests don't apply conditions yet, so every
   registered tool is offered everywhere. Workspace tools would need their manifests added and removed as workspaces
   open and close. It's unknown whether the Copilot's tool list updates mid-conversation when the registry changes,
   and whether a model copes with tools disappearing between turns.
2. **Where tools run.** Copilot tool APIs are created with the chat element as their host, not a workspace. The
   bridge forwards to this package's tool hub, which keeps its own hosts, so this should be fine, but it's untested.
3. **How long actions take.** This package's actions return `completed: false` while a modal is open. The model has
   to understand it should then use the modal tools on its next turn. Prompting quality is unknown.
4. **Overlap with the Copilot's own tools.** The Copilot already edits and saves the selected entity. The model may
   pick the wrong tool (for example this package's `umbraco_run_workspace_action` Save instead of the Copilot's
   `save`). Which of this package's tools to leave out is a design question.
5. **Context window cost.** About 20 extra tool definitions are sent with every request.
6. **Production hardening.** Until now, this package has been a dev-only spike. Running in editors' browsers in
   production raises the bar for:
   - error handling;
   - performance: the extension registry walks and the DOM walk used to find modal buttons;
   - modal buttons matched by translated label rather than by `id`;
   - prompt injection: tool results include editor-written content such as names and modal data, and the Copilot's
     tool contract has no equivalent of WebMCP's `untrustedContentHint`.

**Smallest version worth shipping:**

> ASSUMPTION: Read-only navigation (sections, menus, trees, open entity, get location) plus entity actions, create
> options and modal buttons, all behind approval where they change data. Leave out the document tools and the
> workspace footer actions, which overlap with the Copilot's entity tools.

**What would kill it:** any of these, found while testing in the Umbraco.AI demo site:
- **Models misuse the tools.** The model regularly picks the wrong tool, or gets stuck after an action opens a modal.
- **Dynamic tools don't work.** The Copilot can't handle workspace tools appearing and disappearing mid-conversation.
- **Too much context cost.** The extra tool definitions noticeably hurt the Copilot's answers, or what it costs to
  run.

The Copilot gaining its own navigation tools is **not** a reason to stop. The bridge would still add package-agnostic
actions and modals.

## Non-goals

- **Changing Umbraco.AI.** The bridge lives on this package's side and uses only the public `uaiAgentFrontendTool`
  contract. Proposals for the Copilot itself (applying conditions to frontend tools, a shared tool extension type
  with WebMCP) are separate conversations, and a shared type in the CMS would go through the RFC process.
- **Putting the Copilot's tools on WebMCP** (the other direction). It needs its own answer for approvals, which only
  exist in the chat UI.
- **Replacing the Copilot's entity editing.** Its block-aware `set_value` and related tools stay the way to edit
  content.
- **Products other than Umbraco Forms.** Workflow, Commerce and the others may need their own toolsets first; the
  survey in this repo's history found Commerce and Engage don't follow the standard navigation patterns.
