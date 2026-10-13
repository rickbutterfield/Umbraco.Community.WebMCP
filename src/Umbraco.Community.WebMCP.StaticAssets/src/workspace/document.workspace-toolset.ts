import type { UmbWebMcpToolsetApi } from '../extension-types.ts';
import type { UmbWebMcpTool, UmbWebMcpToolCall } from '../model-context.ts';
import { startOutcome } from '../outcome.ts';
import { toPlain, waitUntil, whenWorkspaceReady } from '../utils.ts';
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import {
	UMB_DOCUMENT_PUBLISHING_WORKSPACE_CONTEXT,
	UMB_DOCUMENT_WORKSPACE_CONTEXT,
	type UmbDocumentPublishingWorkspaceContext,
	type UmbDocumentWorkspaceContext,
} from '@umbraco-cms/backoffice/document';
import { UMB_MODAL_MANAGER_CONTEXT, type UmbModalContext } from '@umbraco-cms/backoffice/modal';
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

const CULTURES_PROPERTY = {
	cultures: {
		type: 'array',
		items: { type: 'string' },
		description:
			'For documents that vary by culture: the cultures to act on, such as ["en-US", "da"], from variantOptions in umbraco_get_document_state. The tool answers the dialog that asks which variants, as choosing them there does.',
	},
};

interface UmbCultureOption {
	unique: string;
	culture: string | null;
	language: string | null;
	isMandatory: boolean;
	isDefault: boolean;
	name: string | null;
	state: string | null;
	readOnly: boolean;
}

/** The first value of an observable, such as the workspace's variant options. */
const firstValue = <T>(observable: { subscribe(next: (value: T) => void): { unsubscribe(): void } }) =>
	new Promise<T>((resolve) => {
		let done = false;
		const subscription = observable.subscribe((value) => {
			if (done) return;
			done = true;
			resolve(value);
			queueMicrotask(() => subscription.unsubscribe());
		});
	});

/**
 * Document tools, registered as a `webMcpWorkspaceToolset` so they exist only while a document workspace is open.
 */
export class UmbDocumentWebMcpToolset extends UmbControllerBase implements UmbWebMcpToolsetApi {
	#workspace?: UmbDocumentWorkspaceContext;
	#publishing?: UmbDocumentPublishingWorkspaceContext;
	#modals: ReadonlyArray<UmbModalContext> = [];

	constructor(host: UmbControllerHost) {
		super(host);

		this.consumeContext(UMB_DOCUMENT_PUBLISHING_WORKSPACE_CONTEXT, (publishing) => {
			this.#publishing = publishing;
		});

		this.consumeContext(UMB_DOCUMENT_WORKSPACE_CONTEXT, (workspace) => {
			this.#workspace = workspace;
		});

		// Saving or publishing a document that varies by culture opens a dialog to choose the variants
		this.consumeContext(UMB_MODAL_MANAGER_CONTEXT, (manager) => {
			if (!manager) return;
			this.observe(manager.modals, (modals) => (this.#modals = modals), '_observeModals');
		});
	}

	/**
	 * The culture variants the save and publish dialogs offer (one per language when the document type varies by
	 * culture), with whether each exists, is mandatory or is read-only for the current user.
	 */
	async #getCultureOptions(): Promise<Array<UmbCultureOption>> {
		const workspace = this.#getWorkspace();
		const options = ((await firstValue(workspace.variantOptions as any)) ?? []) as Array<any>;
		return options
			.filter((option) => !option.segment)
			.map((option) => ({
				unique: option.unique,
				culture: option.culture ?? null,
				language: option.language?.name ?? null,
				isMandatory: Boolean(option.language?.isMandatory),
				isDefault: Boolean(option.language?.isDefault),
				name: option.variant?.name ?? null,
				state: option.variant?.state ?? null,
				readOnly: workspace.readOnlyGuard?.getIsPermittedForVariant?.(UmbVariantId.Create(option)) ?? false,
			}));
	}

	/**
	 * The variant ids to answer the dialog with, one per culture asked for. Throws an error that lists the cultures
	 * there are, and refuses read-only ones. When publishing, mandatory languages that aren't published yet must be in
	 * the selection, or the server refuses the publish.
	 */
	async #selectCultures(cultures: Array<string>, publishing: boolean) {
		const options = await this.#getCultureOptions();
		const available = () => options.map((x) => x.culture ?? 'invariant').join(', ');
		const selected = cultures.map((culture) => {
			const option = options.find((x) => (x.culture ?? '').toLowerCase() === culture.toLowerCase());
			if (!option) throw new Error(`"${culture}" is not a culture of this document. Cultures: ${available()}.`);
			if (option.readOnly) throw new Error(`You can't edit the "${option.culture}" variant.`);
			return option;
		});
		if (publishing) {
			const published = ['Published', 'PublishedPendingChanges'];
			const missing = options.filter((x) => x.isMandatory && !published.includes(x.state ?? '') && !selected.includes(x));
			if (missing.length) {
				throw new Error(
					`Mandatory languages must be published too: ${missing.map((x) => x.culture).join(', ')}. Add them to cultures.`,
				);
			}
		}
		return selected.map((x) => x.unique);
	}

