# Why WebMCP, beyond testing

*Last checked: 08-10-2026. The WebMCP maturity facts and the Umbraco.AI details change quickly; recheck them before relying on this page.*

WebMCP lets an agent work inside the page someone already has open: as that person, on what they're looking at, with
every change visible before it's saved. [Umbraco MCP, WebMCP and Playwright](testing-layers.md) covers testing; this
page covers everything else.

## What WebMCP gives any website

- **Fewer steps.** The agent calls named, typed actions instead of reading screenshots or the accessibility tree and
  guessing where to click. In this repo's benchmark that meant about 20% fewer turns and 10% lower cost on short
  content tasks, at the same speed, with the gap growing on longer paths ([benchmarks/RESULTS.md](../benchmarks/RESULTS.md)).
  It isn't a big win on simple flows; expect more on long or fragile ones, which haven't been measured yet.
- **No new login to set up.** Tools run in the user's existing session with their existing permissions. There's no
  API key, OAuth app or separate MCP server to run.
- **The site decides what agents can do.** The site lists the actions it allows and marks the risky ones
  (`consequentialHint`), instead of an agent clicking whatever it finds.
- **It sees what's on screen.** Unsaved edits, the open dialog, the current selection: a server API can't see any of
  that.
- **Little to build.** Tools reuse the front-end code that's already there, with nothing new on the server.

## In Umbraco

| Use case | Who | Why WebMCP rather than the Developer MCP or clicking | How ready |
|---|---|---|---|
| **Editor assistant in the backoffice:** "add alt text to every image in this folder", "translate this page's Danish variant and leave it as a draft", "which pages link here?" | Editors | It works as the editor, with their permissions, and changes land in the open workspace for review before Save. The Developer MCP needs an API user with credentials and writes data straight away, with no review step | The tools exist (this package). An external in-browser agent needs WebMCP support; the Umbraco.AI Copilot could use them now (see below) |
| **"This page I'm looking at"** | Editors and developers | The agent knows the open workspace, the unsaved values and the current variant. The Management API only knows saved data | Works now (`umbraco_get_workspace_info`, document tools) |
| **Packages supported automatically** | Editors, plus package vendors | The generic tools discover any package's sections, trees, actions and modals from the extension registry, so assistants can use Forms or a third-party package without anyone writing an integration | Shown with Umbraco Forms |
| **Guided help and support** | New editors, support staff | "Take me to where I set up a redirect": the agent navigates the backoffice and highlights where things are, instead of describing the steps | Plausible; nothing built |
| **Agent-ready websites:** forms, booking and checkout on sites built with Umbraco | Site owners and their visitors | Umbraco Forms could add WebMCP's form attributes (the declarative API), so agents fill forms reliably; Commerce storefronts could expose search and add-to-basket, with checkout marked consequential | Small change; waits on mainstream agents |

### Next to the Developer MCP

- **The Developer MCP** is for developers and automation: headless, bulk, scripted, with no browser.
- **WebMCP** is for people working in the backoffice: in-session, in context, with the editor reviewing changes.

They're aimed at different users; Umbraco can reasonably offer both.

## With the Umbraco.AI Copilot

The Umbraco.AI Copilot already runs tools in the browser. A tool is a `uaiAgentFrontendTool` extension with:
- a tool name and a description;
- JSON Schema parameters;
- a `scope` and an `isDestructive` flag;
- optional human-in-the-loop `approval`;
- an API with `execute(args)`.

The Copilot sends the registered frontend tools to its server-side agent over AG-UI. The server only keeps the tools
the agent has been granted, by tool name or by scope, and the browser runs the calls the agent makes.

That's almost exactly the shape of this package's tools, so the two can be bridged.
[Umbraco.AI Copilot frontend tools](umbraco-ai-copilot.md) walks through a call end to end and maps the fields.

| Direction | How | Gain | Watch out for |
|---|---|---|---|
| **This package's tools in the Copilot** | Register a `uaiAgentFrontendTool` for each tool in the tool hub, mapping `inputSchema` to `parameters`. Map `readOnlyHint` to a read scope (for example `backoffice-navigation`), and `consequentialHint` to `isDestructive` plus `approval: true`. Workspace tools come and go, so register and unregister their manifests as the hub changes | The Copilot can move around the whole backoffice: sections, trees, any package's entity actions, create options and modals. Today it works on the selected entity. Administrators grant the new scopes per agent, as with any Copilot tool | Skip the document tools, which the Copilot's own entity tools (`set_value`, `save`, `save_and_publish`) already cover, with block-aware paths. Copilot tool names are snake_case without a prefix, so keep the `umbraco_` names |
| **The Copilot's tools on WebMCP** | Observe `uaiAgentFrontendTool` manifests and register them in the tool hub | External agents (Gemini in Chrome, chrome-devtools-mcp, Playwright MCP) get the Copilot's content-editing tools | The Copilot's approval prompt lives in its chat UI. Calling `execute` directly skips it, so tools marked `approval` must not be exposed, or must get an equivalent confirmation |

Longer term, two browser-tool contracts this similar suggest one shared extension type in the CMS, used by both the
Copilot and WebMCP. That would be a CMS change, through the RFC process.

**The Copilot changes the timing.** WebMCP's main limit is that few agents call it yet. The Copilot is an agent that
already ships in the backoffice, so this tool layer is useful now, whether or not WebMCP adoption arrives.

## Caveats

- **Prompt injection through content.** An agent that reads page content can meet text written to manipulate it,
  then call tools that change data. Tools that return editor-written content should set `untrustedContentHint`.
  Publishing, deleting and unpublishing should need an explicit confirmation from the user. This matters more in a
  CMS, where content is the product.
- **Same permissions as the user.** An editor's agent can do anything that editor can, so user groups (and, in the
  Copilot, agent tool permissions) are the safety boundary.
- **Maturity.**
  - WebMCP is a W3C Community Group draft, not a standard.
  - Chrome is the only browser that implements it, through an origin trial.
  - The API moved from `navigator` to `document` in 2026.
  - As of October 2026, no mainstream agent calls WebMCP tools, apart from Google's plans for Gemini in Chrome.

  Anything said publicly about "agent-ready" Umbraco should stay within that, and comparisons with other platforms
  need marketing and legal review first.
