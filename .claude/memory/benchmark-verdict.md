---
name: benchmark-verdict
description: The 08-10-2026 benchmark found WebMCP tools give only small speed/cost gains on short content flows; testing parked, value is the Copilot bridge
type: decision
---

On 08-10-2026 `benchmarks/` measured the tools against plain Playwright: scripted CMS content tests were 5% faster
when the tools only navigate (21% when they do everything, which no longer tests the UI), and agents (Claude Sonnet)
took about 20% fewer turns and cost about 10% less at the same speed. Rick decided to stop the testing angle there.

**Why:** gains that small sit within the run-to-run noise of the benchmark (clicking-only numbers moved 10-15% between
rounds with no code change), and the content tasks are short paths that the CMS test helpers already make reliable.
The useful output was the bugs the benchmark found, all fixed (see `benchmarks/RESULTS.md`, "How the numbers moved").

**How to apply:** don't claim WebMCP makes testing or agents faster; say agents get around the backoffice by name for
slightly fewer turns. Pitch the tools on the Copilot bridge (safe, approved actions for editors) and on working with
packages without package-specific code. If testing resumes, add long or fragile flows (Forms' nested modals, block
editors, pickers) to `benchmarks/agent/cases.json` before anything else, and run the test site without SQLite's
`Cache=Shared`.
