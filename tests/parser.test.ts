import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as Core from '../src/lib/core/EventCore.gen';
import { discoverLinks } from '../src/lib/announcementLinks';
import { overnightExport } from '../src/lib/core/overnightExport';

const context = { referenceInstant: '2026-10-24T03:00:00Z', browserTimeZone: 'Asia/Seoul' };
const parse = (text: string, ctx = context, override?: string) => {
	const draft = Core.describe(Core.setZone(Core.create(ctx), override), text);
	return Core.completeParse(draft, Core.parseTicket(draft), Core.extract(draft), true);
};
const settle = (draft: Core.draft, apply = true) =>
	Core.completeParse(draft, Core.parseTicket(draft), Core.extract(draft), apply);
const values = (draft: Core.draft, field: Core.fieldName) =>
	Core.alternatives(draft, field).map((c) => c.value);

const spacedClockSource = fs.readFileSync(
	'tests/inputs/spaced-clock-overnight-sanitized.txt',
	'utf8'
);

it.each(['23:00', '23: 00', '23 :00', '23 : 00', '23\t:\t00', '23\u00a0:\u300000'])(
	'parses the sanitized overall overnight range with %s',
	(clock) => {
		const source = spacedClockSource.replace('23: 00', clock);
		const draft = parse(source);
		expect(draft.title.value).toBe('Example Blues Party');
		expect(draft.start.value).toBe('2026-12-19 23:00');
		expect(draft.end.value).toBe('2026-12-20 03:00');
		expect(Core.durationValue(draft)).toBe(240);
		expect(draft.description).toBe(source);
		const starts = Core.alternatives(draft, 'start');
		const ends = Core.alternatives(draft, 'end');
		const start = starts.find((c) => c.value === draft.start.value)!;
		const end = ends.find((c) => c.value === draft.end.value)!;
		expect(end.groups.some((g) => start.groups.includes(g))).toBe(true);
		expect(end.inferred).not.toContain('assumed-end');
		expect(end.dateSpans).toEqual(start.dateSpans);
		const endAt = source.indexOf('~ 3:00') + 2;
		expect(end.timeSpans).toEqual([{ start: endAt, end: endAt + '3:00'.length }]);
		for (const [first, last] of [
			['23:00', '01:00'],
			['01:00', '03:00']
		])
			expect(
				starts.some(
					(s) =>
						s.time === first &&
						ends.some((e) => e.time === last && e.groups.some((g) => s.groups.includes(g)))
				)
			).toBe(true);
		expect(starts.some((c) => c.date === '2026-12-18')).toBe(false);
		expect(starts.some((c) => c.date === '2027-03-20')).toBe(true);
		const at = source.indexOf(clock);
		expect(start.timeSpans).toEqual([{ start: at, end: at + clock.length + 1 }]);
		expect(source.slice(start.timeSpans![0].start, start.timeSpans![0].end)).toBe(`${clock} `);
		expect(Core.candidateInput(draft, start)).toContain(clock);
		expect(draft.start.input).toBe(Core.candidateInput(draft, start));
		const event = Core.validate(draft).event!;
		expect(event).toMatchObject({
			start: '20261219T140000Z',
			end: '20261219T180000Z',
			description: source,
			zone: 'Asia/Seoul'
		});
		for (const enabled of [true, false]) {
			const exported = overnightExport(event, !enabled).event!;
			const end = enabled ? '20261219T140000Z' : '20261219T180000Z';
			expect(new URL(Core.googleUrl(exported)).searchParams.get('dates')).toBe(
				`20261219T140000Z/${end}`
			);
			expect(
				Core.ics(exported, 'spaced-clock', '20261024T030000Z').replace(/\r\n /g, '')
			).toContain(`DTSTART:20261219T140000Z\r\n${enabled ? 'SUMMARY:' : `DTEND:${end}`}`);
			expect(exported.description.includes('Actual end:')).toBe(enabled);
		}
	}
);

it('retains UTF-16 evidence and manual ownership through spaced-clock edits and reset', () => {
	const source = spacedClockSource.replace('Party', 'Party 🎵').replaceAll('\n', '\r\n');
	let draft = parse(source);
	const candidate = Core.alternatives(draft, 'start').find((c) => c.value === draft.start.value)!;
	const at = source.indexOf('23: 00');
	const span = { start: at, end: at + '23: 00 '.length };
	const selected = Core.selectCandidate(draft, 'start', candidate.id);
	expect(
		selected.selections.some((s) =>
			s.candidate.timeSpans?.some((s) => s.start === span.start && s.end === span.end)
		)
	).toBe(true);
	expect(Core.candidateInput(selected, candidate)).toContain('23: 00');
	draft = Core.edit(draft, 'start', '2026-12-19 22:00');
	draft = settle(Core.describe(draft, source.replace('23: 00', '23 : 00')));
	expect(draft.start).toMatchObject({ value: '2026-12-19 22:00', ownership: 'manual' });
	draft = Core.reset(draft, 'start');
	draft = Core.reset(draft, 'end');
	expect(draft.start).toMatchObject({ value: '2026-12-19 23:00', ownership: 'auto' });
	expect(draft.start.input).toContain('23 : 00');
	expect(draft.end.value).toBe('2026-12-20 03:00');
	expect(Core.durationValue(draft)).toBe(240);
	const updated = Core.alternatives(draft, 'start').find((c) => c.value === draft.start.value)!;
	expect(updated.timeSpans).toEqual([{ start: at, end: at + '23 : 00 '.length }]);
});

it.each([
	'23: 000',
	'23 : 000',
	'123 : 00',
	'23 : 60',
	'25 : 00',
	'23:\n00',
	'23\n:00',
	'23:\v00',
	'23:\f00',
	'https://example.test/23:00',
	'https://example.test/23: 00',
	'Price: 23: 00',
	'입장료: 23: 00원',
	'Note: doors open later'
])('does not invent a clock from malformed or incidental evidence: %s', (token) => {
	const draft = parse(`Party\nDate: 2026-12-19\n${token}`);
	expect(
		draft.suggestions.candidates.filter((c) => c.time && !c.inferred.includes('inferred-time'))
	).toEqual([]);
});

it.each([
	['20 : 00 ~ 24 : 00', '2026-12-20 00:00'],
	['23 : 00 ~ 00 : 00', '2026-12-20 00:00'],
	['03 : 00 ~ 04 : 00', '2026-12-19 04:00'],
	['11 : 00pm ~ 3 : 00am', '2026-12-20 03:00'],
	['11 ~ 3 : 00pm', '2026-12-20 15:00'],
	['오후 11시 ~ 새벽 3시', '2026-12-20 03:00']
])('retains daypart and midnight semantics for %s', (range, end) => {
	expect(parse(`Date: 2026-12-19 ${range}`).end.value).toBe(end);
});

it.each(['24 : 00', '24 : 01', '24 : 00pm', '오후 24 : 00', '24 : 000'])(
	'keeps strict 24-hour start and endpoint validation with %s',
	(clock) => {
		expect(parse(`Date: 2026-12-19 ${clock}`).suggestions.candidates.filter((c) => c.time)).toEqual(
			[]
		);
		if (clock !== '24 : 00')
			expect(
				Core.alternatives(parse(`Date: 2026-12-19 20 : 00 ~ ${clock}`), 'end').some(
					(c) => !c.inferred.includes('assumed-end')
				)
			).toBe(false);
	}
);

it('keeps an unqualified spaced clock ambiguous without inventing a default time', () => {
	const draft = parse('Party\nDate: 2026-12-19\n3 : 00');
	expect(Core.alternatives(draft, 'start')).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				time: '03:00',
				inferred: expect.arrayContaining(['ambiguous-am-pm'])
			})
		])
	);
	expect(draft.suggestions.candidates.some((c) => c.inferred.includes('inferred-time'))).toBe(
		false
	);
	expect(Core.validate(draft).event).toBeUndefined();
});

it.each([
	'https://veneer.leftium.com/f.SYNTHETIC',
	'https://veneer.leftium.com/g.SYNTHETIC/s.SHEET?tabs=info#form',
	'https://veneer.leftium.com/b.OPAQUE'
])('skips an initial Veneer link and preserves title evidence offsets: %s', (url) => {
	const source = `${url}\r\n\r\n---\r\n\r\nEvening dance\r\nNovember 1, 2026 at 7pm\r\nLocation: Test Hall`;
	const draft = parse(source);
	expect(draft.title.value).toBe('Evening dance');
	expect(values(draft, 'title')).not.toContain(url);
	const title = Core.alternatives(draft, 'title').find(
		(candidate) => candidate.value === 'Evening dance'
	);
	expect(title?.textSpans?.map((span) => source.slice(span.start, span.end)).join('')).toBe(
		'Evening dance'
	);
	expect(draft.description).toBe(source);
});

it('does not invent a title for a Veneer-only description, or replace a manual title', () => {
	const url = 'https://veneer.leftium.com/f.SYNTHETIC';
	expect(parse(url).title.value).toBe('');
	const manual = Core.edit(parse('Original title'), 'title', 'My title');
	const updated = settle(Core.describe(manual, `${url}\n\nUpdated heading`));
	expect(updated.title.value).toBe('My title');
	expect(values(updated, 'title')).toContain('Updated heading');
});

