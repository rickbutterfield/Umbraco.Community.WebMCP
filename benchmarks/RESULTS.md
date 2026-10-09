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

## Umbraco Forms: four tasks, 5 runs each per variant (09-10-2026)

Run on the test site upgraded to CMS 18.2.1 and Forms 18.2.1. The generic tools can open, save, delete and move a form,
but not edit its design, so the page API agent also had the example Forms toolset
(`examples/Umbraco.WebMCP.TestSite/wwwroot/App_Plugins/WebMcpFormsExample`): a `webMcpWorkspaceToolset` with
`forms_get_form_design`, `forms_list_field_types`, `forms_set_form_name`, `forms_add_page`, `forms_add_group` and
`forms_add_field`, the kind of toolset Forms itself could ship.

| Variant | Runs | Pass rate | Median turns | Median time (s) | Mean cost (USD) |
|---|---|---|---|---|---|
| `page-api` (with the Forms toolset) | 20 | 100% | 11 | 41 | 0.084 |
| `playwright` (UI only) | 19 | 100% | 20 | 52 | 0.168 |

One `playwright` run is left out: it hit the runner's 10-minute timeout while the machine slept overnight, not because
the agent failed.

| Case | Needs | Turns (page API / UI) | Time, s | Median tokens | Cost, USD |
|---|---|---|---|---|---|
| forms-build: a blank form with a mandatory short answer, a long answer and a dropdown with three options | The Forms toolset | 11 / 51 | 34 / 97 | 168k / 785k | 0.087 / 0.358 |
| forms-pages: a second page with a captioned group and a question | The Forms toolset | 10 / 21 | 34 / 55 | 145k / 343k | 0.076 / 0.158 |
| forms-delete: delete a form through its confirmation | Generic tools | 12 / 15 | 41 / 51 | 175k / 251k | 0.073 / 0.108 |
| forms-move: move a form into a folder | Generic tools | 13 / 12 | 44 / 35 | 203k / 144k | 0.101 / 0.085 |

- **The form designer is where the tools pay off.** Building a form took a fifth of the turns, a third of the time and
  a quarter of the cost; adding a page, half. Clicking through the designer means a field-type picker, a field
  settings panel and a dropdown option editor for every question, each needing snapshots to find.
- **Generic tools on Forms' own modals are about even.** Deleting through the confirmation was a little cheaper with
  the tools.
- **Picker modals are a gap.** Moving a form was worse with the page API: `umbraco_set_modal_value` changed the "Move
  to" sidebar's value but not its selection, so the Move button stayed disabled and the agent fell back to clicking.
  Driving pickers needs a tool that selects through the picker's own selection manager.
- **Toolset design matters.** In a trial run, `forms_add_page` couldn't caption the group it creates, so the agent
  typed into the designer (20 turns); with a `groupCaption` parameter, 10.

## Scripted Forms tests: three tests, 10 runs each per variant (09-10-2026)

`tests/scripted/forms.spec.ts`: tests modelled on Forms' own acceptance suite (create a form with a short answer
field, delete a form, create a form with two pages and groups), with our own steps. The `tools` variant uses the
example Forms toolset for the designer.

| Test | `ui` (ms) | `hybrid` (ms) | `tools` (ms) |
|---|---|---|---|
| Create a form with a short answer field | 8,267 | 4,751 | 2,717 |
| Create a form with two pages and groups | 8,919 | 5,076 | 3,106 |
| Delete a form | 2,205 | 3,882 | 4,041 |
| **All three (median Act)** | **8,235** | **4,621 (−44%)** | **3,352 (−59%)** |

- **The designer is where the time goes:** each question means the Add question button, a name, the answer type
  picker and Submit, and `hybrid` saves about 3.5 s a test just by opening the create workspace through a tool.
- **Deleting is faster by clicking:** the tree's actions menu and the confirmation are two quick clicks, while the tool
  path searches, builds the entity actions and waits for the modal to close and for notifications.
- **Forms 18.2.1's Create button needs a forced click.** It sits next to the Forms heading and is only revealed on
  hover, so Playwright never sees it as clickable; Forms' own suite forces clicks for the same reason. Before that
  was found, every `ui` run fell back to the create URL.
- 86 of 90 passed. The four failures (one `ui`, two `hybrid`, one `tools`) trace to the test site's SQLite database,
  which logged "database is locked" 22 times during the run: 500 errors from the Forms API, and a timeout.

## Real WebMCP: the same tasks through Chrome's WebMCP (09-10-2026)

