import { umbWebMcpNotificationLog } from './outcome.ts';
import { UmbControllerBase } from '@umbraco-cms/backoffice/class-api';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification';

/**
 * Feeds the notifications the backoffice shows into the notification log, so tools can report them.
 */
export class UmbWebMcpNotificationWatcher extends UmbControllerBase {
	constructor(host: UmbControllerHost) {
		super(host);
		this.consumeContext(UMB_NOTIFICATION_CONTEXT, (context) => {
			if (!context) return;
			this.observe(
				context.notifications,
				(handlers) => umbWebMcpNotificationLog.record(handlers),
				'_observeNotifications',
			);
		});
	}
}
