import nlp from 'compromise';
import dates from 'compromise-dates';
import { referenceDate, validZone } from './calendarAdapter';

const english = nlp.extend(dates);

/** Recognition only. Relative arithmetic, precision policy and clock pairing belong to ReScript. */
export type EnglishDateEvidence = {
	start: number;
	end: number;
	unit: 'day' | 'month';
	offset: number;
	day: number;
	period: string;
};

type DateMatch = { offset?: { start: number; length: number } };

export function recognizeEnglishDates(
	text: string,
	referenceInstant: string,
	zone: string
): EnglishDateEvidence[] {
	try {
		const today = referenceDate(referenceInstant, zone);
		if (!today || !validZone(zone)) return [];
		const recognized: DateMatch[] = english(text)
			.dates({ today, timezone: zone })
			.json({ offset: true });
		return recognized.flatMap(({ offset }) => {
			if (
				!offset ||
				!Number.isInteger(offset.start) ||
				!Number.isInteger(offset.length) ||
				offset.start < 0 ||
				offset.length <= 0 ||
				offset.start + offset.length > text.length
			)
				return [];
			const fragment = text.slice(offset.start, offset.start + offset.length);
			// The recognizer sometimes includes a label such as 'Season:' in its match.
			const prefix = /^[a-z][a-z ]*:\s*/i.exec(fragment)?.[0].length ?? 0;
			const source = fragment.slice(prefix);
			// Keep this precision gate deliberately small. Library range bounds and default
			// hours are never source evidence. Existing English rules remain authoritative.
			const match =
				/^(?:(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)\s+of\s+)?next\s+month\b|^(tonight|tomorrow\s+(?:night|evening|morning|afternoon))\b/i.exec(
					source
				);
			if (!match) return [];
			const suffix = source.slice(match[0].length);
			if (!/^[\s.,!?;]*$/.test(suffix) && !/^\s+(?:(?:at|from)\s+)?\d/i.test(suffix)) return [];
			const period = match[2]?.toLowerCase();
			return [
				{
					start: offset.start + prefix,
					end: offset.start + prefix + match[0].length,
					unit: period ? ('day' as const) : ('month' as const),
					offset: period === 'tonight' ? 0 : 1,
					day: match[1] ? Number(match[1]) : 0,
					period: period ? (period === 'tonight' ? 'night' : period.split(/\s+/)[1]) : ''
				}
			];
		});
	} catch {
		// Dependency failures must leave the deterministic parser available.
		return [];
	}
}
