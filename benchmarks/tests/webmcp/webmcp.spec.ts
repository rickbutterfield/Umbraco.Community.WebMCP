import { expect } from "@playwright/test";
import { ConstantHelper, test } from "@umbraco-cms/acceptance-test-helpers";
import path from "node:path";
import {
  BENCH_FOLDER,
  BENCH_FOLDER_ID,
  BENCH_FORM,
  FormsApi,
} from "../agent/forms-api";
import { callTool as callWebMcp, webMcpToolNames } from "../webmcp-tools";

// Checks the tools through WebMCP (document.modelContext). The webmcp project uses Chrome's own implementation
// (Google Chrome 149 or later, launched with WebMCP switched on); webmcp-polyfill runs the same tests in Playwright's
// bundled Chromium with Google's polyfill.

const documentTypeName = "WebMcpE2eDocumentType";
const documentName = "WebMCP end-to-end page";

test.beforeEach(async ({ page, umbracoApi, umbracoUi }, testInfo) => {
  if (testInfo.project.name === "webmcp-polyfill") {
    await page.addInitScript({
      path: path.join(import.meta.dirname, "webmcp-polyfill.js"),
    });
  }
  await umbracoApi.document.ensureNameNotExists(documentName);
  await umbracoApi.documentType.ensureNameNotExists(documentTypeName);
  await umbracoUi.goToBackOffice();
  await umbracoUi.content.goToSection(ConstantHelper.sections.content);
});

test.afterEach(async ({ umbracoApi }) => {
  await umbracoApi.document.ensureNameNotExists(documentName);
  await umbracoApi.documentType.ensureNameNotExists(documentTypeName);
});

test("registers the tools with their annotations", async ({ page }) => {
  await expect
    .poll(() => webMcpToolNames(page))
    .toContain("umbraco_search_entities");
  const tools = await page.evaluate(async () =>
    (await (document as any).modelContext.getTools()).map((tool: any) => ({
      name: tool.name,
      // An omitted hint means false; Chrome fills it in, the polyfill leaves it out
      readOnly: tool.annotations?.readOnlyHint ?? false,
      consequential: tool.annotations?.consequentialHint ?? false,
    })),
  );
  const byName = Object.fromEntries(
    tools.map((tool: any) => [tool.name, tool]),
  );

  expect(byName["umbraco_get_location"].readOnly).toBe(true);
  expect(byName["umbraco_run_entity_action"].consequential).toBe(true);
  expect(byName["umbraco_run_create_option"].consequential).toBe(false);
  expect(byName["umbraco_search_entities"]).toBeTruthy();
});

test("finds the Forms tree through the extension registry", async ({
  page,
}) => {
  const result = await callWebMcp(page, "umbraco_get_tree_items", {
    treeAlias: "Forms.Tree.Forms",
  });

  expect(result.root.entityType).toBe("forms-form-root");
});

test("returns a tool error to the caller instead of an UnknownError", async ({
  page,
}) => {
  const result = await callWebMcp(page, "umbraco_get_tree_items", {});

  expect(result.error).toContain("needs treeAlias");
});

test("creates and saves a document through WebMCP alone", async ({
  page,
  umbracoApi,
}) => {
  const documentTypeId =
    await umbracoApi.documentType.createDefaultDocumentTypeWithAllowAsRoot(
      documentTypeName,
    );

  const opened = await callWebMcp(page, "umbraco_open_new_document", {
    documentTypeKey: documentTypeId,
  });
  expect(opened.workspaceReady).toBe(true);
  expect(opened.workspaceTools).toContain("umbraco_set_document_name");
  // The workspace tools reached WebMCP too, not only the hub
  expect(await webMcpToolNames(page)).toContain("umbraco_save_document");

  await callWebMcp(page, "umbraco_set_document_name", { name: documentName });
  const saved = await callWebMcp(page, "umbraco_save_document");

  expect(saved.completed).toBe(true);
  await expect
    .poll(() => umbracoApi.document.doesNameExist(documentName))
    .toBeTruthy();
});

test("moves a form into a folder by picking the folder in the Move to picker", async ({
  page,
  umbracoApi,
}) => {
  const forms = new FormsApi(umbracoApi);
  await forms.cleanUp(BENCH_FORM);
  try {
    await forms.createFolder(BENCH_FOLDER_ID, BENCH_FOLDER);
    const formId = await forms.createForm(BENCH_FORM);
    await page.goto("/umbraco/section/forms");

    const ran = await callWebMcp(page, "umbraco_run_entity_action", {
      entityType: "forms-form",
      unique: formId,
      action: "Move",
    });
    expect(ran.completed).toBe(false);
    const { key } = (await callWebMcp(page, "umbraco_list_modals")).at(-1);

    // Forms' Move to only lets folders be picked
    const refused = await callWebMcp(page, "umbraco_select_picker_item", {
      key,
      name: BENCH_FORM,
    });
    expect(refused.error).toContain("can't be picked");

    const picked = await callWebMcp(page, "umbraco_select_picker_item", {
      key,
      name: BENCH_FOLDER,
    });
    expect(picked.selection).toEqual([
      { unique: BENCH_FOLDER_ID, name: BENCH_FOLDER },
    ]);
    expect(
      picked.buttons.find((button: any) => button.label === "Move").disabled,
    ).toBe(false);

    const moved = await callWebMcp(page, "umbraco_click_modal_button", {
      key,
      label: "Move",
    });
    expect(moved.closed).toBe(true);
    await expect
      .poll(async () => (await forms.getFormByName(BENCH_FORM))?.parentUnique)
      .toBe(BENCH_FOLDER_ID);
  } finally {
    await forms.cleanUp(BENCH_FORM);
  }
});
