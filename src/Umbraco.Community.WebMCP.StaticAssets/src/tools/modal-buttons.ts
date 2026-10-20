export interface UmbWebMcpModalButton {
	element: HTMLElement;
	/** The button's `id`, which stays the same when the backoffice is translated. Null when the button has none. */
	id: string | null;
	label: string;
	disabled: boolean;
}

/**
 * Walks the light and shadow DOM below `root`, depth first, without entering elements `skip` matches.
 */
export function* walk(root: Node, skip?: (element: Element) => boolean): Generator<Element> {
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
export function findModalElement(key: string, root: Node = document.body) {
	for (const element of walk(root)) {
		if ((element as any).modalContext?.key === key) return element;
	}
	return undefined;
}

/**
 * The buttons a modal renders, without those of modals opened on top of it, or the actions of the menu and tree items
 * inside it, such as a picker's "..." and "Move..." on each row.
 */
export function getButtons(modalElement: Element): Array<UmbWebMcpModalButton> {
	const skip = (element: Element) =>
		element.localName === 'uui-menu-item' ||
		(element !== modalElement && (element as any).modalContext !== undefined);
	return [...walk(modalElement, skip)]
		.filter((element) => element.localName === 'uui-button')
		.map((element) => ({
			element: element as HTMLElement,
			id: element.id || null,
			label: ((element as any).label || element.textContent || '').trim(),
			disabled: Boolean((element as any).disabled),
		}))
		.filter((button) => button.label || button.id);
}

/**
 * Finds a button by `id` if one is given, otherwise by label, ignoring case. Throws an error that tells the agent what
 * to call instead.
 */
export function findButton(buttons: Array<UmbWebMcpModalButton>, { id, label }: { id?: string; label?: string }) {
	if (!id && !label) throw new Error('Pass the id or the label of a button from umbraco_list_modals.');
	const button = id
		? buttons.find((x) => x.id === id)
		: buttons.find((x) => x.label.toLowerCase() === label!.toLowerCase());
	const description = id ? `with id "${id}"` : `labelled "${label}"`;
	if (!button) throw new Error(`No button ${description}. Use umbraco_list_modals for the buttons.`);
	if (button.disabled) throw new Error(`The button ${description} is disabled.`);
	return button;
}
