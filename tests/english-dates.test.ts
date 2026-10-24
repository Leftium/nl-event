import { describe, expect, it, vi } from 'vitest';
import * as Core from '../src/lib/core/EventCore.gen';
import { recognizeEnglishDates } from '../src/lib/core/englishDatesAdapter';

const context = { referenceInstant: '2026-10-24T03:00:00Z', browserTimeZone: 'Asia/Seoul' };
const parse = (
	text: string,
	instant = context.referenceInstant,
	zone = context.browserTimeZone
) => {
	const draft = Core.describe(
		Core.create({ referenceInstant: instant, browserTimeZone: zone }),
		text
	);
	return Core.completeParse(draft, Core.parseTicket(draft), Core.extract(draft), true);
};

describe('English recognition with ReScript precision policy', () => {
	it.each([
		['sleep tonight', '2026-10-24'],
		['sleep tomorrow night', '2026-10-25'],
		['sleep tomorrow morning', '2026-10-25'],
		['sleep tomorrow afternoon', '2026-10-25'],
		['sleep tomorrow evening', '2026-10-25']
	])('retains %s as a date and vague period', (text, date) => {
		const d = parse(text);
		expect(Core.alternatives(d, 'start')).toEqual([
			expect.objectContaining({ date, time: '', completeness: 'date-only' })
		]);
		expect(d.start.value).toBe('');
		expect(Core.validate(d).event).toBeUndefined();
		expect(Core.partialLabels(d, 'start')[0]).toContain('no exact time');
		expect(Core.temporalOptions(d, 'start', 'time').every((c) => c.generated)).toBe(true);
	});

	it.each([
		['2026-10-24T03:00:00Z', '2026-11'],
		['2026-12-31T03:00:00Z', '2027-01'],
		['2027-01-31T03:00:00Z', '2027-02']
	])('keeps next month unresolved from %s', (instant, month) => {
		const d = parse('cancel netflix next month', instant);
		expect(Core.alternatives(d, 'start')).toEqual([
			expect.objectContaining({ value: month, date: '', time: '', completeness: 'month-only' })
		]);
		expect(d.start.value).toBe('');
		expect(Core.validate(d).event).toBeUndefined();
		expect(Core.partialLabels(d, 'start')).toEqual([`${month}: day unresolved`]);
		for (const part of ['date', 'time'] as const)
			expect(Core.temporalOptions(d, 'start', part).every((c) => c.generated)).toBe(true);
		// Even when Tomorrow happens to be the first, choosing it is an explicit,
		// generic Manual choice, never evidence extracted from "next month".
		const generic = Core.temporalOptions(d, 'start', 'date')[0];
		const completed = Core.selectTemporalPart(d, 'start', 'date', generic.value);
		expect(completed.start.ownership).toBe('manual');
		expect(completed.selections[0].candidate.inferred).toContain('generated-date');
		expect(completed.selections[0].candidate.spans).toEqual([]);
	});

	it.each([
		['2026-10-24T03:00:00Z', '2026-11-05'],
		['2026-12-31T03:00:00Z', '2027-01-05'],
		['2027-01-31T03:00:00Z', '2027-02-05']
	])('resolves the 5th of next month from %s', (instant, date) => {
		const d = parse('cancel netflix on the 5th of next month', instant);
		expect(d.start.value).toBe(`${date} 09:00`);
		expect(Core.alternatives(d, 'start')[0].inferred).toContain('inferred-time');
	});

	it('anchors dates at event-local midnight, including a different month/year', () => {
		const instant = '2026-12-31T15:00:00Z';
		expect(Core.alternatives(parse('sleep tonight', instant), 'start')[0].date).toBe('2027-01-01');
		expect(
			Core.alternatives(parse('sleep tonight', instant, 'America/Chicago'), 'start')[0].date
		).toBe('2026-12-31');
		expect(Core.partialLabels(parse('cancel netflix next month', instant), 'start')).toEqual([
			'2027-02: day unresolved'
		]);
		expect(
			Core.partialLabels(parse('cancel netflix next month', instant, 'America/Chicago'), 'start')
		).toEqual(['2027-01: day unresolved']);
	});

	it('pairs explicit overnight clocks and exports the same bounds', () => {
		const d = parse('tonight from 11pm to 1am', '2026-12-31T03:00:00Z');
		expect(d.start.value).toBe('2026-12-31 23:00');
		expect(d.end.value).toBe('2027-01-01 01:00');
		const event = Core.validate(d).event!;
		expect(Core.googleUrl(event)).toContain('20261231T140000Z%2F20261231T160000Z');
		expect(Core.ics(event, 'stable', '20261231T030000Z')).toContain(
			'DTSTART:20261231T140000Z\r\nDTEND:20261231T160000Z'
		);
	});

	it('leaves Chicago DST gap and overlap validation to the core', () => {
		const gap = parse('tonight from 1am to 2:30am', '2026-03-08T12:00:00Z', 'America/Chicago');
		expect(Core.validate(gap).endError).toContain('DST gap');
		const overlap = parse('tonight from 1am to 2:30am', '2026-11-01T12:00:00Z', 'America/Chicago');
		expect(Core.validate(overlap).startChoices.map((c) => c.offset)).toEqual(['-05:00', '-06:00']);
		expect(Core.validate(overlap).event).toBeUndefined();
	});

	it('preserves UTF-16 source offsets and repeated occurrences', () => {
		const text = '안녕 😀 sleep tonight\nsleep tonight';
		const d = parse(text);
		const candidate = Core.alternatives(d, 'start')[0];
		expect(candidate.spans.map((s) => text.slice(s.start, s.end))).toEqual(['tonight', 'tonight']);
		expect(candidate.spans[0].start).toBe(text.indexOf('tonight'));
		expect(candidate.groups).toHaveLength(2);
	});

	it('keeps partial precision and original spans with ordinary punctuation', () => {
		for (const punctuation of ['.', '!', ',', '?']) {
			const text = `안녕 😀 sleep tonight${punctuation}`;
			const d = parse(text);
			expect(d.start.value).toBe('');
			const c = Core.alternatives(d, 'start')[0];
			expect(c.date).toBe('2026-10-24');
			expect(c.spans.map((s) => text.slice(s.start, s.end))).toEqual(['tonight']);
		}
		const d = parse('cancel netflix next month.');
		expect(Core.partialLabels(d, 'start')).toEqual(['2026-11: day unresolved']);
		expect(d.start.value).toBe('');
	});

	it('keeps contextual months and periods away from event boundaries', () => {
		const d = parse('sleep tonight\nDeadline: tomorrow night\nFee: next month\nSeason: next month');
		expect(Core.alternatives(d, 'start').map((c) => c.date)).toEqual(['2026-10-24']);
		expect(Core.validate(d).event).toBeUndefined();
		expect(d.suggestions.contextDates.map((c) => c.value)).toContain('2026-10-25');
	});

	it('does not fabricate a default event from contextual partial months or invalid days', () => {
		for (const text of [
			'Fee: next month',
			'Season: next month',
			'Deadline: next month',
			'cancel netflix on the 31st of next month'
		]) {
			const d = parse(text, '2027-01-31T03:00:00Z');
			expect(d.start.value).toBe('');
			expect(Core.validate(d).event).toBeUndefined();
		}
	});

	it('uses source and override zones before recognizing relative days', () => {
		const text = 'sleep tonight\nTime zone: America/Chicago';
		const d = parse(text, '2026-12-31T15:00:00Z');
		expect(Core.alternatives(d, 'start')[0].date).toBe('2026-12-31');
		const override = Core.setZone(d, 'Asia/Seoul');
		const next = Core.completeParse(
			override,
			Core.parseTicket(override),
			Core.extract(override),
			true
		);
		expect(Core.alternatives(next, 'start')[0].date).toBe('2027-01-01');
	});

	it('does not borrow a different activity date for a month-only clock', () => {
		const d = parse('cancel netflix next month at 7pm\nParty tomorrow at 8pm');
		expect(Core.alternatives(d, 'start').some((c) => c.value === '2026-10-25 19:00')).toBe(false);
		expect(d.start.value).toBe('2026-10-25 20:00');
	});

	it('retains complete source preference and mixed-language recognition', () => {
		const d = parse('sleep tonight\nWhen: 내일 오후 7시~9시');
		expect(d.start.value).toBe('2026-10-25 19:00');
		expect(d.end.value).toBe('2026-10-25 21:00');
		expect(Core.alternatives(d, 'start').some((c) => c.completeness === 'date-only')).toBe(true);
	});

	it('does not recognize names as dates or replace the existing fallback', () => {
		for (const text of ['Tomorrowland', 'Tonightland', 'cancel netflix']) {
			const d = parse(text);
			expect(Core.alternatives(d, 'start')).toEqual([]);
			expect(d.start.value).toBe('2026-10-25');
		}
	});

	it('preserves Manual fields, UID and stale context guards', () => {
		let d = Core.withUid(parse('sleep tonight'), 'stable');
		d = Core.edit(d, 'start', '2026-11-12 12:00');
		d = Core.describe(d, 'cancel netflix next month');
		const ticket = Core.parseTicket(d);
		const output = Core.extract(d);
		const next = Core.completeParse(d, ticket, output, true);
		expect(next.start.value).toBe('2026-11-12 12:00');
		expect(next.uid).toBe('stable');
		expect(Core.reset(next, 'start').start.value).toBe('');
		const changed = Core.setZone(d, 'America/Chicago');
		expect(Core.completeParse(changed, ticket, output, true)).toBe(changed);
	});

	it('bounds recognition failures without disabling deterministic English/Korean', async () => {
		expect(recognizeEnglishDates('tonight', 'invalid', 'Asia/Seoul')).toEqual([]);
		vi.resetModules();
		vi.doMock('compromise', () => ({
			default: {
				extend: () => () => {
					throw new Error('dependency failure');
				}
			}
		}));
		try {
			const isolated = await import('../src/lib/core/EventCore.gen');
			const d = isolated.describe(isolated.create(context), 'When: 내일 오후 7시~9시');
			expect(isolated.extract(d).candidates.some((c) => c.value === '2026-10-25 19:00')).toBe(true);
		} finally {
			vi.doUnmock('compromise');
			vi.resetModules();
		}
	});
});
