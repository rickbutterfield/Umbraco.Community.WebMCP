# Results, 13-10-2026

One machine (Windows 11), the test site (Umbraco CMS 18.2.1, Umbraco Forms 18.2.1, SQLite without `Cache=Shared`),
Google Chrome 154. Agent runs used Claude Sonnet through Claude Code 2.1.296, with Playwright MCP 0.0.83 and Chrome
DevTools MCP 1.10.1. Raw results and agent transcripts stay in `results/` (git-ignored); `npm run summarise` rebuilds
the tables. See [README.md](README.md) for the method.

## Scripted: eight tests, 10 runs each per variant

Every variant runs in Chrome with WebMCP switched on; only the Act step differs. Act time is the Act step alone, for
passing runs. All 240 runs passed.

| Test | Without WebMCP (`ui`) | WebMCP to navigate, clicks for the step (`hybrid`) | WebMCP only (`tools`) |
|---|---|---|---|
| Content: create empty content | 3.93 s | 3.64 s | 2.90 s |
| Content: save and publish empty content | 3.78 s | 3.53 s | 3.10 s |
| Content: create content | 4.03 s | 3.79 s | 3.00 s |
| Content: rename content | 3.63 s | 3.55 s | 2.96 s |
| Content: update content | 3.48 s | 3.50 s | 2.87 s |
| Forms: create a form with a short answer field | 7.95 s | 4.02 s | 2.33 s |
| Forms: delete a form | 1.90 s | 3.33 s | 3.60 s |
| Forms: create a form with pages and groups | 7.94 s | 4.04 s | 2.48 s |
| **5 content tests** | **18.8 s** | **18.0 s (−4%)** | **14.8 s (−21%)** |
| **3 Forms tests** | **17.8 s** | **11.4 s (−36%)** | **8.4 s (−53%)** |

- **Content:** using WebMCP to get to the step under test saves a fraction of a second per test. The CMS test
  helpers already make these short paths reliable.
- **Forms:** the designer is where WebMCP pays off. Creating a form takes half the time with WebMCP navigating, and
  under a third with the example Forms toolset doing the design.
- **Deleting a form is slower with WebMCP** (3.3–3.6 s against 1.9 s). Clicking is two steps there, while the tools
  wait for the confirmation modal to open and close before they return.

## Agent: eight tasks, 3 runs each per variant

Medians of turns and time, mean cost, per task. 71 of 72 runs passed.

| Task | Without WebMCP (Playwright MCP, clicking) | With WebMCP, Playwright MCP | With WebMCP, Chrome DevTools MCP |
|---|---|---|---|
| Create a page | 10 turns, 34 s, $0.047 | 10 turns, 28 s, $0.110 | 13 turns, 23 s, $0.066 |
| Publish a page | 9 turns, 27 s, $0.039 | 7 turns, 24 s, $0.093 | 9 turns, 15 s, $0.047 |
| Rename a page | 8 turns, 24 s, $0.029 | 8 turns, 25 s, $0.098 | 9 turns, 16 s, $0.052 |
| Trash a page | 13 turns, 38 s, $0.062 | 9 turns, 31 s, $0.080 | 12 turns, 25 s, $0.064 |
| **4 content tasks** | **40 turns, 123 s, $0.178** | **34 turns, 108 s, $0.382** | **43 turns, 80 s, $0.228** |
| Build a form with three questions | 48 turns, 107 s, $0.290 (2 of 3 passed) | 11 turns, 43 s, $0.103 | 17 turns, 47 s, $0.106 |
| Add a page to a form | 19 turns, 48 s, $0.113 | 10 turns, 30 s, $0.113 | 12 turns, 24 s, $0.078 |
| Delete a form | 17 turns, 44 s, $0.080 | 12 turns, 36 s, $0.083 | 13 turns, 30 s, $0.074 |
| Move a form into a folder | 13 turns, 37 s, $0.075 | 11 turns, 39 s, $0.098 | 21 turns, 47 s, $0.117 |
| **4 Forms tasks** | **97 turns, 235 s, $0.558** | **44 turns, 148 s, $0.397** | **63 turns, 149 s, $0.375** |
| **All eight** | **137 turns, 358 s, $0.736** | **78 turns, 256 s, $0.779** | **106 turns, 229 s, $0.603** |

