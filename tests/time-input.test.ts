import { expect, it } from 'vitest';
import * as Core from '../src/lib/core/EventCore.gen';
const context = { referenceInstant: '2026-10-24T03:00:00Z', browserTimeZone: 'Asia/Seoul' };
const make = (start: string, end: string) =>
	Core.edit(Core.edit(Core.create(context), 'start', start), 'end', end);

it.each([
	['tomorrow at 7pm', 'tomorrow at 8pm', '2026-10-25 19:00', '2026-10-25 20:00'],
	['내일 오후 5시', '내일 오후 6시', '2026-10-25 17:00', '2026-10-25 18:00'],
	['Oct 25, 2026 at 5pm', 'October 25 at 6pm', '2026-10-25 17:00', '2026-10-25 18:00'],
	['2026-10-25T17:00', '2026-10-25 18:00', '2026-10-25 17:00', '2026-10-25 18:00'],
	['all day tomorrow', 'all day day after tomorrow', '2026-10-25', '2026-10-26'],
	['tomorrow 7pm - 9pm', 'tomorrow 7pm - 9pm', '2026-10-25 19:00', '2026-10-25 21:00']
])('interprets freeform %s / %s without rewriting input', (start, end, startValue, endValue) => {
	const draft = make(start, end),
		result = Core.validate(draft);
	expect(result.startValue).toBe(startValue);
	expect(result.endValue).toBe(endValue);
	expect(result.startError).toBe('');
	expect(result.endError).toBe('');
	expect(result.event).toBeDefined();
	expect(draft.start.value).toBe(start);
	expect(draft.end.value).toBe(end);
	expect(draft.start.ownership).toBe('manual');
	const event = result.event!;
	expect(new URL(Core.googleUrl(event)).searchParams.get('dates')).toBe(
		`${event.start}/${event.end}`
	);
	expect(Core.ics(event, 'freeform', '20261024T030000Z')).toContain(
		`DTSTART${event.allDay ? ';VALUE=DATE' : ''}:${event.start}`
	);
});
it.each([
	['tomorrow evening', 'time missing'],
	['7pm', 'date missing'],
	['tomorrow 7:30', 'AM or PM'],
	['nonsense', 'Could not interpret'],
	['October 25 at 7pm\nOctober 26 at 7pm', 'multiple'],
	['2026-10-25T17:00Z', 'local time']
])('shows actionable validation for %s', (text, message) => {
	const result = Core.validate(make(text, '2026-10-25 20:00'));
	expect(result.startError).toContain(message);
	expect(result.event).toBeUndefined();
});
it('keeps freeform DST overlaps explicit and uses the chosen instant', () => {
	let d = Core.setZone(
		make('November 1, 2026 at 1:30 am', 'November 1, 2026 at 2:30 am'),
		'America/Chicago'
	);
	expect(Core.validate(d).startChoices.map((c) => c.offset)).toEqual(['-05:00', '-06:00']);
	expect(Core.validate(d).event).toBeUndefined();
	d = Core.chooseOffset(d, 'start', '-06:00');
	expect(Core.validate(d).event?.start).toBe('20261101T073000Z');
	expect(d.start.value).toBe('November 1, 2026 at 1:30 am');
	expect(Core.validate(Core.edit(d, 'start', 'March 8, 2026 at 2:30 am')).startError).toContain(
		'DST gap'
	);
});
it('uses the effective event zone for freeform relative dates', () => {
	const d = Core.setZone(make('tomorrow at 7pm', 'tomorrow at 8pm'), 'America/Chicago');
	expect(Core.validate(d).startValue).toBe('2026-10-24 19:00');
});
it('keeps canonical invalid dates invalid instead of repairing them through freeform parsing', () => {
	for (const text of ['0000-10-25 17:00', '2026-02-29 17:00', '2026-10-25 24:00'])
		expect(Core.validate(make(text, '2026-10-25 20:00')).event).toBeUndefined();
});

it('keeps freeform fields editable while an invalid zone is being corrected', () => {
	for (const zone of ['', 'America/Chic', 'Mars/Olympus']) {
		const result = Core.validate(Core.setZone(make('Oct 25 at 7pm', 'tomorrow at 8pm'), zone));
		expect(result.startError).toContain('valid IANA');
		expect(result.event).toBeUndefined();
	}
});

