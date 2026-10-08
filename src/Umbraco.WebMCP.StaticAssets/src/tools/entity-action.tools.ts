import {
	openPath,
	type UmbWebMcpTool,
	type UmbWebMcpToolAnnotations,
	type UmbWebMcpToolCall,
} from '../model-context.ts';
import { runWithoutBlocking, waitForQuiet } from '../utils.ts';
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

	function createListAndRunTools(
		type: 'entityAction' | 'entityCreateOptionAction',
		names: { list: string; run: string },
		text: { listTitle: string; listDescription: string; runTitle: string; runDescription: string },
		runAnnotations: UmbWebMcpToolAnnotations,
	): Array<UmbWebMcpTool> {
		return [
			{
				name: names.list,
				title: text.listTitle,
				description: text.listDescription,
				annotations: { readOnlyHint: true },
				inputSchema: { type: 'object', properties: ENTITY_PROPERTIES, required: ['entityType', 'unique'] },
				async execute(entity: UmbEntityRef, call?: UmbWebMcpToolCall) {
					const { dispose, permitted } = await getPermittedActions(type, entity, call?.signal);
					try {
						return permitted.map(({ manifest }) => ({
							alias: manifest.alias,
							label: localize.string(manifest.meta?.label ?? manifest.name),
							kind: manifest.kind ?? null,
						}));
					} finally {
						dispose();
					}
				},
			},
			{
				name: names.run,
				title: text.runTitle,
				description: text.runDescription,
				annotations: runAnnotations,
				inputSchema: {
					type: 'object',
					properties: { ...ENTITY_PROPERTIES, alias: { type: 'string', description: `From ${names.list}.` } },
					required: ['entityType', 'unique', 'alias'],
				},
				async execute({ alias, ...entity }: UmbEntityRef & { alias: string }, call?: UmbWebMcpToolCall) {
					const { dispose, permitted } = await getPermittedActions(type, entity, call?.signal);
					const action = permitted.find((controller) => controller.manifest.alias === alias)?.api;
					if (!action) {
						dispose();
						throw new Error(`"${alias}" is not available for this entity. Use ${names.list}.`);
					}

					const href = await action.getHref?.();
					if (href) {
						dispose();
						return { completed: true, ...(await openPath(href, call?.signal)) };
					}

					let work: Promise<unknown>;
					try {
						call?.signal?.throwIfAborted();
						work = action.execute();
					} catch (error) {
						dispose();
						throw error;
					}
					// Keep the host alive until the action, and any modal it opened, has finished, even if the caller
					// stops waiting first.
					work.then(dispose, dispose);
					const { completed } = await runWithoutBlocking(() => work, undefined, call?.signal);
					return { completed };
				},
			},
		];
	}

	return [
		...createListAndRunTools(
			'entityAction',
			{ list: 'umbraco_list_entity_actions', run: 'umbraco_run_entity_action' },
			{
				listTitle: 'List entity actions',
				listDescription:
					'Lists the actions the current user can run on an entity, as in its "..." menu in the tree: create, delete, move, rename and any actions added by packages. For a tree root, use the root entity from umbraco_get_tree_items.',
				runTitle: 'Run an entity action',
				runDescription:
					'Runs an entity action, as clicking it in the "..." menu does. Most actions open a modal: this returns while it is open, with completed false, so use umbraco_list_modals and the other modal tools to finish it. To create something, prefer umbraco_run_create_option.',
			},
			// Some actions, such as Reload, change nothing, but Delete, Trash and Move do, so every call is treated as
			// consequential.
			{ consequentialHint: true },
		),
		...createListAndRunTools(
			'entityCreateOptionAction',
			{ list: 'umbraco_list_create_options', run: 'umbraco_run_create_option' },
			{
				listTitle: 'List create options',
				listDescription:
					'Lists what can be created under an entity, as in the dialog its Create action opens: for example New Form, a form template or New Folder.',
				runTitle: 'Run a create option',
				runDescription:
					"Runs a create option directly, skipping the Create dialog. Most open the new item's workspace, wait until it has loaded and return workspaceTools; some, such as New Folder, open a modal instead and return completed false.",
			},
			// Opens an unsaved workspace or a modal; nothing is saved until the agent saves or submits.
			{},
		),
	];
}
