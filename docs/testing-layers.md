# Umbraco MCP, WebMCP and Playwright: where each fits

*Last checked: 07-10-2026, against WebMCP (W3C Community Group draft of 02-10-2026), Chrome 149+ and the Umbraco Developer MCP README.*

For uses beyond testing, see [Why WebMCP, beyond testing](why-webmcp.md).

Umbraco gives agents three ways in. They don't compete: each enters the same stack at a different layer, skips
everything above it, and so is good at different jobs.

```
Rendered UI (DOM, pixels, clicks)          ← Playwright (and Playwright MCP)
Backoffice app (contexts, actions,         ← Umbraco WebMCP tools (via WebMCP in Chrome,
  repositories, router)                       or the window.__umbWebMcp page API)
Management API (HTTP)                      ← Umbraco Developer MCP, and API test helpers
Server (services, database)
```

"MCP" isn't one of the layers. It's how an agent connects to each of them: the Developer MCP is an MCP server,
WebMCP tools reach an agent through an MCP server such as chrome-devtools-mcp, and Playwright MCP is an MCP server
for Playwright.

## The three layers

| | Umbraco Developer MCP | Umbraco WebMCP (this package) | Playwright |
|---|---|---|---|
| **Enters at** | The Management API | The backoffice app in the open page | The rendered page |
| **Runs as** | A separate Node process, authenticated as an API user (`UMBRACO_CLIENT_ID` / `UMBRACO_CLIENT_SECRET`) | The logged-in user, in their browser session | Whoever logged in through the UI |
| **Needs a browser** | No | Yes, with the backoffice open | Yes |
| **Skips** | The whole front end: no workspace, modal or button handler runs | Rendering and pointer interaction, but not the backoffice's own logic | Nothing on the client |
| **Coverage** | What its tool collections were written for, scoped with `UMBRACO_INCLUDE_TOOL_COLLECTIONS` | Mostly discovered from the extension registry, so packages such as Forms work without package-specific code | Anything you can see and click |
| **Good for** | Seeding and bulk changes; setup that doesn't need a browser | Getting around and arranging state in-session, as the user would | Checking the UI works: visible, enabled, labelled, accessible |

Each layer down is faster and steadier, but exercises less of the product. Submitting a modal through its context
is one step below clicking its button, and it can skip work the button handler does: a confirmation modal that
deletes in its own click handler won't delete if you only submit it. Calling the API directly skips the modal, the
workspace and the router altogether.