it('retains original pasted phrases separately from their resolved values', () => {
	const text = 'Title: Party\nNovember 14th, 2026, 8 pm - midnight\nLocation: St Paul, MN';
	const pending = Core.describe(Core.create(context), text);
	let d = Core.completeParse(pending, Core.parseTicket(pending), Core.extract(pending), true);
	expect(d.start.input).toBe('November 14th, 2026, 8 pm');
	expect(d.end.input).toBe('November 14th, 2026, 8 pm - midnight');
	expect(Core.validate(d)).toMatchObject({
		startValue: '2026-11-14 20:00',
		endValue: '2026-11-15 00:00'
	});
	const before = Core.validate(d).event!;
	d = Core.withUid(d, 'preserved');
	expect(d.start.input).toBe('November 14th, 2026, 8 pm');
	expect(Core.ics(before, 'preserved', '20261024T030000Z')).toContain('DTEND:20261115T060000Z');
	d = Core.edit(d, 'start', 'November 14, 2026 at 9pm');
	expect(d.start.input).toBeUndefined();
	expect(Core.validate(d).startValue).toBe('2026-11-14 21:00');
	expect(d.end.input).toBe('November 14th, 2026, 8 pm - midnight');
	d = Core.reset(d, 'start');
	expect(d.start.input).toBe('November 14th, 2026, 8 pm');
});
it('keeps inferred ends explicit instead of pretending they were quoted', () => {
	const pending = Core.describe(Core.create(context), '내일 오후 5시');
	const d = Core.completeParse(pending, Core.parseTicket(pending), Core.extract(pending), true);
	expect(d.start.input).toBe('내일 오후 5시');
	expect(d.end.input).toBe('2026-10-25 18:00');
	expect(Core.validate(d).endValue).toBe('2026-10-25 18:00');
	expect(d.suggestions.warnings).toContain('assumed-end');
});

it.each([
	['4hr', '2026-10-25 23:00'],
	['90min', '2026-10-25 20:30'],
	['1.5 hours', '2026-10-25 20:30'],
	['1h30m', '2026-10-25 20:30'],
	['.25hr', '2026-10-25 19:15'],
	[' 2 HRS ', '2026-10-25 21:00']
])('interprets End duration %s from Start', (duration, expected) => {
	const d = make('tomorrow at 7pm', duration),
		result = Core.validate(d);
	expect(d.end.value).toBe(duration);
	expect(d.end.ownership).toBe('manual');
	expect(result.endValue).toBe(expected);
	expect(result.endError).toBe('');
	expect(result.event).toBeDefined();
	const event = result.event!;
	expect(new URL(Core.googleUrl(event)).searchParams.get('dates')).toBe(
		`${event.start}/${event.end}`
	);
	expect(Core.ics(event, 'duration', '20261024T030000Z')).toContain(`DTEND:${event.end}`);
});
it('recomputes a duration after Start changes, including across midnight, without rewriting End', () => {
	let d = make('2026-10-25 19:00', '4hr');
	expect(Core.validate(d).endValue).toBe('2026-10-25 23:00');
	d = Core.edit(d, 'start', '2026-10-25 22:00');
	expect(Core.validate(d).endValue).toBe('2026-10-26 02:00');
	expect(d.end.value).toBe('4hr');
});
it.each(['0hr', '-4hr', '1h -30min', '.5min'])('blocks invalid duration %s', (duration) => {
	const result = Core.validate(make('2026-10-25 19:00', duration));
	expect(result.endError).not.toBe('');
	expect(result.event).toBeUndefined();
});
it.each(['', 'tomorrow evening', '7pm', '2026-10-25'])(
	'requires a complete timed Start for durations: %s',
	(start) => {
		const result = Core.validate(make(start, '4hr'));
		expect(result.endError).toContain('Complete a timed Start');
		expect(result.event).toBeUndefined();
	}
);
it('adds elapsed duration across the spring DST gap', () => {
	const d = Core.setZone(make('2026-03-08 01:30', '1hr'), 'America/Chicago');
	expect(Core.validate(d)).toMatchObject({ endValue: '2026-03-08 03:30', endError: '' });
	expect(Core.validate(d).event?.end).toBe('20260308T083000Z');
});
it('derives a unique End instant within the fall DST overlap', () => {
	const d = Core.setZone(make('2026-11-01 00:30', '1hr'), 'America/Chicago');
	const result = Core.validate(d);
	expect(result.endValue).toBe('2026-11-01 01:30');
	expect(result.endChoices).toEqual([]);
	expect(result.event?.end).toBe('20261101T063000Z');
});
it('waits for the Start offset choice, then derives the correct End for each choice', () => {
	const d = Core.setZone(make('2026-11-01 01:30', '1hr'), 'America/Chicago');
	expect(Core.validate(d).endError).toContain('DST choice');
	for (const [offset, endValue, end] of [
		['-05:00', '2026-11-01 01:30', '20261101T073000Z'],
		['-06:00', '2026-11-01 02:30', '20261101T083000Z']
	]) {
		const result = Core.validate(Core.chooseOffset(d, 'start', offset));
		expect(result.endValue).toBe(endValue);
		expect(result.endChoices).toEqual([]);
		expect(result.event?.end).toBe(end);
	}
});

