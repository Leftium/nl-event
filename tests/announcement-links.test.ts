import { expect, it } from 'vitest';
import { discoverLinks, groupEquivalentLinks, primarySignup } from '../src/lib/announcementLinks';

const form = 'https://docs.google.com/forms/d/e/SYNTHETIC_FORM/viewform';
const sheet = 'https://docs.google.com/spreadsheets/d/SYNTHETIC_SHEET/edit';

it.each([false, true])(
	'prefers an existing Veneer Sheet URL regardless of source order (%s)',
	(reverse) => {
		const veneer = 'https://veneer.leftium.com/f.SYNTHETIC_FORM/s.SHEET?tabs=info#form';
		const source = [form, 'https://veneer.leftium.com/f.SYNTHETIC_FORM/', veneer];
		const links = groupEquivalentLinks(
			discoverLinks((reverse ? source.reverse() : source).join('\n'))
		);
		expect(links).toHaveLength(1);
		expect(links[0].veneerUrl).toBe(veneer);
	}
);

it('groups known equivalent Form/Veneer signup URLs and retains each source without guessing redirects', () => {
	const source = `${form}\nhttps://veneer.leftium.com/f.SYNTHETIC_FORM\nhttps://forms.gle/OPAQUE`;
	const links = groupEquivalentLinks(discoverLinks(source));
	expect(links).toHaveLength(2);
	expect(links[0].href).toBe(form);
	expect(links[0].equivalents).toEqual([
		{
			href: 'https://veneer.leftium.com/f.SYNTHETIC_FORM',
			source: 'https://veneer.leftium.com/f.SYNTHETIC_FORM'
		}
	]);
	expect(links[1].href).toBe('https://forms.gle/OPAQUE');
});

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

it.each([
	[
		'Korean',
		`신청 링크:\nhttps://example.com/signup\n\n신청 확인:\n${sheet}`,
		[['Signup'], ['Signup', 'Confirmation']]
	],
	[
		'English',
		`Registration:\r\n  https://example.com/signup\r\n\r\nConfirmation:\r\n${sheet}`,
		[['Signup'], ['Confirmation']]
	]
])('uses immediately preceding labels for standalone URLs in %s', (_language, source, roles) => {
	const links = discoverLinks(source as string);
	expect(links.map((link) => link.roles)).toEqual(roles);
	expect(links[0].context).toContain('https://example.com/signup');
	for (const link of links)
		expect((source as string).slice(link.start, link.end)).toBe(link.source);
});

it('does not inherit labels across blanks, intervening prose, or another URL', () => {
	for (const source of [
		'Registration:\n\nhttps://example.com/info',
		'신청 링크:\nGeneral information\nhttps://example.com/info',
		'Registration: https://example.com/first\nhttps://example.com/second',
		'Registration:\nhttps://example.com/first https://example.com/second',
		'Registration:\nInfo: https://example.com/info'
	]) {
		expect(discoverLinks(source).at(-1)?.roles).toEqual([]);
	}
});
