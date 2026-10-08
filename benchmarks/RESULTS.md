# Results, 08-10-2026

One machine (Windows 11), the test site (CMS 18.1.0, Forms 18.1.3, SQLite), Chromium headless. Agent runs used
Claude Sonnet through Claude Code 2.1.294 and Playwright MCP 0.0.83. Raw results stay in `results/` (git-ignored);
`npm run summarise` rebuilds these tables.

## Scripted: five CMS content tests, 10 runs each per variant

Act time is the Act step alone, for passing runs.

| Variant | Runs | Pass rate | Median Act (ms) | vs `ui` |
|---|---|---|---|---|
| `ui` | 50 | 100% | 3,944 | |
| `hybrid` (page API navigates, UI for the step under test) | 50 | 100% | 3,649 | −7% |
| `tools` (everything through the page API; no longer tests the UI) | 50 | 98% | 2,856 | −28% |

Per test, `hybrid` saves 0.1–0.6 s, all from skipping the actions menu and Create dialog or the tree click. Its
p90 is tighter than `ui` (3.8–4.1 s against 4.4–5.4 s), so it varies less from run to run.

The one failure: `tools › can create content` (1 of 10). `umbraco_set_document_name` ran before the new document's
data had loaded ("Data is missing"). The workspace tools register before the workspace is ready.

## Agent: four content tasks, 5 runs each per variant

| Variant | Runs | Pass rate | Median turns | Median time (s) | Mean cost (USD) |
|---|---|---|---|---|---|
| `page-api` | 20 | 100% | 8 | 31 | 0.063 |
| `playwright` (UI only) | 20 | 100% | 10 | 26 | 0.055 |

| Case | Turns (page API / UI) | Time, s | Cost, USD |
|---|---|---|---|
| create-content | 8 / 10 | 29 / 26 | 0.068 / 0.061 |
| publish-content | 9 / 9 | 40 / 26 | 0.060 / 0.051 |
| rename-content | 8 / 8 | 28 / 23 | 0.059 / 0.038 |
| trash-content | 9 / 12 | 34 / 39 | 0.067 / 0.069 |

The page API saves turns where the UI path is long (the recycle bin's action menu and confirmation), but costs more
overall: `list()` returns every tool's description and input schema, and the agent has to list again once a
workspace opens to see the workspace tools. On short UI paths, plain Playwright snapshots are cheaper.

## Environment finding: SQLite hangs under repeated test load

With the connection string's `Cache=Shared` (Umbraco's default for SQLite), the site hung three times in the scripted
runs: a document request (a `DELETE /document/{id}` and a `GET /tree/document/root` that started in the same second)
never finished, and every later query timed out after 30 s until the site was restarted. With `Cache=Shared` removed
for the run (`ConnectionStrings__umbracoDbDSN` set without it), all 150 tests ran without a failed database command;
Umbraco still logged a "cache instruction sync … stalled" warning, but requests kept working. One clean run isn't
proof. The hang is in the CMS on SQLite, not in this package, and is worth reporting to the CMS team if it reproduces
on a fresh site.
