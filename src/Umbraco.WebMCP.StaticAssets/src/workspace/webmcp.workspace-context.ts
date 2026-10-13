import type { UmbWebMcpToolsetApi } from '../extension-types.ts';
import { registerTools, type UmbWebMcpTool, type UmbWebMcpToolCall } from '../model-context.ts';
import { startOutcome } from '../outcome.ts';
import { findAction, isWorkspaceReady, runWithoutBlocking, whenWorkspaceReady } from '../utils.ts';
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

	#getActions() {
		return this.#workspaceActions.map((controller) => ({
			alias: controller.manifest.alias as string,
			label: this.#localize.string(controller.manifest.meta?.label ?? controller.manifest.name),
			api: controller.api,
		}));
	}

	#getInfo() {
		const workspace = this.#workspace;
		return {
			workspaceAlias: workspace.workspaceAlias ?? null,
			entityType: workspace.getEntityType?.() ?? null,
			unique: workspace.getUnique?.() ?? null,
			isNew: workspace.getIsNew?.() ?? null,
			hasUnsavedChanges: workspace.getHasUnpersistedChanges?.() ?? null,
			ready: isWorkspaceReady(workspace),
			actions: this.#getActions().map(({ alias, label }) => ({ alias, label })),
		};
	}

	#createTools(): Array<UmbWebMcpTool> {
		return [
			{
				name: 'umbraco_get_workspace_info',
				title: 'Get open workspace',
				description:
					'Returns the workspace that is open: its alias, entity type and key, whether it is new, whether it has unsaved changes, whether it has finished loading and its footer actions, such as Save. When a workspace is open in a modal, this describes the modal one.',
				annotations: { readOnlyHint: true },
				execute: async () => this.#getInfo(),
			},
			{
				name: 'umbraco_run_workspace_action',
				title: 'Run workspace action',
				description:
					'Runs a button in the open workspace footer by its label, such as Save or Save and publish, as clicking it does, and returns any notifications it showed and the workspace afterwards. Validation failures are returned as an error. If it opens a modal, for example to choose variants, this returns with completed false: finish it with the modal tools.',
				annotations: { consequentialHint: true },
				inputSchema: {
					type: 'object',
					properties: {
						action: {
							type: 'string',
							description: 'The button label, such as Save, or its alias, from umbraco_get_workspace_info.',
						},
					},
					required: ['action'],
				},
				execute: async ({ action: wanted }: { action: string }, call?: UmbWebMcpToolCall) => {
					const found = findAction(this.#getActions(), wanted, 'in this workspace');
					const outcome = startOutcome();
					const { completed } = await runWithoutBlocking(() => found.api.execute(), undefined, call?.signal);
					return {
						completed,
						ran: { alias: found.alias, label: found.label },
						...(await outcome.report()),
						workspace: this.#getInfo(),
					};
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