Mean tokens per run:

| | Without WebMCP | With WebMCP, Playwright MCP | With WebMCP, Chrome DevTools MCP |
|---|---|---|---|
| Cache writes | 13.0k | 18.2k | 9.8k |
| Cache reads | 280k | 162k | 211k |
| Output | 1.2k | 0.8k | 1.5k |

- **Content tasks:** with WebMCP the agent is quicker (108 s and 80 s against 123 s), but it costs more than
  clicking: about twice as much through Playwright MCP, and a quarter more through Chrome DevTools MCP. These are
  short paths, and a click is cheap.
- **Forms tasks:** with the example Forms toolset, WebMCP halves the turns through Playwright MCP and cuts the cost by
  about a third through either client. Building a form took a quarter to a third of the turns, under half the time
  and about a third of the cost. Without WebMCP, one of the three form builds reported success but saved the dropdown's options
  wrongly; the check through the Management API caught it.
- **The client matters.** Playwright MCP gives the agent each page tool as one of its own tools, so every change to
  the list (a workspace opening, a section change) rewrites the cached prompt: 18.2k cache-write tokens a run. Chrome
  DevTools MCP keeps a fixed pair of tools (`list_webmcp_tools`, `execute_webmcp_tool`) and puts the page's tool list
  in the conversation when the agent asks, so its cache writes (9.8k) are below clicking's. Its tool calls also return
  quickly, with fewer page snapshots, which makes it the fastest variant on every content task. In exchange its agent
  takes a few more turns.
- **Agents ask for tools too early.** In 21 of 24 Chrome DevTools MCP runs, the agent listed the page's tools straight
  after navigating, before the backoffice had registered them, got "No WebMCP tools available" and asked again.
- **Pickers are the gap.** Moving a form into a folder is the one task where WebMCP doesn't help. Setting the value
  of Forms' "Move to" picker modal doesn't update the picker's selection, so every WebMCP run fell back to clicking it
  (1–2 clicks a run), and through Chrome DevTools MCP it took 20–22 turns against 13 clicking.
- **Errors reach the agent.** Tools return their errors as results rather than throwing, because WebMCP reports a
  thrown error as a generic `UnknownError`. In one run the agent asked for "Delete" on a form, got back the list of
  the form's actions, and ran Trash.

## Verdict

**Without a product toolset, on short flows,** WebMCP makes an agent somewhat quicker but not cheaper, and it saves
scripted tests a fraction of a second. **With a product toolset, on a complex editor** like the Forms designer, it cuts
an agent's turns sharply (a quarter to a third of the turns to build a form) and its cost by about a third, and it
cuts a scripted Forms test's time by a third to a half. The WebMCP client decides much of the cost: one that lists the page's tools on request (Chrome
DevTools MCP) was the cheapest and fastest overall here. The gaps are picker modals, and agents asking for tools before
the backoffice has registered them.

## Caveats

- Three runs per task per variant, one model, one machine: read the agent numbers as a direction.
- Variants alternate order between rounds, so drift during the session doesn't favour one.
- One login before an agent run timed out while the site's SQLite database was locked by a background job; the
  session carried on from the next round, and the runner now retries the login once.

## Environment finding: SQLite under repeated test load

With the connection string's `Cache=Shared` (Umbraco's default for SQLite), the site hangs under repeated test load: a
document request never finishes, and every later query times out after 30 s until the site is restarted. The
benchmarks run without `Cache=Shared` (`ConnectionStrings__umbracoDbDSN` set without it). Even then, Umbraco's
background cache sync sometimes logs "database is locked", and a request that lands at that moment can fail. The
problem is in the CMS on SQLite, not in this package, and is worth reporting to the CMS team if it reproduces on a
fresh site.
