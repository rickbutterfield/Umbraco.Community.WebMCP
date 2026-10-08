import type { UmbWebMcpToolsetApi } from '../extension-types.ts';
import { registerTools, type UmbWebMcpTool, type UmbWebMcpToolCall } from '../model-context.ts';
import { runWithoutBlocking, whenWorkspaceReady } from '../utils.ts';
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbExtensionsApiInitializer } from '@umbraco-cms/backoffice/extension-api';
import { umbExtensionsRegistry } from '@umbraco-cms/backoffice/extension-registry';
import { UmbLocalizationController } from '@umbraco-cms/backoffice/localization-api';

/**
 * Created in every workspace. Registers tools that work for any workspace, such as running its footer actions, and
 * runs the `webMcpWorkspaceToolset` extensions whose conditions match this workspace. Nothing is registered until the
 * workspace has loaded, so a tool that appears can be used straight away.
 */
export class UmbWebMcpWorkspaceContext extends UmbControllerBase {
	#abortController = new AbortController();
	#toolsetAbortController?: AbortController;
	#workspace: any;
	#workspaceActions: Array<any> = [];
	#localize = new UmbLocalizationController(this);
	#ready: Promise<unknown>;
	#toolsets: Array<UmbWebMcpToolsetApi | undefined> = [];

	constructor(host: UmbControllerHost, workspace: unknown) {
		super(host);
		this.#workspace = workspace;
		// Registers anyway if loading takes too long, because the tools also report a workspace that failed to load
		this.#ready = whenWorkspaceReady(workspace, this.#abortController.signal).catch(() => undefined);

		new UmbExtensionsApiInitializer(
			this,
			umbExtensionsRegistry,
			'workspaceAction',
			(manifest: any) => [{ meta: manifest.meta }],
			undefined,
			(controllers) => (this.#workspaceActions = controllers),
		);

		new UmbExtensionsApiInitializer(
			this,
			umbExtensionsRegistry,
			'webMcpWorkspaceToolset',
			[workspace],
			undefined,
			(controllers) => {
				this.#toolsets = controllers.map((controller) => controller.api as UmbWebMcpToolsetApi);
				this.#ready.then(() => this.#registerToolsets());
			},
		);

		this.#ready.then(() => registerTools(this.#createTools(), this.#abortController.signal, 'workspace'));
	}

	#registerToolsets() {
		if (this.#abortController.signal.aborted) return;
		this.#toolsetAbortController?.abort();
		this.#toolsetAbortController = new AbortController();
		for (const toolset of this.#toolsets) {
			if (toolset) registerTools(toolset.getTools(), this.#toolsetAbortController.signal, 'workspace');
		}
	}

	#getInfo() {
		const workspace = this.#workspace;
		return {
			workspaceAlias: workspace.workspaceAlias ?? null,
			entityType: workspace.getEntityType?.() ?? null,
			unique: workspace.getUnique?.() ?? null,
			isNew: workspace.getIsNew?.() ?? null,
			hasUnsavedChanges: workspace.getHasUnpersistedChanges?.() ?? null,
		};
	}

	#createTools(): Array<UmbWebMcpTool> {
		return [
			{
				name: 'umbraco_get_workspace_info',
				title: 'Get open workspace',
				description:
					'Returns the workspace that is open: its alias, entity type and key, whether it is new and whether it has unsaved changes. When a workspace is open in a modal, this describes the modal one.',
				annotations: { readOnlyHint: true },
				execute: async () => this.#getInfo(),
			},
			{
				name: 'umbraco_list_workspace_actions',
				title: 'List workspace actions',
				description: 'Lists the buttons in the open workspace footer, such as Save, Save and publish or Submit.',
				annotations: { readOnlyHint: true },
				execute: async () =>
					this.#workspaceActions.map(({ manifest }) => ({
						alias: manifest.alias,
						label: this.#localize.string(manifest.meta?.label ?? manifest.name),
					})),
			},
			{
				name: 'umbraco_run_workspace_action',
				title: 'Run workspace action',
				description:
					'Runs a workspace footer action, as clicking its button does. If it opens a modal, for example to choose variants, this returns with completed false: finish it with the modal tools.',
				annotations: { consequentialHint: true },
				inputSchema: {
					type: 'object',
					properties: { alias: { type: 'string', description: 'From umbraco_list_workspace_actions.' } },
					required: ['alias'],
				},
				execute: async ({ alias }: { alias: string }, call?: UmbWebMcpToolCall) => {
					const action = this.#workspaceActions.find((controller) => controller.manifest.alias === alias)?.api;
					if (!action)
						throw new Error(
							`Action "${alias}" is not available in this workspace. Use umbraco_list_workspace_actions.`,
						);
					const { completed } = await runWithoutBlocking(() => action.execute(), undefined, call?.signal);
					return { completed, workspace: this.#getInfo() };
				},
			},
		];
	}

	override destroy() {
		this.#abortController.abort();
		this.#toolsetAbortController?.abort();
		super.destroy();
	}
}

export { UmbWebMcpWorkspaceContext as api };
