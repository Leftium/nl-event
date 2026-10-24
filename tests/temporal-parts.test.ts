import { expect, it } from 'vitest';
import fs from 'node:fs';
import * as Core from '../src/lib/core/EventCore.gen';
const context = { referenceInstant: '2026-10-24T03:00:00Z', browserTimeZone: 'Asia/Seoul' };
const settle = (d: Core.draft) => Core.completeParse(d, Core.parseTicket(d), Core.extract(d), true);
const parse = (text: string) => settle(Core.describe(Core.create(context), text));

it('deduplicates the series and retains secondary dates outside Auto ranking', () => {
	let d = parse(fs.readFileSync('tests/inputs/slow-saturday-user.txt', 'utf8'));
	expect(Core.temporalOptions(d, 'start', 'date')).toHaveLength(12);
	expect(Core.temporalOptions(d, 'start', 'time').map((o) => o.value)).toEqual([
		'16:30',
		'18:00',
		'20:30'
	]);
	expect(Core.temporalParts(d, 'start')).toEqual({ date: '2026-07-04', time: '16:30' });
	const end = d.end;
	d = Core.selectTemporalPart(d, 'start', 'date', '2026-07-11');
	expect(d.start.value).toBe('2026-07-11 16:30');
	expect(d.start.ownership).toBe('manual');
	expect(d.start.input).toContain('16:30');
	expect(d.end).toBe(end);
	d = Core.selectTemporalPart(d, 'end', 'date', '2026-07-11');
	expect(Core.validate(d).event?.start).toBe('20260711T073000Z');
	d = Core.selectTemporalPart(d, 'start', 'time', '18:00');
	expect(d.start.value).toBe('2026-07-11 18:00');
	expect(d.end.value).toBe('2026-07-11 18:00');
	expect(Core.validate(d).event).toBeUndefined();
});
it('selects the natural time for a date and preserves that date when changing time', () => {
	let d = parse('October 25, 2026 at 7pm\nOctober 26, 2026 at 8pm');
	const end = d.end;
	d = Core.selectTemporalPart(d, 'start', 'date', '2026-10-26');
	expect(Core.temporalParts(d, 'start')).toEqual({ date: '2026-10-26', time: '20:00' });
	expect(Core.validate(d).startError).toBe('');
	expect(d.end).toBe(end);
	expect(Core.evidenceWarnings(d, 'start')).toEqual([]);
	d = Core.selectTemporalPart(d, 'start', 'time', '19:00');
	expect(d.start.value).toBe('2026-10-26 19:00');
	expect(d.start.input).toBe('October 26, 2026 7pm');
	expect(Core.evidenceWarnings(d, 'start').join(' ')).toContain('Not paired in source');
	d = Core.selectTemporalPart(d, 'start', 'time', '20:00');
	expect(Core.temporalParts(d, 'start')).toEqual({ date: '2026-10-26', time: '20:00' });
	expect(Core.evidenceWarnings(d, 'start')).toEqual([]);
	expect(d.start.input).toBe('October 26, 2026 at 8pm');
});
it('allows time-only evidence to complete a manually supplied date without borrowing its sibling', () => {
	let d = parse('Practice 16:30~18:00');
	d = Core.edit(d, 'start', '2026-10-25 15:00');
	d = Core.selectTemporalPart(d, 'start', 'time', '16:30');
	expect(d.start.value).toBe('2026-10-25 16:30');
	expect(d.end.value).toBe('');
});
it('allows explicit composition of partial evidence while preserving ambiguous AM/PM', () => {
	let d = parse('October 25, 2026\nOctober 26, 2026\nPractice 16:30~18:00');
	d = Core.selectTemporalPart(d, 'start', 'date', '2026-10-25');
	d = Core.selectTemporalPart(d, 'start', 'time', '16:30');
	expect(Core.temporalParts(d, 'start')).toEqual({ date: '2026-10-25', time: '16:30' });
	expect(Core.validate(d).startError).toBe('');
	d = Core.selectTemporalPart(d, 'end', 'date', '2026-10-25');
	expect(Core.validate(d).event).toBeDefined();
	d = parse('Tomorrow at 7:30');
	d = Core.selectTemporalPart(d, 'start', 'date', '2026-10-25');
	d = Core.selectTemporalPart(d, 'start', 'time', '07:30');
	expect(Core.validate(d).event).toBeUndefined();
});
it('retains Manual composition through reparses and resets to the current Auto candidate', () => {
	let d = parse('October 25, 2026 at 7pm\nOctober 26, 2026 at 8pm');
	d = Core.selectTemporalPart(d, 'start', 'date', '2026-10-26');
	d = Core.selectTemporalPart(d, 'start', 'time', '20:00');
	d = settle(Core.describe(d, 'Tomorrow at 9pm'));
	expect(d.start.value).toBe('2026-10-26 20:00');
	expect(Core.evidenceWarnings(d, 'start').join(' ')).toContain('earlier Description');
	expect(Core.selectTemporalPart(d, 'start', 'date', '2026-10-26')).toBe(d);
	d = Core.reset(d, 'start');
	expect(Core.temporalParts(d, 'start')).toEqual({ date: '2026-10-25', time: '21:00' });
});
it('preserves all-day semantics and invalidates DST offset choices when a component changes', () => {
	let d = parse('All day October 25, 2026 - October 26, 2026');
	d = Core.selectTemporalPart(d, 'start', 'date', '2026-10-25');
	expect(Core.validate(d).allDay).toBe(true);
	expect(Core.validate(d).event).toBeDefined();
	d = settle(
		Core.setZone(
			parse('November 1, 2026 at 1:30 am\nNovember 2, 2026 at 1:30 am'),
			'America/Chicago'
		)
	);
	d = Core.chooseOffset(d, 'start', '-06:00');
	d = Core.selectTemporalPart(d, 'start', 'date', '2026-11-02');
	expect(d.start.offset).toBe('');
	expect(d.start.value).toBe('2026-11-02 01:30');
});

