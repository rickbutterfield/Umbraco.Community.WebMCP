---
name: benchmark-verdict
description: Benchmarks - small gains on short content flows (08-10-2026), but half the turns and cost on the Forms designer with a product toolset (09-10-2026)
type: decision
---

On 08-10-2026 `benchmarks/` measured the tools against plain Playwright: scripted CMS content tests were 5% faster
when the tools only navigate (21% when they do everything, which no longer tests the UI), and agents (Claude Sonnet)
took about 20% fewer turns and cost about 10% less at the same speed. Rick decided to stop the testing angle there.

**Why:** gains that small sit within the run-to-run noise of the benchmark (clicking-only numbers moved 10-15% between
rounds with no code change), and the content tasks are short paths that the CMS test helpers already make reliable.
The useful output was the bugs the benchmark found, all fixed (see `benchmarks/RESULTS.md`, "How the numbers moved").

**Update 09-10-2026:** on Forms 18.2.1, with the example Forms toolset in the test site, agents needed half the turns
and cost (11 vs 20 turns, $0.084 vs $0.168), and building a form a fifth of the turns (11 vs 51). The generic tools
alone were even on Forms' modals and worse on its picker. So the testing case is real for complex editors that ship a
toolset; it isn't for simple flows.

**Update 09-10-2026, real WebMCP:** through Chrome 154's WebMCP and Playwright MCP 0.0.83 (which exposes page tools
as `webmcp_*` MCP tools by default), all runs passed with page-API speed and turns but 1.7-2.5x the page API's cost,
more than clicking on content. The cause is the eager tool list (every definition and schema in context every turn,
plus cache rewrites when the list changes). First-sentence descriptions (23d45ed) and `--snapshot-mode none` didn't
help. Don't pitch WebMCP as cheaper for agents; the lazy page API is. Fewer tools at once or lazy-loading clients would.

**Round 3 (09-10-2026):** Claude Code tool search cut WebMCP's cost on content (-24%) but raised it on Forms (extra
lookup turns). Whole-job tools (`umbraco_create_document`, `forms_add_fields`) gave the fastest content run (6 turns)
when used, but agents picked the step tools 4 times in 6, and Forms turns hardly moved: a floor of 8-10 turns goes on
finding, opening, saving and checking. Next lever is fewer discovery turns, not bigger edit tools.

**Round 4 (09-10-2026, 86ed534):** run-by-label tools (no list_* partners) and section-scoped document tools made
WebMCP fastest (87 s vs page API 97-105 s over three tasks) and 15% cheaper, about 1.6x the page API. Page API itself
unchanged by B or C. Fewer tools and fewer turns are the only levers that moved WebMCP's cost.

**How to apply (content flows):** don't claim WebMCP makes testing or agents faster on simple flows; say agents get around the backoffice by name for
slightly fewer turns. Pitch the tools on the Copilot bridge (safe, approved actions for editors) and on working with
packages without package-specific code. If testing resumes, add long or fragile flows (Forms' nested modals, block
editors, pickers) to `benchmarks/agent/cases.json` before anything else, and run the test site without SQLite's
`Cache=Shared`.
