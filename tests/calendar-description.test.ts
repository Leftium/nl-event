import { describe, expect, it } from 'vitest';
import {
	addFormIntroduction,
	composeDescription,
	formIntroduction,
	leadingVeneerLink,
	readMetadata,
	sheetIdentity,
	signupSource,
	setSignupLink,
	veneerLink
} from '../src/lib/calendarDescription';
import * as Core from '../src/lib/core/EventCore.gen';

const form = 'https://docs.google.com/forms/d/e/SYNTHETIC_FORM/viewform';
const veneer = 'https://veneer.leftium.com/f.SYNTHETIC_FORM';
const metadata = (extra = {}) =>
	readMetadata({
		status: 'ok',
		type: 'form',
		documentId: 'f.SYNTHETIC_FORM',
		infoText: 'Intro\n\nVenue\nMain hall',
		autoSheets: [],
		autoSheetsStatus: 'complete',
		...extra
	});

describe('export description composition', () => {
	it('keeps source whitespace, Unicode and repeated prose in the agreed order', () => {
		const original = '  춤 🎵\r\nIntro\n\n ';
		expect(composeDescription(original, veneer)).toBe(`${veneer}\n\n---\n\n${original}`);
		expect(composeDescription(original)).toBe(original);
	});
	it('adds dividers only between present sections without trimming sources', () => {
		expect(composeDescription('')).toBe('');
		expect(composeDescription('', veneer)).toBe(veneer);
		expect(composeDescription(' ')).toBe(' ');
	});
	it('recomposes from the working Description without appending extra copies', () => {
		const first = composeDescription('Original', veneer);
		expect(composeDescription('Original', veneer)).toBe(first);
		expect(composeDescription('Original', veneer)).toBe(`${veneer}\n\n---\n\nOriginal`);
		expect(composeDescription('Edited', veneer)).toBe(`${veneer}\n\n---\n\nEdited`);
	});
	it('preserves valid Veneer URLs and only explicitly replaces a Sheet', () => {
		const existing = `${veneer}/s.EXISTING?tabs=info#form`;
		expect(veneerLink(signupSource(existing))).toBe(existing);
		expect(veneerLink(signupSource(existing), 's.OVERRIDE')).toBe(
			`${veneer}/s.OVERRIDE?tabs=info#form`
		);
		expect(veneerLink(signupSource(existing), '')).toBe(`${veneer}?tabs=info#form`);
		expect(veneerLink(signupSource(form))).toBe(veneer);
	});
	it('leaves Sheet discovery to Veneer until an explicit override is chosen', () => {
		expect(veneerLink(signupSource(form))).toBe(veneer);
		expect(veneerLink(signupSource(form), 's.EXPLICIT')).toBe(`${veneer}/s.EXPLICIT`);
	});
	it('imports Form title and introduction before a link-only input, or after an announcement', () => {
		const intro = formIntroduction(metadata({ title: 'Form title' }));
		expect(intro).toBe('Form title\n\nIntro\n\nVenue\nMain hall');
		expect(addFormIntroduction(form, intro)).toBe(`${intro}\n\n${form}`);
		expect(addFormIntroduction('Original\n ', intro)).toBe(`Original\n \n\n---\n\n${intro}`);
		expect(addFormIntroduction('', intro)).toBe(intro);
		expect(addFormIntroduction('Original', '')).toBe('Original');
		expect(addFormIntroduction(setSignupLink(form, veneer), intro)).toBe(
			`${veneer}\n\n---\n\n${intro}\n\n${form}`
		);
	});
	it('adds, replaces, and removes a leading signup link without changing the announcement', () => {
		const original = '  춤 🎵\r\n\nOriginal  ';
		const text = setSignupLink(original, veneer);
		expect(text).toBe(composeDescription(original, veneer));
		expect(leadingVeneerLink(text)?.id).toBe('f.SYNTHETIC_FORM');
		expect(setSignupLink(text, veneer)).toBe(text);
		expect(setSignupLink(text)).toBe(original);
		expect(setSignupLink(text, `${veneer}/s.SHEET`)).toBe(
			composeDescription(original, `${veneer}/s.SHEET`)
		);
		expect(setSignupLink(original)).toBe(original);
		expect(setSignupLink(veneer)).toBe('');
		expect(leadingVeneerLink('https://veneer.leftium.com.evil.example/f.FORM')).toBeUndefined();
	});
});

