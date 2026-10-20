import { hasBlockEditor } from './block-layout.ts';
import { UMB_CONTENT_WORKSPACE_CONTEXT } from '@umbraco-cms/backoffice/content';
import type { UmbControllerHost } from '@umbraco-cms/backoffice/controller-api';
import type { UmbConditionConfigBase, UmbConditionControllerArguments } from '@umbraco-cms/backoffice/extension-api';
import { UmbConditionBase } from '@umbraco-cms/backoffice/extension-registry';
import { mergeObservables } from '@umbraco-cms/backoffice/observable-api';

/**
 * Permits an extension while the open content workspace's type has a Block List or Block Grid property, its own or
 * from a composition. It reads the data types the workspace's structure has already loaded for its properties, and
 * follows them, so it changes when the workspace moves on to a document of another type.
 */
export class UmbWebMcpHasBlockPropertyCondition extends UmbConditionBase<UmbConditionConfigBase> {
	constructor(host: UmbControllerHost, args: UmbConditionControllerArguments<UmbConditionConfigBase>) {
		super(host, args);
		this.consumeContext(UMB_CONTENT_WORKSPACE_CONTEXT, (workspace) => {
			const structure = workspace?.structure;
			this.observe(
				structure?.contentTypeDataTypeUniques,
				(uniques) => {
					if (!structure || !uniques?.length) {
						this.removeUmbControllerByAlias('observeDataTypes');
						this.permitted = false;
						return;
					}
					this.observe(
						mergeObservables(
							uniques.map((unique) => structure.contentTypeDataTypeDetailOf(unique)),
							(details) => hasBlockEditor(details.map((detail) => detail?.editorAlias)),
						),
						(permitted) => (this.permitted = permitted),
						'observeDataTypes',
					);
				},
				'observeDataTypeUniques',
			);
		});
	}
}

export { UmbWebMcpHasBlockPropertyCondition as api };