// The only expectation data passed to the parser is injected reference context.
// Assertions and oracle metadata are read exclusively by the test driver.
for (const file of fs.readdirSync('tests/fixtures/nl-event/expected')) {
	const fixture = JSON.parse(fs.readFileSync(`tests/fixtures/nl-event/expected/${file}`, 'utf8'));
	const text = fs.readFileSync(`tests/fixtures/nl-event/inputs/${fixture.id}.txt`, 'utf8');
	it(`accepted source fixture: ${fixture.id}`, () => {
		const { referenceInstant, browserTimeZone, eventTimeZoneOverride } = fixture.context;
		const draft = parse(
			text,
			{ referenceInstant, browserTimeZone },
			eventTimeZoneOverride ?? undefined
		);
		const a = fixture.assertions;
		for (const [name, value] of Object.entries(a.preferred ?? {})) {
			if (name.endsWith('Contains')) {
				expect(
					Core.getField(draft, name.replace('Contains', '') as Core.fieldName).value
				).toContain(value);
			} else {
				expect(Core.getField(draft, name as Core.fieldName).value).toBe(value ?? '');
			}
		}
		for (const [name, expected] of Object.entries(a.candidateValues ?? {})) {
			if ((expected as string[]).length === 0)
				expect(values(draft, name as Core.fieldName)).toEqual([]);
			else
				expect(values(draft, name as Core.fieldName)).toEqual(
					expect.arrayContaining(expected as string[])
				);
		}
		// Opt in only for small lists whose full membership and order are meaningful.
		for (const [name, expected] of Object.entries(a.orderedCandidateValues ?? {}))
			expect(values(draft, name as Core.fieldName)).toEqual(expected);
		if (a.expectedZone) expect(Core.effectiveZone(draft)).toBe(a.expectedZone);
		for (const warning of a.warnings ?? []) expect(draft.suggestions.warnings).toContain(warning);
		if (a.partialCandidateValues?.startTimes) {
			expect(Core.alternatives(draft, 'start').map((c) => c.time)).toEqual(
				a.partialCandidateValues.startTimes
			);
			expect(Core.alternatives(draft, 'end').map((c) => c.time)).toEqual(
				a.partialCandidateValues.endTimes
			);
		}
		if (a.partialCandidateValues?.startDate) {
			expect(Core.alternatives(draft, 'start')).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						date: a.partialCandidateValues.startDate,
						time: '',
						completeness: 'date-only'
					})
				])
			);
		}
		for (const relation of a.relationships ?? []) {
			const starts = Core.alternatives(draft, 'start').filter((c) =>
				relation.start ? c.value === relation.start : c.time === relation.startTime
			);
			const ends = Core.alternatives(draft, 'end').filter((c) =>
				relation.end ? c.value === relation.end : c.time === relation.endTime
			);
			expect(starts.some((s) => ends.some((e) => s.groups.some((g) => e.groups.includes(g))))).toBe(
				true
			);
			if (relation.endInferred)
				expect(ends.some((e) => e.inferred.includes('assumed-end'))).toBe(true);
		}
		for (const range of a.additionalRelatedTimeRanges ?? []) {
			expect(
				Core.alternatives(draft, 'start').some(
					(s) =>
						s.time === range[0] &&
						Core.alternatives(draft, 'end').some(
							(e) => e.time === range[1] && e.groups.some((g) => s.groups.includes(g))
						)
				)
			).toBe(true);
		}
		for (const boundary of a.excludeAsEventBoundary ?? [])
			expect(values(draft, 'start').some((v) => v.startsWith(boundary))).toBe(false);
		const validation = Core.validate(draft);
		if (a.exportable === false || a.exportableBeforeChoice === false)
			expect(validation.event).toBeUndefined();
		if (a.ambiguousStartOffsets)
			expect(validation.startChoices.map((c) => c.offset)).toEqual(a.ambiguousStartOffsets);
		if (a.allDay) {
			expect(validation.event?.allDay).toBe(true);
			expect(Core.ics(validation.event!, 'fixture', '20261024T030000Z')).toContain(
				`DTEND;VALUE=DATE:${a.ics.exclusiveDtend}`
			);
		}
		// Every candidate has actual current-source evidence, including inferred ends.
		for (const c of draft.suggestions.candidates) {
			expect(c.spans.length).toBeGreaterThan(0);
			for (const span of [
				...c.spans,
				...(c.dateSpans ?? []),
				...(c.timeSpans ?? []),
				...(c.textSpans ?? [])
			]) {
				expect(Number.isInteger(span.start) && Number.isInteger(span.end)).toBe(true);
				expect(span.start).toBeGreaterThanOrEqual(0);
				expect(span.end).toBeGreaterThan(span.start);
				expect(span.end).toBeLessThanOrEqual(text.length);
			}
		}
	});
}

it('promotes the related inferred lesson End ahead of the higher-ranked social End', () => {
	const text = fs.readFileSync('tests/fixtures/nl-event/inputs/k2-milonga-excerpt.txt', 'utf8');
	let draft = parse(text);
	const lesson = Core.alternatives(draft, 'start').find((c) => c.time === '18:00')!;
	const originalEnd = draft.end;
	draft = Core.selectCandidate(draft, 'start', lesson.id);
	const [related, social] = Core.alternatives(draft, 'end');
	expect([related.value, social.value]).toEqual(['2026-10-18 19:00', '2026-10-18 22:30']);
	expect(related.rank).toBeLessThan(social.rank);
	expect(related.groups.some((group) => lesson.groups.includes(group))).toBe(true);
	expect(social.groups.some((group) => lesson.groups.includes(group))).toBe(false);
	expect(related.inferred).toContain('assumed-end');
	// The inferred 19:00 has no clock evidence of its own.
	expect(related.timeSpans).toEqual([]);
	expect(related.spans).toEqual(lesson.spans);
	expect(lesson.timeSpans).toEqual([
		{ start: text.indexOf('6시'), end: text.indexOf('6시') + '6시 '.length }
	]);
	expect(draft.start).toMatchObject({ value: lesson.value, ownership: 'manual' });
	expect(draft.end).toEqual(originalEnd);
	expect(Core.evidenceWarnings(draft, 'end').join()).toContain('different activities');
	draft = Core.reset(draft, 'end');
	expect(draft.end).toMatchObject({ value: related.value, ownership: 'auto' });
	const event = Core.validate(draft).event!;
	expect(event).toMatchObject({ start: '20261018T090000Z', end: '20261018T100000Z' });
	expect(new URL(Core.googleUrl(event)).searchParams.get('dates')).toBe(
		'20261018T090000Z/20261018T100000Z'
	);
	expect(Core.ics(event, 'lesson', '20261024T030000Z')).toContain(
		'DTSTART:20261018T090000Z\r\nDTEND:20261018T100000Z'
	);
});

it('selects a lower-ranked source title independently and exports it in the inferred city zone', () => {
	const text = fs
		.readFileSync('tests/fixtures/nl-event/inputs/e1-st-paul-houseparty-sanitized.txt', 'utf8')
		.replace('Community house party', 'Community house party 🙂')
		.replaceAll('\n', '\r\n');
	const draft = parse(text);
	const [heading, activity] = Core.alternatives(draft, 'title');
	expect(heading.rank).toBeGreaterThan(activity.rank);
	expect(activity.value).toBe('Music from');
	const at = text.indexOf('Music from');
	expect(activity.textSpans).toEqual([{ start: at, end: at + 'Music from'.length }]);
	expect(activity.spans.map((s) => text.slice(s.start, s.end))).toEqual([
		'Music from 8:00 pm - midnight.'
	]);
	const selected = Core.selectCandidate(draft, 'title', activity.id);
	expect(selected.title).toMatchObject({ value: 'Music from', ownership: 'manual' });
	for (const field of ['start', 'end', 'location'] as const)
		expect(selected[field]).toEqual(draft[field]);
	expect(selected.suggestions.zoneProvenance).toBe('Inferred from recognized city');
	const event = Core.validate(selected).event!;
	expect(event).toMatchObject({
		title: 'Music from',
		start: '20261115T020000Z',
		end: '20261115T060000Z',
		zone: 'America/Chicago',
		description: text
	});
	expect(new URL(Core.googleUrl(event)).searchParams.get('text')).toBe('Music from');
	expect(Core.ics(event, 'activity', '20261024T030000Z')).toContain('SUMMARY:Music from\r\n');
	expect(Core.reset(selected, 'title').title).toMatchObject({
		value: 'Community house party 🙂',
		ownership: 'auto'
	});
});

describe('ownership, revisions and incomplete evidence', () => {
	it('preserves typing, manual blank, UID and override while Auto fields refresh', () => {
		let d = Core.withUid(parse('Title: First\nTomorrow at 7pm'), 'stable');
		d = Core.edit(Core.edit(d, 'title', 'Mine'), 'location', '');
		d = settle(Core.describe(d, 'Title: Second\nTomorrow at 8pm'));
		expect(d.title.value).toBe('Mine');
		expect(d.location.ownership).toBe('manual');
		expect(d.start.value).toBe('2026-10-25 20:00');
		expect(d.uid).toBe('stable');
		expect(Core.reset(d, 'title').title.value).toBe('Second');
		const cleared = Core.describe(d, '');
		expect(cleared.start.value).toBe('');
		expect(cleared.title.value).toBe('Mine');
	});
	it('rejects out-of-order, clear, discarded-draft and changed-context results', () => {
		const d = Core.describe(Core.create(context), 'Tomorrow at 7pm');
		const ticket = Core.parseTicket(d),
			output = Core.extract(d);
		for (const newer of [
			Core.describe(d, 'new'),
			Core.describe(d, ''),
			Core.describe(Core.create(context), 'Tomorrow at 7pm'),
			Core.setZone(d, 'America/Chicago')
		]) {
			expect(Core.completeParse(newer, ticket, output, true)).toBe(newer);
			expect(Core.failParse(newer, ticket, 'stale')).toBe(newer);
		}
		const typed = Core.edit(d, 'start', '');
		expect(Core.completeParse(typed, ticket, output, true).start.ownership).toBe('manual');
	});
	it('hides pending evidence, resets to blank, blocks exports, and fails terminally', () => {
		let d = Core.describe(parse('Tomorrow at 7pm'), 'Next Friday at 8pm');
		expect(Core.alternatives(d, 'start')).toEqual([]);
		expect(Core.validate(d).event).toBeUndefined();
		d = Core.reset(d, 'start');
		expect(d.start.value).toBe('');
		d = Core.failParse(Core.edit(d, 'title', 'Manual'), Core.parseTicket(d), 'Parse failed');
		expect(d.parseStatus).toBe('failed');
		expect(d.title.value).toBe('Manual');
		expect(d.end.value).toBe('');
		d = Core.edit(Core.edit(d, 'start', '2026-10-25 17:00'), 'end', '2026-10-25 18:00');
		expect(Core.validate(d).event).toBeDefined();
	});
	it('selects only one field; related End reset follows Start without changing its sibling', () => {
		const text = fs.readFileSync(
			'tests/fixtures/nl-event/inputs/k3-slow-saturday-synthetic.txt',
			'utf8'
		);
		let d = parse(text);
		const oldEnd = d.end;
		const c = Core.alternatives(d, 'start').find((c) => c.value === '2026-07-11 16:30')!;
		d = Core.selectCandidate(d, 'start', c.id);
		expect(d.start.ownership).toBe('manual');
		expect(d.end).toEqual(oldEnd);
		expect(Core.reset(d, 'end').end.value).toBe('2026-07-11 18:00');
		const stale = Core.describe(d, 'New description');
		expect(Core.evidenceWarnings(stale, 'start').join()).toContain('earlier Description');
		expect(Core.selectCandidate(stale, 'start', c.id)).toBe(stale);
	});
	it('never borrows sibling/reference dates, but accepts compatible same-field dates', () => {
		let d = parse('Class 1: Example: 12:15 - 1:15 pm');
		const c = Core.alternatives(d, 'start')[0];
		d = Core.selectCandidate(Core.edit(d, 'end', '2026-05-16 13:15'), 'start', c.id);
		expect(d.start.value).toBe('12:15');
		expect(Core.validate(d).event).toBeUndefined();
		d = Core.selectCandidate(Core.edit(d, 'start', '2026-05-16'), 'start', c.id);
		expect(d.start.value).toBe('2026-05-16 12:15');
		expect(Core.validate(d).event).toBeDefined();
	});
	it('date/period candidates do not imply all-day; explicit manual dates do', () => {
		let d = parse('Tomorrow evening');
		const c = Core.alternatives(d, 'start')[0];
		d = Core.selectCandidate(Core.edit(d, 'end', '2026-10-25'), 'start', c.id);
		expect(Core.validate(d).event).toBeUndefined();
		d = Core.edit(d, 'start', '2026-10-25');
		expect(Core.validate(d).event?.allDay).toBe(true);
	});
	it('applies an explicit reset during a zone refresh without changing other fields', () => {
		let d = parse('Tomorrow at 7pm');
		const end = d.end;
		d = Core.reset(Core.setZone(d, 'America/Chicago'), 'start');
		expect(d.start.value).toBe('');
		d = settle(d, false);
		expect(d.start.value).toBe('2026-10-24 19:00');
		expect(d.end).toEqual(end);
	});
	it('invalidates offsets when inferred source zone changes or is cleared', () => {
		let d = parse('Time zone: America/Chicago\nNovember 1, 2026 at 1:30 am to 2:30 am');
		d = Core.chooseOffset(d, 'start', '-05:00');
		const cleared = Core.describe(d, '');
		expect(cleared.start.offset).toBe('');
		d = settle(
			Core.describe(d, 'Time zone: America/New_York\nNovember 1, 2026 at 1:30 am to 2:30 am')
		);
		expect(d.start.offset).toBe('');
		expect(d.start.ownership).toBe('manual');
		expect(Core.validate(d).event).toBeUndefined();
	});
	it('warns when a selected Start conflicts with the retained Auto End', () => {
		let d = parse(
			fs.readFileSync('tests/fixtures/nl-event/inputs/k3-slow-saturday-synthetic.txt', 'utf8')
		);
		const c = Core.alternatives(d, 'start').find((c) => c.value === '2026-07-11 16:30')!;
		d = Core.selectCandidate(d, 'start', c.id);
		expect(Core.evidenceWarnings(d, 'end').join()).toContain('different activities');
	});

	it('zone refresh preserves wall values and ownership, then reset applies current suggestions', () => {
		const d = parse('Tomorrow at 7pm');
		const zoned = settle(Core.setZone(d, 'America/Chicago'), false);
		expect(zoned.start).toEqual(d.start);
		expect(Core.effectiveZone(zoned)).toBe('America/Chicago');
		expect(Core.describe(zoned, '').zoneOverride).toBe('America/Chicago');
	});
});