it('allows fee and deadline dates to be explicitly combined without changing Auto defaults', () => {
	let d = parse(fs.readFileSync('tests/inputs/rhythm-party-user.txt', 'utf8'));
	expect(d.start.value).toBe('2026-08-14 23:00');
	const option = Core.temporalOptions(d, 'start', 'date').find((o) => o.value === '2026-08-12');
	expect(option?.source).toContain('파티비');
	expect(option?.source).toContain('8/12');
	d = Core.selectTemporalPart(d, 'start', 'date', '2026-08-12');
	expect(d.start.value).toBe('2026-08-12');
	expect(Core.validate(d).allDay).toBe(true);
	d = Core.selectTemporalPart(d, 'end', 'date', '2026-08-12');
	expect(d.end.value).toBe('2026-08-12');
	expect(Core.validate(d).event).toBeDefined();
	d = Core.selectTemporalPart(d, 'start', 'time', '00:30');
	expect(d.start.value).toBe('2026-08-12 00:30');
	d = Core.selectTemporalPart(d, 'end', 'time', '03:30');
	expect(Core.validate(d).allDay).toBe(false);
	expect(Core.validate(d).event).toBeDefined();
	expect(new URL(Core.googleUrl(Core.validate(d).event!)).searchParams.get('dates')).toBe(
		'20260811T153000Z/20260811T183000Z'
	);
	d = Core.reset(d, 'start');
	expect(d.start.value).toBe('2026-08-14 23:00');
});

it('sorts clock alternatives by time rather than source rank', () => {
	const d = parse(fs.readFileSync('tests/inputs/rhythm-party-user.txt', 'utf8'));
	for (const name of ['start', 'end'] as const) {
		const times = Core.temporalOptions(d, name, 'time').map((o) => o.value);
		expect(times).toEqual([...times].sort());
	}
});

