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

export function referenceDate(instant: string, zone: string): string {
	try {
		return Temporal.Instant.from(instant).toZonedDateTimeISO(zone).toPlainDate().toString();
	} catch {
		return '';
	}
}
export function dateParts(date: string): {
	year: number;
	month: number;
	day: number;
	weekday: number;
} {
	const value = Temporal.PlainDate.from(date);
	return { year: value.year, month: value.month, day: value.day, weekday: value.dayOfWeek };
}
export function makeDate(year: number, month: number, day: number): string {
	try {
		return Temporal.PlainDate.from({ year, month, day }, { overflow: 'reject' }).toString();
	} catch {
		return '';
	}
}
export function addDays(date: string, days: number): string {
	try {
		return Temporal.PlainDate.from(date).add({ days }).toString();
	} catch {
		return '';
	}
}
export function distance(a: string, b: string): number {
	return Math.abs(Temporal.PlainDate.from(a).until(Temporal.PlainDate.from(b)).days);
}
export function elapsedEnd(value: string, zone: string, minutes: number): string {
	const resolution = resolve(value, zone);
	if (resolution.choices.length !== 1) return '';
	return Temporal.Instant.fromEpochMilliseconds(resolution.choices[0].epoch)
		.add({ minutes })
		.toZonedDateTimeISO(zone)
		.toPlainDateTime()
		.toString({ smallestUnit: 'minute' })
		.replace('T', ' ');
}

export function advanceInstant(
	epoch: number,
	zone: string,
	minutes: number
): { value: string; offset: string } {
	try {
		const end = Temporal.Instant.fromEpochMilliseconds(epoch)
			.add({ minutes })
			.toZonedDateTimeISO(zone);
		return {
			value: end.toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' '),
			offset: end.offset
		};
	} catch {
		return { value: '', offset: '' };
	}
}

export function advanceReference(instant: string, zone: string, minutes: number): string {
	try {
		const value = Temporal.Instant.from(instant).add({ minutes }).toZonedDateTimeISO(zone);
		if (value.year < 1 || value.year > 9999) return '';
		return value.toPlainDateTime().toString({ smallestUnit: 'minute' }).replace('T', ' ');
	} catch {
		return '';
	}
}

export function rangeDuration(start: string, end: string, allDay: boolean): number {
	try {
		const iso = (value: string) =>
			value
				.replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')
				.replace(/T(\d{2})(\d{2})(\d{2})Z$/, 'T$1:$2:$3Z');
		const amount = allDay
			? Temporal.PlainDate.from(iso(start)).until(Temporal.PlainDate.from(iso(end))).days
			: (Temporal.Instant.from(iso(end)).epochMilliseconds -
					Temporal.Instant.from(iso(start)).epochMilliseconds) /
				60000;
		return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
	} catch {
		return 0;
	}
}
