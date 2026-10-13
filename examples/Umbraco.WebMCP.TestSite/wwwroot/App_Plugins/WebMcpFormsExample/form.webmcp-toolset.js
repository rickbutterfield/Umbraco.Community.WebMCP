// An example of a product adding its own WebMCP tools: the Umbraco Forms form designer, which the generic tools can
// open and save but not edit. It is a `webMcpWorkspaceToolset`, so it exists only while a form is open, and it depends
// on neither this package nor Forms' code: it works on the form workspace context it is given, the same way the
// designer's own structure manager does, and reads field types from the Forms management API.
//
// Written against Umbraco Forms 18.1.3. It is an example for the benchmark, not a supported part of Forms.
import { UMB_AUTH_CONTEXT } from '@umbraco-cms/backoffice/auth';
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import { UmbId } from '@umbraco-cms/backoffice/id';

const FIELD_TYPE_URL = '/umbraco/forms/management/api/v1/field-type';

/** The shapes Forms' own designer creates (FormDesignScaffoldsGenerator in Forms). */
const FIELD_PROPERTIES = {
	fieldType: { type: 'string', description: 'A field type name or alias, such as Short answer.' },
	caption: { type: 'string', description: 'The question text.' },
	alias: { type: 'string' },
	mandatory: { type: 'boolean' },
	requiredErrorMessage: { type: 'string' },
	options: { type: 'array', items: { type: 'string' }, description: 'For field types that take options.' },
	settings: { type: 'object', description: 'Setting values by alias, such as { "Placeholder": "Your name" }.' },
};
const FIELDS_SCHEMA = {
	type: 'array',
	items: { type: 'object', properties: FIELD_PROPERTIES, required: ['fieldType', 'caption'] },
};

const container = () => ({ id: UmbId.new(), caption: '', width: 12, fields: [] });
const group = (pageId, caption = '', sortOrder = 0) => ({
	id: UmbId.new(),
	caption,
	sortOrder,
	page: pageId,
	containers: [container()],
	condition: null,
});

/** Turns a caption into a field alias the way the designer does: "Your name" becomes "yourName". */
function toAlias(caption) {
	const words = caption.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
	return words.map((word, i) => (i ? word[0].toUpperCase() + word.slice(1) : word.toLowerCase())).join('');
}

export class WebMcpFormsToolset extends UmbControllerBase {
	#workspace;
	#fieldTypes;

	constructor(host, workspace) {
		super(host);
		this.#workspace = workspace;
	}