it('marks time pairing relative to the chosen date without restricting selection', () => {
	let d = parse('October 25, 2026 at 7pm\nOctober 26, 2026 at 8pm');
	d = Core.selectTemporalPart(d, 'start', 'date', '2026-10-26');
	const options = Core.temporalOptions(d, 'start', 'time');
	expect(options.find((o) => o.value === '20:00')?.paired).toBe(true);
	expect(options.find((o) => o.value === '19:00')?.paired).toBe(false);
	expect(options.find((o) => o.value === '20:00')?.source).toBe('October 26, 2026 at 8pm');
	d = Core.selectTemporalPart(d, 'start', 'time', '19:00');
	expect(Core.temporalOptions(d, 'start', 'time').find((o) => o.selected)?.paired).toBe(false);
	expect(d.start.value).toBe('2026-10-26 19:00');
	d = Core.selectTemporalPart(d, 'start', 'date', '2026-10-25');
	expect(Core.temporalOptions(d, 'start', 'time').find((o) => o.selected)?.paired).toBe(true);
	const undated = parse('Practice 16:30~18:00');
	expect(Core.temporalOptions(undated, 'start', 'time').every((o) => o.paired === undefined)).toBe(
		true
	);
});

it('sorts date chips chronologically including secondary source dates', () => {
	const d = parse(fs.readFileSync('tests/inputs/rhythm-party-user.txt', 'utf8'));
	for (const name of ['start', 'end'] as const) {
		expect(Core.temporalOptions(d, name, 'date').map((o) => o.value)).toEqual([
			'2026-08-12',
			'2026-08-14',
			'2026-08-15'
		]);
	}
	expect(d.start.value).toBe('2026-08-14 23:00');
});

// These regressions protect generated/source provenance and ownership boundaries.
it('offers dates without inventing Auto evidence and completes an inclusive all-day day', () => {
	let d = parse('cancel netflix');
	expect(Core.validate(d).allDay).toBe(true);
	expect(Core.validate(d).event).toBeUndefined();
	expect(d.start.value).toBe('');
	expect(d.suggestions.candidates.every((c) => !c.inferred.includes('generated-suggestion'))).toBe(
		true
	);
	expect(
		Core.temporalOptions(d, 'start', 'date').map((o) => [o.label, o.value, o.generated])
	).toEqual([
		['Today', '2026-10-24', true],
		['Tomorrow', '2026-10-25', true],
		['In 7 days', '2026-10-31', true]
	]);
	const end = d.end;
	d = Core.selectTemporalPart(d, 'start', 'date', '2026-10-25');
	expect(d.end).toBe(end);
	expect(d.start.ownership).toBe('manual');
	expect(d.selections[0].candidate.spans).toEqual([]);
	expect(Core.validate(d).event).toMatchObject({
		allDay: true,
		start: '20261025',
		end: '20261026'
	});
	expect(Core.googleUrl(Core.validate(d).event!)).toContain('20261025%2F20261026');
	expect(Core.ics(Core.validate(d).event!, 'test', '20261024T030000Z')).toContain(
		'DTEND;VALUE=DATE:20261026'
	);
	d = Core.selectDuration(d, 3);
	expect(Core.validate(d).event?.end).toBe('20261028');
	d = settle(Core.describe(d, 'cancel subscription'));
	expect(Core.validate(d).event?.start).toBe('20261025');
	d = Core.reset(d, 'start');
	expect(d.start.value).toBe('');
	expect(Core.validate(d).event).toBeUndefined();
	expect(Core.temporalOptions(Core.create(context), 'start', 'date')).toEqual([]);
	expect(Core.validate(parse('tomorrow evening')).allDay).toBe(false);
});

