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
	expect(d.location.value).toBe('해피홀(Happy Hall) 서울 서대문구 명물길 37 지하1층');
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
