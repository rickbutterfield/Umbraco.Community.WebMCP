# Benchmarks: Playwright with and without the page API

Two measurements, from the same Umbraco CMS content tests:

- **Scripted** (`tests/scripted/`): five tests adapted from the CMS acceptance tests
  (`tests/Umbraco.Tests.AcceptanceTest/tests/DefaultConfig/Content/Content.spec.ts`), each run three ways. Only the
  Act step differs:

  | Variant | Navigation | Step under test (typing, Save) | Still tests the UI? |
  |---|---|---|---|
  | `ui` | Clicks, as in the CMS tests | Clicks | Yes |
  | `hybrid` | Page API | Clicks | Yes, for the step under test |
  | `tools` | Page API | Page API | No. It's an upper bound on speed, not a replacement for a UI test |

  The comparison: pass rate over repeated runs (flakiness) and Act time.

- **Agent** (`agent/`): an agent (Claude Code, headless, driving the browser through Playwright MCP) is given each
  case in `agent/cases.json` in plain words, run two ways:
  - `playwright` can't run scripts in the page, so it works through the UI.
  - `page-api` is told about `window.__umbWebMcp`.

  Each run is arranged and verified through the Management API (`tests/agent/fixture.spec.ts`), so a pass means the
  content really changed. The comparison: success rate, turns, time, tokens and cost.

What a speed difference alone doesn't prove: the `tools` variant is faster partly because it skips the UI that the
original test exists to check. Read the scripted results for flakiness and for the `hybrid` variant; read the agent
results for whether agents do better with named tools.

## Setup

1. Run the test site (`examples/Umbraco.WebMCP.TestSite`) with the package enabled. For the scripted benchmark,
   override the connection string without `Cache=Shared`, because with it SQLite hung under repeated test load (see
   [RESULTS.md](RESULTS.md)). In PowerShell:

   ```powershell
   $env:ConnectionStrings__umbracoDbDSN = 'Data Source=|DataDirectory|/Umbraco.sqlite.db;Foreign Keys=True;Pooling=True'
   dotnet run --launch-profile Umbraco.Web.UI
   ```

2. Copy `.env.example` to `.env` and fill in the backoffice login. `.env` is git-ignored.
3. `npm install`, then `npx playwright install chromium`.

The CMS test helpers are pinned to the version closest to the test site's CMS version
(`@umbraco-cms/acceptance-test-helpers` 18.1.1 for CMS 18.1.0).

## Running

```sh
npm run scripted                     # each scripted test 10 times, about 20 minutes
npm run agent -- --runs 5            # each agent case 5 times per variant; costs tokens
npm run agent -- --runs 1 --cases create-content   # a quick check
npm run summarise                    # tables in results/summary.md
```

Agent settings: `BENCH_MODEL` (default `sonnet`) and `BENCH_MAX_USD`, the budget per run (default 1). The agent
runs outside the repo with only the Playwright MCP server and no built-in tools, but your user-level `CLAUDE.md`
still loads, for both variants alike.

## Caveats

- One machine, one SQLite site, so absolute times are only comparable within a session.
- Variants alternate order between agent runs, so drift during a session doesn't favour one.
- The CMS tests' audit trail checks are left out: they test the UI after the step and would be the same in every
  variant.
- There's no Umbraco Forms case yet. The CMS helpers have no Forms API to arrange and verify one.