it('keeps inferred 09:00 and offers common clocks with a relative inferred End', () => {
	let d = parse('workout tomorrow');
	expect(d.start.value).toBe('2026-10-25 09:00');
	const clocks = Core.temporalOptions(d, 'start', 'time');
	expect(clocks.map((o) => o.value)).toEqual(['07:00', '09:00', '12:00', '18:00', '19:00']);
	expect(clocks.find((o) => o.value === '09:00')?.note).toBe('inferred time');
	const end = d.end;
	d = Core.selectTemporalPart(d, 'start', 'time', '18:00');
	expect(d.end).toBe(end);
	expect(d.end.ownership).toBe('auto');
	expect(Core.validate(d).event).toMatchObject({
		start: '20261025T090000Z',
		end: '20261025T100000Z'
	});
	expect(Core.evidenceWarnings(d, 'start')).toEqual([]);
	d = Core.edit(d, 'end', '2026-10-25 20:00');
	const manualEnd = d.end;
	d = Core.selectTemporalPart(d, 'start', 'time', '19:00');
	expect(d.end).toBe(manualEnd);
	expect(Core.validate(d).endValue).toBe('2026-10-25 20:00');
	expect(
		Core.temporalOptions(parse('workout tomorrow at 8pm'), 'start', 'time').map((o) => o.value)
	).toEqual(['20:00']);
	let undated = parse('cancel netflix');
	undated = Core.selectTemporalPart(undated, 'start', 'time', '19:00');
	expect(Core.temporalParts(undated, 'start')).toEqual({ date: '', time: '19:00' });
	expect(Core.validate(undated).event).toBeUndefined();
});

it('defaults a single labeled deadline separately from undated class clocks', () => {
	let d = parse('Registration deadline: October 20, 2026\nClass 1: 12:15 - 1:15 pm');
	expect(Core.validate(d).event).toMatchObject({
		allDay: true,
		start: '20261020',
		end: '20261021'
	});
	expect(Core.validate(d).warnings).toContain('Start is in the past.');
	expect(d.title.value).toContain('Registration deadline');
	expect(Core.temporalOptions(d, 'start', 'time').map((o) => o.value)).toEqual(['12:15']);
	expect(Core.temporalOptions(d, 'end', 'time').map((o) => o.value)).toEqual(['13:15']);
	expect(Core.alternatives(d, 'start').find((c) => c.time === '12:15')?.date).toBe('');
	d = Core.selectTemporalPart(d, 'start', 'time', '12:15');
	expect(d.start.value).toBe('2026-10-20 12:15');
	expect(Core.evidenceWarnings(d, 'start')).toContain('Not paired in source');
	d = Core.selectTemporalPart(d, 'end', 'time', '13:15');
	expect(Core.validate(d).event?.allDay).toBe(false);
	for (const text of [
		'Registration deadline: October 20, 2026\nDeadline: October 21, 2026',
		'Registration deadline: October 20, 2026\nSeason: October 1, 2026 - October 31, 2026',
		'Registration deadline: October 20, 2026 at 5pm',
		'Fee: October 20, 2026'
	])
		expect(Core.validate(parse(text)).event).toBeUndefined();
});

it('anchors generated dates in the effective zone and revalidates generated clocks at DST', () => {
	const ctx = { ...context, referenceInstant: '2026-03-08T00:30:00Z' };
	let d = settle(Core.describe(Core.create(ctx), 'cancel netflix'));
	d = settle(Core.setZone(d, 'America/Chicago'));
	expect(Core.temporalOptions(d, 'start', 'date')[0].value).toBe('2026-03-07');
	d = Core.selectTemporalPart(d, 'start', 'date', '2026-03-08');
	d = Core.selectTemporalPart(d, 'start', 'time', '07:00');
	expect(Core.validate(d).startValue).toBe('2026-03-08 07:00');
	const start = d.start;
	d = settle(Core.setZone(d, 'Asia/Seoul'));
	expect(d.start).toEqual(start);
	expect(Core.temporalOptions(d, 'start', 'date')[0].value).toBe('2026-03-08');
	d = Core.selectTemporalPart(d, 'start', 'time', '09:00');
	expect(Core.temporalParts(d, 'start')).toEqual({ date: '2026-03-08', time: '09:00' });
});