describe('supported identifier boundaries', () => {
	it.each([
		[form, 'f.SYNTHETIC_FORM'],
		[`${form}?entry.123=PRIVATE#section`, 'f.SYNTHETIC_FORM'],
		[`${veneer}/s.SHEET`, 'f.SYNTHETIC_FORM'],
		['https://forms.gle/TOKEN?prefill=PRIVATE', 'g.TOKEN'],
		['https://bit.ly/TOKEN', 'b.TOKEN'],
		['https://shorturl.at/TOKEN', 'h.TOKEN'],
		['https://url.kr/TOKEN', 'u.TOKEN'],
		['f.SYNTHETIC_FORM', 'f.SYNTHETIC_FORM']
	])('canonicalizes %s without leaking query data', (input, id) => {
		expect(signupSource(input)?.id).toBe(id);
	});
	it.each([
		'http://forms.gle/TOKEN',
		'https://user:pass@forms.gle/TOKEN',
		'https://forms.gle:444/TOKEN',
		'https://forms.gle.evil.example/TOKEN',
		'https://forms.gle/TOKEN/extra',
		'https://example.com/signup',
		'https://docs.google.com/forms/d/EDITOR_ONLY/edit',
		'https://veneer.leftium.com/s.SHEET',
		`${veneer}/f.OTHER`,
		's.SHEET',
		'f.BAD?query=1',
		'https://forms.gle/%2fTOKEN'
	])('keeps unsupported inputs local: %s', (input) => {
		expect(signupSource(input)).toBeUndefined();
	});
	it('accepts Sheet metadata identities without fetching Sheet content', () => {
		expect(sheetIdentity('https://docs.google.com/spreadsheets/d/SHEET/edit?usp=sharing')).toBe(
			's.SHEET'
		);
		expect(sheetIdentity('https://veneer.leftium.com/s.SHEET')).toBe('s.SHEET');
		expect(sheetIdentity('https://example.com/s.SHEET')).toBeUndefined();
	});
	it('accepts only plain-text intro fields and valid Sheet suggestions', () => {
		const result = metadata({
			infoText: '<script>plain text</script>',
			questions: ['PRIVATE'],
			html: '<b>PRIVATE</b>',
			autoSheets: [
				{ veneerId: 's.SHEET', title: 'Public title' },
				{ veneerId: 'https://evil.example', title: 'Bad' }
			]
		});
		expect(result.infoText).toBe('<script>plain text</script>');
		expect(result.autoSheets).toEqual([{ veneerId: 's.SHEET', title: 'Public title' }]);
		expect(result).not.toHaveProperty('questions');
		expect(result).not.toHaveProperty('html');
		expect(() => readMetadata({ status: 'ok', type: 'form' })).toThrow();
		expect(readMetadata({ status: 'unavailable' }).status).toBe('unavailable');
	});
});

it('changes only normalized description and uses exactly the same text for Google and ICS', () => {
	const original = 'Announcement\n  춤 🎵  ';
	const event: Core.normalized = {
		title: 'Synthetic event',
		description: original,
		location: 'Test hall',
		zone: 'Asia/Seoul',
		allDay: false,
		start: '20261101T100000Z',
		end: '20261101T110000Z'
	};
	const text = composeDescription(addFormIntroduction(original, 'Intro\nBring shoes.'), veneer);
	const enriched = { ...event, description: text };
	const google = new URL(Core.googleUrl(enriched));
	expect(google.searchParams.get('details')).toBe(text);
	const unfold = (value: string) => value.replace(/\r\n[ \t]/g, '');
	const ics = unfold(Core.ics(enriched, 'synthetic@nl-event', '20261026T000000Z'));
	const description = ics.match(/(?:^|\r\n)DESCRIPTION:(.*)/)?.[1];
	expect(description).toBe(
		text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
	);
	const baseGoogle = new URL(Core.googleUrl(event));
	google.searchParams.delete('details');
	baseGoogle.searchParams.delete('details');
	const normalizedGoogle = new URL(
		Core.googleUrl({ ...event, description: composeDescription(original) })
	);
	expect(normalizedGoogle.href).toBe(Core.googleUrl(event));
	expect(
		Core.ics({ ...event, description: composeDescription(original) }, 'same', '20261026T000000Z')
	).toBe(Core.ics(event, 'same', '20261026T000000Z'));
	expect(google.href).toBe(baseGoogle.href);
	expect(event.description).toBe(original);
});
