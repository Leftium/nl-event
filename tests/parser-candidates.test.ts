import { expect, it } from 'vitest';
import fs from 'node:fs';
import * as Core from '../src/lib/core/EventCore.gen';
import { consolidate, type candidate } from '../src/lib/core/ParserCandidates.gen';

const make = (id: string, overrides: Partial<candidate> = {}): candidate => ({
	id,
	field: 'start',
	value: '2026-11-01 14:00',
	date: '2026-11-01',
	time: '14:00',
	completeness: 'complete',
	spans: [],
	inferred: [],
	rank: 100,
	groups: [],
	label: id,
	...overrides
});

it('orders by descending rank, then lexical value, preserving ties and the input', () => {
	const input = [
		make('z', { value: 'z' }),
		make('tie-first', { value: 'a', field: 'end' }),
		make('highest', { value: 'z', field: 'location', rank: 101 }),
		make('tie-second', { value: 'a', completeness: 'date' }),
		make('lowest', { value: 'a', rank: 99 })
	];
	const before = structuredClone(input);
	expect(consolidate(input).map((c) => c.id)).toEqual([
		'highest',
		'tie-first',
		'tie-second',
		'z',
		'lowest'
	]);
	expect(input).toEqual(before);
	expect(consolidate([])).toEqual([]);
});

it('merges only field, value and completeness, retaining the first ranked metadata', () => {
	const winner = make('winner', { rank: 200, label: 'retained label' });
	const otherField = make('end', { field: 'end' });
	const otherCompleteness = make('date', { completeness: 'date' });
	const otherValue = make('other', { value: '2026-11-02 14:00' });
	const output = consolidate([
		make('lower', { date: '', time: '', rank: 50 }),
		winner,
		make('equal', { rank: 200, label: 'discarded', date: 'other', time: 'other' }),
		otherField,
		otherCompleteness,
		otherValue
	]);
	expect(output).toHaveLength(4);
	expect(output[0]).toEqual({ ...winner, dateSpans: [], timeSpans: [], textSpans: [] });
	expect(output.slice(1)).toEqual([otherField, otherCompleteness, otherValue]);
	// A candidate without duplicates keeps its object identity and absent optional fields.
	expect(output[1]).toBe(otherField);
	expect(output[1]).not.toHaveProperty('dateSpans');
});

it('concatenates repeated raw evidence and deduplicates layered spans only by reference', () => {
	const source = '🙂 한글\r\n오후 2시 ~ 4시';
	const start = source.indexOf('2시');
	const shared = { start, end: start + 2 };
	const equalCoordinates = { ...shared };
	const earlier = { start: 0, end: 2 };
	const overlapping = { start: start - 1, end: start + 1 };
	const first = make('first', {
		spans: [shared, shared],
		dateSpans: [shared, shared],
		timeSpans: [shared],
		textSpans: [shared],
		groups: ['lesson', 'lesson', 'overall'],
		inferred: ['inferred-year', 'inferred-year']
	});
	const second = make('second', {
		spans: [earlier, shared, equalCoordinates],
		dateSpans: [shared, equalCoordinates, earlier, overlapping],
		timeSpans: [shared, equalCoordinates, earlier, overlapping],
		textSpans: [shared, equalCoordinates, earlier, overlapping],
		groups: ['overall', 'social', 'lesson'],
		inferred: ['assumed-end', 'inferred-year', 'inferred-time']
	});
	const before = structuredClone([first, second]);
	const [merged] = consolidate([first, second]);
	expect(merged.spans).toEqual([shared, shared, earlier, shared, equalCoordinates]);
	for (const spans of [merged.dateSpans!, merged.timeSpans!, merged.textSpans!]) {
		expect(spans).toEqual([shared, equalCoordinates, earlier, overlapping]);
		expect(spans[0]).toBe(shared);
		expect(spans[1]).toBe(equalCoordinates);
		expect(spans.map((s) => source.slice(s.start, s.end))).toEqual(['2시', '2시', '🙂', ' 2']);
	}
	expect(merged.groups).toEqual(['lesson', 'overall', 'social']);
	expect(merged.inferred).toEqual(['inferred-year', 'assumed-end', 'inferred-time']);
	expect([first, second]).toEqual(before);
});

it('normalizes absent evidence only when merging, and preserves repeated candidate evidence', () => {
	const c = make('same', { spans: [{ start: 4, end: 8 }] });
	expect(consolidate([c])[0]).toBe(c);
	const [merged] = consolidate([c, c, c]);
	expect(merged.spans).toEqual([c.spans[0], c.spans[0], c.spans[0]]);
	expect(merged).toEqual({
		...c,
		spans: merged.spans,
		dateSpans: [],
		timeSpans: [],
		textSpans: []
	});
});

const extract = (source: string) =>
	Core.extract(
		Core.describe(
			Core.create({
				referenceInstant: '2026-10-24T03:00:00Z',
				browserTimeZone: 'Asia/Seoul'
			}),
			source
		)
	);

it('retains sourced and inferred End identities, warning order and lesson relationships', () => {
	const source = fs.readFileSync('tests/fixtures/nl-event/inputs/k2-milonga-excerpt.txt', 'utf8');
	const output = extract(source);
	const lesson = output.candidates.find(
		(c) => c.id === 'start:2026-10-18 18:00:free-lesson:2026-10-18'
	)!;
	const inferred = output.candidates.find(
		(c) => c.id === 'end:2026-10-18 19:00:free-lesson:2026-10-18'
	)!;
	const sourced = output.candidates.find(
		(c) => c.id === 'end:2026-10-18 22:30:overall:2026-10-18'
	)!;
	expect(inferred.groups).toEqual(lesson.groups);
	expect(inferred.spans).toEqual(lesson.spans);
	expect(inferred.timeSpans).toEqual([]);
	expect(inferred.inferred).toEqual(['inferred-year', 'assumed-end']);
	expect(sourced.inferred).toEqual(['inferred-year']);
	expect(sourced.timeSpans!.map((s) => source.slice(s.start, s.end))).toEqual(['10:30']);
	expect(output.warnings).toEqual([
		'inferred-year',
		'assumed-end',
		'past-event',
		'Inferred lesson end may overlap the social.'
	]);
});

it('keeps Korean series associations and original UTF-16 evidence after emoji and CRLF', () => {
	const source = fs
		.readFileSync('tests/inputs/bulleted-workshop-sanitized.txt', 'utf8')
		.replace('Blues Dance Workshop', '🙂 Blues Dance Workshop')
		.replaceAll('\n', '\r\n');
	const output = extract(source);
	const start = output.candidates.find(
		(c) => c.id === 'start:2026-11-01 14:00:overall:2026-11-01'
	)!;
	const end = output.candidates.find((c) => c.id === 'end:2026-11-01 16:00:overall:2026-11-01')!;
	expect(start.groups).toEqual(['overall:2026-11-01']);
	expect(end.groups).toEqual(start.groups);
	expect(start.inferred).toEqual([]);
	expect(end.inferred).toEqual([]);
	const span = (token: string) => ({
		start: source.indexOf(token),
		end: source.indexOf(token) + token.length
	});
	expect(start.spans).toEqual([span('2026년 11월 1일'), span('오후 2시 ')]);
	expect(end.spans).toEqual([...start.spans, span('4시')]);
	expect(start.dateSpans).toEqual([start.spans[0]]);
	expect(end.timeSpans).toEqual([span('4시')]);
	expect(output.contextDates).toContainEqual({
		value: '2026-12-06',
		spans: [span('12월 6일')],
		label: 'Final weekly occurrence'
	});
});