	/**
	 * Runs a save or publish. If it opens the dialog to choose variants, answers it with the selection when there is
	 * one, through the modal's value, because its confirm button would rebuild the value from its own checkboxes.
	 * Without a selection, returns with the dialog open and completed false.
	 */
	async #runWithVariantDialog(work: () => Promise<unknown>, selection: Array<string> | undefined, signal?: AbortSignal) {
		const before = new Set(this.#modals.map((x) => x.key));
		let settled = false;
		let error: unknown;
		work().then(
			() => (settled = true),
			(reason) => {
				settled = true;
				error = reason;
			},
		);
		const dialog = () => this.#modals.find((x) => !before.has(x.key) && Array.isArray((x.getValue() as any)?.selection));
		await waitUntil(() => settled || dialog() !== undefined, signal, 5000);
		const modal = settled ? undefined : dialog();
		if (modal && selection) {
			modal.setValue({ ...(modal.getValue() as object), selection });
			modal.submit();
			await waitUntil(() => settled, signal, 30000);
		}
		if (error) throw error instanceof Error ? error : new Error(String(error));
		return {
			completed: settled,
			variantDialog:
				modal && !selection
					? { key: modal.key, value: toPlain(modal.getValue()), hint: 'Pass cultures to choose the variants.' }
					: undefined,
		};
	}

	#getWorkspace() {
		if (!this.#workspace) throw new Error('No document workspace is open.');
		return this.#workspace;
	}

	/**
	 * The workspace, once it has loaded. A document reloads after some actions, and setting a value while it does fails
	 * with "Data is missing".
	 */
	async #getReadyWorkspace(signal?: AbortSignal) {
		const workspace = this.#getWorkspace();
		if (!(await whenWorkspaceReady(workspace, signal)))
			throw new Error('The document is still loading. Try again shortly.');
		return workspace;
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
			variantOptions: await this.#getCultureOptions(),
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
					'Returns the document open in the workspace, including unsaved edits: key, variants and names, variantOptions (every culture it can have, including ones not created yet, with whether each is mandatory or read-only), the document type properties and the current property values.',
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
				execute: async (input: UmbVariantInput & { name: string }, call?: UmbWebMcpToolCall) => {
					(await this.#getReadyWorkspace(call?.signal)).setName(input.name, toVariantId(input));
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
				execute: async (input: UmbVariantInput & { alias: string; value: unknown }, call?: UmbWebMcpToolCall) => {
					const workspace = await this.#getReadyWorkspace(call?.signal);
					await workspace.setPropertyValue(input.alias, input.value, toVariantId(input));
					return { ok: true };
				},
			},
			{
				name: 'umbraco_save_document',
				title: 'Save document',
				description:
					'Saves the open document, as the Save button does, and returns any notifications it showed. Validation failures are returned as an error. For a document that varies by culture, pass cultures to save those variants; without them, the dialog to choose variants stays open and completed is false.',
				annotations: { consequentialHint: true, untrustedContentHint: true },
				inputSchema: { type: 'object', properties: CULTURES_PROPERTY },
				execute: async ({ cultures }: { cultures?: Array<string> } = {}, call?: UmbWebMcpToolCall) => {
					const selection = cultures?.length ? await this.#selectCultures(cultures, false) : undefined;
					const outcome = startOutcome();
					const result = await this.#runWithVariantDialog(
						() => this.#getWorkspace().requestSave(),
						selection,
						call?.signal,
					);
					return { ...result, ...(await outcome.report()), state: await this.#getState() };
				},
			},
			{
				name: 'umbraco_save_and_publish_document',
				title: 'Save and publish document',
				description:
					'Saves and publishes the open document, as the Save and publish button does, and returns the notifications it showed. For a document that varies by culture, pass cultures to publish those variants; mandatory languages that are not published yet must be included. Without cultures, the dialog to choose variants stays open and completed is false.',
				annotations: { consequentialHint: true, untrustedContentHint: true },
				inputSchema: { type: 'object', properties: CULTURES_PROPERTY },
				execute: async ({ cultures }: { cultures?: Array<string> } = {}, call?: UmbWebMcpToolCall) => {
					if (!this.#publishing) throw new Error('Publishing is not available for this document.');
					const publishing = this.#publishing;
					const selection = cultures?.length ? await this.#selectCultures(cultures, true) : undefined;
					const outcome = startOutcome();
					const result = await this.#runWithVariantDialog(() => publishing.saveAndPublish(), selection, call?.signal);
					return { ...result, ...(await outcome.report()), state: await this.#getState() };
				},
			},
		];
	}
}

export { UmbDocumentWebMcpToolset as api };
