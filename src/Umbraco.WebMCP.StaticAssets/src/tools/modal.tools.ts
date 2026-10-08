import type { UmbWebMcpTool, UmbWebMcpToolCall } from '../model-context.ts';
import { startOutcome } from '../outcome.ts';
import { toPlain, waitUntil } from '../utils.ts';
import { findButton, findModalElement, getButtons } from './modal-buttons.ts';
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UMB_MODAL_MANAGER_CONTEXT, type UmbModalContext } from '@umbraco-cms/backoffice/modal';

const KEY_PROPERTY = { key: { type: 'string', description: 'From umbraco_list_modals.' } };

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

	isOpen(key: string) {
		return this.modals.some((x) => x.key === key);
	}
}

/**
 * Tools for the modals and sidebars that actions open, such as pickers, confirmations and Deploy's transfer dialogs.
 */
export function createModalTools(host: UmbControllerHost): Array<UmbWebMcpTool> {
	const watcher = new UmbWebMcpModalWatcher(host);

	/**
	 * After a modal has been clicked, submitted or closed: waits for it to close and for the notifications the work
	 * it started shows, such as "Form deleted", then reports them. A modal that stays open (a validation error, or a
	 * second step) is reported with closed false, and the agent carries on with umbraco_list_modals.
	 */
	async function reportAfter(key: string, outcome: ReturnType<typeof startOutcome>, signal?: AbortSignal) {
		const closed = await waitUntil(() => !watcher.isOpen(key), signal, 2000);
		return { closed, ...(await outcome.report({ settleMs: closed ? 300 : 0, signal })) };
	}

	return [
		{
			name: 'umbraco_list_modals',
			title: 'List open modals',
			description:
				'Lists the open modals and sidebars, topmost last, with the data they were opened with, their current value and their buttons (id, label and whether disabled).',
			annotations: { readOnlyHint: true, untrustedContentHint: true },
			async execute() {
				return watcher.modals.map((modal) => ({
					key: modal.key,
					alias: modal.alias.toString(),
					type: modal.type,
					data: toPlain(modal.data),
					value: toPlain(modal.getValue()),
					buttons: (() => {
						const element = findModalElement(modal.key);
						return element ? getButtons(element).map(({ id, label, disabled }) => ({ id, label, disabled })) : null;
					})(),
				}));
			},
		},
		{
			name: 'umbraco_set_modal_value',
			title: 'Set modal value',
			description:
				'Replaces the value of an open modal, for example the selection of a picker. The shape depends on the modal: read its current value with umbraco_list_modals first. The modal UI may not show the change.',
			annotations: { untrustedContentHint: true },
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
				'Clicks a button in an open modal, such as Delete, Submit or Choose, then reports whether the modal closed and the notifications it caused. Pass the button id where it has one, because labels change when the backoffice is translated; otherwise its label. Prefer this to umbraco_submit_modal, because many modals do their work in the button handler before submitting.',
			annotations: { consequentialHint: true },
			inputSchema: {
				type: 'object',
				properties: {
					...KEY_PROPERTY,
					id: { type: 'string', description: 'A button id from umbraco_list_modals. Preferred to label.' },
					label: { type: 'string', description: 'A button label from umbraco_list_modals, if it has no id.' },
				},
				required: ['key'],
			},
			async execute({ key, id, label }: { key: string; id?: string; label?: string }, call?: UmbWebMcpToolCall) {
				watcher.get(key);
				const element = findModalElement(key);
				if (!element) throw new Error(`The element for modal "${key}" is not rendered yet. Try again shortly.`);
				const button = findButton(getButtons(element), { id, label });
				const outcome = startOutcome();
				button.element.click();
				return reportAfter(key, outcome, call?.signal);
			},
		},
		{
			name: 'umbraco_submit_modal',
			title: 'Submit modal',
			description:
				'Submits an open modal with its current value, straight through its context. This skips any work the modal does in its own button handler, so use umbraco_click_modal_button when the modal has a confirm button.',
			annotations: { consequentialHint: true },
			inputSchema: { type: 'object', properties: KEY_PROPERTY, required: ['key'] },
			async execute({ key }: { key: string }, call?: UmbWebMcpToolCall) {
				const modal = watcher.get(key);
				const outcome = startOutcome();
				modal.submit();
				return reportAfter(key, outcome, call?.signal);
			},
		},
		{
			name: 'umbraco_close_modal',
			title: 'Close modal',
			description: 'Closes an open modal without submitting it, as its cancel or close button does.',
			inputSchema: { type: 'object', properties: KEY_PROPERTY, required: ['key'] },
			async execute({ key }: { key: string }, call?: UmbWebMcpToolCall) {
				const modal = watcher.get(key);
				const outcome = startOutcome();
				modal.reject();
				return reportAfter(key, outcome, call?.signal);
			},
		},
	];
}
