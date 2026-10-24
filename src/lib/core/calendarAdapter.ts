import { Temporal } from '@js-temporal/polyfill';
import type { resolution } from './EventCore.gen';

// Conversion only: the core decides which alternatives are acceptable.
export function resolve(value: string, zone: string): resolution {
	if (!/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(value) || value.startsWith('0000')) {
		return { kind: 'invalid', date: '', nextDate: '', choices: [] };
	}
	try {
		const date = Temporal.PlainDate.from(value.slice(0, 10));
		if (value.length === 10) {
			if (date.add({ days: 1 }).year > 9999)
				throw new RangeError('Exclusive end exceeds iCalendar year range');
			return {
				kind: 'date',
				date: date.toString().replaceAll('-', ''),
				nextDate: date.add({ days: 1 }).toString().replaceAll('-', ''),
				choices: []
			};
		}
		const local = Temporal.PlainDateTime.from(value.replace(' ', 'T'));
		if (!validZone(zone)) return { kind: 'zone', date: '', nextDate: '', choices: [] };
		const candidates = ['earlier', 'later'].map((disambiguation) =>
			local.toZonedDateTime(zone, { disambiguation: disambiguation as 'earlier' | 'later' })
		);
		const choices = candidates
			.filter(
				(candidate, i) =>
					candidate.toPlainDateTime().equals(local) &&
					(i === 0 || candidate.epochNanoseconds !== candidates[0].epochNanoseconds)
			)
			.map((candidate) => ({
				offset: candidate.offset,
				instant: candidate.toInstant().toString({ smallestUnit: 'second' }).replaceAll(/[-:]/g, ''),
				epoch: candidate.epochMilliseconds
			}));
		if (
			choices.some(
				(choice) => !/^\d{8}T\d{6}Z$/.test(choice.instant) || choice.instant.startsWith('0000')
			)
		) {
			throw new RangeError('Resolved UTC instant exceeds iCalendar year range');
		}
		return { kind: 'timed', date: '', nextDate: '', choices };
	} catch {
		return { kind: 'invalid', date: '', nextDate: '', choices: [] };
	}
}

export function validZone(zone: string): boolean {
	// Temporal also accepts fixed offsets, but this product requires an IANA identifier.
	if (!zone || /^[+-]/.test(zone)) return false;
	try {
		new Intl.DateTimeFormat('en', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

export function localDate(instant: string, zone: string): string {
	return Temporal.Instant.from(instant)
		.toZonedDateTimeISO(zone)
		.toPlainDate()
		.toString()
		.replaceAll('-', '');
}
