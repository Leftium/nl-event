import {
	trackFormIntroduction,
	writeFormIntroduction,
	type FormIntroductionSection
} from './calendarDescription';

export type FormImportReview = {
	description: string;
	section?: FormIntroductionSection;
	confirmReplacement: boolean;
};

export function trackDescription(state: FormImportReview, description: string): FormImportReview {
	if (description === state.description) return state;
	return {
		description,
		section: trackFormIntroduction(state.description, description, state.section),
		confirmReplacement: false
	};
}

export function dismissReview(state: FormImportReview): FormImportReview {
	return state.confirmReplacement ? { ...state, confirmReplacement: false } : state;
}

export function reviewDetails(state: FormImportReview, description: string, intro: string) {
	const edited =
		!!state.section &&
		description.slice(state.section.start, state.section.end) !== state.section.text;
	return { edited, alreadyUsed: !!intro && state.section?.text === intro && !edited };
}

export function addFormDetails(
	state: FormImportReview,
	description: string,
	intro: string,
	selected: boolean,
	replaceEdited = false
): { state: FormImportReview; description?: string } {
	const { edited, alreadyUsed } = reviewDetails(state, description, intro);
	if (!selected || !intro || alreadyUsed) return { state };
	if (edited && !replaceEdited) return { state: { ...state, confirmReplacement: true } };
	const result = writeFormIntroduction(description, intro, state.section);
	return {
		state: { description: result.description, section: result.section, confirmReplacement: false },
		description: result.description
	};
}
