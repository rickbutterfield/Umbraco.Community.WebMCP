# Umbraco.WebMCP (spike)

Development-only [WebMCP](https://developer.chrome.com/docs/ai/webmcp) tools for the Umbraco 18 backoffice. Once
you're logged in, the backoffice registers tools that an agent can call directly to navigate and arrange backoffice
state: sections, trees, workspaces, entity actions, create options and modals. No snapshot-and-click is needed. The
tools are available on WebMCP (`document.modelContext`) for in-browser agents, and on the page API
(`window.__umbWebMcp`) for page scripts such as Playwright.

The tools are for **arranging and inspecting** backoffice state. They don't replace UI testing, because a tool call
skips the buttons, modals and routing a user would go through.

## Benchmarks

Measured on 08-10-2026 (content, CMS 18.1) and 09-10-2026 (Umbraco Forms, CMS and Forms 18.2.1) on one machine. See
[benchmarks/RESULTS.md](benchmarks/RESULTS.md) for the method, per-test numbers, how the numbers moved as the tools
improved, and caveats.

**Scripted Playwright tests**: median time of the step under test, 10 runs of each test.

| Tests | Playwright, clicking | Page API to navigate, clicks for the step under test | Page API only (no longer tests the UI) |
|---|---|---|---|
| 5 CMS content tests | 3.84 s | 3.64 s (−5%) | 3.03 s (−21%) |
| 3 Forms tests | 8.24 s | 4.62 s (−44%) | 3.35 s (−59%) |

**An agent doing a task** (Claude Sonnet through Playwright MCP): 5 runs of each task.

| Tasks | Measure | Playwright only, clicking | Playwright + page API | Difference |
|---|---|---|---|---|
| 4 content tasks | Turns (median) | 10 | 8 | −20% |
| | Time (median) | 27 s | 29 s | +7% |
| | Cost (mean) | $0.054 | $0.049 | −9% |
| 4 Forms tasks (+ the example Forms toolset) | Turns (median) | 20 | 11 | −45% |
| | Time (median) | 52 s | 41 s | −21% |
| | Cost (mean) | $0.168 | $0.084 | −50% |

**Through real WebMCP** (Chrome 154 with WebMCP on; Playwright MCP gives the agent the page's tools as its own): about 2
runs of each task, 19 in all, every one passed.

| Tasks | Playwright only, clicking | Playwright + page API | Playwright + WebMCP tools |
|---|---|---|---|
| 4 content tasks | 10 turns, 27 s, $0.054 | 8 turns, 29 s, $0.049 | 10 turns, 29 s, $0.128 |
| 4 Forms tasks | 20 turns, 52 s, $0.168 | 11 turns, 41 s, $0.084 | 13 turns, 36 s, $0.141 |

Every approach passed nearly every run (the few failures came from the test site's SQLite database, not the
approach). On simple content tasks the page API saves a little; on a complex editor like the Forms designer, with a
small product toolset, it halves an agent's turns and cost and more than halves a scripted test's time. Through real
WebMCP the tools are as fast but cost far more, because every tool definition stays in the agent's context on every
turn; shortening descriptions or snapshots didn't change that. Running actions by label and registering tools only in
the section they apply to later made WebMCP the fastest approach and cut its cost to about 1.6 times the page API's;
see [benchmarks/RESULTS.md](benchmarks/RESULTS.md#verdict) for every step.

## Documentation

- [Tools](docs/tools.md): what each tool does, and how to call it.
- [Adding tools from a package](docs/extending.md): toolset extensions for package and product authors.
- [Umbraco MCP, WebMCP and Playwright](docs/testing-layers.md): where each fits, especially in testing.
- [Why WebMCP, beyond testing](docs/why-webmcp.md): uses in Umbraco, including the Umbraco.AI Copilot.
- [Umbraco.AI Copilot frontend tools](docs/umbraco-ai-copilot.md): how the Copilot runs browser tools, and how this
  package's tools map onto them.
- [Vocabulary](docs/vocabulary.md): the terms used across these docs.

## Enabling

The tools are reachable through two surfaces, WebMCP and the page API. Each is a separate backoffice entry point
with its own setting, and by default both are only served in the `Development` environment:

```json
{ "Umbraco": { "WebMCP": { "Enabled": true, "ModelContext": true, "PageApi": false } } }
```

- `Enabled` is the default for every surface.
- `ModelContext` registers the tools with WebMCP (`document.modelContext`).
- `PageApi` exposes `window.__umbWebMcp` to page scripts.

When no surface is enabled, nothing is loaded. `benchmarks/tests/surfaces` checks which entry points a running site
serves.

Chrome needs WebMCP switched on: Chrome 149+ with `chrome://flags/#enable-webmcp-testing`, or launched with
`--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport`. The page API works without it.

## Driving it from Claude Code

```bash
claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest \
  --categoryExperimentalWebmcp --acceptInsecureCerts --isolated \
  --chromeArg=--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport
```

Log in to the backoffice, then use `list_webmcp_tools` and `call_webmcp_tool`.

## Running locally

```bash
npm run install-client
npm run build-client
dotnet run --project examples/Umbraco.WebMCP.TestSite --launch-profile Umbraco.Web.UI
```

Open https://localhost:44311/umbraco. Use HTTPS, because the backoffice refuses login over HTTP. The test site installs
unattended, with the dev-only admin set in `appsettings.Development.json`. It also includes Umbraco Forms, to try the
tools against a package.

The compiled client in `src/Umbraco.WebMCP.StaticAssets/wwwroot` is not committed, so build it before running or
packing. Use `npm run watch-client` while working on the client, and `npm run test-client` to run the front-end tests.
