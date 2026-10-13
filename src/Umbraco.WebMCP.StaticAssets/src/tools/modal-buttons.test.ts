import { expect, fixture, html } from '@open-wc/testing';
import { findButton, findModalElement, getButtons } from './modal-buttons.js';

/**
 * Renders a modal element with a `modalContext`, as UmbModalBaseElement does, around the given buttons.
 */
async function renderModal(key: string, content: ReturnType<typeof html>) {
	const element = await fixture(html`<div>${content}</div>`);
	(element as any).modalContext = { key };
	return element;
}

describe('modal buttons', () => {
	it('lists buttons with their id and label', async () => {
		const modal = await renderModal(
			'a',
			html`<uui-button id="cancel">Cancel</uui-button><uui-button id="confirm">Delete</uui-button>`,
		);

		expect(getButtons(modal).map(({ id, label }) => ({ id, label }))).to.deep.equal([
			{ id: 'cancel', label: 'Cancel' },
			{ id: 'confirm', label: 'Delete' },
		]);
	});

	it('reports a missing id as null', async () => {
		const modal = await renderModal('a', html`<uui-button>Close</uui-button>`);

		expect(getButtons(modal)[0].id).to.equal(null);
	});

	it('leaves out the buttons of a modal opened on top', async () => {
		const modal = await renderModal(
			'a',
			html`<uui-button>Outer</uui-button>
				<div class="inner"></div>`,
		);
		const inner = modal.querySelector('.inner')!;
		(inner as any).modalContext = { key: 'b' };
		inner.innerHTML = '<uui-button>Inner</uui-button>';

		expect(getButtons(modal).map((x) => x.label)).to.deep.equal(['Outer']);
	});

	it('finds a modal element by its context key', async () => {
		const modal = await renderModal('find-me', html`<uui-button>OK</uui-button>`);

		expect(findModalElement('find-me')).to.equal(modal);
	});

	describe('finding a button', () => {
		const buttons = () => [
			{ element: document.createElement('uui-button'), id: 'confirm', label: 'Slet', disabled: false },
			{ element: document.createElement('uui-button'), id: 'cancel', label: 'Annuller', disabled: false },
			{ element: document.createElement('uui-button'), id: 'locked', label: 'Locked', disabled: true },
		];

		it('matches by id, whatever the translated label', () => {
			expect(findButton(buttons(), { id: 'confirm' }).label).to.equal('Slet');
		});

		it('matches by label, ignoring case', () => {
			expect(findButton(buttons(), { label: 'annuller' }).id).to.equal('cancel');
		});

		it('prefers the id when both are given', () => {
			expect(findButton(buttons(), { id: 'cancel', label: 'Slet' }).id).to.equal('cancel');
		});

		it('rejects a disabled button', () => {
			expect(() => findButton(buttons(), { id: 'locked' })).to.throw(/disabled/);
		});

		it('rejects an unknown button', () => {
			expect(() => findButton(buttons(), { id: 'nope' })).to.throw(/umbraco_list_modals/);
		});

		it('needs an id or a label', () => {
			expect(() => findButton(buttons(), {})).to.throw(/id or the label/);
		});
	});
});
