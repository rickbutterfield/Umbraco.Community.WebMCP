# Umbraco.WebMCP (spike)

Development-only [WebMCP](https://developer.chrome.com/docs/ai/webmcp) tools for the Umbraco 18 backoffice. Once
you're logged in, the backoffice registers tools that an agent can call directly to navigate and arrange backoffice
state: sections, trees, workspaces, entity actions, create options and modals. No snapshot-and-click is needed. The
tools are available on WebMCP (`document.modelContext`) for in-browser agents, and on the page API
(`window.__umbWebMcp`) for page scripts such as Playwright.

The tools are for **arranging and inspecting** backoffice state. They don't replace UI testing, because a tool call
skips the buttons, modals and routing a user would go through.

## Documentation

- [Tools](docs/tools.md): what each tool does, and how to call it.
- [Adding tools from a package](docs/extending.md): toolset extensions for package and product authors.
- [Umbraco MCP, WebMCP and Playwright](docs/testing-layers.md): where each fits, especially in testing.
- [Why WebMCP, beyond testing](docs/why-webmcp.md): uses in Umbraco, including the Umbraco.AI Copilot.
- [Umbraco.AI Copilot frontend tools](docs/umbraco-ai-copilot.md): how the Copilot runs browser tools, and how this
  package's tools map onto them.
- [Vocabulary](docs/vocabulary.md): the terms used across these docs.

## Enabling

By default the entry point is only served in the `Development` environment. You can override that with:

```json
{ "Umbraco": { "WebMCP": { "Enabled": true } } }
```

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
