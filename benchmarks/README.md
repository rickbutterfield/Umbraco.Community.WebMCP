# Benchmarks: with and without WebMCP

Two measurements, both against the test site (`examples/Umbraco.Community.WebMCP.TestSite`, Umbraco CMS and Forms 18.2.1):

- **Scripted** (`tests/scripted/`): five tests adapted from the CMS acceptance tests
  (`tests/Umbraco.Tests.AcceptanceTest/tests/DefaultConfig/Content/Content.spec.ts`) and three modelled on Umbraco
  Forms' acceptance suite, each run three ways in Google Chrome with WebMCP switched on. Only the Act step differs:

  | Variant | Navigation | Step under test (typing, the designer, Save) | Still tests the UI? |
  |---|---|---|---|
  | `ui` | Clicks, as in the original tests | Clicks | Yes |
  | `hybrid` | WebMCP tools | Clicks | Yes, for the step under test |
  | `tools` | WebMCP tools | WebMCP tools | No. It's an upper bound on speed, not a replacement for a UI test |

  The tests call the tools through `document.modelContext` (`tests/webmcp-tools.ts`). The comparison: pass rate over
  repeated runs (flakiness) and Act time.

- **Agent** (`agent/`): an agent (Claude Code, headless) is given each case in `agent/cases.json` in plain words: four
  content tasks (create, publish, rename, trash a page) and four Forms tasks (build a form, add a page to a form,
  delete a form, move a form into a folder). Every variant drives Google Chrome, and none may run scripts in the page:

  | Variant | WebMCP | Browser tools |
  |---|---|---|
  | `playwright` | Without: Chrome launched without WebMCP, so the agent clicks | Playwright MCP |
  | `webmcp` | With: each page tool becomes one of the agent's own tools, `webmcp_<tool name>` | Playwright MCP |
  | `webmcp-devtools` | With: the agent lists the page's tools with `list_webmcp_tools` and calls them with `execute_webmcp_tool` | Chrome DevTools MCP |

  The Forms tasks use the example Forms toolset in the test site (`wwwroot/App_Plugins/WebMcpFormsExample`), as a product
  would ship its own. Each run is arranged and verified through the Management API (`tests/agent/fixture.spec.ts`),
  so a pass means the content really changed. The comparison: success rate, turns, time, tokens and cost.

What a speed difference alone doesn't prove: the `tools` variant is faster partly because it skips the UI that the
original test exists to check. Read the scripted results for flakiness and for the `hybrid` variant; read the agent
results for whether agents do better with WebMCP.

## Setup

1. Run the test site with the package enabled, overriding the connection string without `Cache=Shared`, because with
   it SQLite hangs under repeated test load (see [RESULTS.md](RESULTS.md)). In PowerShell:

   ```powershell
   $env:ConnectionStrings__umbracoDbDSN = 'Data Source=|DataDirectory|/Umbraco.sqlite.db;Foreign Keys=True;Pooling=True'
   dotnet run --launch-profile Umbraco.Web.UI
   ```

2. Copy `.env.example` to `.env` and fill in the backoffice login. `.env` is git-ignored.
3. `npm install`, then `npx playwright install chromium`. Google Chrome 149 or later must be installed too.

The CMS test helpers are pinned to the test site's CMS version (`@umbraco-cms/acceptance-test-helpers` 18.2.1).

## Running

```sh
npm run scripted                     # each scripted test 10 times
npm run agent -- --runs 3            # each agent case 3 times per variant; costs tokens
npm run agent -- --runs 1 --cases create-content   # a quick check
npm run summarise                    # tables in results/summary.md
npx playwright test --project=webmcp --project=webmcp-polyfill   # the WebMCP end-to-end tests
```

`webmcp-polyfill` runs the WebMCP tests in Playwright's bundled Chromium with Google's WebMCP polyfill
(`tests/webmcp/webmcp-polyfill.js`) instead of Chrome's own WebMCP.

`tests/webmcp/blocks.spec.ts` does one block-editing job (Block List and Block Grid) twice: with the document tools
alone, rewriting each property's stored value, and with the block tools. Each run adds a `job` annotation with its
calls and the characters of input an agent would write. On 20-10-2026: 5 calls and 1,794 characters, plus two keys no
WebMCP tool returns, against 8 calls and 653 characters with the block tools.

Agent settings: `BENCH_MODEL` (default `sonnet`) and `BENCH_MAX_USD`, the budget per run (default 1). The agent
runs outside the repo with only the one MCP server and no built-in tools, but your user-level `CLAUDE.md` still
loads, for every variant alike. Chrome DevTools MCP runs with its usage statistics and CrUX lookups off.

## Caveats

- One machine, one SQLite site, so absolute times are only comparable within a session.
- Variants alternate order between agent runs, so drift during a session doesn't favour one.
- The CMS tests' audit trail checks are left out: they test the UI after the step and would be the same in every
  variant.
