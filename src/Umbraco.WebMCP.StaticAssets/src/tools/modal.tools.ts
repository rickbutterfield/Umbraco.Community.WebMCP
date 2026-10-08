import type { UmbWebMcpTool } from '../model-context.ts';
import { toPlain } from '../utils.ts';
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UMB_MODAL_MANAGER_CONTEXT, type UmbModalContext } from '@umbraco-cms/backoffice/modal';

const KEY_PROPERTY = { key: { type: 'string', description: 'From umbraco_list_modals.' } };

/**
 * Walks the light and shadow DOM below `root`, depth first, without entering nested modals.
 */
function* walk(root: Node, skip?: (element: Element) => boolean): Generator<Element> {
	const children = [...((root as Element).shadowRoot?.children ?? []), ...((root as Element).children ?? [])];
	for (const child of children) {
		if (skip?.(child)) continue;
		yield child;
		yield* walk(child, skip);
	}
}

/**
 * Finds the element a modal renders, which exposes its context as `modalContext` (UmbModalBaseElement).
 */
function findModalElement(key: string) {
	for (const element of walk(document.body)) {
		if ((element as any).modalContext?.key === key) return element;
	}
	return undefined;
}

function getButtons(modalElement: Element) {
	const isOtherModal = (element: Element) => element !== modalElement && (element as any).modalContext !== undefined;
	return [...walk(modalElement, isOtherModal)]
		.filter((element) => element.localName === 'uui-button')
		.map((element) => ({
			element: element as HTMLElement,
			label: ((element as any).label || element.textContent || '').trim(),
			disabled: Boolean((element as any).disabled),
		}))
		.filter((button) => button.label);
}

class UmbWebMcpModalWatcher extends UmbControllerBase {
	modals: ReadonlyArray<UmbModalContext> = [];

	constructor(host: UmbControllerHost) {
		super(host);
		this.consumeContext(UMB_MODAL_MANAGER_CONTEXT, (manager) => {
			if (!manager) return;
			this.observe(manager.modals, (modals) => (this.modals = modals), '_observeModals');
		});
	}

	get(key: string) {
		const modal = this.modals.find((x) => x.key === key);
		if (!modal) throw new Error(`No open modal has key "${key}". Use umbraco_list_modals.`);
		return modal;
	}
}

/**
 * Tools for the modals and sidebars that actions open, such as pickers, confirmations and Deploy's transfer dialogs.
 */
export function createModalTools(host: UmbControllerHost): Array<UmbWebMcpTool> {
	const watcher = new UmbWebMcpModalWatcher(host);

	return [
		{
			name: 'umbraco_list_modals',
			title: 'List open modals',
			description:
				'Lists the open modals and sidebars, topmost last, with the data they were opened with, their current value and the labels of their buttons.',
			annotations: { readOnlyHint: true },
			async execute() {
				return watcher.modals.map((modal) => ({
					key: modal.key,
					alias: modal.alias.toString(),
					type: modal.type,
					data: toPlain(modal.data),
					value: toPlain(modal.getValue()),
					buttons: (() => {
						const element = findModalElement(modal.key);
						return element ? getButtons(element).map(({ label, disabled }) => ({ label, disabled })) : null;
					})(),
				}));
			},
		},
		{
			name: 'umbraco_set_modal_value',
			title: 'Set modal value',
			description:
				'Replaces the value of an open modal, for example the selection of a picker. The shape depends on the modal: read its current value with umbraco_list_modals first. The modal UI may not show the change.',
			inputSchema: {
				type: 'object',
				properties: { ...KEY_PROPERTY, value: { description: 'The new value.' } },
				required: ['key', 'value'],
			},
			async execute({ key, value }: { key: string; value: unknown }) {
				const modal = watcher.get(key);
				modal.setValue(value);
				return { value: toPlain(modal.getValue()) };
			},
		},
		{
			name: 'umbraco_click_modal_button',
			title: 'Click modal button',
			description:
				'Clicks a button in an open modal by its label, such as Delete, Submit or Choose. Prefer this to umbraco_submit_modal, because many modals do their work in the button handler before submitting.',
			annotations: { consequentialHint: true },
			inputSchema: {
				type: 'object',
				properties: {
					...KEY_PROPERTY,
					label: { type: 'string', description: 'A button label from umbraco_list_modals.' },
				},
				required: ['key', 'label'],
			},
			async execute({ key, label }: { key: string; label: string }) {
				watcher.get(key);
				const element = findModalElement(key);
				if (!element) throw new Error(`The element for modal "${key}" is not rendered yet. Try again shortly.`);
				const button = getButtons(element).find((x) => x.label.toLowerCase() === label.toLowerCase());
				if (!button) throw new Error(`No button labelled "${label}". Use umbraco_list_modals for the labels.`);
				if (button.disabled) throw new Error(`The "${label}" button is disabled.`);
				button.element.click();
				return { ok: true };
			},
		},
		{
			name: 'umbraco_submit_modal',
			title: 'Submit modal',
			description:
				'Submits an open modal with its current value, straight through its context. This skips any work the modal does in its own button handler, so use umbraco_click_modal_button when the modal has a confirm button.',
			annotations: { consequentialHint: true },
			inputSchema: { type: 'object', properties: KEY_PROPERTY, required: ['key'] },
			async execute({ key }: { key: string }) {
				watcher.get(key).submit();
				return { ok: true };
			},
		},
		{
			name: 'umbraco_close_modal',
			title: 'Close modal',
			description: 'Closes an open modal without submitting it, as its cancel or close button does.',
			inputSchema: { type: 'object', properties: KEY_PROPERTY, required: ['key'] },
			async execute({ key }: { key: string }) {
				watcher.get(key).reject();
				return { ok: true };
			},
		},
	];
}