describe('date policy boundaries', () => {
	it.each([
		['this Monday at 7pm', '2026-10-19 19:00'],
		['next Friday at 7pm', '2026-10-30 19:00'],
		['다음 주 금요일 오후 7시', '2026-10-30 19:00'],
		['내일 오후 6시 반', '2026-10-25 18:30'],
		['May 16, 12:15 - 1:15 pm', '2026-05-16 12:15']
	])('%s', (text, expected) => expect(parse(text).start.value).toBe(expected));
	it('resolves relatives after source zone, near local midnight', () => {
		expect(
			parse('Time zone: America/Chicago\nTomorrow at 7pm', {
				referenceInstant: '2026-10-24T01:00:00Z',
				browserTimeZone: 'Asia/Seoul'
			}).start.value
		).toBe('2026-10-24 19:00');
	});
	it('handles year/week boundaries, nearest-year ties and explicit weekday mismatches', () => {
		expect(
			parse('next Friday at 7pm', { ...context, referenceInstant: '2026-12-31T00:00:00Z' }).start
				.value
		).toBe('2027-01-08 19:00');
		expect(
			parse('January 1 at 7pm', { ...context, referenceInstant: '2024-07-02T03:00:00Z' }).start
				.value
		).toBe('2024-01-01 19:00');
		const d = parse('Sunday, October 25, 2025 at 7pm');
		expect(d.start.value).toBe('2025-10-25 19:00');
		expect(d.suggestions.warnings).toContain('weekday-mismatch');
	});
	it('does not synthesize unrelated dates and times or use deadlines and numeric noise', () => {
		const d = parse(
			'October 25, 2026\nOctober 26, 2026\nClass 1: 1:30 - 2:30 pm\nRegistration deadline: October 20 at 7pm\nAccount 0000-0000-0000'
		);
		expect(d.start.value).toBe('');
		expect(Core.alternatives(d, 'start').filter((c) => c.completeness === 'complete')).toEqual([]);
	});
	it('keeps unqualified AM/PM clocks unresolved and rejects invalid minutes', () => {
		expect(parse('Tomorrow at 7:30').start.value).toBe('');
		expect(parse('Tomorrow at 07:30').start.value).toBe('2026-10-25 07:30');
		expect(parse('Tomorrow at 7:99 pm').start.value).toBe('');
	});

	it('uses elapsed default duration across DST, with no assumed ambiguous/gap instant', () => {
		expect(parse('Time zone: America/Chicago\nMarch 8, 2026 at 1:30 am').end.value).toBe(
			'2026-03-08 03:30'
		);
		expect(parse('Time zone: America/Chicago\nNovember 1, 2026 at 1:30 am').end.value).toBe('');
	});
	it('requires confirmation for conflicting/unsupported source zones', () => {
		for (const zone of ['CST', 'America/Chicago America/New_York']) {
			const d = parse(`Time zone: ${zone}\nTomorrow at 7pm`);
			expect(Core.validate(d).event).toBeUndefined();
			expect(Core.validate(settle(Core.setZone(d, 'America/Chicago'), false)).event).toBeDefined();
		}
	});
});

it.each([
	['lunch tomorrow', 'lunch', '2026-10-25 12:00', true],
	['lunch tomorrow 12p', 'lunch', '2026-10-25 12:00', false],
	['lunch tomorrow 12a', 'lunch', '2026-10-25 00:00', false],
	['Lunch tomorrow at 12:30p', 'Lunch', '2026-10-25 12:30', false],
	['Lunch next Friday at 1P', 'Lunch', '2026-10-30 13:00', false],
	['meeting tomorrow', 'meeting', '2026-10-25 09:00', true],
	['tomorrow', '', '2026-10-25 09:00', true],
	['breakfast tomorrow', 'breakfast', '2026-10-25 09:00', true],
	['dinner tomorrow', 'dinner', '2026-10-25 18:00', true],
	['내일 점심', '점심', '2026-10-25 12:00', true]
])('handles short announcement %s', (text, title, start, inferred) => {
	const d = parse(text),
		result = Core.validate(d);
	expect(d.title.value).toBe(title);
	expect(result.startValue).toBe(start);
	expect(result.event).toBeDefined();
	expect(Core.alternatives(d, 'start')[0].inferred.includes('inferred-time')).toBe(inferred);
	const event = result.event!;
	expect(new URL(Core.googleUrl(event)).searchParams.get('dates')).toBe(
		`${event.start}/${event.end}`
	);
	expect(Core.ics(event, 'lunch', '20261024T030000Z')).toContain(`DTSTART:${event.start}`);
});
it('does not infer a time over explicit clock evidence, vague periods, or competing dates', () => {
	for (const text of [
		'tomorrow evening',
		'tomorrow at 7:99pm',
		'October 25, 2026\nOctober 26, 2026'
	])
		expect(parse(text).start.value).toBe('');
	expect(parse('Workshop schedule\nTomorrow at 7:30').start.value).toBe('');
});
it('preserves explicitly supplied titles and manual title edits', () => {
	let d = parse('Title: lunch tomorrow\nTomorrow at 12p');
	expect(d.title.value).toBe('lunch tomorrow');
	d = Core.edit(d, 'title', 'My lunch tomorrow');
	d = settle(Core.describe(d, 'lunch tomorrow 12a'));
	expect(d.title.value).toBe('My lunch tomorrow');
});

it.each([
	['unsubscribe netflix in 30 days', 'unsubscribe netflix', '2026-11-23', true],
	['renew passport in 2 weeks', 'renew passport', '2026-11-07', true],
	['unsubscribe netflix in 30 days at 5pm', 'unsubscribe netflix', '2026-11-23 17:00', false],
	['lunch in 2 days', 'lunch', '2026-10-26 12:00', false],
	['call in 2 hours', 'call', '2026-10-24 14:00', false],
	['stretch in 90 minutes', 'stretch', '2026-10-24 13:30', false]
])('interprets relative reminder %s', (text, title, start, allDay) => {
	const d = parse(text),
		result = Core.validate(d);
	expect(d.title.value).toBe(title);
	expect(result.startValue).toBe(start);
	expect(result.allDay).toBe(allDay);
	expect(result.event).toBeDefined();
	const event = result.event!;
	expect(new URL(Core.googleUrl(event)).searchParams.get('dates')).toBe(
		`${event.start}/${event.end}`
	);
	expect(Core.ics(event, 'reminder', '20261024T030000Z')).toContain(
		allDay ? 'DTSTART;VALUE=DATE:' : 'DTSTART:'
	);
	if (allDay) expect(result.endValue).toBe(start);
});
it('uses calendar days across DST and elapsed hours from the reference instant', () => {
	const ctx = { referenceInstant: '2026-03-07T17:00:00Z', browserTimeZone: 'America/Chicago' };
	expect(Core.validate(parse('cancel subscription in 1 day', ctx)).startValue).toBe('2026-03-08');
	expect(Core.validate(parse('call in 24 hours', ctx)).startValue).toBe('2026-03-08 12:00');
	const nearMidnight = { referenceInstant: '2026-12-31T15:30:00Z', browserTimeZone: 'Asia/Seoul' };
	expect(Core.validate(parse('renew in 30 days', nearMidnight)).startValue).toBe('2027-01-31');
});
it('preserves manual values and mode through relative reminder reparses', () => {
	let d = parse('unsubscribe netflix in 30 days');
	d = Core.edit(d, 'title', 'My subscription');
	d = Core.edit(d, 'start', '2026-12-01');
	d = settle(Core.describe(d, 'unsubscribe netflix in 40 days'));
	expect(d.title.value).toBe('My subscription');
	expect(d.start.value).toBe('2026-12-01');
	expect(parse('Title: unsubscribe netflix in 30 days\nin 30 days').title.value).toBe(
		'unsubscribe netflix in 30 days'
	);
});
it('does not turn vague or competing reminder dates into an all-day range', () => {
	expect(Core.validate(parse('call in 2 days in the evening')).event).toBeUndefined();
	expect(Core.validate(parse('cancel in 2 days or in 3 days')).event).toBeUndefined();
	for (const text of ['cancel in -3 days', 'cancel in 1.5 days'])
		expect(parse(text).start.value).toBe('');
});

