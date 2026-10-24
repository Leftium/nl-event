import { describe, expect, it } from 'vitest';
import * as Core from '../src/lib/core/EventCore.gen';
import { resolve } from '../src/lib/core/calendarAdapter';
import fs from 'node:fs';

const context = { referenceInstant: '2026-10-24T03:00:00Z', browserTimeZone: 'Asia/Seoul' };
const make = (start = '2026-10-25 17:00', end = '2026-10-25 18:00') =>
	Core.edit(Core.edit(Core.create(context), 'start', start), 'end', end);
const normalized = (draft: Core.draft): Core.normalized => {
	const result = Core.validate(draft);
	expect(result.startError).toBe('');
	expect(result.endError).toBe('');
	return result.event!;
};
const unfold = (text: string) => text.replace(/\r\n /g, '');

describe('manual draft lifecycle', () => {
	it('initializes all fields Auto and captures injected context', () => {
		const draft = Core.create(context);
		expect(draft.context).toEqual(context);
		expect(Core.populated(draft)).toBe(false);
		for (const name of ['title', 'start', 'end', 'location'] as const) {
			expect(Core.getField(draft, name)).toEqual({ value: '', ownership: 'auto', offset: '' });
		}
	});
	it('typing or deleting marks only the target Manual; reset is blank without suggestions', () => {
		const draft = Core.edit(make(), 'title', '');
		expect(draft.title.ownership).toBe('manual');
		expect(draft.location.ownership).toBe('auto');
		const reset = Core.reset(draft, 'start');
		expect(reset.start).toEqual({ value: '', ownership: 'auto', offset: '' });
		expect(reset.end).toEqual(draft.end);
	});
	it('description edits/clear preserve manual values, zone, fixed context and UID', () => {
		const draft = Core.withUid(Core.setZone(make(), 'America/Chicago'), 'identity');
		for (const text of ['announcement', '', 'unparseable text']) {
			const next = Core.describe(draft, text);
			expect(next.description).toBe(text);
			expect(next.start).toEqual(draft.start);
			expect(next.context).toEqual(context);
			expect(next.uid).toBe('identity');
			expect(next.zoneOverride).toBe('America/Chicago');
			expect(next.title.value).toBe('');
		}
	});
	it('a manual blank or zone override requires replacement confirmation', () => {
		expect(Core.populated(Core.edit(Core.create(context), 'title', ''))).toBe(true);
		expect(Core.populated(Core.setZone(Core.create(context), ''))).toBe(true);
	});
	it('clipboard empty and cancelled replacement preserve the exact draft', () => {
		const draft = Core.withUid(make(), 'id');
		expect(Core.replaceClipboard(draft, '', true, context)).toBe(draft);
		expect(Core.replaceClipboard(draft, 'replacement', false, context)).toBe(draft);
	});
	it('clipboard fills an empty draft without recapturing its reference context', () => {
		const empty = Core.create(context);
		const later = { ...context, referenceInstant: '2026-12-01T00:00:00Z' };
		expect(Core.replaceClipboard(empty, 'description', false, later)).toEqual({
			...empty,
			description: 'description'
		});
	});
	it('confirmed replacement resets identity, fields, zone, context, and offsets', () => {
		const draft = Core.withUid(Core.setZone(make(), 'America/Chicago'), 'id');
		const nextContext = { ...context, referenceInstant: '2026-11-01T00:00:00Z' };
		expect(Core.replaceClipboard(draft, 'new text', true, nextContext)).toEqual({
			...Core.create(nextContext),
			description: 'new text'
		});
	});
	it('new event captures new context and clears ownership and UID', () => {
		const draft = Core.withUid(make(), 'id');
		const fresh = Core.create({ ...context, referenceInstant: '2026-12-01T00:00:00Z' });
		expect(fresh.uid).toBeUndefined();
		expect(fresh.start.ownership).toBe('auto');
		expect(fresh.context).not.toEqual(draft.context);
	});
	it('UID is reused after edits/reset and differs for the next exported draft', () => {
		const first = Core.withUid(make(), 'first');
		expect(Core.withUid(Core.edit(first, 'title', 'Changed'), 'unused').uid).toBe('first');
		expect(Core.withUid(Core.reset(first, 'title'), 'unused').uid).toBe('first');
		expect(Core.withUid(Core.create(context), 'second').uid).toBe('second');
	});
});