	#form() {
		const form = this.#workspace.getData();
		if (!form) throw new Error('No form is loaded. Open one with umbraco_open_entity first.');
		return form;
	}

	async #getFieldTypes() {
		if (!this.#fieldTypes) {
			const auth = await this.getContext(UMB_AUTH_CONTEXT);
			const token = await auth.getLatestToken();
			const response = await fetch(FIELD_TYPE_URL, { headers: { Authorization: `Bearer ${token}` } });
			if (!response.ok) throw new Error(`Could not load the Forms field types (${response.status}).`);
			this.#fieldTypes = await response.json();
		}
		return this.#fieldTypes;
	}

	async #findFieldType(nameOrAlias) {
		const wanted = nameOrAlias.toLowerCase();
		const types = await this.#getFieldTypes();
		const type = types.find((t) => [t.name, t.alias, t.id].some((x) => x?.toLowerCase() === wanted));
		if (!type) throw new Error(`No field type "${nameOrAlias}". Use forms_list_field_types.`);
		return type;
	}

	/** Every container on the form, with where it sits, newest last. */
	#containers(form) {
		return form.pages.flatMap((page, pageIndex) =>
			page.fieldSets.flatMap((fieldset) =>
				fieldset.containers.map((c) => ({ page, pageIndex, fieldset, container: c })),
			),
		);
	}

	#setPages(pages) {
		this.#workspace.setFormProperty('pages', pages);
	}

	#describe(form) {
		return {
			name: form.name,
			pages: form.pages.map((page) => ({
				id: page.id,
				caption: page.caption,
				groups: page.fieldSets.map((fieldset) => ({
					id: fieldset.id,
					caption: fieldset.caption,
					containers: fieldset.containers.map((c) => ({
						id: c.id,
						fields: c.fields.map((field) => ({
							id: field.id,
							caption: field.caption,
							alias: field.alias,
							fieldTypeId: field.fieldTypeId,
							mandatory: field.mandatory,
							preValues: field.preValues.map((p) => p.value),
						})),
					})),
				})),
			})),
		};
	}

	/** Adds a question to the given container of the open form, or else its last one. */
	async #addField(input) {
		const type = await this.#findFieldType(input.fieldType);
		if (input.options?.length && !type.supportsPrevalues)
			throw new Error(`"${type.name}" doesn't take options.`);
		const form = this.#form();
		const containers = this.#containers(form);
		const target = input.containerId
			? containers.find((c) => c.container.id === input.containerId)
			: containers.at(-1);
		if (!target) throw new Error(`No container "${input.containerId}". Use forms_get_form_design.`);

		const taken = new Set(containers.flatMap((c) => c.container.fields.map((field) => field.alias)));
		let alias = input.alias || toAlias(input.caption) || 'question';
		for (let i = 2; taken.has(alias); i++) alias = `${input.alias || toAlias(input.caption)}${i}`;

		const defaults = Object.fromEntries(type.settings.map((setting) => [setting.alias, setting.defaultValue ?? '']));
		const field = {
			id: UmbId.new(),
			caption: input.caption,
			alias,
			tooltip: '',
			cssClass: '',
			fieldTypeId: type.id,
			mandatory: input.mandatory ?? type.mandatoryByDefault ?? false,
			requiredErrorMessage: input.requiredErrorMessage ?? '',
			invalidErrorMessage: '',
			regex: '',
			// The API wants a GUID here, and the empty GUID means no prevalue source (the designer maps its empty string to it)
			prevalueSourceId: '00000000-0000-0000-0000-000000000000',
			preValues: (input.options ?? []).map((value) => ({ value, caption: null })),
			dataSourceFieldKey: '',
			condition: { id: UmbId.new(), enabled: false, actionType: 'Show', logicType: 'All', rules: [] },
			containsSensitiveData: false,
			settings: { ...defaults, ...(input.settings ?? {}) },
			allowedUploadTypes: [],
			allowMultipleFileUploads: false,
			mappedMemberPropertyAlias: null,
			memberPrefillMode: 'None',
		};

		this.#setPages(
			form.pages.map((page) =>
				page !== target.page
					? page
					: {
							...page,
							fieldSets: page.fieldSets.map((fieldset) =>
								fieldset !== target.fieldset
									? fieldset
									: {
											...fieldset,
											containers: fieldset.containers.map((c) =>
												c !== target.container ? c : { ...c, fields: [...c.fields, field] },
											),
										},
							),
						},
			),
		);
		return { fieldId: field.id, alias, fieldType: type.name };
	}

	async #addFields(fields, containerId) {
		const added = [];
		for (const field of fields) added.push(await this.#addField({ ...field, containerId: field.containerId ?? containerId }));
		return added;
	}

	getTools() {
		return [
			{
				name: 'forms_get_form_design',
				title: 'Get the form design',
				description:
					'Returns the open form: its name, and its pages, groups, containers and fields (id, caption, alias, field type, mandatory and options), including unsaved changes.',
				annotations: { readOnlyHint: true, untrustedContentHint: true },
				execute: async () => this.#describe(this.#form()),
			},
			{
				name: 'forms_list_field_types',
				title: 'List form field types',
				description:
					'Lists the field types a question can have, such as Short answer, Long answer or Dropdown, with whether they take options and the aliases of their settings.',
				annotations: { readOnlyHint: true },
				execute: async () =>
					(await this.#getFieldTypes()).map((type) => ({
						name: type.name,
						alias: type.alias,
						supportsOptions: type.supportsPrevalues,
						settings: type.settings.map((setting) => setting.alias),
					})),
			},
			{
				name: 'forms_set_form_name',
				title: 'Set the form name',
				description: 'Sets the name of the open form. Does not save: save with umbraco_run_workspace_action.',
				inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
				execute: async ({ name }) => {
					this.#workspace.setName(name);
					return { name };
				},
			},
			{
				name: 'forms_set_caption',
				title: 'Set a page or group caption',
				description: 'Sets the caption of a page or a group of the open form, by its id. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						id: { type: 'string', description: 'A page or group id, from forms_get_form_design.' },
						caption: { type: 'string' },
					},
					required: ['id', 'caption'],
				},
				execute: async ({ id, caption }) => {
					const form = this.#form();
					let found = false;
					const pages = form.pages.map((page) => {
						if (page.id === id) {
							found = true;
							return { ...page, caption };
						}
						return {
							...page,
							fieldSets: page.fieldSets.map((fieldset) => {
								if (fieldset.id !== id) return fieldset;
								found = true;
								return { ...fieldset, caption };
							}),
						};
					});
					if (!found) throw new Error(`No page or group "${id}". Use forms_get_form_design.`);
					this.#setPages(pages);
					return { id, caption };
				},
			},
			{
				name: 'forms_add_page',
				title: 'Add a form page',
				description:
					'Adds a page to the end of the open form, with one group and any questions you pass. Returns the ids of the page, its group and the group container to add questions to. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						caption: { type: 'string', description: 'The page caption. Optional.' },
						groupCaption: { type: 'string', description: "The caption of the page's first group. Optional." },
						fields: { ...FIELDS_SCHEMA, description: 'Questions to add to the group, as for forms_add_fields. Optional.' },
					},
				},
				execute: async ({ caption = '', groupCaption = '', fields = [] }) => {
					const form = this.#form();
					const pageId = UmbId.new();
					const fieldset = group(pageId, groupCaption);
					this.#setPages([
						...form.pages,
						{ id: pageId, caption, sortOrder: form.pages.length, form: form.unique, fieldSets: [fieldset], buttonCondition: null },
					]);
					const containerId = fieldset.containers[0].id;
					return { pageId, groupId: fieldset.id, containerId, fields: await this.#addFields(fields, containerId) };
				},
			},
			{
				name: 'forms_add_group',
				title: 'Add a form group',
				description:
					'Adds a group to a page of the open form (the last page if pageId is omitted). Returns the ids of the group and its container. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						pageId: { type: 'string', description: 'From forms_get_form_design or forms_add_page.' },
						caption: { type: 'string', description: 'The group caption. Optional.' },
					},
				},
				execute: async ({ pageId, caption = '' }) => {
					const form = this.#form();
					const target = pageId ? form.pages.find((page) => page.id === pageId) : form.pages.at(-1);
					if (!target) throw new Error(`No page "${pageId}". Use forms_get_form_design.`);
					const fieldset = group(target.id, caption, target.fieldSets.length);
					this.#setPages(
						form.pages.map((page) => (page === target ? { ...page, fieldSets: [...page.fieldSets, fieldset] } : page)),
					);
					return { groupId: fieldset.id, containerId: fieldset.containers[0].id };
				},
			},
			{
				name: 'forms_add_field',
				title: 'Add a question to the form',
				description:
					'Adds a question (field) to the open form, in the given container or else the last one. The alias is made from the caption unless given. Pass options for field types that take them, such as Dropdown, and settings by alias from forms_list_field_types. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						...FIELD_PROPERTIES,
						containerId: { type: 'string', description: 'From forms_get_form_design, forms_add_page or forms_add_group.' },
					},
					required: ['fieldType', 'caption'],
				},
				execute: (input) => this.#addField(input),
			},
			{
				name: 'forms_add_fields',
				title: 'Add questions to the form',
				description:
					'Adds several questions to the open form in one call, in order, in the given container or else the last one. Each takes the same input as forms_add_field. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						fields: FIELDS_SCHEMA,
						containerId: { type: 'string', description: 'From forms_get_form_design, forms_add_page or forms_add_group.' },
					},
					required: ['fields'],
				},
				execute: async ({ fields, containerId }) => ({ fields: await this.#addFields(fields, containerId) }),
			},
		];
	}
}

export { WebMcpFormsToolset as api };
