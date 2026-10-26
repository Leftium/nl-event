import { expect, it } from 'vitest';
import { discoverLinks, primarySignup } from '../src/lib/announcementLinks';

const form = 'https://docs.google.com/forms/d/e/SYNTHETIC_FORM/viewform';
const sheet = 'https://docs.google.com/spreadsheets/d/SYNTHETIC_SHEET/edit';

it('discovers every URL in source order with Korean role hints and exact offsets', () => {
	const source = `신청: ${form}\n확인: ${sheet}\n장소: https://map.naver.com/p/example`;
	const links = discoverLinks(source);
	expect(links.map((link) => link.kind)).toEqual(['Form', 'Sheet', 'Map']);
	expect(links.map((link) => link.roles)).toEqual([['Signup'], ['Confirmation'], ['Location']]);
	for (const link of links) expect(source.slice(link.start, link.end)).toBe(link.source);
	expect(primarySignup(links)).toBe(links[0].identity);
});

it('deduplicates normalized URLs and escaped ampersands without rewriting the source', () => {
	const first = 'https://EXAMPLE.com/info?a=1&amp;b=2';
	const links = discoverLinks(`(${first}),\nhttps://example.com/info?a=1&b=2.\n${form}`);
	expect(links).toHaveLength(2);
	expect(links[0].source).toBe(first);
	expect(links[0].href).toBe('https://EXAMPLE.com/info?a=1&b=2');
	expect(links[0].identity).toBe('https://example.com/info?a=1&b=2');
});

it('distinguishes known shorteners from Forms without resolving destinations', () => {
	const links = discoverLinks(
		'https://forms.gle/SYNTHETIC https://bit.ly/SYNTHETIC https://shorturl.at/SYNTHETIC https://url.kr/SYNTHETIC'
	);
	expect(links.map((link) => link.kind)).toEqual([
		'Form',
		'Short link',
		'Short link',
		'Short link'
	]);
	expect(links.map((link) => link.form)).toEqual([true, false, false, false]);
	expect(discoverLinks('https://bit.ly.evil.example/SYNTHETIC')[0].kind).toBe('Other');
});

it('recognizes Veneer document IDs without duplicating embedded links', () => {
	const links = discoverLinks(
		'https://veneer.leftium.com/f.SYNTHETIC/s.SYNTHETIC https://veneer.leftium.com/s.SHEET https://veneer.leftium.com/b.OPAQUE'
	);
	expect(links.map((link) => link.kind)).toEqual(['Veneer', 'Veneer', 'Veneer']);
	expect(links.map((link) => [link.form, link.sheet])).toEqual([
		[true, false],
		[false, true],
		[false, false]
	]);
	expect(primarySignup(links)).toBe(links[0].identity);
});

it('groups map services locally and retains unrelated URLs', () => {
	const links = discoverLinks(
		'https://naver.me/SYNTHETIC https://map.kakao.com/link/map/example https://kko.to/SYNTHETIC https://maps.app.goo.gl/SYNTHETIC https://www.google.com/maps/place/example https://example.com/info'
	);
	expect(links.map((link) => link.kind)).toEqual(['Map', 'Map', 'Map', 'Map', 'Map', 'Other']);
	expect(discoverLinks('No URLs here. Contact synthetic@example.com')).toEqual([]);
});

it('requires a choice for ambiguous Forms and preserves an explicit choice through reorder', () => {
	const links = discoverLinks(`${form}\nhttps://forms.gle/SECOND_SYNTHETIC`);
	expect(primarySignup(links)).toBeUndefined();
	expect(primarySignup([...links].reverse(), links[1].identity)).toBe(links[1].identity);
	expect(primarySignup(links, null)).toBeUndefined();
	expect(primarySignup(discoverLinks(sheet), links[1].identity)).toBeUndefined();
	expect(primarySignup(discoverLinks(''), links[1].identity)).toBeUndefined();
});

it('does not guess between a Form and an explicitly labelled opaque signup link', () => {
	const links = discoverLinks(`${form}\nRegister: https://url.kr/SYNTHETIC`);
	expect(primarySignup(links)).toBeUndefined();
	expect(primarySignup(links, links[1].identity)).toBe(links[1].identity);
	expect(links[1].form).toBe(false);
});

it('combines weak hints from duplicate occurrences without changing first-occurrence order', () => {
	const links = discoverLinks(`${form}\nRegistration: ${form}\n${sheet}`);
	expect(links).toHaveLength(2);
	expect(links[0].roles).toEqual(['Signup']);
	expect(primarySignup([...links].reverse())).toBe(links[0].identity);
});
