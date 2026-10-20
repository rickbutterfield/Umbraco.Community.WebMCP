import { insertBlock, type UmbBlockLayoutEntry } from './block-layout.ts';
import {
	UmbBlockManagerContext,
	type UmbBlockDataModel,
	type UmbBlockDataObjectModel,
	type UmbBlockWorkspaceOriginData,
} from '@umbraco-cms/backoffice/block';
import type { UmbBlockTypeBaseModel } from '@umbraco-cms/backoffice/block-type';

/** Where to insert a block: at an index of the root, or of an area of a Block Grid block. */
export interface UmbWebMcpBlockOrigin extends UmbBlockWorkspaceOriginData {
	index: number;
	parentUnique: string | null;
	areaKey: string | null;
}

/**
 * The backoffice's block manager, for Block List and Block Grid alike, without the property editor that normally
 * hosts it. Creating a block goes through the manager's own code, so it gets the property value presets, the settings
 * data and the expose entries a block added in the editor gets. Inserting puts the layout entry where the origin says,
 * including into a Block Grid area, which Block List's manager can't do and Block Grid's isn't exported to do.
 */
export class UmbWebMcpBlockManager extends UmbBlockManagerContext<
	UmbBlockTypeBaseModel,
	UmbBlockLayoutEntry,
	UmbWebMcpBlockOrigin
> {
	async createWithPresets(
		contentElementTypeKey: string,
		partialLayoutEntry?: Omit<UmbBlockLayoutEntry, 'contentKey'>,
	): Promise<UmbBlockDataObjectModel<UmbBlockLayoutEntry> | undefined> {
		return this._createBlockData(contentElementTypeKey, partialLayoutEntry);
	}

	insert(
		layoutEntry: UmbBlockLayoutEntry,
		content: UmbBlockDataModel,
		settings: UmbBlockDataModel | undefined,
		originData: UmbWebMcpBlockOrigin,
	): boolean {
		this.setLayouts(
			insertBlock(this.getLayouts(), layoutEntry, {
				parentKey: originData.parentUnique,
				areaKey: originData.areaKey,
				index: originData.index,
			}),
		);
		// Adds the content and settings, and exposes the block in the current variant (and mandatory languages)
		this.insertBlockData(layoutEntry, content, settings, originData);
		return true;
	}
}