it('interprets a Start duration from the edit-time clock rather than draft creation', () => {
	let d = Core.editAt(make('', '2hr'), 'start', '30min', '2026-10-24T06:00:00Z');
	expect(d.start.value).toBe('30min');
	expect(d.start.ownership).toBe('manual');
	expect(Core.validate(d)).toMatchObject({
		startValue: '2026-10-24 15:30',
		endValue: '2026-10-24 17:30',
		startError: '',
		endError: ''
	});
	const original = Core.validate(d).event!;
	expect(original.start).toBe('20261024T063000Z');
	d = Core.editAt(d, 'end', '4hr', '2026-10-24T07:00:00Z');
	expect(Core.validate(d).startValue).toBe('2026-10-24 15:30');
	d = Core.withUid(d, 'same-draft');
	expect(Core.validate(d).startValue).toBe('2026-10-24 15:30');
	d = Core.editAt(d, 'start', '1hr', '2026-10-24T07:00:00Z');
	expect(Core.validate(d).startValue).toBe('2026-10-24 17:00');
	expect(new URL(Core.googleUrl(original)).searchParams.get('dates')).toBe(
		'20261024T063000Z/20261024T083000Z'
	);
	expect(Core.ics(original, 'from-now', '20261024T060000Z')).toContain('DTSTART:20261024T063000Z');
});
it('keeps a Start duration anchor through Description edits and removes it on reset or other input', () => {
	const d = Core.editAt(make('', '1hr'), 'start', '4hr', '2026-10-24T06:00:00Z');
	expect(Core.describe(d, '').start.durationReference).toBe('2026-10-24T06:00:00Z');
	expect(
		Core.editAt(d, 'start', 'tomorrow at 7pm', '2026-10-24T07:00:00Z').start.durationReference
	).toBeUndefined();
	expect(Core.reset(d, 'start').start.durationReference).toBeUndefined();
	expect(Core.create(context).start.durationReference).toBeUndefined();
});
it('uses the injected draft reference for deterministic Start duration edits without a clock', () => {
	expect(Core.validate(make('1h30m', '1hr')).startValue).toBe('2026-10-24 13:30');
});
it('keeps from-now instants exact across zone corrections and a DST overlap', () => {
	let d = Core.editAt(make('', '1hr'), 'start', '1hr', '2026-11-01T05:30:00Z');
	d = Core.setZone(d, 'America/Chicago');
	let result = Core.validate(d);
	expect(result.startValue).toBe('2026-11-01 01:30');
	expect(result.startChoices).toEqual([]);
	expect(result.event).toMatchObject({ start: '20261101T063000Z', end: '20261101T073000Z' });
	d = Core.setZone(d, 'Asia/Seoul');
	result = Core.validate(d);
	expect(result.startValue).toBe('2026-11-01 15:30');
	expect(result.event?.start).toBe('20261101T063000Z');
});
it.each(['0hr', '-1hr', '.5min'])('blocks invalid Start duration %s', (start) => {
	const result = Core.validate(make(start, '1hr'));
	expect(result.startError).not.toBe('');
	expect(result.event).toBeUndefined();
});

it('freezes a field without changing source text or DST choices, then restores its suggestion', () => {
	const pending = Core.describe(
		Core.create(context),
		'Time zone: America/Chicago\nNovember 1, 2026 at 1:30 am to 2:30 am'
	);
	const parsed = Core.completeParse(
		pending,
		Core.parseTicket(pending),
		Core.extract(pending),
		true
	);
	const manual = Core.setAutomatic(parsed, 'start', false);
	expect(manual.start).toEqual({ ...parsed.start, ownership: 'manual' });
	expect(manual.end).toEqual(parsed.end);
	const chosen = Core.chooseOffset(manual, 'start', '-05:00');
	expect(Core.setAutomatic(chosen, 'start', false).start.offset).toBe('-05:00');
	const restored = Core.setAutomatic(chosen, 'start', true);
	expect(restored.start).toEqual(parsed.start);
	const next = Core.describe(manual, 'Tomorrow at 7pm');
	expect(Core.completeParse(next, Core.parseTicket(next), Core.extract(next), true).start).toEqual(
		manual.start
	);
});

