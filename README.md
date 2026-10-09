# Umbraco.WebMCP (spike)

Development-only [WebMCP](https://developer.chrome.com/docs/ai/webmcp) tools for the Umbraco 18 backoffice. Once
you're logged in, the backoffice registers tools that an agent can call directly to navigate and arrange backoffice
state: sections, trees, workspaces, entity actions, create options and modals. No snapshot-and-click is needed. The
tools are available on WebMCP (`document.modelContext`) for in-browser agents, and on the page API
(`window.__umbWebMcp`) for page scripts such as Playwright.

The tools are for **arranging and inspecting** backoffice state. They don't replace UI testing, because a tool call
skips the buttons, modals and routing a user would go through.

## Benchmarks

Measured on 08-10-2026 (content) and 09-10-2026 (Forms, on CMS and Forms 18.2.1) on one machine; see [benchmarks/RESULTS.md](benchmarks/RESULTS.md) for the method, per-test
numbers, how the numbers moved as the tools improved, and caveats.

| What | Variant | Pass rate | Result |
|---|---|---|---|
| Five CMS content acceptance tests, 10 runs each, median time of the step under test | Clicks, as in the CMS tests | 50/50 | 3.84 s |
| | Page API navigates, clicks for the step under test | 50/50 | 3.64 s (−5%) |
| | Everything through the page API (no longer tests the UI) | 50/50 | 3.03 s (−21%) |
| Four content tasks given to an agent (Claude Sonnet, Playwright MCP), 5 runs each | Clicking only | 20/20 | 10 turns, 27 s, $0.054 |
| | Told about the page API | 20/20 | 8 turns, 29 s, $0.049 |
| Four Umbraco Forms tasks given to an agent, 5 runs each | Clicking only | 19/19 | 20 turns, 52 s, $0.168 |
| | Told about the page API, with an example Forms toolset | 20/20 | 11 turns, 41 s, $0.084 |

On simple content tasks the page API makes scripted tests a little faster and agents about 20% more economical. On the
Forms designer, with a small Forms toolset, agents need half the turns and half the cost, and building a form takes a
fifth of the turns. A complex editor plus a product toolset is where the tools pay off.

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
