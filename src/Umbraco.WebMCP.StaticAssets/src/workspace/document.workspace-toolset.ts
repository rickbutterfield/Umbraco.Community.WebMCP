import type { UmbWebMcpToolsetApi } from '../extension-types.ts';
import type { UmbWebMcpTool, UmbWebMcpToolCall } from '../model-context.ts';
import { runWithoutBlocking } from '../utils.ts';
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import {
	UMB_DOCUMENT_PUBLISHING_WORKSPACE_CONTEXT,
	UMB_DOCUMENT_WORKSPACE_CONTEXT,
	type UmbDocumentPublishingWorkspaceContext,
	type UmbDocumentWorkspaceContext,
} from '@umbraco-cms/backoffice/document';
import { UmbVariantId } from '@umbraco-cms/backoffice/variant';

interface UmbVariantInput {
	culture?: string | null;
	segment?: string | null;
}

const VARIANT_PROPERTIES = {
	culture: { type: ['string', 'null'], description: 'The culture, for example en-US. Omit for invariant content.' },
	segment: { type: ['string', 'null'], description: 'The segment. Omit unless the document type varies by segment.' },
};

const toVariantId = ({ culture, segment }: UmbVariantInput) => new UmbVariantId(culture ?? null, segment ?? null);

/**
 * Document tools, registered as a `webMcpWorkspaceToolset` so they exist only while a document workspace is open.
 */
export class UmbDocumentWebMcpToolset extends UmbControllerBase implements UmbWebMcpToolsetApi {
	#workspace?: UmbDocumentWorkspaceContext;
	#publishing?: UmbDocumentPublishingWorkspaceContext;

	constructor(host: UmbControllerHost) {
		super(host);

		this.consumeContext(UMB_DOCUMENT_PUBLISHING_WORKSPACE_CONTEXT, (publishing) => {
			this.#publishing = publishing;
		});

		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			this.#workspace = workspace;
		});
	}

	#getWorkspace() {
		if (!this.#workspace) throw new Error('No document workspace is open.');
		return this.#workspace;
	}

	async #getState() {
		const workspace = this.#getWorkspace();
		const properties = await workspace.structure.getContentTypeProperties();
		return {
			key: workspace.getUnique() ?? null,
			isNew: workspace.getIsNew() ?? false,
			hasUnsavedChanges: workspace.getHasUnpersistedChanges(),
			documentTypeKey: workspace.getContentTypeUnique() ?? null,
			variants:
				workspace.getVariants()?.map(({ culture, segment, name, state }) => ({ culture, segment, name, state })) ?? [],
			properties: properties.map(({ alias, name, variesByCulture, variesBySegment, dataType, validation }) => ({
				alias,
				name,
				variesByCulture,
				variesBySegment,
				dataTypeKey: dataType.unique,
				mandatory: validation.mandatory,
			})),
			values:
				workspace.getValues()?.map(({ alias, culture, segment, value }) => ({ alias, culture, segment, value })) ?? [],
		};
	}

	getTools(): Array<UmbWebMcpTool> {
		return [
			{
				name: 'umbraco_get_document_state',
				title: 'Get open document state',
				description:
					'Returns the document open in the workspace, including unsaved edits: key, variants and names, the document type properties and the current property values.',
				annotations: { readOnlyHint: true, untrustedContentHint: true },
				execute: () => this.#getState(),
			},
			{
				name: 'umbraco_set_document_name',
				title: 'Set document name',
				description: 'Sets the name of the open document for a variant. Does not save.',
				inputSchema: {
					type: 'object',
					properties: { name: { type: 'string' }, ...VARIANT_PROPERTIES },
					required: ['name'],
				},
				execute: async (input: UmbVariantInput & { name: string }) => {
					this.#getWorkspace().setName(input.name, toVariantId(input));
					return { ok: true };
				},
			},
			{
				name: 'umbraco_set_document_property_value',
				title: 'Set document property value',
				description:
					'Sets a property value on the open document, by property alias. The value must be in the stored format of the property editor. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						alias: { type: 'string', description: 'The property alias, from umbraco_get_document_state.' },
						value: { description: 'The value, in the property editor stored format.' },
						...VARIANT_PROPERTIES,
					},
					required: ['alias', 'value'],
				},
				execute: async (input: UmbVariantInput & { alias: string; value: unknown }) => {
					await this.#getWorkspace().setPropertyValue(input.alias, input.value, toVariantId(input));
					return { ok: true };
				},
			},
			{
				name: 'umbraco_save_document',
				title: 'Save document',
				description:
					'Saves the open document, as the Save button does. Variant documents open a dialog to choose variants: then completed is false, so finish it with the modal tools.',
				annotations: { consequentialHint: true, untrustedContentHint: true },
				execute: async (_input: object, call?: UmbWebMcpToolCall) => {
					const { completed } = await runWithoutBlocking(
						() => this.#getWorkspace().requestSave(),
						undefined,
						call?.signal,
					);
					return { completed, state: await this.#getState() };
				},
			},
			{
				name: 'umbraco_save_and_publish_document',
				title: 'Save and publish document',
				description:
					'Saves and publishes the open document, as the Save and publish button does. Variant documents open a dialog to choose variants: then completed is false, so finish it with the modal tools.',
				annotations: { consequentialHint: true, untrustedContentHint: true },
				execute: async (_input: object, call?: UmbWebMcpToolCall) => {
					if (!this.#publishing) throw new Error('Publishing is not available for this document.');
					const publishing = this.#publishing;
					const { completed } = await runWithoutBlocking(
						() => publishing.saveAndPublish(),
						undefined,
						call?.signal,
					);
					return { completed, state: await this.#getState() };
				},
			},
		];
	}
}

export { UmbDocumentWebMcpToolset as api };
