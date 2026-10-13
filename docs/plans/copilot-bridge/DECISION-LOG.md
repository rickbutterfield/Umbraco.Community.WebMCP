# Decision log

- 07-10-2026 (umb-explore): Bridge direction is this package's tools → Copilot only; the reverse (Copilot tools on WebMCP) is out of scope because the Copilot's approval prompt only exists in its chat UI.
- 07-10-2026 (umb-explore): No changes to Umbraco.AI; the bridge uses only the public `uaiAgentFrontendTool` contract, so it works against released Umbraco.AI 18.1+.
- 07-10-2026 (umb-explore): Audience is backoffice editors in production, not only devs/testers — so the bridge needs its own opt-in that works outside Development, while WebMCP (`document.modelContext`) stays dev-only unless enabled separately.
- 07-10-2026 (umb-explore): The Copilot gaining its own navigation would not kill this; package-agnostic actions and modals still add value. Kill criteria are tool misuse by models, dynamic tool registration not working, or context cost.
