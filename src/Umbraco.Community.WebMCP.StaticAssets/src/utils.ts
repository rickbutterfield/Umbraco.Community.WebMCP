/**
 * Starts `work` and returns once it finishes or `waitMs` passes, whichever comes first. Actions often open a modal and
 * only resolve when it closes, so an agent must get control back to drive the modal with the modal tools.
 *
 * When `signal` aborts (the caller cancelled the tool call), it stops waiting and rejects with the signal's reason. The
 * work itself carries on, because an action that has started can't be called back; `signal` only ends the wait.
 */
export async function runWithoutBlocking(work: () => Promise<unknown>, waitMs = 1500, signal?: AbortSignal) {
	signal?.throwIfAborted();

	let error: unknown;
	let completed = false;
	const promise = work().then(
		() => (completed = true),
		(reason) => {
			completed = true;
			error = reason;
		},
	);

	let timer: ReturnType<typeof setTimeout> | undefined;
	let onAbort: (() => void) | undefined;
	try {
		await Promise.race([
			promise,
			new Promise((resolve) => (timer = setTimeout(resolve, waitMs))),
			new Promise((_resolve, reject) => {
				if (!signal) return;
				onAbort = () => reject(signal.reason);
				signal.addEventListener('abort', onAbort, { once: true });
			}),
		]);
	} finally {
		clearTimeout(timer);
		if (onAbort) signal?.removeEventListener('abort', onAbort);
	}

	if (error) throw error instanceof Error ? error : new Error(String(error));
	return { completed, promise };
}

/**
 * Resolves after `onChange` has stayed quiet for `quietMs`, so asynchronous extension conditions have time to settle.
 * Changes after it settles are ignored, and if `subscribe` returns a function, it is called to unsubscribe. When
 * `signal` aborts, it stops waiting and rejects with the signal's reason.
 */
export function waitForQuiet(
	subscribe: (onChange: () => void) => (() => void) | void,
	quietMs = 200,
	maxMs = 3000,
	signal?: AbortSignal,
) {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(signal.reason);
			return;
		}

		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const subscription: { unsubscribe?: (() => void) | void } = {};
		const settle = (outcome: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			clearTimeout(deadline);
			signal?.removeEventListener('abort', onAbort);
			subscription.unsubscribe?.();
			outcome();
		};
		const onAbort = () => settle(() => reject(signal!.reason));

		timer = setTimeout(() => settle(resolve), quietMs);
		const deadline = setTimeout(() => settle(resolve), maxMs);
		signal?.addEventListener('abort', onAbort, { once: true });
		subscription.unsubscribe = subscribe(() => {
			if (settled) return;
			clearTimeout(timer);
			timer = setTimeout(() => settle(resolve), quietMs);
		});
		// The subscription may have settled the wait already, before it could be unsubscribed
		if (settled) subscription.unsubscribe?.();
	});
}

/**
 * Whether a workspace has finished loading: nothing is loading and, for workspaces that hold data, the data is there.
 * Workspace contexts differ, so this only uses what they have.
 */
export function isWorkspaceReady(workspace: any) {
	if (workspace?.loading?.getIsOn?.()) return false;
	if (typeof workspace?.getData === 'function' && workspace.getData() === undefined) return false;
	return hasDataTypeDetails(workspace?.structure);
}

/**
 * Whether a content workspace's structure has loaded the data type of every property. It loads them after the content
 * type, separately from the entity, and tool conditions (such as whether a document has a Block List property) read
 * them. Structures without data types count as loaded.
 */
function hasDataTypeDetails(structure: any) {
	if (typeof structure?.getContentTypeDataTypeUniques !== 'function') return true;
	if (typeof structure.contentTypeDataTypeDetailOf !== 'function') return true;
	return (structure.getContentTypeDataTypeUniques() as Array<string>).every((unique) => {
		let loaded = false;
		// The backoffice's states give their current value on subscribe
		structure
			.contentTypeDataTypeDetailOf(unique)
			.subscribe((detail: unknown) => (loaded = detail !== undefined))
			.unsubscribe();
		return loaded;
	});
}

/**
 * Resolves with true once the workspace has finished loading, or with false after `maxMs` if it hasn't. Before then,
 * setting values on it can fail with "Data is missing". Rejects with the signal's reason when `signal` aborts.
 */
export function whenWorkspaceReady(workspace: unknown, signal?: AbortSignal, maxMs = 10_000, pollMs = 50) {
	return waitUntil(() => isWorkspaceReady(workspace), signal, maxMs, pollMs);
}

/**
 * Resolves with true once `condition` holds, checking every `pollMs`, or with false after `maxMs` if it doesn't.
 * Rejects with the signal's reason when `signal` aborts.
 */
export async function waitUntil(condition: () => boolean, signal?: AbortSignal, maxMs = 2000, pollMs = 50) {
	const deadline = Date.now() + maxMs;
	while (!condition()) {
		signal?.throwIfAborted();
		if (Date.now() >= deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, pollMs));
	}
	return true;
}

/**
 * Converts a value to something JSON can carry, dropping functions, elements and cycles and cutting deep nesting.
 */
export function toPlain(value: unknown, depth = 4, seen = new WeakSet<object>()): unknown {
	if (value === null || value === undefined) return value ?? null;
	if (typeof value === 'function' || typeof value === 'symbol') return undefined;
	if (typeof value !== 'object') return value;
	if (value instanceof Node) return `<${value.nodeName.toLowerCase()}>`;
	if (seen.has(value)) return '[circular]';
	if (depth <= 0) return '[…]';
	seen.add(value);
	if (Array.isArray(value)) return value.map((item) => toPlain(item, depth - 1, seen));
	const result: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		const plain = toPlain(entry, depth - 1, seen);
		if (plain !== undefined) result[key] = plain;
	}
	return result;
}

export function navigate(path: string) {
	history.pushState(null, '', path);
	return { navigatedTo: location.pathname };
}

export interface UmbNamedAction {
	alias: string;
	label: string;
}

/**
 * Finds the action an agent asked for, by alias or else by its label ignoring case and surrounding "...", so an agent
 * can run "Save" or "Trash" without listing the actions first. Throws with the available labels when nothing matches.
 */
export function findAction<T extends UmbNamedAction>(actions: Array<T>, wanted: string, where: string): T {
	const normalise = (text: string) => text.trim().replace(/(\.\.\.|…)$/, '').toLowerCase();
	const found =
		actions.find((action) => action.alias === wanted) ??
		actions.find((action) => normalise(action.label) === normalise(wanted));
	if (found) return found;
	const available = actions.map((action) => action.label).join(', ') || 'none';
	throw new Error(`"${wanted}" is not available ${where}. Available: ${available}.`);
}
