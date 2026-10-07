import type { UmbWebMcpTool } from '../model-context.ts';
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
	 * Creates the entity actions the current user is permitted to run on the entity. The caller must destroy the
	 * returned element once it no longer needs the actions, which may be after an action's modal closes.
	 */
	async function getPermittedActions(
		type: 'entityAction' | 'entityCreateOptionAction',
		{ entityType, unique }: UmbEntityRef,
	) {
		const element = new UmbWebMcpEntityHostElement();
		host.getHostElement().appendChild(element);
		const entityContext = new UmbEntityContext(element);
		entityContext.setEntityType(entityType);
		entityContext.setUnique(unique);

		let permitted: Array<any> = [];
		await waitForQuiet((onChange) => {
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
		});

		const dispose = () => {
			element.destroy();
			element.remove();
		};
		return { dispose, permitted };
	}

	function createListAndRunTools(
		type: 'entityAction' | 'entityCreateOptionAction',
		names: { list: string; run: string },
		text: { listTitle: string; listDescription: string; runTitle: string; runDescription: string },
	): Array<UmbWebMcpTool> {
		return [
			{
				name: names.list,
				title: text.listTitle,
				description: text.listDescription,
				annotations: { readOnlyHint: true },
				inputSchema: { type: 'object', properties: ENTITY_PROPERTIES, required: ['entityType', 'unique'] },
				async execute(entity: UmbEntityRef) {
					const { dispose, permitted } = await getPermittedActions(type, entity);
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
				annotations: { consequentialHint: true },
				inputSchema: {
					type: 'object',
					properties: { ...ENTITY_PROPERTIES, alias: { type: 'string', description: `From ${names.list}.` } },
					required: ['entityType', 'unique', 'alias'],
				},
				async execute({ alias, ...entity }: UmbEntityRef & { alias: string }) {
					const { dispose, permitted } = await getPermittedActions(type, entity);
					const action = permitted.find((controller) => controller.manifest.alias === alias)?.api;
					if (!action) {
						dispose();
						throw new Error(`"${alias}" is not available for this entity. Use ${names.list}.`);
					}

					const href = await action.getHref?.();
					if (href) {
						dispose();
						history.pushState(null, '', href);
						return { completed: true, navigatedTo: location.pathname };
					}

					try {
						const { completed, promise } = await runWithoutBlocking(() => action.execute());
						// Keep the host alive until the action, and any modal it opened, has finished.
						promise.finally(dispose);
						return { completed };
					} catch (error) {
						dispose();
						throw error;
					}
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
					"Runs a create option directly, skipping the Create dialog. Most open the new item's workspace; some, such as New Folder, open a modal instead and return completed false.",
			},
		),
	];
}