Sources: [Umbraco-CMS-MCP-Dev](https://github.com/umbraco/Umbraco-CMS-MCP-Dev),
[Umbraco Developer MCP docs](https://docs.umbraco.com/umbraco-cms/reference/developer-mcp),
[Chrome WebMCP docs](https://developer.chrome.com/docs/ai/webmcp).

## A mental model: landmarks and controls

*A metaphor, not ARIA: these aren't ARIA landmark roles. The idea rhymes with them, though, because both give a non-visual user a map of the places and the things you can do there.*

The tools expose the backoffice's landmarks, the places a person navigates by, and the controls at each of them.

- **Landmarks** are what a person sees: sections, sidebar menus, trees and workspaces (`umbraco_list_sections`,
  `umbraco_list_section_menu`, `umbraco_get_tree_items`, `umbraco_open_entity`). They come from the same extension
  registry the UI renders from, so anything the backoffice can draw, the tools can find. These tools are
  `readOnlyHint`.
- **Controls** act: entity actions, create options, workspace buttons and modal buttons. Several change data and are
  marked `consequentialHint`.
- **What's available depends on where you are.** Workspace tools only exist while a workspace is open, and the
  document tools only in a document workspace.
- **No new capabilities.** Every control runs the same code as the matching button, with the logged-in user's
  permissions. The agent operates the UI by name; it doesn't get around it.

## Compared with a Playwright click

The tools call the same code the click handlers call, one layer below the page. Only one tool actually clicks.

| Tool group | What it does | Compared with Playwright clicking |
|---|---|---|
| Navigation (`umbraco_navigate`, `umbraco_open_entity`) | `history.pushState`, which the backoffice router listens to | Same as clicking a link, but the sidebar tree isn't expanded or highlighted |
| Trees (`umbraco_get_tree_items`) | Asks the tree's own repository | Doesn't touch the sidebar tree on screen |
| Entity actions and create options | Builds the same action with the same inputs and permission checks as the "..." menu, then runs it | Same code, but the menu never opens; the action is hosted on a hidden element, so side effects tied to the tree item may differ |
| Workspace buttons (`umbraco_run_workspace_action`) | Runs the same action as the footer button | Same code, but the button's own spinner and success state don't show |
| Modal buttons (`umbraco_click_modal_button`) | `.click()` on the real button | The closest to Playwright: the modal's own handler runs |
| Modal and document values | Writes into the modal's or workspace's data | Skips the editor UI, including its validation and formatting |

So Playwright tests the UI, and the tools test the behaviour behind it. Tool calls are faster, don't break when
selectors change, and return structured results, but they can't tell you that a button is hidden, covered or
mislabelled.

### What you can see

- **The markup doesn't change.** The only exception is a hidden `<umb-webmcp-entity-host>` element inside
  `umb-backoffice` while an entity action runs.
- **The tools live in JavaScript:** `document.modelContext`, which Chrome 149+ shows in DevTools under Application →
  WebMCP, and `window.__umbWebMcp.list()`.
- **Annotations are hints to the agent,** not restrictions.
- **WebMCP's declarative API is different:** it adds `toolname` attributes to HTML forms and does change markup. It
  suits front-end forms, not the backoffice.

## Using them together in a test

1. **Seed** data through the API (Developer MCP, or the API helpers an acceptance suite already has).
2. **Get there and arrange state** with the WebMCP tools: open the workspace, run the create option, fill a
   value.
3. **Test the step that matters** with Playwright: click Save, then check the notification, the validation message
   or the rendering.

The page API (`window.__umbWebMcp`) is what lets one Playwright session use both of the top two layers: call tools with
`page.evaluate`, or with Playwright MCP's `browser_evaluate`. For testing, the WebMCP standard itself is optional;
the page API doesn't depend on it, so Chrome flags and spec changes don't affect this use.

## Where this pays off: a product acceptance suite

A typical product suite already arranges with the API, acts through a page-object helper, and asserts with the API.
Most of its fragility tends to sit in getting to the feature, not in the feature: hover menus that don't appear in
headless CI, tree expansion races, and elements that steal clicks.

| Part of a test | With the tools | Verdict |
|---|---|---|
| Getting to the entity or workspace | `umbraco_get_tree_items`, `umbraco_open_entity`, `umbraco_run_create_option`: no hover, no tree, no selectors | **Strong fit.** It's not under test, and it causes most of the flakiness |
| Waiting until the workspace is ready | `umbraco_get_workspace_info` exposes new and unsaved state; a "workspace loaded" check would close data races | **Good fit,** with one tool to add |
| The feature under test | Keep Playwright clicks | **Not a fit.** Tools would skip what you're testing |
| Asserting | Can also check state the API can't see yet, such as unsaved changes | **Small gain** |

The tools also age better than selectors. They read the manifests a product registers: tree aliases, entity types
and action aliases. Those change only when the product changes, not when its markup does.

The bigger payoff is agent-driven work:

- **Reproducing an issue:** the agent calls named steps instead of reading snapshots and clicking.
- **Smoke testing across version lines:** the agent reaches every tree, action and modal quickly, then spends its
  effort on the UI it's checking. This needs the new backoffice, so Umbraco 16 and later.
- **Writing new specs:** the agent finds the real aliases first, then writes the page-object methods from facts.

### Costs

- **The test site needs this package installed.** It's dev-only and gated, but it's a new test dependency.
- **Overusing the tools gives false confidence:** a green test that never clicked the button. Keep the rule: tools
  for setup and navigation, the UI for the step under test.
- **Two known gaps:**
  - Modal buttons are matched by their visible label, which gets translated; matching by `id` is planned.
  - Whether the sidebar tree refreshes after an action run through the tools is unverified.

### Finding out whether it's worth it

Rewrite only the navigation of a suite's flakiest specs to use the tools, then compare run time and retry counts in
CI over a week. Separately, run an exploratory smoke test with and without the tools, and compare speed and token
use.
