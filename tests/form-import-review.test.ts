import { describe, expect, it } from 'vitest';
import {
	addFormDetails,
	dismissReview,
	reviewDetails,
	trackDescription,
	type FormImportReview
} from '../src/lib/formImportReview';

const initial = (): FormImportReview => ({ description: '', confirmReplacement: false });

function editedReview() {
	const first = addFormDetails(initial(), 'Announcement', 'Original details', true);
	const description = first.description!.replace('Original details', 'My edits');
	const edited = trackDescription(first.state, description);
	return { description, state: addFormDetails(edited, description, 'New details', true).state };
}

describe('Form import review transitions', () => {
	it('preserves review for unchanged Description, and clears it for an actual edit', () => {
		const { state, description } = editedReview();
		expect(state.confirmReplacement).toBe(true);
		expect(trackDescription(state, description)).toBe(state);
		const changed = trackDescription(state, `Prefix ${description}`);
		expect(changed.confirmReplacement).toBe(false);
		expect(reviewDetails(changed, changed.description, 'New details').edited).toBe(true);
	});

	it('keeps edits or replaces the tracked section and follows the resulting description', () => {
		const { state, description } = editedReview();
		const kept = dismissReview(state);
		expect(kept.confirmReplacement).toBe(false);
		expect(kept.section).toEqual(state.section);
		const requested = addFormDetails(kept, description, 'New details', true);
		expect(requested.state.confirmReplacement).toBe(true);
		const replaced = addFormDetails(requested.state, description, 'New details', true, true);
		expect(replaced.description).toBe('Announcement\n\n---\n\nNew details');
		expect(reviewDetails(replaced.state, replaced.description!, 'New details').alreadyUsed).toBe(
			true
		);
		expect(trackDescription(replaced.state, replaced.description!)).toBe(replaced.state);
	});

	it('invalidates review on dismissal, selection or refresh and drops stale tracking for a new draft', () => {
		const { state } = editedReview();
		for (const boundary of ['dismiss', 'selection', 'refresh']) {
			expect(dismissReview(state).confirmReplacement, boundary).toBe(false);
		}
		const reset = trackDescription(state, 'A completely different draft');
		expect(reset.section).toBeUndefined();
		expect(reset.confirmReplacement).toBe(false);
	});

	it('rejects replacement when Description changed before tracking ran', () => {
		const { state, description } = editedReview();
		const changed = `Prefix ${description}`;
		const result = addFormDetails(state, changed, 'New details', true, true);
		expect(result.description).toBeUndefined();
		expect(result.state.confirmReplacement).toBe(false);
		expect(result.state.description).toBe(changed);
	});

	it('does not request review without a selection, usable intro, or a change to already imported details', () => {
		const first = addFormDetails(initial(), 'Announcement', 'Details', true);
		for (const result of [
			addFormDetails(first.state, first.description!, 'Details', true),
			addFormDetails(first.state, first.description!, '', true),
			addFormDetails(first.state, first.description!, 'New', false)
		])
			expect(result).toEqual({ state: first.state });
	});
});