describe('validation and deterministic time conversion', () => {
	it.each([
		'',
		'12:15',
		'tomorrow evening',
		'2026-02-29',
		'2026-04-31',
		'2026-10-25 24:00',
		'2026-10-25 17:60',
		'2026-10-25T17:00',
		'0000-10-25'
	])('blocks incomplete/invalid Start %s', (start) => {
		expect(Core.validate(make(start)).event).toBeUndefined();
		expect(Core.validate(make(start)).startError).not.toBe('');
	});
	it('allows empty title, description, and location for complete manual times', () => {
		expect(normalized(make())).toMatchObject({
			start: '20261025T080000Z',
			end: '20261025T090000Z',
			allDay: false
		});
	});
	it('accepts leap day and inclusive single-day/multiday dates', () => {
		expect(normalized(make('2028-02-29', '2028-02-29'))).toMatchObject({
			start: '20280229',
			end: '20280301',
			allDay: true
		});
		expect(normalized(make('2026-12-31', '2027-01-02')).end).toBe('20270103');
	});
	it.each([
		['2026-10-25', '2026-10-25 18:00'],
		['2026-10-25 17:00', '2026-10-25'],
		['2026-10-25', '2026-10-24'],
		['2026-10-25 17:00', '2026-10-25 17:00'],
		['2026-10-25 17:00', '2026-10-25 16:00']
	])('blocks mixed modes or invalid ordering: %s to %s', (start, end) => {
		expect(Core.validate(make(start, end)).event).toBeUndefined();
	});
	it('zone changes preserve wall times and clear choices without sibling ownership changes', () => {
		const draft = Core.chooseOffset(make(), 'start', '-05:00');
		const changed = Core.setZone(draft, 'America/Chicago');
		expect(changed.start.value).toBe(draft.start.value);
		expect(changed.start.offset).toBe('');
		expect(changed.end).toEqual(draft.end);
		expect(normalized(changed).start).toBe('20261025T220000Z');
		expect(Core.effectiveZone(Core.setZone(changed, undefined))).toBe('Asia/Seoul');
	});
	it.each(['', 'Mars/Olympus', '+09:00'])(
		'blocks invalid timed zone %s but allows all-day',
		(zone) => {
			expect(Core.validate(Core.setZone(make(), zone)).event).toBeUndefined();
			expect(normalized(Core.setZone(make('2026-10-25', '2026-10-25'), zone)).allDay).toBe(true);
		}
	);
	it('keeps normalized all-day export zones usable when an irrelevant override is invalid', () => {
		const event = normalized(Core.setZone(make('2026-10-25', '2026-10-25'), 'invalid'));
		expect(new URL(Core.googleUrl(event)).searchParams.get('stz')).toBe('Asia/Seoul');
	});
	it('blocks values whose normalized export would exceed four-digit calendar years', () => {
		expect(Core.validate(make('9999-12-31', '9999-12-31')).event).toBeUndefined();
		expect(Core.validate(make('0001-01-01 00:00', '0001-01-01 01:00')).event).toBeUndefined();
	});
	it('blocks spring-forward gaps without silently shifting', () => {
		const result = Core.validate(
			Core.setZone(make('2026-03-08 02:30', '2026-03-08 04:00'), 'America/Chicago')
		);
		expect(result.startError).toContain('DST gap');
		expect(result.startChoices).toEqual([]);
		expect(result.event).toBeUndefined();
	});
	it('requires independent overlap choices and invalidates a choice on edit/reset', () => {
		const draft = Core.setZone(make('2026-11-01 01:30', '2026-11-01 01:45'), 'America/Chicago');
		const result = Core.validate(draft);
		expect(result.startChoices.map((c) => c.offset)).toEqual(['-05:00', '-06:00']);
		expect(result.event).toBeUndefined();
		const startChosen = Core.chooseOffset(draft, 'start', '-05:00');
		expect(Core.validate(startChosen).endError).toContain('Choose an offset');
		const both = Core.chooseOffset(startChosen, 'end', '-06:00');
		expect(normalized(both)).toMatchObject({ start: '20261101T063000Z', end: '20261101T074500Z' });
		expect(Core.validate(Core.edit(both, 'start', both.start.value)).event).toBeUndefined();
		expect(Core.reset(both, 'start').start.offset).toBe('');
	});
	it('compares overlap ordering as instants, not local text', () => {
		const draft = Core.setZone(make('2026-11-01 01:45', '2026-11-01 01:30'), 'America/Chicago');
		expect(
			normalized(Core.chooseOffset(Core.chooseOffset(draft, 'start', '-05:00'), 'end', '-06:00'))
				.end
		).toBe('20261101T073000Z');
	});
	it('warns about past events without changing dates or blocking exports', () => {
		expect(Core.validate(make('2026-10-18 18:30', '2026-10-18 22:30')).warnings).toContain(
			'Start is in the past.'
		);
		expect(normalized(make('2026-10-18', '2026-10-18')).start).toBe('20261018');
	});
	it('checks the independent E3 calendar oracle without using parser expectations', () => {
		const oracle = JSON.parse(
			fs.readFileSync('tests/fixtures/nl-event/oracles/e3-series-calendar-metadata.json', 'utf8')
		);
		for (const occurrence of oracle.localOccurrences) {
			for (const local of [occurrence.start, occurrence.end]) {
				expect(resolve(local, oracle.timeZone).choices[0].offset).toBe(occurrence.utcOffset);
			}
			const event = normalized(
				Core.setZone(make(occurrence.start, occurrence.end), oracle.timeZone)
			);
			expect(new URL(Core.googleUrl(event)).searchParams.get('dates')).toBe(
				`${event.start}/${event.end}`
			);
			expect(Core.ics(event, 'oracle-id', '20261024T030000Z')).toContain(
				`DTSTART:${event.start}\r\nDTEND:${event.end}`
			);
		}
	});
});

