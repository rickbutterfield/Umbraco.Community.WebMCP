---
name: production-gating
description: What may load in production — the Copilot bridge can (own opt-in); WebMCP stays dev-only unless enabled separately
type: decision
---

The package was dev-only: `WebMcpPackageManifestReader` only serves the backoffice entry point when `Umbraco:Community:WebMCP:Enabled` is true or the environment is Development. From the Copilot bridge onwards (07-10-2026), the Copilot bridge is meant for editors in production, behind its **own** opt-in. Enabling it must not also register tools on `document.modelContext`, which stays dev-only unless enabled separately.

**Why:** Rick chose editors in production as the bridge's audience. In production the safety boundary is the Copilot's agent tool permissions plus the editor's user permissions, with chat approval on every tool that changes data. Exposing the same tools to any in-page script or browser agent in production is a separate decision nobody has made.

**Done:** the client builds one entry point per surface (`umbraco-community-webmcp.js` for the tools,
`umbraco-community-webmcp-model-context.js` for WebMCP), and the manifest reader serves each surface only when its setting
(`Umbraco:Community:WebMCP:ModelContext`, defaulting to `Enabled`, then Development) allows it. The tool hub
only registers with `document.modelContext` once the WebMCP surface attaches it. The registration code still ships in
the shared hub chunk, but it doesn't run.

**How to apply:** Treat "load in production" as per-surface, not package-wide. Any surface (WebMCP, the Copilot bridge, future ones) gets its own setting and defaults to off outside Development. The "manifest is served from C#" convention in `CLAUDE.md` still holds, but its "keeps the tools out of production" wording needs updating once the bridge's gating is designed (umb-design).