it('associates the supplied Slow Saturday month lists with practice and social ranges', () => {
	const text = fs.readFileSync('tests/inputs/slow-saturday-user.txt', 'utf8');
	const d = parse(text),
		result = Core.validate(d);
	expect(values(d, 'title')).toContain('슬로우신림, 슬로우 연습모임');
	expect(result.startValue).toBe('2026-07-04 16:30');
	expect(result.endValue).toBe('2026-07-04 18:00');
	expect(result.event).toBeDefined();
	const dates = [
		'07-04',
		'07-11',
		'07-18',
		'07-25',
		'08-01',
		'08-08',
		'08-22',
		'09-05',
		'09-12',
		'09-19'
	];
	for (const name of ['start', 'end'] as const) {
		const options = Core.alternatives(d, name);
		expect(options).toHaveLength(30);
		expect(options.every((c) => c.completeness === 'complete')).toBe(true);
		expect(options.some((c) => c.date === '2026-07-01' || c.date === '2026-09-30')).toBe(false);
		for (const date of dates) {
			for (const time of name === 'start'
				? ['16:30', '18:00', '20:30']
				: ['18:00', '20:30', '23:00'])
				expect(options.some((c) => c.value === `2026-${date} ${time}`)).toBe(true);
		}
	}
	expect(d.location.value).toBe('');
	expect(new URL(Core.googleUrl(result.event!)).searchParams.get('dates')).toBe(
		'20260704T073000Z/20260704T090000Z'
	);
	expect(Core.ics(result.event!, 'slow', '20261024T030000Z')).toContain('DTSTART:20260704T073000Z');
});
it('does not associate month lists with unrelated ranges beyond the schedule section', () => {
	const d = parse('연습 모임 16:30~18:00\n7월 4, 11\n<다른 행사>\n다른 행사 20:00~22:00');
	expect(values(d, 'start')).toContain('2026-07-04 16:30');
	expect(values(d, 'start')).not.toContain('2026-07-04 20:00');
	expect(
		Core.alternatives(d, 'start').some((c) => c.value === '20:00' && c.completeness === 'time-only')
	).toBe(true);
});

it('parses the supplied decorated party announcement as one overnight schedule', () => {
	const text = fs.readFileSync('tests/inputs/rhythm-party-user.txt', 'utf8');
	const d = parse(text),
		result = Core.validate(d);
	expect(result.startValue).toBe('2026-08-14 23:00');
	expect(result.endValue).toBe('2026-08-15 03:30');
	expect(d.location.value).toBe('서울 서대문구 명물길 37');
	expect(values(d, 'start')).toEqual(
		expect.arrayContaining(['2026-08-14 23:00', '2026-08-15 00:30', '2026-08-15 02:00'])
	);
	expect(values(d, 'end')).toEqual(
		expect.arrayContaining(['2026-08-15 00:30', '2026-08-15 02:00', '2026-08-15 03:30'])
	);
	expect(d.suggestions.candidates.some((c) => c.date === '2026-08-12')).toBe(false);
	expect(Core.temporalOptions(d, 'start', 'date').map((o) => o.value)).toEqual([
		'2026-08-12',
		'2026-08-14',
		'2026-08-15'
	]);
	expect(Core.temporalOptions(d, 'start', 'time').find((o) => o.value === '23:00')?.selected).toBe(
		true
	);
	expect(Core.temporalOptions(d, 'end', 'date').map((o) => o.value)).toEqual([
		'2026-08-12',
		'2026-08-14',
		'2026-08-15'
	]);
	expect(new URL(Core.googleUrl(result.event!)).searchParams.get('dates')).toBe(
		'20260814T140000Z/20260814T183000Z'
	);
	expect(Core.ics(result.event!, 'party', '20261024T030000Z')).toContain('DTEND:20260814T183000Z');
	const selected = Core.selectTemporalPart(d, 'start', 'date', '2026-08-15');
	expect(Core.temporalParts(selected, 'start').time).toBe('00:30');
	expect(
		Core.temporalParts(Core.selectTemporalPart(selected, 'start', 'time', '23:00'), 'start')
	).toEqual({ date: '2026-08-15', time: '23:00' });
});
it('limits overnight rollover to the consecutive ranges below a dated heading', () => {
	const d = parse(
		'✔일시: 2026년 8월 14일(금)\n23:00~00:30 : DJ A\n00:30~02:00 : DJ B\n장소: Hall\n다른 행사 01:00~03:00'
	);
	expect(d.start.value).toBe('2026-08-14 23:00');
	expect(d.end.value).toBe('2026-08-15 02:00');
	expect(values(d, 'start')).not.toContain('2026-08-15 01:00');
});

it('does not infer English dates or weekdays from fragments inside names or ordinary words', () => {
	const parseText = (text: string) => {
		const d = Core.describe(
			Core.create({ referenceInstant: '2026-10-24T03:00:00Z', browserTimeZone: 'Asia/Seoul' }),
			text
		);
		return Core.completeParse(d, Core.parseTicket(d), Core.extract(d), true);
	};
	const named = parseText('Tomorrowland');
	expect(named.title.value).toBe('Tomorrowland');
	expect(values(named, 'start')).toEqual([]);
	expect(named.start).toMatchObject({ value: '2026-10-25', input: 'Tomorrow', ownership: 'auto' });
	expect(parseText('Money talk 10/25 at 7pm').start.value).toBe('2026-10-25 19:00');
	expect(parseText('Sunset meetup 10/26 at 7pm').start.value).toBe('2026-10-26 19:00');
});

