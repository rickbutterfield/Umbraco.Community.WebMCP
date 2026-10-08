import type { ApiHelpers } from '@umbraco-cms/acceptance-test-helpers';

// A few Umbraco Forms management API calls, to arrange and verify the Forms agent cases. Written against Forms 18.2.1.

const BASE = '/umbraco/forms/management/api/v1/';

export const BENCH_FORM = 'Bench form';
export const BENCH_FOLDER = 'Bench folder';
/** A fixed id, so clean-up can find the folder without a folder search. */
export const BENCH_FOLDER_ID = '5f0c3a4e-8d1b-4c6e-9a2f-b3e7d4c1a0f9';

export class FormsApi {
	constructor(private readonly api: ApiHelpers) {}

	#url(path: string) {
		return this.api.baseUrl + BASE + path;
	}

	async #json(path: string) {
		const response = await this.api.get(this.#url(path));
		if (!response.ok()) throw new Error(`GET ${path} returned ${response.status()}`);
		return response.json();
	}

	/** Creates a form from the blank scaffold, which has one page with a data consent question. */
	async createForm(name: string) {
		const scaffold = await this.#json('form/scaffold');
		const response = await this.api.post(this.#url('form'), { ...scaffold, name });
		if (response.status() !== 201) throw new Error(`Creating form "${name}" returned ${response.status()}`);
		return (response.headers()['location'] ?? '').split('/').pop()!;
	}

	async createFolder(id: string, name: string) {
		const response = await this.api.post(this.#url('folder'), { id, name, parentId: null });
		if (response.status() !== 201) throw new Error(`Creating folder "${name}" returned ${response.status()}`);
	}

	/** The full design of the live form with this name, or null. */
	async getFormByName(name: string) {
		const forms: Array<{ id: string; name: string }> = await this.#json('form');
		const summary = forms.find((form) => form.name === name);
		return summary ? this.#json(`form/${summary.id}`) : null;
	}

	/** Every question on a form, with its caption, type, mandatory flag and options. */
	static fields(form: any): Array<any> {
		return form.pages.flatMap((page: any) =>
			page.fieldSets.flatMap((fieldset: any) => fieldset.containers.flatMap((container: any) => container.fields)),
		);
	}

	/**
	 * Removes every form with this name, live or in the recycle bin, and the bench folder. Deleting a form only moves it
	 * to the recycle bin, so each one is then deleted permanently from there.
	 */
	async cleanUp(name: string) {
		const forms: Array<{ id: string; name: string }> = await this.#json('form');
		for (const form of forms.filter((x) => x.name === name)) await this.api.delete(this.#url(`form/${form.id}`));
		const bin = await this.#json('tree/recycle-bin/root');
		for (const item of (bin.items ?? bin) as Array<{ id: string; name: string; isFolder: boolean }>) {
			if (!item.isFolder && item.name === name) await this.api.delete(this.#url(`form/${item.id}/permanent`));
		}
		await this.api.delete(this.#url(`folder/${BENCH_FOLDER_ID}`));
		await this.api.delete(this.#url(`folder/${BENCH_FOLDER_ID}/permanent`));
	}
}
