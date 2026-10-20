// An example of a product adding its own WebMCP tools: the Umbraco Forms form designer, which the generic tools can
// open and save but not edit. It is a `webMcpWorkspaceToolset`, so it exists only while a form is open, and it depends
// on neither this package nor Forms' code: it works on the form workspace context it is given, the same way the
// designer's own structure manager does, and reads field and workflow types from the Forms management API.
//
// The designer edits a field, a condition or a workflow in a dialog that holds a copy, and its Submit button only
// writes that copy back to the form workspace (after asking the server to validate the settings). These tools write
// to the form workspace directly and call the same validation, so nothing opens and nothing blocks. Like the designer,
// they only stage changes: save with umbraco_run_workspace_action.
//
// Written against Umbraco Forms 18.2.1. It is an example for the benchmark, not a supported part of Forms.
import { UMB_AUTH_CONTEXT } from '@umbraco-cms/backoffice/auth';
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import { UmbId } from '@umbraco-cms/backoffice/id';

const API_URL = '/umbraco/forms/management/api/v1/';
const EMPTY_GUID = '00000000-0000-0000-0000-000000000000';
/** The view Forms gives settings that its dialogs don't show. */
const HIDDEN_SETTING_VIEW = 'Forms.PropertyEditorUi.Hidden';
const STAGES = ['onSubmit', 'onApprove', 'onReject'];
/** Forms' condition operators, spelled as Forms spells them (GreaterThen, LessThen). */
const OPERATORS = [
	'Is',
	'IsNot',
	'GreaterThen',
	'LessThen',
	'Contains',
	'ContainsIgnoreCase',
	'StartsWith',
	'StartsWithIgnoreCase',
	'EndsWith',
	'EndsWithIgnoreCase',
	'NotContains',
	'NotContainsIgnoreCase',
	'NotStartsWith',
	'NotStartsWithIgnoreCase',
	'NotEndsWith',
	'NotEndsWithIgnoreCase',
];

const SETTINGS_SCHEMA = {
	type: 'object',
	description:
		'Setting values by alias. Booleans become "True" or "False" and lists are joined with commas, as Forms stores them.',
};

/** The shapes Forms' own designer creates (FormDesignScaffoldsGenerator in Forms). */
const FIELD_PROPERTIES = {
	fieldType: { type: 'string', description: 'A field type name or alias, such as Short answer.' },
	caption: { type: 'string', description: 'The question text.' },
	alias: { type: 'string' },
	mandatory: { type: 'boolean' },
	requiredErrorMessage: { type: 'string' },
	options: { type: 'array', items: { type: 'string' }, description: 'For field types that take options.' },
	settings: { ...SETTINGS_SCHEMA, description: 'Setting values by alias, such as { "Placeholder": "Your name" }.' },
};
const FIELDS_SCHEMA = {
	type: 'array',
	items: { type: 'object', properties: FIELD_PROPERTIES, required: ['fieldType', 'caption'] },
};

const STAGE_SCHEMA = {
	type: 'string',
	enum: STAGES,
	description: 'When the workflow runs: onSubmit, onApprove or onReject (onReject only with manual approval).',
};