describe('address-first labeled locations', () => {
	const announcement = fs.readFileSync('tests/inputs/multiline-location-user.txt', 'utf8');
	const flattened = fs.readFileSync(
		'tests/fixtures/nl-event/inputs/k2-milonga-excerpt.txt',
		'utf8'
	);
	it.each([announcement, flattened])(
		'exports only the source address, preserving Description: %s',
		(text) => {
			const draft = parse(text);
			expect(draft.location.value).toBe('연남동 568-51');
			expect(values(draft, 'location')).toEqual(['연남동 568-51', '피스타']);
			expect(draft.description).toBe(text);
			const event = Core.validate(draft).event!;
			expect(event).toBeDefined();
			expect(new URL(Core.googleUrl(event)).searchParams.get('location')).toBe('연남동 568-51');
			expect(new URL(Core.googleUrl(event)).searchParams.get('details')).toBe(text);
			const ics = Core.ics(event, 'location-regression', '20261024T030000Z').replace(/\r\n /g, '');
			expect(ics).toContain('LOCATION:연남동 568-51\r\n');
		}
	);
	it.each([
		{ label: '장소', venue: '피스타', address: '연남동 568-51', floor: '(B1)' },
		{ label: 'Location', venue: 'The Hall', address: '123 Main Street', floor: ' (Suite 2)' },
		{ label: 'Venue', venue: 'The Basement', address: '123 Main St', floor: ', Floor 2' }
	])(
		'continues inline $label venues into the next address with original evidence and exports',
		({ label, venue, address, floor }) => {
			for (const separator of ['\n', '\r\n\r\n']) {
				const text = `🙂 provenance\nTomorrow at 7pm\n${label}: **${venue}**${separator}${address}${floor}`;
				const draft = parse(text);
				const candidates = Core.alternatives(draft, 'location');
				expect(draft.location.value).toBe(address);
				expect(candidates.map((c) => c.value)).toEqual([address, venue]);
				expect(candidates[0].rank).toBeGreaterThan(candidates[1].rank);
				for (const candidate of candidates) {
					const start = text.indexOf(candidate.value);
					expect(candidate.spans).toEqual([{ start, end: start + candidate.value.length }]);
				}
				expect(draft.description).toBe(text);
				const event = Core.validate(draft).event!;
				expect(event).toBeDefined();
				expect(new URL(Core.googleUrl(event)).searchParams.get('location')).toBe(address);
				expect(
					Core.ics(event, 'inline-location', '20261024T030000Z').replace(/\r\n /g, '')
				).toContain(`LOCATION:${address}\r\n`);
			}
		}
	);
	it.each([
		'시간: 6시',
		'Date: tomorrow',
		'Location: The Hall\nCome dance with us',
		'함께 즐겨요!',
		'Come dance with us',
		'홍대역에서 도보 5분',
		'Walk 5 minutes from the station',
		'다른홀'
	])('stops an inline venue before unrelated or neighboring content: %s', (boundary) => {
		const text = `장소: 피스타\n${boundary}\n연남동 568-51(B1)`;
		const locations = values(parse(text), 'location');
		expect(locations).not.toContain('연남동 568-51');
		expect(locations).toContain('피스타');
	});
	it.each(['장소: 연남동 568-51(B1)', '장소: 피스타 연남동 568-51(B1)'])(
		'does not continue an inline address: %s',
		(inline) => {
			const draft = parse(`${inline}\n다른동 123-45`);
			expect(draft.location.value).toBe('연남동 568-51');
			expect(values(draft, 'location')).not.toContain('다른동 123-45');
		}
	);
	it.each(['장소', '주소', '위치', 'Location', 'Venue', 'location', 'VENUE'])(
		'recognizes decorated multiline and inline %s labels',
		(label) => {
			for (const source of [
				`${label}\n피스타\n연남동 568-51(B1)\n홍대역 2번출구`,
				`**${label} :**\r\n\r\n~ **피스타**\r\n\r\n연남동 568-51 (B1)`,
				`${label}:피스타, 연남동 568-51 (B1) 홍대역 2번출구`,
				`**${label}**:\n피스타\n연남동 568-51(B1)`,
				`${label} 피스타 연남동 568-51(B1)`
			]) {
				const draft = parse(source);
				expect(draft.location.value).toBe('연남동 568-51');
				expect(values(draft, 'location')).toEqual(['연남동 568-51', '피스타']);
			}
		}
	);
	it.each([
		['📍 해피홀 서울 서대문구 명물길 37 지하1층', '서울 서대문구 명물길 37', '해피홀'],
		['장소: 피스타, 연남동 568-51(B1)', '연남동 568-51', '피스타'],
		['장소: 연남동 568-51번지', '연남동 568-51번지', undefined],
		['Location: The Hall, 123 Main Street (Suite 2)', '123 Main Street', 'The Hall'],
		['Venue\nThe Hall\n123 Main St, Floor 2', '123 Main St', 'The Hall'],
		['주소: 서울 마포구 와우산로29길 27 지하 1층 101호', '서울 마포구 와우산로29길 27', undefined]
	])('strips floor and unit annotations in %s', (text, address, venue) => {
		const draft = parse(text!);
		expect(draft.location.value).toBe(address);
		if (venue) expect(values(draft, 'location')).toContain(venue);
		expect(draft.description).toBe(text);
	});
	it.each(['장소\n~ **피스타**', '장소: 피스타 (B1)', 'Venue: The Hall (Floor 2)', '공간비틀즈'])(
		'keeps venue-only fallback: %s',
		(text) => {
			expect(parse(text).location.value).toBe(
				text.includes('피스타') ? '피스타' : text.includes('The Hall') ? 'The Hall' : '공간비틀즈'
			);
		}
	);
	it.each([
		'장소',
		'장소\n\n',
		'장소\n6시 밀롱가 무료강습\n연남동 568-51',
		'장소\n홍대역 2번출구\n연남동 568-51',
		'Venue\nRegistration deadline: tomorrow\nThe Hall',
		'Location\nDate: October 18, 2026\n123 Main Street',
		'장소\n회비 20000원\n피스타',
		'장소\n문의: test@example.com\n피스타',
		'장소\nhttps://example.com\n피스타',
		'장소\n추후 공지\n피스타',
		'장소가 궁금하면 연락하세요',
		'이 장소 안내는 추후 공지합니다',
		'장소 안내를 확인하세요',
		'장소\n친구들과 함께합니다\n피스타',
		'Location\nTBD\nThe Hall',
		'장소\n(B1)\n연남동 568-51',
		'장소\nDirections: walk to 123 Main Street',
		'장소\n홍대역 2번출구에서 연남동 568-51',
		'장소\n홍대역에서 도보 5분',
		'장소\n홍대역에서 도보 5분\n연남동 568-51',
		'Location\nWalk to 123 Main Street',
		'Location\nWalk 5 minutes from Hongdae Station',
		'Location\nWalk 5 minutes from Hongdae Station\n123 Main Street',
		'Location\nWalking 5 mins from the station\n123 Main Street',
		'Location\nTake the subway to the hall\n123 Main Street',
		'장소\n6시 연남동 568-51에서 무료강습',
		'장소\n문의: 연남동 568-51',
		'Location\nCome dance with us',
		'Location\nCome dance with us\n123 Main Street',
		'Location\nJoin us for a party\n123 Main Street',
		'Venue\nPlease register by Friday\nThe Hall'
	])('rejects empty sections, directions, copy and ordinary mentions: %s', (text) => {
		expect(values(parse(text), 'location')).toEqual([]);
	});
	it.each(['날짜', '시간', 'Date', 'Time', 'Title', '등록', '문의'])(
		'stops before neighboring %s sections',
		(label) => {
			const draft = parse(`장소\n피스타\n${label}: 연남동 568-51\n다른동 123-45`);
			expect(values(draft, 'location')).toEqual(['피스타']);
		}
	);
	it.each(['The Basement', 'Station Hall', 'The Walk', 'The Turn'])(
		'keeps venue names containing direction words: %s',
		(venue) => {
			expect(values(parse(`Venue\n${venue}`), 'location')).toEqual([venue]);
			expect(values(parse(`Venue\n${venue}\n123 Main Street`), 'location')).toEqual([
				'123 Main Street',
				venue
			]);
		}
	);
	it('stops at unrelated copy and does not concatenate adjacent venues', () => {
		expect(values(parse('장소\n피스타\n함께 즐겨요!\n연남동 568-51'), 'location')).toEqual([
			'피스타'
		]);
		expect(values(parse('장소\n피스타\n다른홀\n연남동 568-51'), 'location')).toEqual(['피스타']);
		expect(values(parse('장소\nLocation: The Hall'), 'location')).toEqual(['The Hall']);
	});
	it('preserves repeated UTF-16 evidence and deterministic address-first deduplication', () => {
		const text =
			'🙂 한글 prefix\r\n**장소:**\r\n~ **피스타**\r\n연남동 568-51(B1)\r\n홍대역 2번출구\r\n장소: 피스타, 연남동 568-51 (B1)';
		const draft = parse(text);
		const candidates = Core.alternatives(draft, 'location');
		expect(candidates.map((c) => c.value)).toEqual(['연남동 568-51', '피스타']);
		expect(candidates[0].rank).toBeGreaterThan(candidates[1].rank);
		for (const c of candidates) {
			expect(c.spans).toHaveLength(2);
			expect(c.spans.map((span) => text.slice(span.start, span.end))).toEqual([c.value, c.value]);
			expect(c.spans[0].start).toBe(text.indexOf(c.value));
		}
		expect(Core.extract(draft).candidates).toEqual(draft.suggestions.candidates);
	});
	it.each(['\n', '\r\n'])(
		'keeps repeated decorated emoji venue and address evidence through map trimming (%j)',
		(newline) => {
			const venue = '피스타🙂 Hall';
			const address = '서울 마포구 와우산로29길 27';
			const text = [
				'🙂 한글 provenance',
				'Tomorrow at 7pm',
				`## **장소**: ~ **${venue}**`,
				'  ',
				`${address} (B1) https://naver.me/example`,
				`Venue: **${venue}**; ${address} (Suite 2) https://maps.google.com/?q=Hall`
			].join(newline);
			const draft = parse(text);
			const candidates = Core.alternatives(draft, 'location');
			expect(candidates.map((c) => c.value)).toEqual([address, venue]);
			for (const [index, candidate] of candidates.entries()) {
				const first = text.indexOf(candidate.value);
				const last = text.lastIndexOf(candidate.value);
				expect(candidate).toMatchObject({
					rank: index === 0 ? 220 : 200,
					label: index === 0 ? 'Address' : 'Venue',
					groups: ['overall'],
					inferred: [],
					spans: [
						{ start: first, end: first + candidate.value.length },
						{ start: last, end: last + candidate.value.length }
					]
				});
				expect(candidate.spans.map((s) => text.slice(s.start, s.end))).toEqual([
					candidate.value,
					candidate.value
				]);
			}
			expect(draft.description).toBe(text);
			const event = Core.validate(draft).event!;
			expect(new URL(Core.googleUrl(event)).searchParams.get('location')).toBe(address);
			expect(new URL(Core.googleUrl(event)).searchParams.get('details')).toBe(text);
			expect(
				Core.ics(event, 'lexical-location', '20261024T030000Z').replace(/\r\n /g, '')
			).toContain(`LOCATION:${address}\r\n`);
		}
	);
	it.each([
		['https://map.naver.com/p/entry/place/123', true, 'Map'],
		['http://naver.me/example', true, 'Map'],
		['https://map.kakao.com/link/map/123', true, 'Map'],
		['https://kko.kakao.com/example', true, 'Other'],
		['https://maps.google.com/?q=Hall', true, 'Map'],
		['https://google.com/maps', true, 'Map'],
		['https://www.google.com/maps/place/Hall', true, 'Map'],
		['https://maps.app.goo.gl/example', true, 'Map'],
		['https://kko.to/example', false, 'Map'],
		['https://goo.gl/maps/example', false, 'Map'],
		['https://google.co.kr/maps/place/Hall', false, 'Map'],
		['https://www.google.co.kr/maps/place/Hall', false, 'Map'],
		['https://google.com/mapslookalike', false, 'Other'],
		['https://map.naver.com.evil.example/place/123', false, 'Other'],
		['https://maps.app.goo.gl.evil.example/place/123', false, 'Other'],
		['https://example.com/maps', false, 'Other']
	] as const)(
		'preserves distinct parser and link-chip map recognition for %s',
		(url, stripped, kind) => {
			const text = `🙂 한글\r\n장소: **피스타🙂** ${url}`;
			const draft = parse(text);
			expect(values(draft, 'location')).toEqual(stripped ? ['피스타🙂'] : []);
			expect(discoverLinks(text).map((link) => link.kind)).toEqual([kind]);
			expect(draft.description).toBe(text);
			expect(values(parse(`장소: ${url}`), 'location')).toEqual([]);
			expect(values(parse(`장소: 피스타 ${url} 추가 안내`), 'location')).toEqual([]);
			expect(values(parse(`장소: ${url} 피스타`), 'location')).toEqual([]);
		}
	);
	it('keeps Manual Location through reparses and restores the latest address on Auto', () => {
		let draft = parse(announcement);
		const venue = Core.alternatives(draft, 'location').find((c) => c.value === '피스타')!;
		draft = Core.selectCandidate(draft, 'location', venue.id);
		expect(draft.location.ownership).toBe('manual');
		draft = settle(Core.describe(draft, '장소: The Hall, 123 Main Street'));
		expect(draft.location.value).toBe('피스타');
		draft = Core.edit(draft, 'location', '  exact 한글🙂  ');
		expect(draft.location.value).toBe('  exact 한글🙂  ');
		draft = settle(Core.describe(draft, 'Location: The Hall\n123 Main Street (Suite 2)'));
		expect(draft.location.value).toBe('  exact 한글🙂  ');
		expect(draft.title.ownership).toBe('auto');
		draft = Core.reset(draft, 'location');
		expect(draft.location.value).toBe('123 Main Street');
		expect(draft.location.ownership).toBe('auto');
	});
});