it('switches to all day independently of ownership and restores raw times and durations', () => {
	const timed = Core.withUid(make('tomorrow at 7pm', '4hr'), 'all-day-uid');
	const before = Core.validate(timed).event!;
	const allDay = Core.setAllDay(timed, true),
		result = Core.validate(allDay);
	expect(allDay.start).toEqual(timed.start);
	expect(allDay.end).toEqual(timed.end);
	expect(result).toMatchObject({
		allDay: true,
		startValue: '2026-10-25',
		endValue: '2026-10-25',
		startChoices: [],
		endChoices: []
	});
	expect(result.event).toMatchObject({ allDay: true, start: '20261025', end: '20261026' });
	expect(new URL(Core.googleUrl(result.event!)).searchParams.get('dates')).toBe(
		'20261025/20261026'
	);
	expect(Core.ics(result.event!, 'all-day-uid', '20261024T030000Z')).toContain(
		'DTSTART;VALUE=DATE:20261025\r\nDTEND;VALUE=DATE:20261026'
	);
	expect(Core.validate(Core.setAllDay(allDay, false)).event).toEqual(before);
	expect(allDay.uid).toBe('all-day-uid');
});
it('converts exclusive midnight ends to inclusive all-day dates', () => {
	const allDay = Core.setAllDay(make('2026-11-14 20:00', '2026-11-15 00:00'), true);
	expect(Core.validate(allDay)).toMatchObject({ startValue: '2026-11-14', endValue: '2026-11-14' });
	expect(Core.validate(allDay).event?.end).toBe('20261115');
});
it('retains the dates covered by a duration that crosses midnight', () => {
	const allDay = Core.setAllDay(make('2026-10-25 23:00', '4hr'), true);
	expect(Core.validate(allDay)).toMatchObject({ startValue: '2026-10-25', endValue: '2026-10-26' });
	expect(Core.validate(allDay).event?.end).toBe('20261027');
});
it('allows a known vague date to become an explicit all-day event without inventing a date', () => {
	const allDay = Core.setAllDay(Core.edit(Core.create(context), 'start', 'tomorrow evening'), true);
	expect(Core.validate(allDay).event).toMatchObject({
		allDay: true,
		start: '20261025',
		end: '20261026'
	});
	expect(Core.validate(Core.setAllDay(allDay, false)).event).toBeUndefined();
	expect(Core.validate(Core.setAllDay(make('7pm', '4hr'), true)).event).toBeUndefined();
});
it('keeps all-day mode through Auto reparses and clears it on New event', () => {
	let d = Core.describe(Core.create(context), 'lunch tomorrow');
	d = Core.completeParse(d, Core.parseTicket(d), Core.extract(d), true);
	d = Core.setAllDay(d, true);
	expect(d.start.ownership).toBe('auto');
	expect(d.end.ownership).toBe('auto');
	d = Core.describe(d, 'lunch day after tomorrow');
	d = Core.completeParse(d, Core.parseTicket(d), Core.extract(d), true);
	expect(Core.validate(d).event).toMatchObject({
		allDay: true,
		start: '20261026',
		end: '20261027'
	});
	expect(Core.validate(Core.setAllDay(d, false)).startValue).toBe('2026-10-26 12:00');
	expect(Core.create(context).allDayOverride).toBeUndefined();
});
it('preserves DST choices across all-day toggles and restores gap validation', () => {
	const gap = Core.setZone(make('2026-03-08 02:30', '2026-03-08 03:30'), 'America/Chicago');
	expect(Core.validate(Core.setAllDay(gap, true)).event?.allDay).toBe(true);
	expect(Core.validate(Core.setAllDay(Core.setAllDay(gap, true), false)).startError).toContain(
		'DST gap'
	);
	const chosen = Core.chooseOffset(
		Core.setZone(make('2026-11-01 01:30', '2026-11-01 02:30'), 'America/Chicago'),
		'start',
		'-06:00'
	);
	const allDay = Core.setAllDay(chosen, true);
	expect(allDay.start.offset).toBe('-06:00');
	expect(Core.validate(allDay).startChoices).toEqual([]);
	expect(Core.validate(Core.setAllDay(allDay, false)).event).toEqual(Core.validate(chosen).event);
});
it('requires times when All day is turned off without any previous timed values', () => {
	const d = Core.setAllDay(make('2026-10-25', '2026-10-25'), false);
	expect(Core.validate(d).allDay).toBe(false);
	expect(Core.validate(d).event).toBeUndefined();
	expect(Core.validate(d).startError).toContain('Add a time');
});

it.each(['tomorrow at 13pm', 'tomorrow at 0am', 'tomorrow at 19:30pm'])(
	'rejects invalid explicit 12-hour clocks: %s',
	(text) => {
		expect(Core.validate(make(text, '2026-10-25 20:00')).event).toBeUndefined();
	}
);
