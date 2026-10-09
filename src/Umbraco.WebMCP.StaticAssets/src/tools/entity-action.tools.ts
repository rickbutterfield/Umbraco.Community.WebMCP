import {
	openPath,
	type UmbWebMcpTool,
	type UmbWebMcpToolAnnotations,
	type UmbWebMcpToolCall,
} from '../model-context.ts';
import { startOutcome } from '../outcome.ts';
import { findAction, runWithoutBlocking, waitForQuiet } from '../utils.ts';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UmbEntityContext } from '@umbraco-cms/backoffice/entity';
import { UmbExtensionsApiInitializer } from '@umbraco-cms/backoffice/extension-api';
import { umbExtensionsRegistry } from '@umbraco-cms/backoffice/extension-registry';
import { css, customElement } from '@umbraco-cms/backoffice/external/lit';
import { UmbLitElement } from '@umbraco-cms/backoffice/lit-element';
import { UmbLocalizationController } from '@umbraco-cms/backoffice/localization-api';

/**
 * An invisible element that provides an entity context, so entity actions and their conditions see the entity the
 * same way they do in a tree item's action menu.
 */
@customElement('umb-webmcp-entity-host')
class UmbWebMcpEntityHostElement extends UmbLitElement {
	static override styles = css`
		:host {
			display: none;
		}
	`;
}

interface UmbEntityRef {
	entityType: string;
	unique: string | null;
}

const ENTITY_PROPERTIES = {
	entityType: { type: 'string', description: 'From umbraco_get_tree_items or umbraco_get_location.' },
	unique: {
		type: ['string', 'null'],
		description: 'The entity key. Null for a root entity, such as the content root.',
	},
};

export function createEntityActionTools(host: UmbControllerHost): Array<UmbWebMcpTool> {
	const localize = new UmbLocalizationController(host);

	/**
	 * Creates the entity actions the current user is permitted to run on the entity. The caller must dispose of them
	 * once it no longer needs the actions, which may be after an action's modal closes. If `signal` aborts while the
	 * conditions settle, everything is disposed of and the abort reason is thrown.
	 */
	async function getPermittedActions(
		type: 'entityAction' | 'entityCreateOptionAction',
		{ entityType, unique }: UmbEntityRef,
		signal?: AbortSignal,
	) {
		const element = new UmbWebMcpEntityHostElement();
		host.getHostElement().appendChild(element);
		const entityContext = new UmbEntityContext(element);
		entityContext.setEntityType(entityType);
		entityContext.setUnique(unique);

		const dispose = () => {
			element.destroy();
			element.remove();
		};

		let permitted: Array<any> = [];
		try {
			await waitForQuiet(
				(onChange) => {
					new UmbExtensionsApiInitializer(
						element,
						umbExtensionsRegistry,
						type,
						(manifest: any) => [{ entityType, unique, meta: manifest.meta }],
						(manifest: any) => manifest.forEntityTypes.includes(entityType),
						(controllers) => {
							permitted = controllers;
							onChange();
						},
					);
				},
				undefined,
				undefined,
				signal,
			);
		} catch (error) {
			dispose();
			throw error;
		}

		return { dispose, permitted };
	}

	/**
	 * One tool that runs an action by alias or label, or lists the actions when none is given, so an agent that knows
	 * what it wants ("Trash", "New Form") needs one call instead of a list and a run.
	 */
	function createRunTool(
		type: 'entityAction' | 'entityCreateOptionAction',
		text: { name: string; title: string; description: string; where: string },
		annotations: UmbWebMcpToolAnnotations,
	): UmbWebMcpTool {
		return {
			name: text.name,
			title: text.title,
			description: text.description,
			annotations,
			inputSchema: {
				type: 'object',
				properties: {
					...ENTITY_PROPERTIES,
					action: {
						type: 'string',
						description: 'The label, such as Trash, or the alias of the action to run. Omit to list them.',
					},
				},
				required: ['entityType', 'unique'],
			},
			async execute({ action: wanted, ...entity }: UmbEntityRef & { action?: string }, call?: UmbWebMcpToolCall) {
				const { dispose, permitted } = await getPermittedActions(type, entity, call?.signal);
				const actions = permitted.map((controller) => ({
					alias: controller.manifest.alias as string,
					label: localize.string(controller.manifest.meta?.label ?? controller.manifest.name),
					kind: (controller.manifest.kind as string | undefined) ?? null,
					api: controller.api,
				}));
				if (!wanted) {
					dispose();
					return { completed: false, available: actions.map(({ alias, label, kind }) => ({ alias, label, kind })) };
				}

				let found;
				try {
					found = findAction(actions, wanted, text.where);
				} catch (error) {
					dispose();
					throw error;
				}
				const ran = { alias: found.alias, label: found.label };

				const href = await found.api?.getHref?.();
				if (href) {
					dispose();
					return { completed: true, ran, ...(await openPath(href, call?.signal)) };
				}

				const outcome = startOutcome();
				let work: Promise<unknown>;
				try {
					call?.signal?.throwIfAborted();
					work = found.api.execute();
				} catch (error) {
					dispose();
					throw error;
				}
				// Keep the host alive until the action, and any modal it opened, has finished, even if the caller
				// stops waiting first.
				work.then(dispose, dispose);
				const { completed } = await runWithoutBlocking(() => work, undefined, call?.signal);
				return { completed, ran, ...(await outcome.report()) };
			},
		};
	}

	return [
		createRunTool(
			'entityAction',
			{
				name: 'umbraco_run_entity_action',
				title: 'Run an entity action',
				description:
					`Runs an action from an entity's "..." menu by its label, such as Trash or Move to, or lists the actions when no action is given. Returns the notifications it showed and where it navigated. Most actions open a modal: this returns while it is open, with completed false, so use umbraco_list_modals and the other modal tools to finish it. To create something, prefer umbraco_run_create_option. For a tree root, use the root entity from umbraco_get_tree_items.`,
				where: 'for this entity',
			},
			// Some actions, such as Reload, change nothing, but Delete, Trash and Move do, so every call is treated as
			// consequential.
			{ consequentialHint: true },
		),
		createRunTool(
			'entityCreateOptionAction',
			{
				name: 'umbraco_run_create_option',
				title: 'Run a create option',
				description:
					"Runs an option from an entity's Create dialog by its label, such as New Form or New Folder, skipping the dialog, or lists the options when no action is given. Most open the new item's workspace, wait until it has loaded and return workspaceTools; some, such as New Folder, open a modal instead and return completed false.",
				where: 'to create here',
			},
			// Opens an unsaved workspace or a modal; nothing is saved until the agent saves or submits.
			{},
		),
	];
}