describe('sanitized October prices, short years and end-of-day ranges', () => {
	const text = fs.readFileSync('tests/inputs/blues-jam-october-sanitized.txt', 'utf8');
	it('keeps the overall four-hour event, activity pairs, evidence and normalized exports', () => {
		const d = parse(text);
		expect(d.description).toBe(text);
		expect(values(d, 'title')).toContain('BLUES JAM 치킨블루스!');
		expect(d.start.value).toBe('2026-10-30 20:00');
		expect(d.end.value).toBe('2026-10-31 00:00');
		expect(d.suggestions.contextDates).toEqual([]);
		expect(d.suggestions.warnings).not.toContain('weekday-mismatch');
		for (const [group, start, end] of [
			['overall', '2026-10-30 20:00', '2026-10-31 00:00'],
			['practice', '2026-10-30 20:00', '2026-10-30 22:00'],
			['social', '2026-10-30 22:00', '2026-10-31 00:00']
		]) {
			const id = `${group}:2026-10-30`;
			expect(
				Core.alternatives(d, 'start').some((c) => c.value === start && c.groups.includes(id))
			).toBe(true);
			expect(
				Core.alternatives(d, 'end').some((c) => c.value === end && c.groups.includes(id))
			).toBe(true);
		}
		const dates = Core.temporalOptions(d, 'start', 'date').map((o) => o.value);
		expect(dates).toEqual(['2026-10-30', '2026-10-31']);
		const spans = Core.alternatives(d, 'end')
			.find((c) => c.value === d.end.value)!
			.spans.map((s) => text.slice(s.start, s.end).trim());
		expect(spans).toContain('24:00');
		expect(
			d.suggestions.candidates
				.filter((c) => c.field !== 'title')
				.flatMap((c) => c.spans)
				.some((s) => text.slice(s.start, s.end).includes('1.5'))
		).toBe(false);
		const event = Core.validate(d).event!;
		expect(event).toBeDefined();
		const query = new URL(Core.googleUrl(event)).searchParams;
		expect(query.get('dates')).toBe('20261030T110000Z/20261030T150000Z');
		expect(query.get('details')).toBe(text);
		const ics = Core.ics(event, 'october', '20261024T030000Z');
		expect(ics).toContain('DTSTART:20261030T110000Z\r\nDTEND:20261030T150000Z');
	});
	it.each(['1.5만', '1.5만원', '1.5 만원', '2.5천원', '1.5 KRW', '₩1.5', 'KRW 1.5', '$1.5'])(
		'ignores monetary token %s in event and contextual date evidence',
		(price) => {
			for (const line of [
				`참여시 - ${price}`,
				`참가비: ${price}`,
				`일시: 2026-10-30 20:00~24:00, ${price}`
			]) {
				const d = parse(`일시: 2026-10-30 20:00~24:00\n${line}`);
				expect(d.start.value).toBe('2026-10-30 20:00');
				expect(d.end.value).toBe('2026-10-31 00:00');
				expect(d.suggestions.contextDates).toEqual([]);
				expect(
					d.suggestions.candidates
						.filter((c) => c.date)
						.every((c) => /^2026-10-(30|31)$/.test(c.date))
				).toBe(true);
			}
		}
	);
	it('preserves ordinary numeric dates and full-year conflicts', () => {
		for (const label of ['', '만남', '원데이'])
			expect(parse(`일시: 1.5 ${label} 20:00~22:00`).start.value).toBe('2027-01-05 20:00');
		const d = parse('BLUES JAM 26.10.30\n일시: 2027-10-30 20:00~24:00');
		expect(d.start.value).toBe('2027-10-30 20:00');
		expect(values(d, 'start')).toContain('2026-10-30');
	});
	it.each(['26.10.30', '26/10/30', '26-10-30', '2026.10.30'])(
		'recognizes %s as one bounded date with exact heading provenance',
		(token) => {
			const source = `🙂 JAM ${token} 금요일\n20:00~24:00`;
			const d = parse(source);
			expect(d.start.value).toBe('2026-10-30 20:00');
			expect(d.end.value).toBe('2026-10-31 00:00');
			expect(values(d, 'start')).not.toContain('2026-10-30 09:00');
			const dateSpans = Core.alternatives(d, 'start')
				.flatMap((c) => c.spans)
				.filter((s) => source.slice(s.start, s.end).includes(token));
			expect(dateSpans.length).toBeGreaterThan(0);
			for (const span of dateSpans) expect(source.slice(span.start, span.end)).toBe(token);
		}
	);
	it.each([
		'26.02.30',
		'26.13.01',
		'26.10.300',
		'126.10.30',
		'v26.10.30',
		'version 1.5.0',
		'version 1.5',
		'https://example.test/26.10.30',
		'계좌 26.10.30'
	])('does not produce partial or spurious dates from %s', (token) => {
		const d = parse(token);
		expect(values(d, 'start')).toEqual([]);
		expect(d.suggestions.contextDates).toEqual([]);
	});
	it('uses the reference century deterministically', () => {
		expect(
			parse('Date: 26.10.30 20:00~24:00', { ...context, referenceInstant: '2126-10-24T03:00:00Z' })
				.start.value
		).toBe('2126-10-30 20:00');
	});
	it.each(['24:00', '24:01', '24:30', '25:00', '24:00pm', '오후 24:00', '24시', '24:000'])(
		'never offers standalone %s as a start or canonical 24-hour clock',
		(clock) => {
			const d = parse(`일시: 2026-10-30 ${clock}`);
			expect(d.suggestions.candidates.filter((c) => c.time)).toEqual([]);
		}
	);
	it.each(['24:01', '24:30', '25:00', '24:00pm', '오후 24:00', '24시', '24:000'])(
		'rejects invalid endpoint %s',
		(clock) => {
			const d = parse(`일시: 2026-10-30 20:00~${clock}`);
			expect(Core.alternatives(d, 'end').some((c) => !c.inferred.includes('assumed-end'))).toBe(
				false
			);
		}
	);
	it.each([
		['20:00~24:00', '2026-10-31 00:00'],
		['20:00~00:00', '2026-10-31 00:00'],
		['20:00~23:59', '2026-10-30 23:59'],
		['23:00~02:00', '2026-10-31 02:00']
	])('preserves rollover for %s', (range, end) => {
		expect(parse(`일시: 10월 30일 금요일 ${range}`).end.value).toBe(end);
	});
	it('does not reinterpret a range starting at 24:00 as a later start', () => {
		const d = parse('Date: 2026-10-30 24:00~02:00');
		expect(d.suggestions.candidates.filter((c) => c.time)).toEqual([]);
	});
	it('rolls listed midnight endpoints forward once and retains subsequent slots', () => {
		const d = parse('일시: 2026-10-30\n22:00~24:00 소셜\n00:00~02:00 After');
		expect(d.start.value).toBe('2026-10-30 22:00');
		expect(d.end.value).toBe('2026-10-31 02:00');
		expect(values(d, 'start')).toContain('2026-10-31 00:00');
		expect(values(d, 'end')).toContain('2026-10-31 00:00');
	});
	it('keeps undated range endpoints partial and uses Temporal across DST', () => {
		const partial = parse('Social 20:00~24:00');
		expect(values(partial, 'end')).toEqual(['00:00']);
		expect(Core.validate(partial).event).toBeUndefined();
		const d = parse('Date: 2026-03-08 00:00~24:00', context, 'America/New_York');
		expect(d.end.value).toBe('2026-03-09 00:00');
		expect(new URL(Core.googleUrl(Core.validate(d).event!)).searchParams.get('dates')).toBe(
			'20260308T050000Z/20260309T040000Z'
		);
	});
});

describe('sanitized November spaced four-digit dates', () => {
	const text = fs.readFileSync('tests/inputs/november-spaced-date-sanitized.txt', 'utf8');
	it('preserves full-date evidence and inferred overall End independently of the segment', () => {
		const d = parse(text);
		expect(d.description).toBe(text);
		expect(d.start.value).toBe('2026-11-14 20:00');
		expect(d.end.value).toBe('2026-11-14 21:00');
		expect(d.suggestions.contextDates).toEqual([]);
		expect(d.suggestions.warnings).not.toContain('weekday-mismatch');
		expect(d.suggestions.warnings).not.toContain('multiple-source-dates');
		const start = Core.alternatives(d, 'start').find((c) => c.value === d.start.value)!;
		const end = Core.alternatives(d, 'end').find((c) => c.value === d.end.value)!;
		expect(start.inferred).not.toContain('inferred-year');
		expect(start.spans[0]).toEqual({
			start: text.indexOf('2026.'),
			end: text.indexOf('2026.') + '2026. 11. 14'.length
		});
		expect(end.inferred).toContain('assumed-end');
		expect(end.groups).toContain('overall:2026-11-14');
		const segmentStart = Core.alternatives(d, 'start').find((c) => c.value === '2026-11-14 22:30')!;
		const segmentEnd = Core.alternatives(d, 'end').find((c) => c.value === '2026-11-14 23:00')!;
		expect(segmentEnd.inferred).not.toContain('assumed-end');
		expect(segmentEnd.groups.some((g) => segmentStart.groups.includes(g))).toBe(true);
		expect(segmentEnd.groups).not.toContain('overall:2026-11-14');
		expect(Core.temporalOptions(d, 'start', 'date').map((o) => o.value)).toEqual(['2026-11-14']);
		const event = Core.validate(d).event!;
		const query = new URL(Core.googleUrl(event)).searchParams;
		expect(query.get('dates')).toBe('20261114T110000Z/20261114T120000Z');
		expect(query.get('details')).toBe(text);
		expect(Core.ics(event, 'november', '20261024T030000Z')).toContain(
			'DTSTART:20261114T110000Z\r\nDTEND:20261114T120000Z'
		);
	});
	it.each([
		'2026.11.14',
		'2026. 11. 14',
		'2026.11. 14',
		'2026. 11.14',
		'2026 . 11 . 14',
		'2026.\t11.\t14',
		'2026-11-14',
		'2026/11/14'
	])('recognizes %s as one explicit token with original UTF-16 evidence', (token) => {
		const source = `🙂 일시: ${token} (토) 20:00~`;
		const d = parse(source, { ...context, referenceInstant: '2031-10-24T03:00:00Z' });
		expect(d.start.value).toBe('2026-11-14 20:00');
		expect(d.suggestions.warnings).not.toContain('weekday-mismatch');
		for (const c of d.suggestions.candidates.filter((c) => c.date)) {
			expect(c.date).toBe('2026-11-14');
			expect(c.inferred).not.toContain('inferred-year');
			expect(source.slice(c.spans[0].start, c.spans[0].end)).toBe(token);
		}
	});
	it('retains weekday mismatch evidence for an explicit source year', () => {
		const d = parse('일시: 2026. 11. 14 (금) 20:00~');
		expect(d.start.value).toBe('2026-11-14 20:00');
		expect(d.suggestions.warnings).toContain('weekday-mismatch');
	});
	it.each([
		'2026. 11.',
		'2026. 11',
		'2026. .14',
		'2026. 13.14',
		'2026. 11.31',
		'2026. 11.140',
		'12026. 11.14',
		'2026. 11.14.1',
		'2026. 11.14 . 1',
		'2026. 11/14/15',
		'26. 11.14',
		'11. 14',
		'version 2026. 11.14',
		'v2026. 11.14'
	])('does not extract partial dates from %s', (token) => {
		const d = parse(`일시: ${token} 20:00~`);
		expect(d.suggestions.candidates.filter((c) => c.date)).toEqual([]);
		expect(d.suggestions.contextDates).toEqual([]);
	});
});

