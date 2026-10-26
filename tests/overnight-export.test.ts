import { describe, expect, it } from 'vitest';
import { overnightExport } from '../src/lib/core/overnightExport';
import { resolve } from '../src/lib/core/calendarAdapter';
import * as Core from '../src/lib/core/EventCore.gen';

const event = (
	start = '2026-10-30 21:00',
	end = '2026-10-31 02:00',
	zone = 'Asia/Seoul'
): Core.normalized => ({
	title: 'Dance',
	location: 'Hall',
	description: '  춤 🎵\r\nhttps://veneer.leftium.com/f.FORM\n\n---\n\nEdited Form intro  ',
	zone,
	allDay: false,
	start: resolve(start, zone).choices[0].instant,
	end: resolve(end, zone).choices[0].instant
});
const unfold = (text: string) => text.replace(/\r\n /g, '');

describe('overnight export', () => {
	it('defaults to exclusive next-day midnight and preserves every other field and original byte', () => {
		const original = event();
		const snapshot = structuredClone(original);
		const output = overnightExport(original);
		expect(output.eligible).toBe(true);
		expect(output.event).toEqual({
			...original,
			end: '20261030T150000Z',
			description: `${original.description}\n\n---\n\nActual end: Oct 31, 2026, 02:00 (Asia/Seoul; next day)`
		});
		expect(original).toEqual(snapshot);
		expect(output.calendarEnd).toBe('Oct 31, 00:00');
		expect(overnightExport(output.event).event).toBe(output.event);
	});
	it('leaves explicitly unchecked exports byte identical, including UID and stamp', () => {
		const original = event();
		const output = overnightExport(original, false);
		expect(output.eligible).toBe(true);
		expect(output.event).toBe(original);
		expect(Core.googleUrl(output.event!)).toBe(Core.googleUrl(original));
		expect(Core.ics(output.event!, 'uid', '20260101T000000Z')).toBe(
			Core.ics(original, 'uid', '20260101T000000Z')
		);
	});
	it('uses the same Google and ICS interval and description and supports the empty-description fallback', () => {
		for (const original of [event(), event('2026-10-30 21:00', '2026-11-01 06:00')]) {
			for (const enabled of [true, false]) {
				const output = overnightExport(original, enabled).event!;
				if (!enabled) {
					expect(Core.googleUrl(output)).toBe(Core.googleUrl(original));
					expect(Core.ics(output, 'uid@nl-event', '20260101T000000Z')).toBe(
						Core.ics(original, 'uid@nl-event', '20260101T000000Z')
					);
				}
				const query = new URL(Core.googleUrl(output)).searchParams;
				const ics = unfold(Core.ics(output, 'uid@nl-event', '20260101T000000Z'));
				expect(query.get('dates')).toBe(`${output.start}/${output.end}`);
				expect(query.get('details')).toBe(output.description);
				for (const line of [
					`DTSTART:${output.start}`,
					`DTEND:${output.end}`,
					'UID:uid@nl-event',
					'DTSTAMP:20260101T000000Z'
				])
					expect(ics).toContain(`${line}\r\n`);
				const escaped = output.description
					.replace(/\r\n/g, '\n')
					.replace(/\\/g, '\\\\')
					.replace(/\n/g, '\\n')
					.replace(/,/g, '\\,')
					.replace(/;/g, '\\;');
				expect(ics).toContain(`DESCRIPTION:${escaped}\r\n`);
				const fallback = new URL(Core.googleUrl({ ...output, description: '' })).searchParams;
				expect(fallback.get('dates')).toBe(query.get('dates'));
				expect(fallback.get('details') || '').toBe('');
			}
		}
	});
	it('deduplicates equivalent authored notes and recomputes from edited validation', () => {
		const base = event();
		const note = 'actual end: Oct 31, 2026, 02:00 (Asia/Seoul; next day)';
		const original = { ...base, description: `${base.description}\n  ${note}  ` };
		expect(overnightExport(original).event!.description).toBe(original.description);
		const next = event('2026-10-30 21:00', '2026-10-31 03:00');
		expect(overnightExport(next).event!.description).toContain('03:00');
		expect(overnightExport(next).event!.description.match(/Actual end:/g)).toHaveLength(1);
		expect(overnightExport(next, false).event!.description).toBe(next.description);
	});
	it('keeps one minute for a very late start', () => {
		const output = overnightExport(event('2026-10-30 23:59'));
		expect(output.event!.start).toBe('20261030T145900Z');
		expect(output.event!.end).toBe('20261030T150000Z');
	});
	it('ignores all-day, same-day, exact-midnight, invalid and reversed intervals', () => {
		for (const original of [
			{ ...event(), allDay: true, start: '20261030', end: '20261031' },
			event('2026-10-30 19:00', '2026-10-30 23:00'),
			event('2026-10-30 21:00', '2026-10-31 00:00'),
			{ ...event(), start: 'invalid' },
			{ ...event(), zone: 'invalid' },
			{ ...event(), start: event().end, end: event().start }
		]) {
			expect(overnightExport(original)).toEqual({ event: original, eligible: false });
		}
		expect(overnightExport(undefined).eligible).toBe(false);
	});
	it('uses the event zone across spring and autumn DST changes', () => {
		for (const [start, end, cutoff] of [
			['2026-03-07 21:00', '2026-03-08 04:00', '20260308T050000Z'],
			['2026-10-31 21:00', '2026-11-01 04:00', '20261101T040000Z']
		]) {
			expect(overnightExport(event(start, end, 'America/New_York')).event!.end).toBe(cutoff);
		}
	});
	it.each([
		['00:00', false],
		['00:01', true],
		['05:59', true],
		['06:00', true],
		['06:00:01', false],
		['06:01', false],
		['17:00', false]
	])('applies the final-morning boundary at %s (eligible: %s)', (clock, eligible) => {
		for (const date of ['2026-10-31', '2026-11-01']) {
			const original = event('2026-10-30 21:00', `${date} ${clock.slice(0, 5)}`);
			const input =
				clock.length > 5 ? { ...original, end: original.end.replace('00Z', '01Z') } : original;
			const result = overnightExport(input);
			expect(result.eligible).toBe(eligible);
			if (eligible) {
				expect(result.event!.start).toBe(input.start);
				expect(result.event!.end).toBe(resolve(`${date} 00:00`, input.zone).choices[0].instant);
				expect(input.end).toBe(original.end);
			} else expect(result.event).toBe(input);
		}
	});
	it('trims only the final morning of a multi-day interval and accurately labels its real end', () => {
		const original = event('2026-10-30 21:00', '2026-11-01 02:00');
		const result = overnightExport(original);
		expect(result.event!.end).toBe('20261031T150000Z');
		expect(result.actualEnd).toBe('Nov 1, 2026, 02:00 (Asia/Seoul)');
		expect(result.event!.description).not.toContain('next day');
		expect(result.event!.description).toBe(
			`${original.description}\n\n---\n\nActual end: ${result.actualEnd}`
		);
		expect(overnightExport(result.event).event).toBe(result.event);
		expect(
			overnightExport({ ...original, description: result.event!.description }).event!.description
		).toBe(result.event!.description);
	});
	it('handles year boundaries and multi-day DST in the event zone', () => {
		for (const [start, end, zone, cutoff] of [
			['2026-12-30 23:59', '2027-01-01 06:00', 'Asia/Seoul', '20261231T150000Z'],
			['2026-03-06 21:00', '2026-03-08 04:00', 'America/New_York', '20260308T050000Z'],
			['2026-10-30 21:00', '2026-11-01 04:00', 'America/New_York', '20261101T040000Z']
		])
			expect(overnightExport(event(start, end, zone)).event!.end).toBe(cutoff);
	});
	it('preserves validated draft ownership and source when browser and event zones differ', () => {
		let draft = Core.create({
			referenceInstant: '2026-10-24T03:00:00Z',
			browserTimeZone: 'America/Los_Angeles'
		});
		draft = Core.setZone(draft, 'Asia/Seoul');
		draft = Core.edit(Core.edit(draft, 'start', '2026-10-30 21:00'), 'end', '2026-11-01 06:00');
		const snapshot = structuredClone(draft);
		const validated = Core.validate(draft).event!;
		expect(validated).toBeDefined();
		expect(overnightExport(validated).event!.end).toBe('20261031T150000Z');
		expect(draft).toEqual(snapshot);
		expect(Core.validate(draft).event!.end).toBe('20261031T210000Z');
	});
	it('visibly declines nonexistent and ambiguous local midnight', () => {
		for (const [start, end, zone] of [
			['2018-11-03 21:00', '2018-11-04 03:00', 'America/Sao_Paulo'],
			['2020-10-31 21:00', '2020-11-01 03:00', 'America/Havana'],
			['2018-11-02 21:00', '2018-11-04 03:00', 'America/Sao_Paulo'],
			['2020-10-30 21:00', '2020-11-01 03:00', 'America/Havana']
		]) {
			const original = event(start, end, zone);
			const output = overnightExport(original);
			expect(output.eligible).toBe(false);
			expect(output.event).toBe(original);
			expect(output.warning).toContain('midnight is ambiguous or missing');
		}
	});
});