const CONDITION_PROPERTIES = {
	enabled: { type: 'boolean', description: 'False switches the condition off and keeps its rules. Defaults to true.' },
	action: { type: 'string', enum: ['Show', 'Hide'], description: 'What to do when the rules match. Defaults to Show.' },
	logic: { type: 'string', enum: ['All', 'Any'], description: 'Whether all rules or any rule must match. Defaults to All.' },
	rules: {
		type: 'array',
		description: 'Replaces the rules. Omit to keep the current ones.',
		items: {
			type: 'object',
			properties: {
				field: { type: 'string', description: 'The id, alias or caption of the question to test.' },
				operator: { type: 'string', enum: OPERATORS, description: 'Defaults to Is.' },
				value: { type: 'string', description: 'For a question with options, one of its option values.' },
			},
			required: ['field', 'value'],
		},
	},
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

/** A setting value as Forms stores it: always a string, "True"/"False" for toggles and comma-separated lists. */
function toSettingValue(value) {
	if (value === null || value === undefined) return '';
	if (typeof value === 'boolean') return value ? 'True' : 'False';
	if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean).join(',');
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

/** Finds the allowed value matching ignoring case, so "hide" and "isnot" work too. */
function pick(value, allowed, what) {
	const aliases = { greaterthan: 'GreaterThen', lessthan: 'LessThen' };
	const wanted = String(value).replace(/[\s_-]/g, '').toLowerCase();
	const match = allowed.find((x) => x.toLowerCase() === wanted) ?? aliases[wanted];
	if (!match) throw new Error(`"${value}" isn't a ${what}. Use one of: ${allowed.join(', ')}.`);
	return match;
}

const visibleSettings = (type) => type.settings.filter((setting) => setting.view !== HIDDEN_SETTING_VIEW);

/**
 * The values a setting can take, for the editors that offer a list; other editors use a setting's prevalues for
 * other things, such as a toggle's default or a number's range. A prevalue can carry a label: "value|label".
 */
const settingOptions = (setting) =>
	/Dropdown|CheckBoxList|RadioButtonList/.test(setting.view)
		? (setting.prevalues ?? []).map((x) => x.split('|')[0].trim()).filter(Boolean)
		: [];

/** A setting of a field or workflow type, as an agent needs it to fill it in. */
const describeSetting = (setting) => ({
	alias: setting.alias,
	name: setting.name,
	description: setting.description || undefined,
	editor: setting.view,
	options: settingOptions(setting).length ? settingOptions(setting) : undefined,
	defaultValue: setting.defaultValue || undefined,
	mandatory: setting.isMandatory || undefined,
	readOnly: setting.isReadOnly || undefined,
});

export class WebMcpFormsToolset extends UmbControllerBase {
	#workspace;
	#fieldTypes;
	#workflowTypes;
	#validationPatterns;

	constructor(host, workspace) {
		super(host);
		this.#workspace = workspace;
	}

	#form() {
		const form = this.#workspace.getData();
		if (!form) throw new Error('No form is loaded. Open one with umbraco_open_entity first.');
		return form;
	}

	/** Calls the Forms management API as the logged-in user. */
	async #fetch(path, init = {}) {
		const auth = await this.getContext(UMB_AUTH_CONTEXT);
		const token = await auth.getLatestToken();
		const headers = { Authorization: `Bearer ${token}` };
		if (init.body) headers['Content-Type'] = 'application/json';
		return fetch(API_URL + path, { ...init, headers });
	}

	async #getJson(path, what) {
		const response = await this.#fetch(path);
		if (!response.ok) throw new Error(`Could not load the Forms ${what} (${response.status}).`);
		return response.json();
	}

	/**
	 * Asks Forms to validate a field's or workflow's settings, as the field dialog does before it closes. A field type
	 * can reject values that look fine, such as a malformed number.
	 */
	async #validateSettings(path, body) {
		const response = await this.#fetch(path, { method: 'POST', body: JSON.stringify(body) });
		if (response.ok) return;
		// A 400 lists each failure in errors, such as "'Subject' setting has not been set (Parameter 'Subject')"
		const problem = await response.json().catch(() => null);
		const reason = problem?.errors?.length ? problem.errors.join(' ') : problem?.detail || problem?.title;
		throw new Error(`Forms rejected the settings: ${reason ?? response.status}`);
	}

	async #getFieldTypes() {
		this.#fieldTypes ??= await this.#getJson('field-type', 'field types');
		return this.#fieldTypes;
	}

	async #getWorkflowTypes() {
		this.#workflowTypes ??= await this.#getJson('workflow-type', 'workflow types');
		return this.#workflowTypes;
	}

	async #getValidationPatterns() {
		this.#validationPatterns ??= await this.#getJson('field-type/validation-pattern', 'validation patterns');
		return this.#validationPatterns;
	}

	async #findFieldType(nameOrAlias) {
		const wanted = nameOrAlias.toLowerCase();
		const types = await this.#getFieldTypes();
		const type = types.find((t) => [t.name, t.alias, t.id].some((x) => x?.toLowerCase() === wanted));
		if (!type) throw new Error(`No field type "${nameOrAlias}". Use umbraco_forms_list_field_types.`);
		return type;
	}

	async #findWorkflowType(nameOrAlias) {
		const wanted = nameOrAlias.toLowerCase();
		const types = await this.#getWorkflowTypes();
		const type = types.find((t) => [t.name, t.alias, t.id].some((x) => x?.toLowerCase() === wanted));
		if (!type) throw new Error(`No workflow type "${nameOrAlias}". Use umbraco_forms_list_workflow_types.`);
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

	#fields(form) {
		return this.#containers(form).flatMap((c) => c.container.fields);
	}

	/** Finds a question by id, alias or caption, ignoring case. */
	#findField(form, ref) {
		const fields = this.#fields(form);
		const byId = fields.find((field) => field.id === ref);
		if (byId) return byId;
		const wanted = String(ref).trim().toLowerCase();
		const byAlias = fields.filter((field) => field.alias.toLowerCase() === wanted);
		const matches = byAlias.length ? byAlias : fields.filter((field) => field.caption.trim().toLowerCase() === wanted);
		if (matches.length === 1) return matches[0];
		if (!matches.length) throw new Error(`No question "${ref}". Use umbraco_forms_get_form_design.`);
		throw new Error(`More than one question is called "${ref}". Pass one of their ids: ${matches.map((x) => x.id).join(', ')}.`);
	}

	#setPages(pages) {
		this.#workspace.setFormProperty('pages', pages);
	}

	/**
	 * Replaces the page, group or question with this id using `update`, and returns which it was ('page', 'group' or
	 * 'field'), or undefined if the form has nothing with that id. The form's state is frozen, so it copies.
	 */
	#updateItem(id, update) {
		let kind;
		const pages = this.#form().pages.map((page) => {
			if (page.id === id) {
				kind = 'page';
				return update(page, kind);
			}
			return {
				...page,
				fieldSets: page.fieldSets.map((fieldset) => {
					if (fieldset.id === id) {
						kind = 'group';
						return update(fieldset, kind);
					}
					return {
						...fieldset,
						containers: fieldset.containers.map((c) => ({
							...c,
							fields: c.fields.map((field) => {
								if (field.id !== id) return field;
								kind = 'field';
								return update(field, kind);
							}),
						})),
					};
				}),
			};
		});
		if (kind) this.#setPages(pages);
		return kind;
	}

	/** Applies setting values to a field or workflow type's settings, refusing aliases the type doesn't have. */
	#applySettings(type, current, input) {
		const settings = { ...current };
		for (const [alias, value] of Object.entries(input ?? {})) {
			const setting = visibleSettings(type).find((x) => x.alias.toLowerCase() === alias.toLowerCase());
			if (!setting) {
				const known = visibleSettings(type).map((x) => x.alias);
				throw new Error(`"${type.name}" has no setting "${alias}". Its settings are: ${known.join(', ') || 'none'}.`);
			}
			if (setting.isReadOnly) throw new Error(`The "${setting.alias}" setting of "${type.name}" is read-only.`);
			const stored = toSettingValue(value);
			const options = settingOptions(setting);
			const invalid = stored ? stored.split(',').filter((x) => options.length && !options.includes(x)) : [];
			if (invalid.length) {
				throw new Error(`The "${setting.alias}" setting of "${type.name}" takes ${options.join(', ')}, not ${invalid.join(', ')}.`);
			}
			settings[setting.alias] = stored;
		}
		return settings;
	}

	/** Refuses empty mandatory settings, as the workflow dialog does; whitespace counts as empty, as on the server. */
	#checkMandatorySettings(type, settings) {
		const missing = visibleSettings(type)
			.filter((setting) => setting.isMandatory && !setting.isReadOnly && !String(settings[setting.alias] ?? '').trim())
			.map((setting) => setting.alias);
		if (missing.length) {
			throw new Error(`"${type.name}" needs these settings: ${missing.join(', ')}. Use umbraco_forms_list_workflow_types.`);
		}
	}

	/** A condition in the shape Forms stores, from the tool input and the condition it replaces. */
	#buildCondition(form, existing, input) {
		const rules = input.rules
			? input.rules.map((rule) => {
					const field = this.#findField(form, rule.field);
					const operator = rule.operator ? pick(rule.operator, OPERATORS, 'condition operator') : 'Is';
					const value = String(rule.value ?? '');
					const options = field.preValues.map((x) => x.value);
					if (options.length && ['Is', 'IsNot'].includes(operator) && !options.includes(value)) {
						throw new Error(`"${field.caption}" has the options ${options.join(', ')}, not "${value}".`);
					}
					return { id: UmbId.new(), field: field.id, operator, value };
				})
			: (existing?.rules ?? []);
		const enabled = input.enabled ?? true;
		if (enabled && !rules.length) {
			throw new Error('A condition needs at least one rule. Pass rules, or enabled: false to switch it off.');
		}
		return {
			id: existing?.id ?? UmbId.new(),
			enabled,
			actionType: input.action ? pick(input.action, ['Show', 'Hide'], 'condition action') : (existing?.actionType ?? 'Show'),
			logicType: input.logic ? pick(input.logic, ['All', 'Any'], 'condition logic') : (existing?.logicType ?? 'All'),
			rules,
		};
	}

	/** A condition with each rule's question named, or undefined if it is switched off and `always` is false. */
	#describeCondition(form, condition, always = false) {
		if (!condition || (!condition.enabled && !always)) return undefined;
		const fields = new Map(this.#fields(form).map((field) => [field.id, field]));
		return {
			enabled: condition.enabled,
			action: condition.actionType,
			logic: condition.logicType,
			rules: condition.rules.map((rule) => ({
				fieldId: rule.field,
				field: fields.get(rule.field)?.caption ?? null,
				operator: rule.operator,
				value: rule.value,
			})),
		};
	}

	#workflows(form) {
		return Object.fromEntries(STAGES.map((stage) => [stage, form.formWorkflows?.[stage] ?? []]));
	}

	#setWorkflows(workflows) {
		this.#workspace.setFormProperty('formWorkflows', workflows);
	}

	/** Finds a workflow on the open form by id or name, ignoring case, and the stage it is in. */
	#findWorkflow(form, ref) {
		const all = Object.entries(this.#workflows(form)).flatMap(([stage, list]) =>
			list.map((workflow) => ({ stage, workflow })),
		);
		const byId = all.find((x) => x.workflow.id === ref);
		if (byId) return byId;
		const wanted = String(ref).trim().toLowerCase();
		const matches = all.filter((x) => x.workflow.name.trim().toLowerCase() === wanted);
		if (matches.length === 1) return matches[0];
		if (!matches.length) throw new Error(`No workflow "${ref}" on this form. Use umbraco_forms_list_workflows.`);
		throw new Error(`More than one workflow is called "${ref}". Pass one of their ids: ${matches.map((x) => x.workflow.id).join(', ')}.`);
	}

	#describeWorkflow(form, workflow) {
		return {
			id: workflow.id,
			name: workflow.name,
			workflowType: workflow.workflowTypeName,
			active: workflow.active,
			includeSensitiveData: workflow.includeSensitiveData === 'True',
			mandatory: workflow.isMandatory || undefined,
			typeDeleted: workflow.isDeleted || undefined,
			settings: workflow.settings,
			condition: this.#describeCondition(form, workflow.condition),
		};
	}

	/** Notes why a workflow in this stage may never run, or undefined. */
	#stageNote(form, stage) {
		return stage === 'onReject' && !form.manualApproval
			? 'This form has no manual approval, so its onReject workflows never run and the designer hides them.'
			: undefined;
	}

	#describe(form) {
		return {
			name: form.name,
			pages: form.pages.map((page) => ({
				id: page.id,
				caption: page.caption,
				buttonCondition: this.#describeCondition(form, page.buttonCondition),
				groups: page.fieldSets.map((fieldset) => ({
					id: fieldset.id,
					caption: fieldset.caption,
					condition: this.#describeCondition(form, fieldset.condition),
					containers: fieldset.containers.map((c) => ({
						id: c.id,
						fields: c.fields.map((field) => ({
							id: field.id,
							caption: field.caption,
							alias: field.alias,
							fieldTypeId: field.fieldTypeId,
							mandatory: field.mandatory,
							preValues: field.preValues.map((p) => p.value),
							condition: this.#describeCondition(form, field.condition),
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
		if (!target) throw new Error(`No container "${input.containerId}". Use umbraco_forms_get_form_design.`);

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
			prevalueSourceId: EMPTY_GUID,
			preValues: (input.options ?? []).map((value) => ({ value, caption: null })),
			dataSourceFieldKey: '',
			condition: { id: UmbId.new(), enabled: false, actionType: 'Show', logicType: 'All', rules: [] },
			containsSensitiveData: false,
			settings: this.#applySettings(type, defaults, input.settings),
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

	/** A question's settings and what its field type allows, for umbraco_forms_get_field_settings and after a change. */
	async #describeField(form, field) {
		const type = await this.#findFieldType(field.fieldTypeId);
		return {
			id: field.id,
			caption: field.caption,
			alias: field.alias,
			fieldType: type.name,
			tooltip: field.tooltip ?? '',
			mandatory: field.mandatory,
			requiredErrorMessage: field.requiredErrorMessage ?? '',
			regex: field.regex ?? '',
			invalidErrorMessage: field.invalidErrorMessage ?? '',
			options: field.preValues.map((p) => p.value),
			usesPrevalueSource: !!field.prevalueSourceId && field.prevalueSourceId !== EMPTY_GUID,
			settings: field.settings,
			condition: this.#describeCondition(form, field.condition, true),
			fieldTypeSupports: {
				mandatory: type.supportsMandatory,
				regex: type.supportsRegex,
				options: type.supportsPrevalues,
			},
			availableSettings: visibleSettings(type).map(describeSetting),
			validationPatterns: type.supportsRegex
				? (await this.#getValidationPatterns()).map((x) => ({ name: x.name, pattern: x.pattern }))
				: undefined,
		};
	}

	async #setFieldSettings(input) {
		const form = this.#form();
		const field = this.#findField(form, input.field);
		const type = await this.#findFieldType(field.fieldTypeId);
		const refuse = (property, supported) => {
			if (input[property] !== undefined && !supported)
				throw new Error(`"${type.name}" questions don't take ${property}.`);
		};
		refuse('mandatory', type.supportsMandatory);
		refuse('requiredErrorMessage', type.supportsMandatory);
		refuse('regex', type.supportsRegex);
		refuse('invalidErrorMessage', type.supportsRegex);
		refuse('options', type.supportsPrevalues);

		const caption = input.caption ?? field.caption;
		const alias = input.alias ?? field.alias;
		if (!caption.trim() || !alias.trim()) throw new Error('A question needs a caption and an alias.');
		if (this.#fields(form).some((other) => other.id !== field.id && other.alias === alias)) {
			throw new Error(`Another question already has the alias "${alias}".`);
		}
		const settings = this.#applySettings(type, field.settings, input.settings);
		await this.#validateSettings(`form-field/${type.id}/validate-settings`, {
			caption,
			alias,
			settings,
			allowedUploadTypes: field.allowedUploadTypes ?? [],
		});

		const changes = { caption, alias, settings };
		for (const property of ['tooltip', 'mandatory', 'requiredErrorMessage', 'regex', 'invalidErrorMessage']) {
			if (input[property] !== undefined) changes[property] = input[property];
		}
		if (input.options) changes.preValues = input.options.map((value) => ({ value: String(value), caption: null }));
		this.#updateItem(field.id, (x) => ({ ...x, ...changes }));
		return this.#describeField(this.#form(), { ...field, ...changes });
	}

	#setCondition(input) {
		const form = this.#form();
		const workflow = Object.values(this.#workflows(form))
			.flat()
			.find((x) => x.id === input.id);
		if (workflow) {
			const condition = this.#buildCondition(form, workflow.condition, input);
			const workflows = this.#workflows(form);
			this.#setWorkflows(
				Object.fromEntries(
					STAGES.map((stage) => [stage, workflows[stage].map((x) => (x.id === workflow.id ? { ...x, condition } : x))]),
				),
			);
			return { id: workflow.id, appliesTo: 'workflow', condition: this.#describeCondition(form, condition, true) };
		}

		const isPageOrGroup = form.pages.some(
			(page) => page.id === input.id || page.fieldSets.some((fieldset) => fieldset.id === input.id),
		);
		const id = isPageOrGroup ? input.id : this.#findField(form, input.id).id;
		let condition;
		const appliesTo = this.#updateItem(id, (item, kind) => {
			const property = kind === 'page' ? 'buttonCondition' : 'condition';
			condition = this.#buildCondition(form, item[property], input);
			return { ...item, [property]: condition };
		});
		return { id, appliesTo, condition: this.#describeCondition(form, condition, true) };
	}

	async #addWorkflow(input) {
		const form = this.#form();
		const type = await this.#findWorkflowType(input.workflowType);
		if (!type.isConfigured) {
			throw new Error(`"${type.name}" isn't configured on this site: ${type.configurationErrors.join(' ')}`);
		}
		const stage = pick(input.stage ?? 'onSubmit', STAGES, 'workflow stage');
		const name = (input.name ?? type.name).trim();
		if (!name) throw new Error('A workflow needs a name.');
		const defaults = Object.fromEntries(type.settings.map((setting) => [setting.alias, setting.defaultValue ?? '']));
		const settings = this.#applySettings(type, defaults, input.settings);
		this.#checkMandatorySettings(type, settings);
		await this.#validateSettings(`form-workflow/${type.id}/validate-settings`, { name, settings });

		const workflows = this.#workflows(form);
		// The shape the workflow dialog creates (createWorkflowScaffold and mapWorkspaceModelToApiWorkflow in Forms)
		const workflow = {
			id: UmbId.new(),
			name,
			form: form.unique,
			active: input.active ?? true,
			includeSensitiveData: input.includeSensitiveData ? 'True' : 'False',
			isDeleted: false,
			sortOrder: workflows[stage].length,
			workflowTypeId: type.id,
			workflowTypeName: type.name,
			workflowTypeIcon: type.icon,
			workflowTypeDescription: type.description,
			workflowTypeGroup: type.group,
			settings,
			isMandatory: false,
			condition: null,
		};
		this.#setWorkflows({ ...workflows, [stage]: [...workflows[stage], workflow] });
		return { stage, ...this.#describeWorkflow(form, workflow), note: this.#stageNote(form, stage) };
	}

	async #setWorkflow(input) {
		const form = this.#form();
		const { workflow, stage: from } = this.#findWorkflow(form, input.workflow);
		const to = input.stage ? pick(input.stage, STAGES, 'workflow stage') : from;
		const updated = { ...workflow };
		if (input.name !== undefined) {
			updated.name = input.name.trim();
			if (!updated.name) throw new Error('A workflow needs a name.');
		}
		if (input.active !== undefined) updated.active = input.active;
		if (input.includeSensitiveData !== undefined) updated.includeSensitiveData = input.includeSensitiveData ? 'True' : 'False';
		if (input.settings && workflow.isDeleted) {
			throw new Error(`The type of "${workflow.name}" no longer exists, so its settings can't change.`);
		}
		if (input.settings || (input.name !== undefined && !workflow.isDeleted)) {
			const type = await this.#findWorkflowType(workflow.workflowTypeId);
			updated.settings = this.#applySettings(type, workflow.settings, input.settings);
			this.#checkMandatorySettings(type, updated.settings);
			await this.#validateSettings(`form-workflow/${type.id}/validate-settings`, {
				name: updated.name,
				settings: updated.settings,
			});
		}

		const workflows = this.#workflows(form);
		const reindex = (list) => list.map((x, i) => (x.sortOrder === i ? x : { ...x, sortOrder: i }));
		const next =
			from === to
				? { ...workflows, [to]: workflows[to].map((x) => (x.id === workflow.id ? updated : x)) }
				: {
						...workflows,
						[from]: reindex(workflows[from].filter((x) => x.id !== workflow.id)),
						[to]: reindex([...workflows[to], updated]),
					};
		this.#setWorkflows(next);
		return { stage: to, ...this.#describeWorkflow(form, updated), note: this.#stageNote(form, to) };
	}

	#removeWorkflow({ workflow: ref }) {
		const form = this.#form();
		const { workflow, stage } = this.#findWorkflow(form, ref);
		if (workflow.isMandatory) throw new Error(`"${workflow.name}" is mandatory on every form, so it can't be removed.`);
		const workflows = this.#workflows(form);
		const remaining = workflows[stage]
			.filter((x) => x.id !== workflow.id)
			.map((x, i) => (x.sortOrder === i ? x : { ...x, sortOrder: i }));
		this.#setWorkflows({ ...workflows, [stage]: remaining });
		return { removed: workflow.id, name: workflow.name, stage };
	}

	getTools() {
		return [
			{
				name: 'umbraco_forms_get_form_design',
				title: 'Get the form design',
				description:
					'Returns the open form: its name, and its pages, groups, containers and fields (id, caption, alias, field type, mandatory, options and any switched-on condition), including unsaved changes.',
				annotations: { readOnlyHint: true, untrustedContentHint: true },
				execute: async () => this.#describe(this.#form()),
			},
			{
				name: 'umbraco_forms_list_field_types',
				title: 'List form field types',
				description:
					'Lists the field types a question can have, such as Short answer, Long answer or Dropdown, with whether they take options and the aliases of their settings.',
				annotations: { readOnlyHint: true },
				execute: async () =>
					(await this.#getFieldTypes()).map((type) => ({
						name: type.name,
						alias: type.alias,
						supportsOptions: type.supportsPrevalues,
						settings: visibleSettings(type).map((setting) => setting.alias),
					})),
			},
			{
				name: 'umbraco_forms_set_form_name',
				title: 'Set the form name',
				description: 'Sets the name of the open form. Does not save: save with umbraco_run_workspace_action.',
				inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
				execute: async ({ name }) => {
					this.#workspace.setName(name);
					return { name };
				},
			},
			{
				name: 'umbraco_forms_set_caption',
				title: 'Set a page or group caption',
				description: 'Sets the caption of a page or a group of the open form, by its id. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						id: { type: 'string', description: 'A page or group id, from umbraco_forms_get_form_design.' },
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
					if (!found) throw new Error(`No page or group "${id}". Use umbraco_forms_get_form_design.`);
					this.#setPages(pages);
					return { id, caption };
				},
			},
			{
				name: 'umbraco_forms_add_page',
				title: 'Add a form page',
				description:
					'Adds a page to the end of the open form, with one group and any questions you pass. Returns the ids of the page, its group and the group container to add questions to. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						caption: { type: 'string', description: 'The page caption. Optional.' },
						groupCaption: { type: 'string', description: "The caption of the page's first group. Optional." },
						fields: { ...FIELDS_SCHEMA, description: 'Questions to add to the group, as for umbraco_forms_add_fields. Optional.' },
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
				name: 'umbraco_forms_add_group',
				title: 'Add a form group',
				description:
					'Adds a group to a page of the open form (the last page if pageId is omitted). Returns the ids of the group and its container. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						pageId: { type: 'string', description: 'From umbraco_forms_get_form_design or umbraco_forms_add_page.' },
						caption: { type: 'string', description: 'The group caption. Optional.' },
					},
				},
				execute: async ({ pageId, caption = '' }) => {
					const form = this.#form();
					const target = pageId ? form.pages.find((page) => page.id === pageId) : form.pages.at(-1);
					if (!target) throw new Error(`No page "${pageId}". Use umbraco_forms_get_form_design.`);
					const fieldset = group(target.id, caption, target.fieldSets.length);
					this.#setPages(
						form.pages.map((page) => (page === target ? { ...page, fieldSets: [...page.fieldSets, fieldset] } : page)),
					);
					return { groupId: fieldset.id, containerId: fieldset.containers[0].id };
				},
			},
			{
				name: 'umbraco_forms_add_field',
				title: 'Add a question to the form',
				description:
					'Adds a question (field) to the open form, in the given container or else the last one. The alias is made from the caption unless given. Pass options for field types that take them, such as Dropdown, and settings by alias from umbraco_forms_list_field_types. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						...FIELD_PROPERTIES,
						containerId: { type: 'string', description: 'From umbraco_forms_get_form_design, umbraco_forms_add_page or umbraco_forms_add_group.' },
					},
					required: ['fieldType', 'caption'],
				},
				execute: (input) => this.#addField(input),
			},
			{
				name: 'umbraco_forms_add_fields',
				title: 'Add questions to the form',
				description:
					'Adds several questions to the open form in one call, in order, in the given container or else the last one. Each takes the same input as umbraco_forms_add_field. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						fields: FIELDS_SCHEMA,
						containerId: { type: 'string', description: 'From umbraco_forms_get_form_design, umbraco_forms_add_page or umbraco_forms_add_group.' },
					},
					required: ['fields'],
				},
				execute: async ({ fields, containerId }) => ({ fields: await this.#addFields(fields, containerId) }),
			},
			{
				name: 'umbraco_forms_get_field_settings',
				title: 'Get question settings',
				description:
					"Returns a question's settings on the open form (caption, alias, mandatory, messages, regex, options, condition and field type settings), with the settings its field type offers and whether it takes mandatory, regex and options.",
				annotations: { readOnlyHint: true, untrustedContentHint: true },
				inputSchema: {
					type: 'object',
					properties: { field: { type: 'string', description: 'The question id, alias or caption.' } },
					required: ['field'],
				},
				execute: async ({ field }) => {
					const form = this.#form();
					return this.#describeField(form, this.#findField(form, field));
				},
			},
			{
				name: 'umbraco_forms_set_field_settings',
				title: 'Change question settings',
				description:
					"Changes a question's settings on the open form, such as mandatory, its messages, regex, options or field type settings like Placeholder, after Forms validates them; omitted ones stay as they are. Does not save.",
				inputSchema: {
					type: 'object',
					properties: {
						field: { type: 'string', description: 'The question id, alias or caption.' },
						caption: { type: 'string' },
						alias: { type: 'string' },
						tooltip: { type: 'string', description: 'Help text shown with the question.' },
						mandatory: { type: 'boolean' },
						requiredErrorMessage: { type: 'string', description: 'Shown when a mandatory question is left empty.' },
						regex: { type: 'string', description: 'A pattern the answer must match; empty for none.' },
						invalidErrorMessage: { type: 'string', description: "Shown when the answer doesn't match the regex." },
						options: { type: 'array', items: { type: 'string' }, description: 'Replaces the options, for field types that take them.' },
						settings: { ...SETTINGS_SCHEMA, description: `${SETTINGS_SCHEMA.description} Aliases from umbraco_forms_get_field_settings.` },
					},
					required: ['field'],
				},
				annotations: { untrustedContentHint: true },
				execute: (input) => this.#setFieldSettings(input),
			},
			{
				name: 'umbraco_forms_set_condition',
				title: 'Set a show or hide condition',
				description:
					"Sets the condition that shows or hides a question, group or workflow on the open form, or on a page the page's buttons, when all or any of its rules match another question's answer. Does not save.",
				inputSchema: {
					type: 'object',
					properties: {
						id: {
							type: 'string',
							description:
								'A page, group or workflow id, or a question id, alias or caption, from umbraco_forms_get_form_design or umbraco_forms_list_workflows.',
						},
						...CONDITION_PROPERTIES,
					},
					required: ['id'],
				},
				execute: async (input) => this.#setCondition(input),
			},
			{
				name: 'umbraco_forms_list_workflow_types',
				title: 'List form workflow types',
				description:
					'Lists the workflow types a form can run, such as Send email, with their settings (alias, name, options, default and whether mandatory) and whether they are configured on this site.',
				annotations: { readOnlyHint: true },
				execute: async () =>
					(await this.#getWorkflowTypes()).map((type) => ({
						name: type.name,
						alias: type.alias,
						description: type.description,
						group: type.group || undefined,
						configured: type.isConfigured,
						configurationErrors: type.configurationErrors?.length ? type.configurationErrors : undefined,
						settings: visibleSettings(type).map(describeSetting),
					})),
			},
			{
				name: 'umbraco_forms_list_workflows',
				title: 'List the form workflows',
				description:
					"Lists the open form's workflows by stage (onSubmit, onApprove, onReject), with each one's id, name, type, active flag, settings and condition, including unsaved changes.",
				annotations: { readOnlyHint: true, untrustedContentHint: true },
				execute: async () => {
					const form = this.#form();
					const workflows = this.#workflows(form);
					return {
						manualApproval: form.manualApproval,
						...Object.fromEntries(
							STAGES.map((stage) => [stage, workflows[stage].map((x) => this.#describeWorkflow(form, x))]),
						),
					};
				},
			},
			{
				name: 'umbraco_forms_add_workflow',
				title: 'Add a workflow to the form',
				description:
					'Adds a workflow of the given type to a stage of the open form, with its settings, after Forms validates them. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						workflowType: { type: 'string', description: 'A workflow type name or alias, from umbraco_forms_list_workflow_types.' },
						stage: { ...STAGE_SCHEMA, description: `${STAGE_SCHEMA.description} Defaults to onSubmit.` },
						name: { type: 'string', description: 'Defaults to the workflow type name.' },
						active: { type: 'boolean', description: 'Defaults to true.' },
						includeSensitiveData: { type: 'boolean', description: 'Defaults to false.' },
						settings: { ...SETTINGS_SCHEMA, description: `${SETTINGS_SCHEMA.description} Mandatory ones must be given.` },
					},
					required: ['workflowType'],
				},
				annotations: { untrustedContentHint: true },
				execute: (input) => this.#addWorkflow(input),
			},
			{
				name: 'umbraco_forms_set_workflow',
				title: 'Change a form workflow',
				description:
					'Changes a workflow on the open form: its name, settings, stage, or whether it is active or includes sensitive data; omitted ones stay as they are. Does not save.',
				inputSchema: {
					type: 'object',
					properties: {
						workflow: { type: 'string', description: 'The workflow id or name, from umbraco_forms_list_workflows.' },
						name: { type: 'string' },
						active: { type: 'boolean', description: 'False keeps the workflow but stops it running.' },
						includeSensitiveData: { type: 'boolean' },
						stage: { ...STAGE_SCHEMA, description: `${STAGE_SCHEMA.description} Moves it to the end of that stage.` },
						settings: { ...SETTINGS_SCHEMA, description: `${SETTINGS_SCHEMA.description} Only the ones given change.` },
					},
					required: ['workflow'],
				},
				annotations: { untrustedContentHint: true },
				execute: (input) => this.#setWorkflow(input),
			},
			{
				name: 'umbraco_forms_remove_workflow',
				title: 'Remove a form workflow',
				description:
					'Removes a workflow from the open form, as its delete button does after the confirmation. Does not save, so saving the form deletes it.',
				inputSchema: {
					type: 'object',
					properties: { workflow: { type: 'string', description: 'The workflow id or name, from umbraco_forms_list_workflows.' } },
					required: ['workflow'],
				},
				execute: async (input) => this.#removeWorkflow(input),
			},
		];
	}
}

export { WebMcpFormsToolset as api };