describe('spaced slash and hyphen dates', () => {
	const text = fs.readFileSync(
		'tests/inputs/simple-blues-party-spaced-slash-sanitized.txt',
		'utf8'
	);
	it('associates the labeled date and overnight interval with exact source evidence and exports', () => {
		const d = parse(text);
		expect(d.title.value).toBe('Simple Blues Party 3rd');
		expect(d.start.value).toBe('2026-12-05 23:00');
		expect(d.end.value).toBe('2026-12-06 03:30');
		expect(d.location.value).toBe('쏘셜클럽');
		expect(Core.effectiveZone(d)).toBe('Asia/Seoul');
		expect(d.description).toBe(text);
		for (const field of ['title', 'start', 'end', 'location'] as const)
			expect(d[field].ownership).toBe('auto');
		const start = Core.alternatives(d, 'start').find((c) => c.value === d.start.value)!;
		const end = Core.alternatives(d, 'end').find((c) => c.value === d.end.value)!;
		expect(start.completeness).toBe('complete');
		expect(end.completeness).toBe('complete');
		expect(start.groups.some((g) => end.groups.includes(g))).toBe(true);
		for (const [candidate, clock] of [
			[start, '23:00 '],
			[end, '03:30']
		] as const) {
			for (const token of ['2026 / 12 /05', clock])
				expect(candidate.spans).toContainEqual({
					start: text.indexOf(token),
					end: text.indexOf(token) + token.length
				});
			expect(candidate.inferred).not.toContain('inferred-year');
			expect(candidate.inferred).not.toContain('assumed-end');
		}
		const event = Core.validate(d).event!;
		const query = new URL(Core.googleUrl(event)).searchParams;
		expect(query.get('dates')).toBe('20261205T140000Z/20261205T183000Z');
		expect(query.get('details')).toBe(text);
		const ics = Core.ics(event, 'simple-blues', '20261024T030000Z').replace(/\r\n /g, '');
		expect(ics).toContain('DTSTART:20261205T140000Z\r\nDTEND:20261205T183000Z');
		expect(ics).toContain(
			`DESCRIPTION:${text
				.replace(/\\/g, '\\\\')
				.replace(/([;,])/g, '\\$1')
				.replace(/\n/g, '\\n')}\r\n`
		);
	});
	it.each([
		'2026 / 12 /05',
		'2026/12/05',
		'2026 /12/ 05',
		'2026\t/\t12/\t05',
		'2026 - 12 - 05',
		'2026-12-05',
		'2026- 12 -05',
		'2026\t-12\t-05',
		'2026 . 12 . 05'
	])('retains UTF-16 spans and the explicit year in %s', (token) => {
		const source = `🙂 일자 : ${token}\n시간 : 23:00 - 03:30`;
		const d = parse(source, { ...context, referenceInstant: '2031-10-24T03:00:00Z' });
		expect(d.start.value).toBe('2026-12-05 23:00');
		expect(d.end.value).toBe('2026-12-06 03:30');
		for (const field of ['start', 'end'] as const) {
			const c = Core.alternatives(d, field).find((c) => c.value === d[field].value)!;
			expect(c.spans).toContainEqual({
				start: source.indexOf(token),
				end: source.indexOf(token) + token.length
			});
			expect(c.inferred).not.toContain('inferred-year');
		}
	});
	it.each([
		'26 / 12 /05',
		'26 - 12 -05',
		'12 / 05',
		'12 - 05',
		'2026 / 13 /05',
		'2026 - 02 - 30',
		'2026 / 12 /050',
		'12026 / 12 /05',
		'2026 / 12 /05 / 1',
		'2026 - 12 -05 - 1',
		'version 2026 / 12 /05',
		'v2026 - 12 -05',
		'₩2026 / 12 /05',
		'2026 / 12 /05원',
		'2026 - 12 -05 USD',
		'계좌: 110 - 2026 - 12 -05',
		'https://example.test/2026/12/05',
		'23:00 - 03:30',
		'2026 /\n12 /05'
	])('does not treat numeric noise as a date: %s', (token) => {
		const d = parse(token);
		expect(d.suggestions.candidates.filter((c) => c.date)).toEqual([]);
		expect(d.suggestions.contextDates).toEqual([]);
	});
});

describe('Korean overnight party', () => {
	const text = fs.readFileSync('tests/inputs/overnight-party-sanitized.txt', 'utf8');
	it('auto-resolves the complete event and retains related next-day DJ ranges', () => {
		const d = parse(text);
		expect(d.title.value).toBe('Slow Drag Night 파티 안내!');
		expect(d.start.value).toBe('2026-10-30 23:00');
		expect(d.end.value).toBe('2026-10-31 02:30');
		expect(d.location.value).toBe('봉천살롱댄스홀');
		expect(d.description).toBe(text);
		for (const field of ['title', 'start', 'end', 'location'] as const)
			expect(d[field].ownership).toBe('auto');
		expect(Core.validate(d).event).toBeDefined();
		for (const [start, end] of [
			['2026-10-30 23:00', '2026-10-30 23:30'],
			['2026-10-30 23:30', '2026-10-31 02:00'],
			['2026-10-31 02:00', '2026-10-31 02:30']
		]) {
			expect(
				Core.alternatives(d, 'start').some(
					(s) =>
						s.value === start &&
						Core.alternatives(d, 'end').some(
							(e) => e.value === end && s.groups.some((g) => e.groups.includes(g))
						)
				)
			).toBe(true);
		}
		expect(d.suggestions.candidates.some((c) => /14:(00|30)/.test(c.time))).toBe(false);
		expect(values(d, 'title').some((v) => /^(밤|새벽)$/.test(v))).toBe(false);
		expect(values(d, 'start').some((v) => v.startsWith('2026-10-29'))).toBe(false);
		expect(d.suggestions.contextDates.some((c) => c.value === '2026-10-29')).toBe(true);
		for (const c of d.suggestions.candidates)
			for (const span of c.spans) expect(text.slice(span.start, span.end)).not.toBe('');
		const dawn = Core.alternatives(d, 'end').find((c) => c.value === '2026-10-31 02:30')!;
		expect(dawn.spans.map((s) => text.slice(s.start, s.end))).toContain('새벽 2시 30분');
	});
	it.each([
		['밤 11시 - 새벽 2시', '23:00', '02:00', true],
		['밤 11시 - 11시 30분', '23:00', '23:30', false],
		['새벽 2시 - 2시 30분', '02:00', '02:30', false],
		['오후 11시 - 오전 2시', '23:00', '02:00', true],
		['저녁 11시 - 아침 2시', '23:00', '02:00', true],
		['오전 9시 - 오후 2시', '09:00', '14:00', false],
		['아침 9시 - 저녁 7시', '09:00', '19:00', false],
		['11시 - 밤 11시 30분', '23:00', '23:30', false],
		['오후 11시 - 24:00', '23:00', '00:00', true]
	])('scopes dayparts in %s', (range, start, end, overnight) => {
		const d = parse(`Title: Party\n일자 및 시간: 10월 30일 (금)\n시간: ${range}\n메모: 오후`);
		expect(d.start.value).toBe(`2026-10-30 ${start}`);
		expect(d.end.value).toBe(`2026-10-${overnight ? '31' : '30'} ${end}`);
	});
	it('keeps unqualified clocks ambiguous and genuine competing dates unresolved', () => {
		const ambiguous = parse('Party\n일자: 10월 30일\n시간: 11시 - 2시');
		expect(Core.validate(ambiguous).event).toBeUndefined();
		const competing = parse('Party\n10월 30일\n10월 31일\n밤 11시 - 새벽 2시');
		expect(Core.validate(competing).event).toBeUndefined();
		expect(Core.alternatives(competing, 'start').some((c) => c.completeness === 'complete')).toBe(
			false
		);
	});
	it('limits next-day association to following slots contained by the overall interval', () => {
		const d = parse(
			'Party\n일자: 10월 30일\n새벽 1시 - 새벽 2시\n시간: 밤 11시 - 새벽 2시 30분\n아침 2시 - 아침 8시'
		);
		expect(values(d, 'start')).toContain('2026-10-30 01:00');
		expect(values(d, 'start')).toContain('2026-10-30 02:00');
		expect(values(d, 'start')).not.toContain('2026-10-31 02:00');
	});
	it('retains separate labeled competing event dates and their own ranges', () => {
		const d = parse(
			'Party\n일자 및 시간: 10월 30일\n시간: 밤 11시 - 새벽 2시\n일자 및 시간: 10월 31일\n시간: 오후 7시 - 오후 9시'
		);
		expect(values(d, 'start')).toEqual(
			expect.arrayContaining(['2026-10-30 23:00', '2026-10-31 19:00'])
		);
		expect(values(d, 'end')).toEqual(
			expect.arrayContaining(['2026-10-31 02:00', '2026-10-31 21:00'])
		);
	});
	it.each([
		'https://map.naver.com/p/entry/place/123456789',
		'https://map.kakao.com/link/map/123456789',
		'https://www.google.com/maps/place/Hall',
		'https://maps.app.goo.gl/example'
	])('extracts the exact venue before %s with UTF-16 source offsets', (url) => {
		const source = `🙂 Party\n10월 30일 오후 11시 - 새벽 2시\n장소: 봉천살롱댄스홀 ${url}`;
		const d = parse(source);
		expect(d.location.value).toBe('봉천살롱댄스홀');
		const c = Core.alternatives(d, 'location')[0];
		expect(c.spans.map((s) => source.slice(s.start, s.end))).toEqual(['봉천살롱댄스홀']);
		expect(d.description).toBe(source);
		expect(parse(`Party\n장소: ${url}`).location.value).toBe('');
	});
	it.each([
		'봉천살롱댄스홀 https://example.com/maps',
		'봉천살롱댄스홀 https://map.naver.com.evil.example/place/123',
		'도보 5분 https://map.kakao.com/link/map/123',
		'계좌 123 입금 https://map.naver.com/p/entry/place/123',
		'봉천살롱댄스홀 https://map.kakao.com/link/map/123 추가 안내'
	])('rejects unrelated URL, directions, payment or nontrailing prose: %s', (venue) => {
		expect(parse(`Party\n장소: ${venue}`).location.value).toBe('');
	});
});