Every earlier `page-api` run reached the tools through `window.__umbWebMcp` and `browser_evaluate`, never through
WebMCP itself. The `webmcp` variants run Google Chrome 154 with `--enable-features=WebMCP,WebMCPTesting`, and
Playwright MCP 0.0.83 (which supports WebMCP by default) gives the agent each tool the page registers as its own MCP
tool, named `webmcp_<tool name>`, and lists them in each page snapshot. Page scripts are disallowed, so the page API is
out of reach. CMS and Forms 18.2.1; the content baselines below were measured on 18.1.

**Round 1, full descriptions** (19 runs, at least 2 of each task, stopped early once the pattern was clear):

| Tasks | Clicking only | Page API | WebMCP | Passed |
|---|---|---|---|---|
| 4 content tasks | 10 turns, 27 s, $0.054 | 8 turns, 29 s, $0.049 | 10 turns, 29 s, $0.128 | 11/11 |
| 4 Forms tasks | 20 turns, 52 s, $0.168 | 11 turns, 41 s, $0.084 | 13 turns, 36 s, $0.141 | 8/8 |

**Round 2, trying to cut the cost** (three tasks, 3 runs each, all 18 passed). Mean cost per run:

| Task | Clicking only | Page API | WebMCP, full descriptions | WebMCP, first sentence only | Same, `--snapshot-mode none` |
|---|---|---|---|---|---|
| Create content | $0.061 | $0.053 | $0.136 | $0.127 | $0.127 |
| Build a form | $0.358 | $0.087 | $0.163 | $0.171 | $0.174 |
| Add a page to a form | $0.158 | $0.076 | $0.154 | $0.126 | $0.165 |

- **The tools work through real WebMCP.** Every run passed, the agent called them as native tools, and the workspace
  tools appeared once a workspace opened (19 tools, then 27 to 29). Speed and turns match the page API.
- **It costs about 1.7 to 2.5 times the page API**, more than clicking on content tasks. Per-turn usage shows why: once
  the first snapshot brings the tools in, the agent's context grows from about 10k to 22k tokens, and to about 30k when a
  workspace adds its tools, and every later turn reads all of it. Each change to the tool list also writes the cached
  prompt again (cache writes of 20-28k tokens a run against 5-10k for the page API). Playwright MCP prefixes each tool
  description with a safety note of about 170 characters, and includes each full input schema.
- **Short descriptions barely help** (first sentence only, from commit 23d45ed): within the noise. The tool
  definitions and schemas, not the descriptions, are the bulk.
- **`--snapshot-mode none` makes it worse**: actions already save their snapshot to a file, so it saves little, and
  without a refresh after each action the agent takes more explicit snapshots to find the workspace's tools.
- **So the cost is the eager tool list.** WebMCP puts every tool's definition into the agent's context on every turn;
  the page API's `list()` gives one-sentence summaries once and the agent asks for more only when it needs it. Fewer
  tools exposed at once, or a client that loads tool definitions lazily, would close the gap; the descriptions won't.

## Verdict

**Content tasks (08-10-2026):** the tools help a little, not enough to justify them on speed or cost for flows like
these. Scripted tests gain a
fraction of a second per test; agents take about 20% fewer turns and cost about 10% less, within the run-to-run noise
of a study this size. Reliability doesn't differ: these tasks are short and the CMS test helpers already make clicking
reliable. The gain grew with path length (the recycle bin's menu and confirmation).

**Forms (09-10-2026):** on a complex editor the difference is large: half the turns and half the cost overall, and on
building a form a fifth of the turns and a quarter of the cost. That gain needs a product toolset (here about 200
lines of plain JavaScript in the product's own package); the generic tools alone were about even on Forms' modals and
worse on its picker. So the case for WebMCP is product toolsets for complex editors, plus a picker tool, rather than
generic navigation.

**Real WebMCP (09-10-2026):** through Chrome's WebMCP and Playwright MCP, the tools keep the page API's speed and turn
savings but cost 1.7 to 2.5 times as much, because every tool definition sits in the agent's context on every turn.
On Forms that's still a little cheaper than clicking, and much cheaper on building a form; on content it's more
expensive than clicking. Trimming descriptions or snapshots didn't change that. Today, an agent with a generic browser
is cheapest using the page API's lazy `list()`; WebMCP's eager tool list pays off only where the tools save many turns.

## Environment finding: SQLite hangs under repeated test load

With the connection string's `Cache=Shared` (Umbraco's default for SQLite), the site hung three times in the scripted
runs: a document request (a `DELETE /document/{id}` and a `GET /tree/document/root` that started in the same second)
never finished, and every later query timed out after 30 s until the site was restarted. With `Cache=Shared` removed
(`ConnectionStrings__umbracoDbDSN` set without it), the three full rounds since ran without a failed database command;
Umbraco still logs a "cache instruction sync … stalled" warning now and then, but requests keep working. The hang is in
the CMS on SQLite, not in this package, and is worth reporting to the CMS team if it reproduces on a fresh site.
