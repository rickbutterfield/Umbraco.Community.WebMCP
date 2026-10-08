import { openPath, type UmbWebMcpTool, type UmbWebMcpToolCall } from '../model-context.ts';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import {
	UMB_CREATE_DOCUMENT_WORKSPACE_PATH_PATTERN,
	UMB_DOCUMENT_ENTITY_TYPE,
	UMB_DOCUMENT_ROOT_ENTITY_TYPE,
	UMB_EDIT_DOCUMENT_WORKSPACE_PATH_PATTERN,
	UmbDocumentItemRepository,
} from '@umbraco-cms/backoffice/document';
import { UmbDocumentTypeStructureRepository } from '@umbraco-cms/backoffice/document-type';
import { createExtensionApi, UmbExtensionsManifestInitializer } from '@umbraco-cms/backoffice/extension-api';
import { umbExtensionsRegistry } from '@umbraco-cms/backoffice/extension-registry';
import { UmbLocalizationController } from '@umbraco-cms/backoffice/localization-api';
import { UMB_WORKSPACE_EDIT_PATH_PATTERN, UMB_WORKSPACE_PATH_PATTERN } from '@umbraco-cms/backoffice/workspace';

const BACKOFFICE_PATH_PATTERN = /\/section\/([^/]+)(?:\/workspace\/([^/]+)\/([^/]+)(?:\/([^/]+))?)?/;
const SECTION_ALIAS_CONDITION = 'Umb.Condition.SectionAlias';

interface UmbSectionInfo {
	alias: string;
	label: string;
	pathname: string;
}

interface UmbSectionManifestLike {
	alias: string;
	name: string;
	meta?: { label?: string; pathname: string };
}

interface UmbTreeRepository {
	requestTreeRootItems(args: object): Promise<{ data?: { items: Array<any>; total: number }; error?: unknown }>;
	requestTreeItemsOf(args: object): Promise<{ data?: { items: Array<any>; total: number }; error?: unknown }>;
	requestTreeRoot?(): Promise<{
		data?: { unique: null; entityType: string; name: string; hasChildren: boolean };
		error?: unknown;
	}>;
}

interface UmbSearchProviderLike {
	search(args: {
		query: string;
		paging?: { skip: number; take: number };
	}): Promise<{ data?: { items: Array<any>; total: number }; error?: unknown }>;
}

/**
 * Search results link to their workspace with a path relative to /umbraco/, such as section/content/workspace/....
 */
function toBackofficePath(href: string) {
	return href.startsWith('/') ? href : `/umbraco/${href}`;
}

function getCurrentSectionPathname() {
	return location.pathname.match(BACKOFFICE_PATH_PATTERN)?.[1] ?? null;
}

/**
 * Whether a manifest's conditions limit it to the given section.
 */
function isInSection(manifest: { conditions?: Array<any> }, sectionAlias: string) {
	return (manifest.conditions ?? []).some(
		(condition) =>
			condition.alias === SECTION_ALIAS_CONDITION &&
			(condition.match === sectionAlias || condition.oneOf?.includes(sectionAlias)),
	);
}

