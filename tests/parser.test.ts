import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import * as Core from '../src/lib/core/EventCore.gen';

const context = { referenceInstant: '2026-10-24T03:00:00Z', browserTimeZone: 'Asia/Seoul' };
const parse = (text: string, ctx = context, override?: string) => {
	const draft = Core.describe(Core.setZone(Core.create(ctx), override), text);
	return Core.completeParse(draft, Core.parseTicket(draft), Core.extract(draft), true);
};
const settle = (draft: Core.draft, apply = true) =>
	Core.completeParse(draft, Core.parseTicket(draft), Core.extract(draft), apply);
const values = (draft: Core.draft, field: Core.fieldName) =>
	Core.alternatives(draft, field).map((c) => c.value);

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
		for (const c of draft.suggestions.candidates)
			for (const span of c.spans)
				expect(text.slice(span.start, span.end).length).toBeGreaterThan(0);
	});
}

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
