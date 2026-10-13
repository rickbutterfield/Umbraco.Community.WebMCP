# CLAUDE.md

Guidance for Claude Code when working in this repository.

**Repository**: https://github.com/rickbutterfield/Umbraco-WebMCP

Umbraco WebMCP is a development-only package for the Umbraco 18 backoffice. It registers tools on WebMCP
(`document.modelContext`), so agents can navigate and arrange backoffice state: sections, trees, workspaces, entity
actions, create options and modals. Most tools read the backoffice extension
registry, so they work for packages such as Umbraco Forms without package-specific code.

The layout follows the Umbraco DXP product repositories (Forms, Workflow, Engage and others).

## Documentation

Use the terms in `docs/vocabulary.md`. In particular, "Copilot bridge" is the Umbraco.AI integration; never call it just
"the bridge".

| File | Kind | Keep it in step when |
|---|---|---|
| `README.md` | Overview: what it is, enabling, running, links | Setup or settings change |
| `docs/tools.md` | Reference: every tool and how to call it | A tool is added, removed or changes behaviour |
| `docs/extending.md` | Reference: toolset extensions for package authors | The toolset types or their contract change |
| `docs/vocabulary.md` | Reference: terms | A new concept gets a name |
| `docs/testing-layers.md` | Explanation: Developer MCP vs WebMCP vs Playwright | Tools change what they skip or exercise |
| `docs/why-webmcp.md` | Explanation: uses beyond testing, including the Copilot | The positioning or the Copilot integration changes |
| `docs/umbraco-ai-copilot.md` | Explanation: how Copilot frontend tools work | Umbraco.AI changes its frontend tool contract |
| `docs/plans/<feature>/` | Plan: one feature, while it's planned and built | See "Finding the current feature's plan folder" below |

Explanations that contain time-sensitive facts (WebMCP's maturity, browser versions, another product's internals)
carry a "Last checked" date. Recheck and update it when you touch the page.

## Structure

```
src/
├── Umbraco.WebMCP               # C# package: composer, options, manifest reader
└── Umbraco.WebMCP.StaticAssets  # Razor class library with the Vite + Lit client (served at /App_Plugins/Umbraco.WebMCP)
examples/
└── Umbraco.WebMCP.TestSite      # Dev test site (SQLite, unattended install, includes Umbraco Forms)
```

Root files: `Directory.Build.props` (shared metadata), `Directory.Packages.props` (central package versions; add
versions there, never on a `PackageReference`), `global.json`, `version.json` (Nerdbank.GitVersioning) and
`Umbraco.WebMCP.slnx`.

## Build

```bash
npm run install-client   # npm install in StaticAssets
npm run build-client     # tsc + vite build to src/Umbraco.WebMCP.StaticAssets/wwwroot
npm run watch-client     # rebuild on change
npm run ci:lint-client   # ESLint, errors only
npm run test-client      # @web/test-runner in Playwright Chromium (*.test.ts next to the source)
dotnet build Umbraco.WebMCP.slnx
dotnet run --project examples/Umbraco.WebMCP.TestSite --launch-profile Umbraco.Web.UI
```

`wwwroot` is gitignored, so build the client before `dotnet build`, `dotnet run` or `dotnet pack`, or the site serves
no backoffice assets. CI (`.github/workflows/build.yml`) installs, lints, tests and builds the client, then builds and packs.

Open https://localhost:44311/umbraco. The backoffice refuses login over HTTP.

## Conventions

- **The manifest is served from C#, not `umbraco-package.json`.** `WebMcpPackageManifestReader` returns the tools'
  entry point plus one entry point per enabled surface: today `Umbraco:WebMCP:ModelContext` (WebMCP), defaulting to
  `Umbraco:WebMCP:Enabled`, which defaults to Development only. With no surface enabled it returns nothing. A new surface, such as the Copilot bridge, gets its own entry point
  and setting; don't replace this with a static manifest. The manifest's
  `Version` comes from the assembly's informational version, which the CMS uses for cache busting.
- **Tools run the backoffice's own code, as the logged-in user.** Prefer clicking a modal's real buttons
  (`umbraco_click_modal_button`) over submitting through its context: many modals do their work in the button handler.
- **Actions that may open a modal must not block.** Use `runWithoutBlocking` so the agent gets control back.
- **Tool names are verb-first: `umbraco_<verb>_<thing>`.** `npm run ci:check-tool-names` enforces it. When you add, remove
  or rename a tool, run `node scripts/check-tool-names.mjs --update` and update `docs/tools.md`.
- **Read-only tools set `readOnlyHint`; tools that change data set `consequentialHint`.**
- TypeScript follows the DXP ESLint 9 config (`eslint.config.mjs`); Prettier runs through ESLint with tabs and single
  quotes (`.prettierrc.json`).
- C#: nullable warnings are errors and public members need XML docs.

## Feature workflow

This project uses the Umbraco Claude Playbook. Feature plan folders live at:
`docs/plans/<feature-slug>/`

Pipeline: `/umb-explore` → `/umb-design` → `/umb-plan` → `/umb-build-loop`.
Each phase owns its own file in the feature's plan folder (`BRIEF.md`, `ARCHITECTURE.md` +
`SPEC.md`, `STORIES.md` + `PLAN.md`, `BUILD-LOG.md`) — see the playbook's README for the
file-ownership table. Small fixes that don't need a design go through `/quick-fix` instead.

**Branch/worktree per feature:** new features start from `main`. Plan-folder files stay
uncommitted through `umb-explore`/`umb-design`/`umb-plan`. `umb-build-loop` commits the plan
folder to `main` and cuts the feature's branch/worktree — named after the plan folder — the
moment building actually starts, not before (see `git-workflow`'s "Branch/worktree per
feature" section). No `WorktreeCreate` hook is configured, so `umb-build-loop` uses a plain
`git checkout -b <feature-slug>` off `main`.

**Finding the current feature's plan folder:** once a branch/worktree exists for a feature,
its name already carries the feature slug — strip a leading `<type>/` prefix and check whether
`docs/plans/` has a matching `<remainder>/` folder. If it does, that's the current feature — no
need to ask which one. Only fall back to asking when nothing matches.

**When a feature ships or is dropped:** move what lasts into the reference docs: new tools into `docs/tools.md`,
settings into `README.md`, terms into `docs/vocabulary.md`. Then add a status line under the plan folder's
`README.md` heading, `Status: shipped <DD-MM-YYYY>` or `Status: dropped <DD-MM-YYYY> — <why>`. Plan folders are
history; the reference docs describe what's true now. Don't let a plan become the spec.

**Plan folders are committed to a repo that may become public.** Describe other Umbraco
products (such as Umbraco.AI) by their public extension contracts and behaviour, without
internal file paths or line numbers.

## Project memory

Two places a decision lives, by scope:
- **Scoped to one directory/module** → a nested `CLAUDE.md` in that directory. Claude reads
  the nearest one walking up from whatever it's editing (`reviewer` does this on every task).
- **Project-wide, but not worth permanently bloating this file** → `.claude/memory/` — one
  file per entry, indexed in `.claude/memory/MEMORY.md`. See `.claude/memory/README.md` for
  the format.
