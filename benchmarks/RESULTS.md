# Results, 08-10-2026

One machine (Windows 11), the test site (CMS 18.1.0, Forms 18.1.3, SQLite without `Cache=Shared`), Chromium headless.
Agent runs used Claude Sonnet through Claude Code 2.1.294 and Playwright MCP 0.0.83. Raw results and agent transcripts
stay in `results/` (git-ignored); `npm run summarise` rebuilds the tables.

The numbers below are from the final round, after the changes listed under [How the numbers moved](#how-the-numbers-moved).

## Scripted: five CMS content tests, 10 runs each per variant

Act time is the Act step alone, for passing runs.

| Variant | Runs | Pass rate | Median Act (ms) | vs `ui` |
|---|---|---|---|---|
| `ui` | 50 | 100% | 3,840 | |
| `hybrid` (page API navigates, UI for the step under test) | 50 | 100% | 3,635 | −5% |
| `tools` (everything through the page API; no longer tests the UI) | 50 | 100% | 3,033 | −21% |

`hybrid` saves 0.1–0.5 s per test, all from skipping the actions menu and Create dialog or the tree click, and its
90th percentile is tighter than `ui`'s on most tests.

## Agent: four content tasks, 5 runs each per variant

| Variant | Runs | Pass rate | Median turns | Median time (s) | Mean cost (USD) |
|---|---|---|---|---|---|
| `page-api` | 20 | 100% | 8 | 29 | 0.049 |
| `playwright` (UI only) | 20 | 100% | 10 | 27 | 0.054 |

| Case | Turns (page API / UI) | Time, s | Median tokens | Cost, USD |
|---|---|---|---|---|
| create-content | 8 / 11 | 28 / 28 | 110k / 144k | 0.053 / 0.061 |
| publish-content | 7 / 9 | 25 / 27 | 92k / 112k | 0.043 / 0.047 |
| rename-content | 7 / 8 | 26 / 23 | 92k / 83k | 0.040 / 0.037 |
| trash-content | 10 / 12 | 32 / 36 | 142k / 169k | 0.059 / 0.069 |

With the page API, agents take about 20% fewer turns and cost about 10% less, at about the same speed: each tool call
is still a model round trip. The gain is largest where the UI path is long (the recycle bin's action menu and
confirmation); on a short path such as renaming, a couple of clicks cost the same or less.

## How the numbers moved

The benchmark found the problems that most of the gain came from fixing.

| Round | Change | Scripted `tools` pass rate | Agent turns (page API / UI) | Agent cost (page API / UI) | Agent time, s |
|---|---|---|---|---|---|
| 1 | First version | 98% | 8 / 10 | $0.063 / $0.055 | 31 / 26 |
| 2 | Workspace tools wait for the workspace; short `list()`; search; outcomes; modal button ids | 100% | 10 / 10 | $0.067 / $0.056 | 46 / 31 |
| 3 | Opening an entity in an open workspace no longer waits 10 s; `list()` gives parameter names; clearer errors for missing parameters | 100% | 8 / 10 | $0.049 / $0.054 | 29 / 27 |

- **Round 1:** one run in ten failed with "Data is missing", because the workspace tools registered before the
  document had loaded. `list()` returned every tool's full schema, so agents with the page API paid more.
- **Round 2:** the backoffice reuses an open workspace for another entity of the same type, so no new workspace tools
  registered and every open waited its full 10 s.
- **Round 3:** agent transcripts showed agents guessing parameter names (`actionAlias`, `buttonId`) from the short
  list, then calling `describe()` and retrying. Listing the parameter names and naming the expected ones in errors
  removed those turns.

The `ui` and `playwright` numbers moved by 10–15% between rounds with no code change, so differences of a few per
cent are noise.

## Environment finding: SQLite hangs under repeated test load

With the connection string's `Cache=Shared` (Umbraco's default for SQLite), the site hung three times in the scripted
runs: a document request (a `DELETE /document/{id}` and a `GET /tree/document/root` that started in the same second)
never finished, and every later query timed out after 30 s until the site was restarted. With `Cache=Shared` removed
(`ConnectionStrings__umbracoDbDSN` set without it), the three full rounds since ran without a failed database command;
Umbraco still logs a "cache instruction sync … stalled" warning now and then, but requests keep working. The hang is in
the CMS on SQLite, not in this package, and is worth reporting to the CMS team if it reproduces on a fresh site.