export function createNavigationTools(host: UmbControllerHost): Array<UmbWebMcpTool> {
	const localize = new UmbLocalizationController(host);
	const documentItemRepository = new UmbDocumentItemRepository(host);
	const documentTypeStructureRepository = new UmbDocumentTypeStructureRepository(host);
	const treeRepositories = new Map<string, Promise<UmbTreeRepository | undefined>>();
	// Remembers which section an entity type was seen in, so umbraco_open_entity can build its path.
	const sectionByEntityType = new Map<string, string>();

	// The searches the backoffice search offers this user: each globalSearch extension names a search provider. Other
	// search providers, such as the entity data picker's, only work inside their own UI.
	let globalSearchManifests: Array<any> = [];
	new UmbExtensionsManifestInitializer(host, umbExtensionsRegistry, 'globalSearch', null, (permitted) => {
		globalSearchManifests = permitted.map(({ manifest }) => manifest);
	});
	const searchProviders = new Map<string, Promise<UmbSearchProviderLike | undefined>>();

	let allowedSectionManifests: Array<UmbSectionManifestLike> = [];
	new UmbExtensionsManifestInitializer(host, umbExtensionsRegistry, 'section', null, (permitted) => {
		allowedSectionManifests = permitted.map(({ manifest }) => manifest as UmbSectionManifestLike);
	});

	// Labels are localised on each call, because a package's translations may load after its section registers.
	function getAllowedSections(): Array<UmbSectionInfo> {
		return allowedSectionManifests.map((manifest) => ({
			alias: manifest.alias,
			label: localize.string(manifest.meta?.label ?? manifest.name),
			pathname: manifest.meta?.pathname ?? '',
		}));
	}

	function findSection(aliasOrPathname: string) {
		const section = getAllowedSections().find((x) => x.alias === aliasOrPathname || x.pathname === aliasOrPathname);
		if (!section) throw new Error(`Section "${aliasOrPathname}" does not exist or the current user can't access it.`);
		return section;
	}

	function getMenuItems(section: UmbSectionInfo) {
		const menuAliases = umbExtensionsRegistry
			.getByType('sectionSidebarApp')
			.filter((app: any) => app.meta?.menu && isInSection(app, section.alias))
			.map((app: any) => app.meta?.menu as string);

		return umbExtensionsRegistry
			.getByType('menuItem')
			.filter((item: any) => item.meta?.menus?.some((menu: string) => menuAliases.includes(menu)))
			.map((item: any) => ({
				alias: item.alias,
				label: localize.string(item.meta?.label ?? item.name),
				entityType: item.meta?.entityType ?? null,
				treeAlias: item.kind === 'tree' ? item.meta?.treeAlias : null,
			}));
	}

	function getSectionOfTree(treeAlias: string) {
		return getAllowedSections().find((section) => getMenuItems(section).some((item) => item.treeAlias === treeAlias));
	}

	function getTreeRepository(treeAlias: string) {
		let repository = treeRepositories.get(treeAlias);
		if (!repository) {
			const tree = umbExtensionsRegistry.getByAlias<any>(treeAlias);
			if (tree?.type !== 'tree') throw new Error(`"${treeAlias}" is not a registered tree.`);
			const repositoryManifest = umbExtensionsRegistry.getByAlias<any>(tree.meta.repositoryAlias);
			if (!repositoryManifest)
				throw new Error(`The repository "${tree.meta.repositoryAlias}" of tree "${treeAlias}" is not registered.`);
			repository = createExtensionApi(host, repositoryManifest) as Promise<UmbTreeRepository | undefined>;
			treeRepositories.set(treeAlias, repository);
		}
		return repository;
	}

	function getSearchProvider(alias: string) {
		let provider = searchProviders.get(alias);
		if (!provider) {
			const manifest = umbExtensionsRegistry.getByAlias<any>(alias);
			if (!manifest) throw new Error(`The search provider "${alias}" is not registered.`);
			provider = createExtensionApi(host, manifest) as Promise<UmbSearchProviderLike | undefined>;
			searchProviders.set(alias, provider);
		}
		return provider;
	}

	async function getDocumentTypeOf(documentKey: string) {
		const { data } = await documentItemRepository.requestItems([documentKey]);
		const documentType = data?.[0]?.documentType.unique;
		if (!documentType) throw new Error(`Document "${documentKey}" was not found.`);
		return documentType;
	}

	return [
		{
			name: 'umbraco_get_location',
			title: 'Get backoffice location',
			description:
				'Returns where the backoffice currently is: the URL path, the open section and, when a workspace is open, its entity type, action (edit or create) and key.',
			annotations: { readOnlyHint: true },
			async execute() {
				const path = location.pathname;
				const [, section, entityType, action, unique] = path.match(BACKOFFICE_PATH_PATTERN) ?? [];
				return {
					path,
					section: section ?? null,
					workspace: entityType ? { entityType, action, unique: unique ?? null } : null,
				};
			},
		},
		{
			name: 'umbraco_navigate',
			title: 'Navigate the backoffice',
			description:
				'Navigates the backoffice to a path, for example /umbraco/section/settings. When the path opens a workspace, waits until it has loaded and returns workspaceTools. Unsaved changes may prompt a discard dialog.',
			inputSchema: {
				type: 'object',
				properties: { path: { type: 'string', description: 'An absolute backoffice path starting with /umbraco/.' } },
				required: ['path'],
			},
			async execute({ path }: { path: string }, call?: UmbWebMcpToolCall) {
				if (!path?.startsWith('/umbraco/')) throw new Error('Path must start with /umbraco/.');
				return openPath(path, call?.signal);
			},
		},
		{
			name: 'umbraco_list_sections',
			title: 'List sections',
			description:
				'Lists the backoffice sections the current user can access, including those added by packages such as Forms.',
			annotations: { readOnlyHint: true },
			async execute() {
				return getAllowedSections();
			},
		},
		{
			name: 'umbraco_list_section_menu',
			title: 'List section menu',
			description:
				'Lists the sidebar menu items of a section. Items with a treeAlias can be browsed with umbraco_get_tree_items; items with only an entityType open with umbraco_open_entity.',
			annotations: { readOnlyHint: true },
			inputSchema: {
				type: 'object',
				properties: {
					section: { type: 'string', description: 'Section alias or pathname. Defaults to the current section.' },
				},
			},
			async execute({ section }: { section?: string }) {
				const target = section ?? getCurrentSectionPathname();
				if (!target) throw new Error('No section is open, so pass one.');
				const sectionInfo = findSection(target);
				const items = getMenuItems(sectionInfo);
				for (const item of items) if (item.entityType) sectionByEntityType.set(item.entityType, sectionInfo.pathname);
				return { section: sectionInfo, items };
			},
		},
		{
			name: 'umbraco_get_tree_items',
			title: 'Get tree items',
			description:
				'Returns the root items of a tree, or the children of a parent item. Without a parent it also returns the tree root entity, whose actions (such as Create) belong to the tree as a whole. Use the entityType and unique of an item with umbraco_open_entity or umbraco_list_entity_actions.',
			annotations: { readOnlyHint: true, untrustedContentHint: true },
			inputSchema: {
				type: 'object',
				properties: {
					treeAlias: { type: 'string', description: 'From umbraco_list_section_menu.' },
					parent: {
						type: 'object',
						description: 'Omit for the root items.',
						properties: { entityType: { type: 'string' }, unique: { type: ['string', 'null'] } },
						required: ['entityType', 'unique'],
					},
					skip: { type: 'number', default: 0 },
					take: { type: 'number', default: 50 },
				},
				required: ['treeAlias'],
			},
			async execute({
				treeAlias,
				parent,
				skip = 0,
				take = 50,
			}: {
				treeAlias: string;
				parent?: { entityType: string; unique: string | null };
				skip?: number;
				take?: number;
			}) {
				const repository = await getTreeRepository(treeAlias);
				if (!repository) throw new Error(`Could not create the repository for tree "${treeAlias}".`);
				const paging = { skip, take };
				const { data, error } = parent
					? await repository.requestTreeItemsOf({ parent, paging })
					: await repository.requestTreeRootItems({ paging });
				if (error) throw error;

				const section = getSectionOfTree(treeAlias);
				const items =
					data?.items.map(({ unique, entityType, name, hasChildren, isFolder }) => ({
						unique,
						entityType,
						name,
						hasChildren,
						isFolder,
					})) ?? [];
				if (section) for (const item of items) sectionByEntityType.set(item.entityType, section.pathname);

				if (parent) return { total: data?.total ?? items.length, items };
				const { data: root } = (await repository.requestTreeRoot?.()) ?? {};
				return {
					root: root ? { entityType: root.entityType, unique: root.unique, name: localize.string(root.name) } : null,
					total: data?.total ?? items.length,
					items,
				};
			},
		},
		{
			name: 'umbraco_search_entities',
			title: 'Search the backoffice',
			description:
				'Finds documents, media, members, data types and other entities by name, with the same searches as the backoffice search, so the agent need not walk trees to find something. Returns each match with its entity type, key and path: open it with umbraco_navigate, or run its actions with umbraco_list_entity_actions.',
			annotations: { readOnlyHint: true, untrustedContentHint: true },
			inputSchema: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'Text to search for, such as part of a name.' },
					entityType: { type: 'string', description: 'Only return matches of this entity type, for example document.' },
					take: { type: 'number', default: 10, description: 'The most matches to return from each provider.' },
				},
				required: ['query'],
			},
			async execute({ query, entityType, take = 10 }: { query: string; entityType?: string; take?: number }) {
				if (!query?.trim()) throw new Error('Pass some text to search for.');
				const matches: Array<object> = [];
				const errors: Array<{ provider: string; error: string }> = [];
				await Promise.all(
					globalSearchManifests.map(async (manifest) => {
						const provider = localize.string(manifest.meta?.label ?? manifest.name);
						try {
							const api = await getSearchProvider(manifest.meta?.searchProviderAlias);
							const { data, error } = (await api?.search({ query, paging: { skip: 0, take } })) ?? {};
							if (error) throw error;
							for (const item of data?.items ?? []) {
								if (entityType && item.entityType !== entityType) continue;
								const path = item.href ? toBackofficePath(item.href) : null;
								const section = path?.match(BACKOFFICE_PATH_PATTERN)?.[1];
								if (section) sectionByEntityType.set(item.entityType, section);
								matches.push({
									provider,
									entityType: item.entityType,
									unique: item.unique,
									name: item.name,
									// Search also finds items in the recycle bin
									...(typeof item.isTrashed === 'boolean' ? { isTrashed: item.isTrashed } : {}),
									path,
								});
							}
						} catch (error) {
							errors.push({ provider, error: error instanceof Error ? error.message : String(error) });
						}
					}),
				);
				return errors.length ? { matches, errors } : { matches };
			},
		},
		{
			name: 'umbraco_open_entity',
			title: 'Open an entity workspace',
			description:
				'Opens the workspace for an entity, such as a document, a form or a data type, using the standard path section/{section}/workspace/{entityType}/edit/{unique}. Omit unique to open the workspace root, for example a collection. Waits until the workspace has loaded, then returns workspaceTools: the tools that work on it. Products that build their own paths (Commerce, for example) need their own tools.',
			inputSchema: {
				type: 'object',
				properties: {
					entityType: { type: 'string' },
					unique: { type: 'string', description: 'Omit to open the workspace root.' },
					section: {
						type: 'string',
						description:
							'Section alias or pathname. Defaults to where the entity type was last seen, then the current section.',
					},
				},
				required: ['entityType'],
			},
			async execute(
				{ entityType, unique, section }: { entityType: string; unique?: string; section?: string },
				call?: UmbWebMcpToolCall,
			) {
				const sectionName = section
					? findSection(section).pathname
					: (sectionByEntityType.get(entityType) ?? getCurrentSectionPathname());
				if (!sectionName) throw new Error(`Don't know which section "${entityType}" belongs to, so pass section.`);
				return openPath(
					unique
						? UMB_WORKSPACE_EDIT_PATH_PATTERN.generateAbsolute({ sectionName, entityType, unique })
						: UMB_WORKSPACE_PATH_PATTERN.generateAbsolute({ sectionName, entityType }),
					call?.signal,
				);
			},
		},
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
				'Opens the document workspace to create a new, unsaved document of the given document type. Waits until it has loaded, then returns workspaceTools: the document tools (umbraco_set_document_name, umbraco_set_document_property_value, umbraco_save_document) to fill it in and save it.',
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
