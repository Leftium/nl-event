import { Temporal } from '@js-temporal/polyfill';
import type { normalized } from './EventCore.gen';
import { validZone } from './calendarAdapter';

export type OvernightExport = {
	event: normalized | undefined;
	eligible: boolean;
	actualEnd?: string;
	calendarEnd?: string;
	warning?: string;
};

const instant = (value: string) => {
	if (!/^\d{8}T\d{6}Z$/.test(value)) throw new RangeError('Invalid normalized instant');
	return Temporal.Instant.from(
		value.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')
	);
};

const label = (value: Temporal.ZonedDateTime) =>
	`${value.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}, ${value.toPlainTime().toString({ smallestUnit: value.second ? 'second' : 'minute' })}`;

// Always derive from validation, keeping the real draft and its description untouched.
export function overnightExport(event: normalized | undefined, enabled = true): OvernightExport {
	const unchanged = { event, eligible: false };
	if (!event || event.allDay || !validZone(event.zone)) return unchanged;
	try {
		const start = instant(event.start).toZonedDateTimeISO(event.zone);
		const end = instant(event.end).toZonedDateTimeISO(event.zone);
		if (Temporal.ZonedDateTime.compare(start, end) >= 0) return unchanged;
		const nextDate = start.toPlainDate().add({ days: 1 });
		if (!end.toPlainDate().equals(nextDate)) return unchanged;
		const midnight = nextDate.toPlainDateTime('00:00');
		if (Temporal.PlainDateTime.compare(end.toPlainDateTime(), midnight) <= 0) return unchanged;
		let cutoff: Temporal.ZonedDateTime;
		try {
			// Reject both missing and repeated local midnights instead of guessing an offset.
			cutoff = midnight.toZonedDateTime(event.zone, { disambiguation: 'reject' });
		} catch {
			return {
				...unchanged,
				warning:
					'Overnight truncation is unavailable because midnight is ambiguous or missing in this time zone. The full interval will be exported.'
			};
		}
		if (
			Temporal.ZonedDateTime.compare(cutoff, start) <= 0 ||
			Temporal.ZonedDateTime.compare(cutoff, end) >= 0
		)
			return unchanged;
		const actualEnd = `${label(end)} (${event.zone}; next day)`;
		const calendarEnd = `${label(cutoff)} (${event.zone})`;
		const note = `Actual end: ${actualEnd}`;
		const equivalent = (text: string) => text.trim().replace(/\s+/gu, ' ').toLowerCase();
		const hasNote = event.description
			.split(/\r?\n/)
			.some((line) => equivalent(line) === equivalent(note));
		return {
			eligible: true,
			actualEnd,
			calendarEnd,
			event: enabled
				? {
						...event,
						end: cutoff.toInstant().toString({ smallestUnit: 'second' }).replaceAll(/[-:]/g, ''),
						description: hasNote
							? event.description
							: `${event.description}${event.description ? '\n\n---\n\n' : ''}${note}`
					}
				: event
		};
	} catch {
		return unchanged;
	}
}