describe('reviewed Korean midnight and backward dawn inheritance', () => {
	it.each(['밤 11시 - 밤 12시', '밤 11시 - 12시'])('%s ends at next-day midnight', (range) => {
		const text = `Party\n일자 및 시간: 10월 30일 (금)\n시간: ${range}`;
		const d = parse(text);
		expect(d.start.value).toBe('2026-10-30 23:00');
		expect(d.end.value).toBe('2026-10-31 00:00');
		expect(Core.validate(d).event).toBeDefined();
	});
	it('preserves noon, explicit midnight starts and backward night inheritance', () => {
		for (const [range, start, end] of [
			['오전 11시 - 오후 12시', '11:00', '12:00'],
			['오전 12시 - 새벽 1시', '00:00', '01:00'],
			['00:00 - 01:00', '00:00', '01:00'],
			['11시 - 밤 11시 30분', '23:00', '23:30']
		]) {
			const d = parse(`Party\n일자 및 시간: 10월 30일 (금)\n시간: ${range}`);
			expect(d.start.value).toBe(`2026-10-30 ${start}`);
			expect(d.end.value).toBe(`2026-10-30 ${end}`);
		}
	});
	it.each(['밤 12시 - 새벽 1시', '12시 - 밤 1시'])(
		'requires a date choice for midnight start %s',
		(range) => {
			const d = parse(`Party\n일자 및 시간: 10월 30일 (금)\n시간: ${range}`);
			expect(d.start.value).toBe('');
			expect(Core.validate(d).event).toBeUndefined();
			expect(Core.alternatives(d, 'start')).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						time: '00:00',
						completeness: 'time-only',
						inferred: expect.arrayContaining(['ambiguous-midnight-date'])
					})
				])
			);
		}
	);
	it.each(['', '\n메모: 오후'])(
		'does not infer AM backward from dawn, even with global PM%s',
		(note) => {
			const d = parse(`Party\n일자 및 시간: 10월 30일 (금)\n시간: 11시 - 새벽 2시${note}`);
			expect(d.start.value).toBe('');
			expect(Core.validate(d).event).toBeUndefined();
			expect(
				Core.alternatives(d, 'start').some(
					(c) =>
						c.time === '11:00' &&
						c.completeness === 'time-only' &&
						c.inferred.includes('ambiguous-am-pm')
				)
			).toBe(true);
		}
	);
});

describe('bounded Korean workshop series', () => {
	const text = fs.readFileSync('tests/inputs/bulleted-workshop-sanitized.txt', 'utf8');
	const period = '2026년 11월 1일 ~ 12월 6일 6주간 매주 일요일';
	it('extracts a complete associated first session and source-backed venue through completeParse', () => {
		const pending = Core.describe(Core.create(context), text);
		const output = Core.extract(pending);
		const d = Core.completeParse(pending, Core.parseTicket(pending), output, true);
		expect(d.title.value).toBe('Blues Dance Workshop');
		expect(d.start.value).toBe('2026-11-01 14:00');
		expect(d.end.value).toBe('2026-11-01 16:00');
		expect(d.location.value).toBe('사당 연습실');
		expect(d.description).toBe(text);
		for (const name of ['title', 'start', 'end', 'location'] as const)
			expect(d[name].ownership).toBe('auto');
		const start = output.candidates.find((c) => c.field === 'start' && c.value === d.start.value)!;
		const end = output.candidates.find((c) => c.field === 'end' && c.value === d.end.value)!;
		expect(start.completeness).toBe('complete');
		expect(end.completeness).toBe('complete');
		expect(start.groups.some((g) => end.groups.includes(g))).toBe(true);
		expect(start.spans.map((s) => text.slice(s.start, s.end))).toEqual([
			'2026년 11월 1일',
			'오후 2시 '
		]);
		expect(end.spans.map((s) => text.slice(s.start, s.end))).toContain('4시');
		const venue = output.candidates.find(
			(c) => c.field === 'location' && c.value === '사당 연습실'
		)!;
		expect(venue.spans).toEqual([
			{
				start: text.indexOf('사당 연습실'),
				end: text.indexOf('사당 연습실') + '사당 연습실'.length
			}
		]);
		expect(output.contextDates).toContainEqual(expect.objectContaining({ value: '2026-12-06' }));
		expect(values(d, 'start')).toContain('2026-12-06');
		expect(Core.validate(d).startError).toBe('');
		expect(Core.validate(d).endError).toBe('');
		const event = Core.validate(d).event!;
		const params = new URL(Core.googleUrl(event)).searchParams;
		expect(params.get('dates')).toBe('20261101T050000Z/20261101T070000Z');
		expect(params.get('location')).toBe('사당 연습실');
		expect(params.get('details')).toBe(text);
		const ics = Core.ics(event, 'workshop', '20261024T030000Z').replace(/\r\n /g, '');
		expect(ics).toContain('DTSTART:20261101T050000Z\r\n');
		expect(ics).toContain('DTEND:20261101T070000Z\r\n');
		expect(ics).toContain('LOCATION:사당 연습실\r\n');
		expect(ics).toContain(`DESCRIPTION:${text.replace(/,/g, '\\,').replace(/\n/g, '\\n')}\r\n`);
		expect(ics).not.toContain('RRULE');
		expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
	});
	it.each([
		text.replaceAll('●', '● '),
		text.replace(/●(장소|기간|시간|비용)\n/g, '● $1: '),
		text.replace(/●(장소|기간|시간|비용)\n/g, '$1： '),
		text.replace(/●(장소|기간|시간|비용)/g, '## **$1**'),
		text.replaceAll('\n', '\r\n'),
		text.replace('Blues Dance Workshop', '🙂 Blues Dance Workshop').replaceAll('\n\n', '\n \n\n')
	])('preserves dates, clocks and UTF-16 venue offsets across heading presentation', (source) => {
		const d = parse(source);
		expect(d.start.value).toBe('2026-11-01 14:00');
		expect(d.end.value).toBe('2026-11-01 16:00');
		expect(d.location.value).toBe('사당 연습실');
		const venue = Core.alternatives(d, 'location').find((c) => c.value === '사당 연습실')!;
		expect(venue.spans).toEqual([
			{
				start: source.indexOf('사당 연습실'),
				end: source.indexOf('사당 연습실') + '사당 연습실'.length
			}
		]);
	});
	it.each([
		['2026년 12월 27일 ~ 2027년 1월 31일 6주간 매주 일요일', '2026-12-27', '2027-01-31'],
		['2026년 12월 27일 ~ 1월 31일 6주간 매주 일요일', '2026-12-27', '2027-01-31'],
		['2027년 1월 31일 ~ 3월 7일 6주간 매주 일요일', '2027-01-31', '2027-03-07'],
		['2028년 12월 31일 ~ 2월 4일 6주간 매주 일요일', '2028-12-31', '2029-02-04'],
		['2026.11.01 ~ 2026.12.06 매주 일요일', '2026-11-01', '2026-12-06']
	])('uses calendar-consistent first and final dates in %s', (window, first, last) => {
		const d = parse(text.replace(period, window));
		expect(d.start.value).toBe(`${first} 14:00`);
		expect(d.end.value).toBe(`${first} 16:00`);
		expect(d.suggestions.contextDates.some((c) => c.value === last)).toBe(true);
		expect(values(d, 'start')).toContain(last);
	});
	it.each([
		text.replace('매주 일요일', '매주 토요일'),
		text.replace('12월 6일', '12월 5일'),
		text.replace('6주간 매주 일요일', '5주간 매주 일요일'),
		text.replace('6주간 매주 일요일', '0주간 매주 일요일'),
		text.replace('오후 2시 ~ 4시', '오후 2시 또는 4시'),
		text.replace('6주간 매주 일요일', '6주간'),
		text.replace('6주간 매주 일요일', ''),
		text.replace('2026년 11월 1일 ~ 12월 6일', '2026년 12월 6일 ~ 2026년 11월 1일'),
		text.replace('●시간', '●신청\n참가 안내\n●시간'),
		text.replace('●시간', '다른 모임\n●시간'),
		text.replace('●비용', '추가 일정: 2026년 11월 8일\n●비용'),
		text.replace('●시간', '●시간\n오전 9시 ~ 10시\n●시간'),
		text.replace('오후 2시 ~ 4시', '2시 ~ 4시'),
		text.replace('오후 2시 ~ 4시', '오후'),
		text.replace('오후 2시 ~ 4시', '오후 2시'),
		text.replace('●기간', '기간에 대해')
	])('refuses to auto-pair unbounded, contradictory, ambiguous or unrelated evidence', (source) => {
		const d = parse(source);
		expect(d.start.value).toBe('');
		expect(d.end.value).toBe('');
		expect(Core.validate(d).event).toBeUndefined();
	});
	it('keeps fee and signup dates/clocks out of event evidence and source addresses first', () => {
		const source =
			text.replace('사당 연습실', '사당 연습실\n서울 동작구 동작대로 123') +
			'오전 9시 ~ 10시 2026년 10월 29일\n●신청\n2026년 10월 30일 오후 1시 ~ 3시\nhttps://example.invalid\n';
		const d = parse(source);
		expect(d.location.value).toBe('서울 동작구 동작대로 123');
		expect(values(d, 'location')).toContain('사당 연습실');
		expect(d.start.value).toBe('2026-11-01 14:00');
		expect(d.end.value).toBe('2026-11-01 16:00');
		expect(
			d.suggestions.candidates.some((c) => ['09:00', '10:00', '13:00', '15:00'].includes(c.time))
		).toBe(false);
		expect(
			d.suggestions.candidates.some((c) => ['2026-10-29', '2026-10-30'].includes(c.date))
		).toBe(false);
	});
	it('stops a venue block before period, time, fee and signup headings', () => {
		for (const heading of ['기간', '시간', '비용', '신청']) {
			const d = parse(`Title\n●장소\n●${heading}\n사당 연습실`);
			expect(values(d, 'location')).toEqual([]);
		}
	});
	it('preserves Manual ownership and normal alternative selection', () => {
		let d = Core.create(context);
		for (const name of ['title', 'start', 'end', 'location'] as const)
			d = Core.edit(d, name, 'Mine');
		d = settle(Core.describe(d, text));
		for (const name of ['title', 'start', 'end', 'location'] as const) {
			expect(d[name].value).toBe('Mine');
			expect(d[name].ownership).toBe('manual');
		}
		const start = Core.alternatives(d, 'start').find((c) => c.value === '2026-11-01 14:00')!;
		d = Core.selectCandidate(d, 'start', start.id);
		expect(d.start.value).toBe(start.value);
		expect(d.start.ownership).toBe('manual');
		expect(d.end.value).toBe('Mine');
	});
});
