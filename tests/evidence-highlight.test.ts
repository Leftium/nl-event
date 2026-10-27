import { expect, it } from 'vitest';
import { styledEvidenceSegments } from '../src/lib/evidenceHighlight';
import * as Core from '../src/lib/core/EventCore.gen';

const context = { referenceInstant: '2026-10-24T03:00:00Z', browserTimeZone: 'Asia/Seoul' };
const parse = (text: string) => {
	const draft = Core.describe(Core.create(context), text);
	return Core.completeParse(draft, Core.parseTicket(draft), Core.extract(draft), true);
};

it('renders plain text when evidence is absent during a development update', () => {
	expect(styledEvidenceSegments('Description', [])).toEqual([
		{ text: 'Description', kind: undefined, hovered: false }
	]);
});

it('splits UTF-16 offsets without losing emoji, CRLF, whitespace or duplicate instances', () => {
	const text = '🙂 same\r\n same  ';
	const segments = styledEvidenceSegments(text, [
		{ kind: 'selected', ranges: [{ start: 10, end: 14 }] }
	]);
	expect(segments).toEqual([
		{ text: '🙂 same\r\n ', kind: undefined, hovered: false },
		{ text: 'same', kind: 'selected', hovered: false },
		{ text: '  ', kind: undefined, hovered: false }
	]);
	expect(segments.map((s) => s.text).join('')).toBe(text);
});

it('merges nested and overlapping ranges, supports gaps and rejects invalid offsets', () => {
	expect(
		styledEvidenceSegments('0123456789', [
			{
				kind: 'selected',
				ranges: [
					{ start: 6, end: 8 },
					{ start: 1, end: 4 },
					{ start: 2, end: 3 },
					{ start: 3, end: 5 },
					{ start: -1, end: 1 },
					{ start: 5, end: 11 },
					{ start: 5, end: 5 },
					{ start: 0.5, end: 1 },
					{ start: NaN, end: 2 }
				]
			}
		])
	).toEqual([
		{ text: '0', kind: undefined, hovered: false },
		{ text: '1234', kind: 'selected', hovered: false },
		{ text: '5', kind: undefined, hovered: false },
		{ text: '67', kind: 'selected', hovered: false },
		{ text: '89', kind: undefined, hovered: false }
	]);
});

it('keeps duplicate date/clock evidence separate before merging candidates', () => {
	const text = '🙂 Party\r\n2026-10-25 16:00-18:00\r\n2026-10-25 16:00-18:00';
	const draft = parse(text);
	const fragments = (name: 'start' | 'end', part: Core.temporalPart, value: string) =>
		styledEvidenceSegments(text, [
			{
				kind: 'selected',
				ranges: Core.temporalOptions(draft, name, part).find((o) => o.value === value)!.evidence
			}
		])
			.filter((s) => s.kind === 'selected')
			.map((s) => s.text);
	expect(fragments('start', 'date', '2026-10-25')).toEqual(['2026-10-25', '2026-10-25']);
	expect(fragments('start', 'time', '16:00')).toEqual(['16:00', '16:00']);
	expect(fragments('end', 'time', '18:00')).toEqual(['18:00', '18:00']);
});

it('uses original Korean clock evidence and gives generated/inferred clocks no range', () => {
	const text = 'Party\n2026-10-25 오후 4시';
	const draft = parse(text);
	const option = Core.temporalOptions(draft, 'start', 'time').find((o) => o.value === '16:00')!;
	expect(option.evidence.map((s) => text.slice(s.start, s.end)).join('')).toContain('4시');
	expect(Core.temporalOptions(draft, 'end', 'time').every((o) => o.evidence.length === 0)).toBe(
		true
	);
	const generated = parse('A party without a schedule');
	for (const part of ['date', 'time'] as const) {
		expect(
			Core.temporalOptions(generated, 'start', part).every((o) => o.evidence.length === 0)
		).toBe(true);
	}
	const pending = Core.describe(draft, 'replacement');
	expect(Core.temporalOptions(pending, 'start', 'time')).toEqual([]);
});

it('keeps hover independent from selected and unselected evidence and preserves the source', () => {
	const text = '0123456789';
	const segments = styledEvidenceSegments(text, [
		{ kind: 'unselected', ranges: [{ start: 1, end: 9 }] },
		{ kind: 'selected', ranges: [{ start: 2, end: 7 }] },
		{
			kind: 'hovered',
			ranges: [
				{ start: 4, end: 5 },
				{ start: 8, end: 9 }
			]
		}
	]);
	expect(segments).toEqual([
		{ text: '0', kind: undefined, hovered: false },
		{ text: '1', kind: 'unselected', hovered: false },
		{ text: '23', kind: 'selected', hovered: false },
		{ text: '4', kind: 'selected', hovered: true },
		{ text: '56', kind: 'selected', hovered: false },
		{ text: '7', kind: 'unselected', hovered: false },
		{ text: '8', kind: 'unselected', hovered: true },
		{ text: '9', kind: undefined, hovered: false }
	]);
	expect(segments.map((s) => s.text).join('')).toBe(text);
});

it('handles shared boundaries, duplicate ranges, absent layers and invalid evidence', () => {
	expect(
		styledEvidenceSegments('abc', [
			{
				kind: 'selected',
				ranges: [
					{ start: 0, end: 1 },
					{ start: 0, end: 1 },
					{ start: 1, end: 2 }
				]
			},
			{
				kind: 'hovered',
				ranges: [
					{ start: -1, end: 3 },
					{ start: 1, end: 4 }
				]
			}
		])
	).toEqual([
		{ text: 'ab', kind: 'selected', hovered: false },
		{ text: 'c', kind: undefined, hovered: false }
	]);
	expect(styledEvidenceSegments('🙂\r\n ', [])).toEqual([
		{ text: '🙂\r\n ', kind: undefined, hovered: false }
	]);
});

it('gives labeled titles presentation evidence without changing their original spans', () => {
	const text = '🙂\r\nTitle: Dance Workshop\r\n2026-10-25 16:00';
	const draft = parse(text);
	const title = Core.alternatives(draft, 'title').find((c) => c.value === 'Dance Workshop')!;
	expect(title.spans.map((s) => text.slice(s.start, s.end))).toEqual(['Title: Dance Workshop']);
	expect(title.textSpans!.map((s) => text.slice(s.start, s.end))).toEqual(['Dance Workshop']);
});

it('tracks title fragments across removed dates and clocks, preserving duplicate and UTF-16 offsets', () => {
	const text = '🙂 Dance Workshop 2026-10-25 16:00\r\nTitle: 🙂 Dance Workshop';
	const draft = parse(text);
	const title = Core.alternatives(draft, 'title').find((c) => c.value === '🙂 Dance Workshop')!;
	const pieces = title.textSpans!.map((s) => text.slice(s.start, s.end));
	expect(pieces).toEqual(['🙂 Dance Workshop', '🙂 Dance Workshop']);
	expect(title.spans.map((s) => text.slice(s.start, s.end))).toContain(
		'🙂 Dance Workshop 2026-10-25 16:00'
	);
	for (const span of title.textSpans!) {
		expect(text.slice(span.start, span.end)).not.toMatch(/October|4pm|Title:/);
	}
});

it('retains discontinuous heading evidence when time appears inside the title', () => {
	const text = 'Dance 4pm Workshop\n2026-10-25';
	const draft = parse(text);
	const title = Core.alternatives(draft, 'title').find((c) => c.value === 'Dance Workshop')!;
	expect(title.textSpans!.map((s) => text.slice(s.start, s.end))).toEqual(['Dance ', 'Workshop']);
});
