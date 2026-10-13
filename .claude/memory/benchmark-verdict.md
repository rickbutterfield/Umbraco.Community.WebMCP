---
name: benchmark-verdict
description: With vs without WebMCP (13-10-2026) - small effect on short content flows; big on the Forms designer with a product toolset; the WebMCP client decides much of the cost
type: decision
---

On 13-10-2026 `benchmarks/` compared the tools with and without WebMCP (CMS and Forms 18.2.1, Chrome 154, Claude
Sonnet; see `benchmarks/RESULTS.md`). Scripted: WebMCP to navigate saved 4% on content tests and 36% on Forms tests;
WebMCP only, 21% and 53%. Agents: on four content tasks WebMCP was quicker but not cheaper than clicking; on four Forms
tasks with the example Forms toolset it halved turns and cut cost by about a third. Chrome DevTools MCP
(`list_webmcp_tools` / `execute_webmcp_tool`) was the cheapest and fastest client overall; Playwright MCP, which gives
each page tool to the agent as its own, rewrites the cached prompt whenever the tool list changes.

**Why:** the comparison is deliberately with vs without WebMCP only. Rick decided (13-10-2026) that the docs, results
and blog posts present only that, with no intermediate approaches or earlier rounds.

**How to apply:** don't claim WebMCP makes agents cheaper on simple flows; pitch it on complex editors with a product
toolset, on the Copilot bridge, and on working with packages without package-specific code. Known gaps: picker modals
(setting the "Move to" picker's value doesn't update its selection) and agents listing tools before the backoffice has
registered them. Run the test site without SQLite's `Cache=Shared`.
