import { waitForQuiet } from './utils.ts';

export interface UmbWebMcpNotification {
	color: string | null;
	headline: string | null;
	message: string | null;
}

interface UmbNotificationHandlerLike {
	key: string;
	color?: string;
}

/**
 * Remembers the notifications the backoffice has shown, so a tool can report the ones its action caused, such as
 * "Document saved" or a validation error, without the agent taking a screenshot.
 */
export class UmbWebMcpNotificationLog {
	#entries: Array<{ index: number; notification: UmbWebMcpNotification }> = [];
	#seen = new Set<string>();
	#count = 0;
	#listeners = new Set<() => void>();

	constructor(private readonly maxEntries = 50) {}

	/**
	 * Records the handlers in the notification context's list that it hasn't seen before.
	 */
	record(handlers: ReadonlyArray<UmbNotificationHandlerLike>) {
		let added = false;
		for (const handler of handlers) {
			if (this.#seen.has(handler.key)) continue;
			this.#seen.add(handler.key);
			// The handler keeps its data private; the toast element gets the same object once rendered
			const data = (handler as any)._data ?? (handler as any).element?.data ?? {};
			this.#entries.push({
				index: ++this.#count,
				notification: {
					color: handler.color ?? null,
					headline: data.headline ?? null,
					message: data.message ?? null,
				},
			});
			added = true;
		}
		if (this.#entries.length > this.maxEntries) this.#entries.splice(0, this.#entries.length - this.maxEntries);
		if (added) for (const listener of [...this.#listeners]) listener();
	}

	/** A point to report notifications from. */
	mark() {
		return this.#count;
	}

	/** The notifications shown after `mark`. */
	since(mark: number) {
		return this.#entries.filter((entry) => entry.index > mark).map((entry) => entry.notification);
	}

	onChange(listener: () => void) {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}
}

export const umbWebMcpNotificationLog = new UmbWebMcpNotificationLog();

/**
 * Takes a snapshot to report an action's outcome against: the notifications shown and the path, from now.
 */
export function startOutcome(log = umbWebMcpNotificationLog) {
	const mark = log.mark();
	const path = location.pathname;

	return {
		/**
		 * What has happened since the snapshot. With `settleMs`, first waits until no new notification has appeared for
		 * that long (at most `maxMs`), because some actions show theirs after the call that started them returns.
		 */
		async report({
			settleMs = 0,
			maxMs = 1500,
			signal,
		}: { settleMs?: number; maxMs?: number; signal?: AbortSignal } = {}) {
			if (settleMs > 0) await waitForQuiet((onChange) => log.onChange(onChange), settleMs, maxMs, signal);
			return {
				notifications: log.since(mark),
				...(location.pathname !== path ? { navigatedTo: location.pathname } : {}),
			};
		},
	};
}
