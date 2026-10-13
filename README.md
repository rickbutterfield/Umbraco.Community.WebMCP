# Umbraco.Community.WebMCP (spike)

Development-only [WebMCP](https://developer.chrome.com/docs/ai/webmcp) tools for the Umbraco 17 and 18 backoffice. Once
you're logged in, the backoffice registers tools that an agent can call directly to navigate and arrange backoffice
state: sections, trees, workspaces, entity actions, create options and modals. No snapshot-and-click is needed. The
tools are registered with WebMCP (`document.modelContext`), for agents and for scripted tests.

The tools are for **arranging and inspecting** backoffice state. They don't replace UI testing, because a tool call
skips the buttons, modals and routing a user would go through.

## Benchmarks

With and without WebMCP, measured on 13-10-2026 on one machine (Umbraco CMS and Forms 18.2.1, Chrome 154). See
[benchmarks/RESULTS.md](benchmarks/RESULTS.md) for per-test numbers and caveats, and
[benchmarks/README.md](benchmarks/README.md) for the method.

**Scripted Playwright tests**: total of the median times of the step under test, 10 runs of each test, all passing.

| Tests | Without WebMCP (clicking) | WebMCP to navigate, clicks for the step under test | WebMCP only (no longer tests the UI) |
|---|---|---|---|
| 5 CMS content tests | 18.8 s | 18.0 s (−4%) | 14.8 s (−21%) |
| 3 Forms tests | 17.8 s | 11.4 s (−36%) | 8.4 s (−53%) |

**An agent doing a task** (Claude Sonnet in Chrome): 3 runs of each task; medians of turns and time, mean cost,
totalled over four tasks. The Forms tasks use the example Forms toolset.

| Tasks | Without WebMCP (Playwright MCP, clicking) | With WebMCP, Playwright MCP | With WebMCP, Chrome DevTools MCP |
|---|---|---|---|
| 4 content tasks | 40 turns, 123 s, $0.178 | 34 turns, 108 s, $0.382 | 43 turns, 80 s, $0.228 |
| 4 Forms tasks | 97 turns, 235 s, $0.558 | 44 turns, 148 s, $0.397 | 63 turns, 149 s, $0.375 |

On simple content tasks WebMCP makes an agent quicker but not cheaper, and saves scripted tests little. On a complex
editor like the Forms designer, with a small product toolset, it halves an agent's turns and cuts its cost by about a
third, and cuts a scripted test's time by a third to a half. The client matters: Chrome DevTools MCP, which lists the
page's tools when the agent asks, was the cheapest and fastest overall; Playwright MCP, which gives the agent every page
tool as its own, rewrites its cached prompt whenever the tools change. Picker modals are the main gap.

## Documentation

- [Tools](docs/tools.md): what each tool does, and how to call it.
- [Adding tools from a package](docs/extending.md): toolset extensions for package and product authors.
- [Umbraco MCP, WebMCP and Playwright](docs/testing-layers.md): where each fits, especially in testing.
- [Why WebMCP, beyond testing](docs/why-webmcp.md): uses in Umbraco, including the Umbraco.AI Copilot.
- [Umbraco.AI Copilot frontend tools](docs/umbraco-ai-copilot.md): how the Copilot runs browser tools, and how this
  package's tools map onto them.
- [Vocabulary](docs/vocabulary.md): the terms used across these docs.

## Enabling

The tools reach agents through WebMCP, a separate backoffice entry point with its own setting. By default it's only
served in the `Development` environment:

```json
{ "Umbraco": { "Community": { "WebMCP": { "Enabled": true, "ModelContext": true } } } }
```

- `Enabled` is the default for every surface.
- `ModelContext` registers the tools with WebMCP (`document.modelContext`).

When no surface is enabled, nothing is loaded. `benchmarks/tests/surfaces` checks which entry points a running site
serves.

Chrome needs WebMCP switched on: Chrome 149+ with `chrome://flags/#enable-webmcp-testing`, or launched with
`--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport`. For scripted tests in a browser without it, load
[Google's WebMCP polyfill](https://github.com/GoogleChromeLabs/webmcp-tools) first, as `benchmarks/tests/webmcp` does.

## Driving it from Claude Code

```bash
claude mcp add chrome-devtools -- npx -y chrome-devtools-mcp@latest \
  --categoryExperimentalWebmcp --acceptInsecureCerts --isolated \
  --chromeArg=--enable-features=WebMCP,WebMCPTesting,DevToolsWebMCPSupport
```

Log in to the backoffice, then use `list_webmcp_tools` and `execute_webmcp_tool`.

Playwright MCP also picks up the tools a page registers, giving the agent each one as its own `webmcp_<tool name>`
tool, when it launches Chrome with WebMCP switched on:

```bash
echo '{ "browser": { "launchOptions": { "args": ["--enable-features=WebMCP,WebMCPTesting"] } } }' > playwright-mcp.json
claude mcp add playwright -- npx -y @playwright/mcp@latest --browser chrome --config playwright-mcp.json
```

## Running locally

```bash
npm run install-client
npm run build-client
dotnet run --project examples/Umbraco.Community.WebMCP.TestSite --launch-profile Umbraco.Web.UI
```

Open https://localhost:44311/umbraco. Use HTTPS, because the backoffice refuses login over HTTP. The test site installs
unattended, with the dev-only admin set in `appsettings.Development.json`. It also includes Umbraco Forms, to try the
tools against a package.

The test site runs Umbraco 18. To try Umbraco 17, change the test site's versions in `Directory.Packages.props`
(`Umbraco.Cms`, `Umbraco.Cms.DevelopmentMode.Backoffice`, `Umbraco.TheStarterKit` and `Umbraco.Forms`) and start from
a fresh database, because Umbraco can't downgrade one. The tools were checked on Umbraco 17.0.0 with Forms 17.0.0.

The compiled client in `src/Umbraco.Community.WebMCP.StaticAssets/wwwroot` is not committed, so build it before running or
packing. Use `npm run watch-client` while working on the client, and `npm run test-client` to run the front-end tests.
