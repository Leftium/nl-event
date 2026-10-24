import { expect, it } from 'vitest';
import fs from 'node:fs';
import * as Core from '../src/lib/core/EventCore.gen';

const context = { referenceInstant: '2026-10-24T03:00:00Z', browserTimeZone: 'Asia/Seoul' };
const parse = (text: string) => {
	const d = Core.describe(Core.create(context), text);
	return Core.completeParse(d, Core.parseTicket(d), Core.extract(d), true);
};
const timed = () =>
	Core.edit(
		Core.edit(Core.create(context), 'start', '2026-10-25 19:00'),
		'end',
		'2026-10-25 20:45'
	);

it('shows a selected custom duration without changing explicitly chosen dates', () => {
	let d = timed();
	expect(Core.durationValue(d)).toBe(105);
	expect(Core.durationOptions(d).find((o) => o.selected)).toMatchObject({
		amount: 105,
		label: '1h 45m',
		custom: true
	});
	expect(d.end.value).toBe('2026-10-25 20:45');
	d = Core.edit(d, 'start', '2026-10-25 20:00');
	expect(d.end.value).toBe('2026-10-25 20:45');
	expect(Core.durationValue(d)).toBe(45);
});
it('anchors a selected duration to Start until an explicit End replaces it', () => {
	let d = timed();
	const start = d.start;
	d = Core.selectDuration(d, 90);
	expect(d.start).toBe(start);
	expect(d.end.value).toBe('1h 30m');
	expect(d.end.ownership).toBe('manual');
	expect(Core.validate(d).endValue).toBe('2026-10-25 20:30');
	d = Core.edit(d, 'start', '2026-10-25 20:00');
	expect(Core.validate(d).endValue).toBe('2026-10-25 21:30');
	d = Core.edit(d, 'end', '2026-10-25 22:00');
	expect(Core.durationOptions(d).find((o) => o.selected)?.amount).toBe(120);
	d = Core.edit(d, 'start', '2026-10-25 21:00');
	expect(Core.validate(d).endValue).toBe('2026-10-25 22:00');
});
it('adds positive durations from complete End suggestions and deduplicates presets', () => {
	const d = parse(fs.readFileSync('tests/inputs/rhythm-party-user.txt', 'utf8'));
	const options = Core.durationOptions(d);
	expect(options.map((o) => o.amount)).toEqual([15, 30, 60, 90, 120, 180, 240, 270]);
	expect(options.find((o) => o.amount === 270)).toMatchObject({ selected: true, custom: false });
	expect(options.find((o) => o.amount === 270)?.source).toContain('03:30');
	expect(options.find((o) => o.amount === 90)?.source).toContain('00:30');
	const moved = Core.edit(d, 'start', '2026-08-15 04:00');
	expect(Core.durationOptions(moved).every((o) => o.source === '')).toBe(true);
});
it('uses elapsed time across DST and suppresses calculations for unresolved or invalid ranges', () => {
	let d = Core.setZone(Core.create(context), 'America/Chicago');
	d = Core.edit(Core.edit(d, 'start', '2026-03-08 01:30'), 'end', '2026-03-08 03:30');
	expect(Core.durationValue(d)).toBe(60);
	d = Core.selectDuration(d, 120);
	expect(Core.validate(d).endValue).toBe('2026-03-08 04:30');
	d = Core.edit(Core.edit(d, 'start', '2026-11-01 01:30'), 'end', '2026-11-01 01:30');
	expect(Core.durationValue(d)).toBe(0);
	expect(Core.durationOptions(d).some((o) => o.selected)).toBe(false);
	expect(Core.selectDuration(d, 60)).toBe(d);
	d = Core.chooseOffset(Core.chooseOffset(d, 'start', '-05:00'), 'end', '-06:00');
	expect(Core.durationValue(d)).toBe(60);
	d = Core.edit(d, 'end', '2026-10-31 12:00');
	expect(Core.durationValue(d)).toBe(0);
});
it('anchors all-day durations in inclusive calendar days and exports exclusive bounds', () => {
	let d = Core.setAllDay(timed(), true);
	expect(Core.durationOptions(d).map((o) => o.amount)).toEqual([1, 2, 3, 7]);
	expect(Core.durationValue(d)).toBe(1);
	d = Core.selectDuration(d, 2);
	expect(d.end.value).toBe('2 days');
	expect(Core.validate(d).endValue).toBe('2026-10-26');
	d = Core.edit(d, 'start', '2026-10-26');
	expect(Core.validate(d).endValue).toBe('2026-10-27');
	const event = Core.validate(d).event!;
	expect(new URL(Core.googleUrl(event)).searchParams.get('dates')).toBe('20261026/20261028');
	expect(Core.ics(event, 'duration-test', '20261024T030000Z')).toContain(
		'DTEND;VALUE=DATE:20261028'
	);
	d = Core.edit(d, 'end', '5 days');
	expect(Core.durationOptions(d).find((o) => o.selected)).toMatchObject({
		amount: 5,
		custom: true
	});
});
it('keeps Manual duration through reparses and restores Auto on reset', () => {
	let d = Core.selectDuration(parse('Tomorrow at 7pm'), 120);
	const changed = Core.describe(d, 'Tomorrow at 8pm');
	d = Core.completeParse(changed, Core.parseTicket(changed), Core.extract(changed), true);
	expect(d.end.value).toBe('2h');
	expect(Core.validate(d).endValue).toBe('2026-10-25 22:00');
	d = Core.reset(d, 'end');
	expect(Core.durationValue(d)).toBe(60);
	expect(d.end.ownership).toBe('auto');
});

it('caps source-derived durations at one day while retaining longer selected custom values', () => {
	let d = parse(fs.readFileSync('tests/inputs/slow-saturday-user.txt', 'utf8'));
	const options = Core.durationOptions(d);
	expect(options).toHaveLength(8);
	expect(options.every((o) => o.amount <= 1440)).toBe(true);
	expect(options.filter((o) => o.source).map((o) => o.amount)).toEqual([90, 240, 390]);
	d = Core.edit(d, 'end', '2026-07-06 17:00');
	expect(Core.durationOptions(d).find((o) => o.selected)).toMatchObject({
		amount: 2910,
		custom: true
	});
	expect(Core.validate(d).event).toBeDefined();
	d = Core.setAllDay(d, true);
	expect(
		Core.durationOptions(d)
			.filter((o) => o.source)
			.every((o) => o.amount <= 1)
	).toBe(true);
});
it('does not derive durations from ambiguous source clocks in all-day mode', () => {
	let d = parse('October 25, 2026 at 7:30 - 9:30');
	d = Core.setAllDay(Core.edit(d, 'start', '2026-10-25'), true);
	expect(Core.durationOptions(d).every((o) => o.source === '')).toBe(true);
});
it('supports typed day counts with an implicit all-day Start and rejects overflowing counts', () => {
	let d = Core.edit(Core.edit(Core.create(context), 'start', '2026-10-25'), 'end', '2 days');
	expect(Core.validate(d).event).toMatchObject({
		allDay: true,
		start: '20261025',
		end: '20261027'
	});
	for (const value of ['4294967297 days', '4294967297 weeks', '0 days', '-1 days']) {
		d = Core.edit(d, 'end', value);
		expect(Core.validate(d).event).toBeUndefined();
	}
});
