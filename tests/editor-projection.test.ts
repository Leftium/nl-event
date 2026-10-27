import { describe, expect, it } from 'vitest';
import * as Core from '../src/lib/core/EventCore.gen';

const context = { referenceInstant: '2026-10-24T03:00:00Z', browserTimeZone: 'Asia/Seoul' };
const make = (start: string, end: string) =>
	Core.edit(Core.edit(Core.create(context), 'start', start), 'end', end);
const settle = (draft: Core.draft) =>
	Core.completeParse(draft, Core.parseTicket(draft), Core.extract(draft), true);
const parse = (text: string) => settle(Core.describe(Core.create(context), text));

// Compare every displayed property, including pairing, generated labels and source spans.
function parity(draft: Core.draft) {
	const before = JSON.stringify(draft);
	const projection = Core.editorProjection(draft);
	expect(projection.validation).toEqual(Core.validate(draft));
	expect(projection.durationValue).toBe(Core.durationValue(draft));
	expect(projection.durationOptions).toEqual(Core.durationOptions(draft));
	for (const name of ['start', 'end'] as const) {
		for (const part of ['date', 'time'] as const) {
			expect(projection[name][part]).toEqual(Core.temporalOptions(draft, name, part));
		}
	}
	const event = projection.validation.event;
	if (event) {
		const legacy = Core.validate(draft).event!;
		expect(Core.googleUrl(event)).toBe(Core.googleUrl(legacy));
		expect(Core.ics(event, 'projection', '20261024T030000Z')).toBe(
			Core.ics(legacy, 'projection', '20261024T030000Z')
		);
	}
	expect(JSON.stringify(draft)).toBe(before);
	return projection;
}

describe('shared editor validation', () => {
	it.each([
		['2026-12-19 18:00', '2026-12-19 20:00'],
		['December 19 2026 at 6pm', 'December 19 2026 at 8pm'],
		['tomorrow at 7pm', '2h'],
		['2026-12-19 18:00', '20:00'],
		['2026-12-19', '2 days'],
		['2026-12-19', '2026-12-20'],
		['19:00', '20:00'],
		['tomorrow evening', ''],
		['invalid time', 'not a date'],
		['2026-02-29', '4294967297 days'],
		['2026-12-19 18:00', '2026-12-19 17:00']
	])('matches public projections for Start %s and End %s', (start, end) => {
		parity(make(start, end));
	});

	it('exports freeform dates and elapsed duration with canonical bounds', () => {
		const projection = parity(make('December 19 2026 at 6pm', 'December 19 2026 at 8pm'));
		expect(projection.validation.event).toMatchObject({
			start: '20261219T090000Z',
			end: '20261219T110000Z',
			allDay: false
		});
		expect(projection.durationValue).toBe(120);
		expect(new URL(Core.googleUrl(projection.validation.event!)).searchParams.get('dates')).toBe(
			'20261219T090000Z/20261219T110000Z'
		);
	});

	it('keeps partial selections ahead of normalized validation and retains evidence', () => {
		let draft = parse('Practice 16:30~18:00');
		for (const name of ['start', 'end'] as const) {
			draft = Core.selectTemporalPart(draft, name, 'time', name === 'start' ? '16:30' : '18:00');
			const projection = parity(draft);
			expect(projection[name].time.find((o) => o.selected)?.evidence?.length).toBeGreaterThan(0);
			expect(projection.validation.event).toBeUndefined();
		}
		parity(Core.selectTemporalPart(parse('October 25, 2026'), 'start', 'date', '2026-10-25'));
	});

	it('preserves pairing, Manual ownership, generated choices and stale evidence', () => {
		let draft = parse('October 25, 2026 at 7pm\nOctober 26, 2026 at 8pm');
		draft = Core.selectTemporalPart(draft, 'start', 'date', '2026-10-26');
		draft = Core.selectTemporalPart(draft, 'start', 'time', '19:00');
		expect(parity(draft).start.time.find((o) => o.selected)?.paired).toBe(false);
		expect(draft.start.ownership).toBe('manual');
		const pending = Core.describe(draft, 'Tomorrow at 9pm');
		expect(parity(pending).start.time.every((o) => o.evidence?.length === 0)).toBe(true);
		const ticket = Core.parseTicket(pending);
		const output = Core.extract(pending);
		draft = settle(pending);
		parity(draft);
		parity(Core.reset(draft, 'start'));
		parity(Core.completeParse(Core.describe(draft, 'Different source'), ticket, output, true));
		const generated = parity(parse('Community gathering without dates'));
		expect(generated.start.date.every((o) => o.generated && o.evidence?.length === 0)).toBe(true);
	});

	it('recomputes across zones, context revisions, all-day overrides and Auto changes', () => {
		let draft = parse('Tomorrow at 7pm');
		const first = parity(draft);
		draft = Core.edit(draft, 'end', '2h');
		parity(draft);
		draft = Core.setZone(draft, 'America/Chicago');
		parity(draft);
		draft = {
			...draft,
			context: { ...context, referenceInstant: '2026-12-01T03:00:00Z' },
			contextRevision: draft.contextRevision + 1
		};
		draft = Core.edit(draft, 'start', 'tomorrow at 7pm');
		expect(parity(draft).validation.startValue).toBe('2026-12-01 19:00');
		expect(first.validation.startValue).toBe('2026-10-25 19:00');
		draft = Core.setAllDay(draft, true);
		expect(parity(draft).validation.allDay).toBe(true);
		parity(Core.setAllDay(draft, false));
		parity(Core.setAutomatic(draft, 'end', true));
		parity(Core.setZone(draft, 'invalid'));
		parity(Core.editAt(draft, 'start', '2h', '2026-12-01T03:00:00Z'));
	});

	it('preserves DST gaps, folds, selected offsets and elapsed durations', () => {
		parity(Core.setZone(make('March 8 2026 at 2:30am', 'March 8 2026 at 4am'), 'America/Chicago'));
		let draft = Core.setZone(make('2026-11-01 01:30', '2026-11-01 01:45'), 'America/Chicago');
		expect(parity(draft).validation.event).toBeUndefined();
		draft = Core.chooseOffset(Core.chooseOffset(draft, 'start', '-05:00'), 'end', '-06:00');
		expect(parity(draft).durationValue).toBe(75);
		parity(Core.edit(draft, 'start', '2026-11-01 01:40'));
	});
});
