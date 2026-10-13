import { openPath, umbWebMcpToolHub, type UmbWebMcpTool, type UmbWebMcpToolCall } from '../model-context.ts';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import {
	UMB_CREATE_DOCUMENT_WORKSPACE_PATH_PATTERN,
	UMB_DOCUMENT_ENTITY_TYPE,
	UMB_DOCUMENT_ROOT_ENTITY_TYPE,
	UMB_EDIT_DOCUMENT_WORKSPACE_PATH_PATTERN,
	UmbDocumentItemRepository,
} from '@umbraco-cms/backoffice/document';
import { UmbDocumentTypeStructureRepository } from '@umbraco-cms/backoffice/document-type';

/**
 * Tools for creating and opening documents. They are registered only while the Content section is open, so agents in
 * other sections aren't sent their definitions on every turn.
 */
export function createDocumentTools(host: UmbControllerHost): Array<UmbWebMcpTool> {
	const documentItemRepository = new UmbDocumentItemRepository(host);
	const documentTypeStructureRepository = new UmbDocumentTypeStructureRepository(host);

	async function getDocumentTypeOf(documentKey: string) {
		const { data } = await documentItemRepository.requestItems([documentKey]);
		const documentType = data?.[0]?.documentType.unique;
		if (!documentType) throw new Error(`Document "${documentKey}" was not found.`);
		return documentType;
	}

	return [
		{
			name: 'umbraco_list_allowed_document_types',
			title: 'List allowed document types',
			description:
				'Lists the document types that can be created at the content root, or under a parent document when parentDocumentKey is given.',
			annotations: { readOnlyHint: true, untrustedContentHint: true },
			inputSchema: {
				type: 'object',
				properties: {
					parentDocumentKey: {
						type: 'string',
						description: 'The key of the parent document. Omit for the content root.',
					},
				},
			},
			async execute({ parentDocumentKey }: { parentDocumentKey?: string }) {
				const parentDocumentType = parentDocumentKey ? await getDocumentTypeOf(parentDocumentKey) : null;
				const { data, error } = await documentTypeStructureRepository.requestAllowedChildrenOf(
					parentDocumentType,
					parentDocumentKey ?? null,
				);
				if (error) throw error;
				return (
					data?.items.map((item) => ({ key: item.unique, name: item.name, description: item.description ?? null })) ??
					[]
				);
			},
		},
		{
			name: 'umbraco_open_new_document',
			title: 'Open a new document',
			description:
				'Opens the document workspace to create a new, unsaved document of the given document type, to fill in step by step (umbraco_create_document creates and saves one in a single call). Waits until it has loaded, then returns workspaceTools: the document tools (umbraco_set_document_name, umbraco_set_document_property_value, umbraco_save_document) to fill it in and save it.',
			inputSchema: {
				type: 'object',
				properties: {
					documentTypeKey: { type: 'string', description: 'From umbraco_list_allowed_document_types.' },
					parentDocumentKey: {
						type: 'string',
						description: 'The key of the parent document. Omit to create at the content root.',
					},
				},
				required: ['documentTypeKey'],
			},
			async execute(
				{ documentTypeKey, parentDocumentKey }: { documentTypeKey: string; parentDocumentKey?: string },
				call?: UmbWebMcpToolCall,
			) {
				return openPath(
					UMB_CREATE_DOCUMENT_WORKSPACE_PATH_PATTERN.generateAbsolute({
						parentEntityType: parentDocumentKey ? UMB_DOCUMENT_ENTITY_TYPE : UMB_DOCUMENT_ROOT_ENTITY_TYPE,
						parentUnique: parentDocumentKey ?? null,
						documentTypeUnique: documentTypeKey,
					}),
					call?.signal,
				);
			},
		},
		{
			name: 'umbraco_create_document',
			title: 'Create a document',
			description:
				'Creates a document in one call: opens a new document of the given type, sets its name and property values, then saves it (or saves and publishes it). Returns what the save returned. For a document type that varies by culture, pass names (and culturedValues) per culture instead of name: the cultures named are saved or published. For segments, use umbraco_open_new_document and the document tools instead.',
			annotations: { consequentialHint: true, untrustedContentHint: true },
			inputSchema: {
				type: 'object',
				properties: {
					documentType: {
						type: 'string',
						description: 'The document type key or name, from umbraco_list_allowed_document_types.',
					},
					parentDocumentKey: {
						type: 'string',
						description: 'The key of the parent document. Omit to create at the content root.',
					},
					name: { type: 'string', description: 'The name, for a document type that does not vary by culture.' },
					names: {
						type: 'object',
						description: 'Names by culture, for a document type that varies by culture, such as { "en-US": "Hello", "da": "Hej" }.',
					},
					values: {
						type: 'object',
						description:
							'Property values by alias that do not vary by culture, each in the property editor stored format, such as { "title": "Hello" }.',
					},
					culturedValues: {
						type: 'object',
						description: 'Property values that vary by culture, by culture then alias, such as { "da": { "title": "Hej" } }.',
					},
					publish: { type: 'boolean', description: 'Save and publish instead of only saving.' },
				},
				required: ['documentType'],
			},
			async execute(
				input: {
					documentType: string;
					parentDocumentKey?: string;
					name?: string;
					names?: Record<string, string>;
					values?: Record<string, unknown>;
					culturedValues?: Record<string, Record<string, unknown>>;
					publish?: boolean;
				},
				call?: UmbWebMcpToolCall,
			) {
				const names = Object.entries(input.names ?? {});
				if (!input.name && !names.length) throw new Error('Pass name, or names by culture for a document that varies by culture.');
				const allowed = (await umbWebMcpToolHub.call(
					'umbraco_list_allowed_document_types',
					{ parentDocumentKey: input.parentDocumentKey },
					call,
				)) as Array<{ key: string; name: string }>;
				const wanted = input.documentType.toLowerCase();
				const documentType = allowed.find((x) => x.key === input.documentType || x.name.toLowerCase() === wanted);
				if (!documentType) {
					throw new Error(
						`"${input.documentType}" can't be created here. Allowed document types: ${allowed.map((x) => x.name).join(', ') || 'none'}.`,
					);
				}

				const opened = (await umbWebMcpToolHub.call(
					'umbraco_open_new_document',
					{ documentTypeKey: documentType.key, parentDocumentKey: input.parentDocumentKey },
					call,
				)) as { workspaceReady?: boolean };
				if (!opened.workspaceReady) throw new Error('The new document did not finish loading.');
				if (input.name) await umbWebMcpToolHub.call('umbraco_set_document_name', { name: input.name }, call);
				// Naming a culture creates its variant
				for (const [culture, name] of names) {
					await umbWebMcpToolHub.call('umbraco_set_document_name', { name, culture }, call);
				}
				for (const [alias, value] of Object.entries(input.values ?? {})) {
					await umbWebMcpToolHub.call('umbraco_set_document_property_value', { alias, value }, call);
				}
				for (const [culture, values] of Object.entries(input.culturedValues ?? {})) {
					for (const [alias, value] of Object.entries(values)) {
						await umbWebMcpToolHub.call('umbraco_set_document_property_value', { alias, value, culture }, call);
					}
				}
				const cultures = names.map(([culture]) => culture);
				return umbWebMcpToolHub.call(
					input.publish ? 'umbraco_save_and_publish_document' : 'umbraco_save_document',
					cultures.length ? { cultures } : {},
					call,
				);
			},
		},
		{
			name: 'umbraco_open_document',
			title: 'Open a document',
			description:
				'Opens an existing document in the document workspace. Waits until it has loaded, then returns workspaceTools: the tools that work on it.',
			inputSchema: {
				type: 'object',
				properties: { documentKey: { type: 'string' } },
				required: ['documentKey'],
			},
			async execute({ documentKey }: { documentKey: string }, call?: UmbWebMcpToolCall) {
				return openPath(
					UMB_EDIT_DOCUMENT_WORKSPACE_PATH_PATTERN.generateAbsolute({ unique: documentKey }),
					call?.signal,
				);
			},
		},
	];
}
