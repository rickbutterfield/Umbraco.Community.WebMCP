# Changelog

All notable changes to `Umbraco.Community.WebMCP` and `Umbraco.Community.WebMCP.StaticAssets` are documented in this
file. Both packages are released together, with the same version.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Each version is tagged `release-<version>`.

## [Unreleased]

## [1.0.0-alpha.2] - 2026-10-20

### Added

- Block tools for Block List and Block Grid properties: `umbraco_list_blocks`, `umbraco_add_block`,
  `umbraco_set_block_values`, `umbraco_move_block` and `umbraco_remove_block`. They're offered only while the open
  document's type has a block property, its own or from a composition.
- `umbraco_select_picker_item`, to pick items in picker modals.
- `umbraco_sort_modal_items`, to sort items in drag-and-drop sort modals, such as sorting children.
- `umbraco_get_property_value_shape`, to describe the format a property stores its value in.
- `umbraco_save_document` and `umbraco_save_and_publish_document` take `cultures`, and answer the dialog that asks
  which variants to save or publish. They refuse cultures the document doesn't have or the user can't edit, and, when
  publishing, mandatory languages that would be left unpublished.
- `umbraco_get_document_state` returns `variantOptions`, every culture whether created or not, and
  `umbraco_create_document` takes `names` and `culturedValues` by culture.
- The example Forms toolset on the test site sets question settings, conditions and workflows.

### Changed

- Opening an entity in a reused workspace waits for its tool registrations to settle, so the reported
  `workspaceTools` match the document that's open.
- The example Forms toolset's tools are named `umbraco_forms_*`.

### Fixed

- `umbraco_list_modals`, `umbraco_select_picker_item` and `umbraco_click_modal_button` no longer list a picker's tree
  item actions as the modal's buttons.

## [1.0.0-alpha] - 2026-10-13

### Added

- WebMCP tools for the Umbraco 17 and 18 backoffice, registered on `document.modelContext` for the logged-in user:
  sections and section menus, trees, search, workspaces and workspace actions, entity actions, create options,
  modals, and creating, editing, saving and publishing documents. See [docs/tools.md](docs/tools.md).
- `webMcpToolset` and `webMcpWorkspaceToolset` extension types, so packages can add their own tools. See
  [docs/extending.md](docs/extending.md).
- The `Umbraco:Community:WebMCP:Enabled` and `Umbraco:Community:WebMCP:ModelContext` settings. By default the tools are
  only served in the `Development` environment.

[Unreleased]: https://github.com/rickbutterfield/Umbraco.Community.WebMCP/compare/release-1.0.0-alpha.2...HEAD
[1.0.0-alpha.2]: https://github.com/rickbutterfield/Umbraco.Community.WebMCP/compare/release-1.0.0-alpha...release-1.0.0-alpha.2
[1.0.0-alpha]: https://github.com/rickbutterfield/Umbraco.Community.WebMCP/tree/release-1.0.0-alpha
