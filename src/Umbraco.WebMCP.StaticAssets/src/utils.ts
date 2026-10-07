/**
 * Starts `work` and returns once it finishes or `waitMs` passes, whichever comes first. Actions often open a modal and
 * only resolve when it closes, so an agent must get control back to drive the modal with the modal tools.
 */
export async function runWithoutBlocking(work: () => Promise<unknown>, waitMs = 1500) {
	let error: unknown;
	let completed = false;
	const promise = work().then(
		() => (completed = true),
		(reason) => {
			completed = true;
			error = reason;
		},
	);
	await Promise.race([promise, new Promise((resolve) => setTimeout(resolve, waitMs))]);
	if (error) throw error instanceof Error ? error : new Error(String(error));
	return { completed, promise };
}

/**
 * Resolves after `onChange` has stayed quiet for `quietMs`, so asynchronous extension conditions have time to settle.
 */
export function waitForQuiet(subscribe: (onChange: () => void) => void, quietMs = 200, maxMs = 3000) {
	return new Promise<void>((resolve) => {
		let timer = setTimeout(resolve, quietMs);
		const deadline = setTimeout(() => {
			clearTimeout(timer);
			resolve();
		}, maxMs);
		subscribe(() => {
			clearTimeout(timer);
			timer = setTimeout(() => {
				clearTimeout(deadline);
				resolve();
			}, quietMs);
		});
	});
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