describe('equivalent normalized calendar exports', () => {
	it.each(['-05:00', '-06:00'])(
		'exports the chosen overlap instant %s in both formats',
		(offset) => {
			const draft = Core.chooseOffset(
				Core.setZone(make('2026-11-01 01:30', '2026-11-01 03:00'), 'America/Chicago'),
				'start',
				offset
			);
			const event = normalized(draft);
			const url = new URL(Core.googleUrl(event));
			expect(url.searchParams.get('dates')).toBe(`${event.start}/${event.end}`);
			expect(Core.ics(event, 'id', '20261024T030000Z')).toContain(
				`DTSTART:${event.start}\r\nDTEND:${event.end}`
			);
		}
	);
	it('uses exclusive all-day bounds in both formats', () => {
		const event = normalized(make('2026-10-25', '2026-10-26'));
		expect(new URL(Core.googleUrl(event)).searchParams.get('dates')).toBe('20261025/20261027');
		expect(Core.ics(event, 'id', '20261024T030000Z')).toContain(
			'DTSTART;VALUE=DATE:20261025\r\nDTEND;VALUE=DATE:20261027'
		);
	});
	it('encodes exact Google details without interpreting text as query parameters', () => {
		let draft = Core.describe(make(), '한글 & = ? # +\nsecond line\r\nthird');
		draft = Core.edit(Core.edit(draft, 'title', 'A & B'), 'location', 'St Paul, MN');
		const event = normalized(Core.setZone(draft, 'America/Chicago'));
		const url = new URL(Core.googleUrl(event));
		expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			action: 'TEMPLATE',
			text: 'A & B',
			details: draft.description,
			location: 'St Paul, MN',
			stz: 'America/Chicago',
			etz: 'America/Chicago'
		});
	});
	it('serializes required properties, escapes text, uses CRLF and folds at 75 UTF-8 octets', () => {
		const description = '한글🙂'.repeat(100) + '\r\nnext; comma, backslash\\\nEND:VEVENT';
		const event = normalized(
			Core.describe(Core.edit(make(), 'title', 'Title; comma, slash\\'), description)
		);
		const output = Core.ics(event, 'unique@nl-event', '20261024T030000Z');
		expect(output.endsWith('END:VCALENDAR\r\n')).toBe(true);
		expect(output.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
		for (const line of output.split('\r\n'))
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
		expect(output).not.toContain('\uFFFD');
		expect(unfold(output)).toContain(
			'DESCRIPTION:' +
				description
					.replaceAll('\\', '\\\\')
					.replaceAll('\r\n', '\n')
					.replaceAll('\n', '\\n')
					.replaceAll(';', '\\;')
					.replaceAll(',', '\\,')
		);
		for (const property of [
			'VERSION:2.0',
			'PRODID:',
			'UID:unique@nl-event',
			'DTSTAMP:20261024T030000Z',
			'SUMMARY:Title\\; comma\\, slash\\\\',
			'LOCATION:'
		])
			expect(unfold(output)).toContain(property);
		expect(output.split('\r\n').filter((line) => line === 'END:VEVENT')).toHaveLength(1);
	});
});
