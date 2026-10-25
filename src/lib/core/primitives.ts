export const codePoints = (text: string): string[] => Array.from(text);
export const byteLength = (text: string): number => new TextEncoder().encode(text).length;
export const replaceAll = (text: string, search: string, replacement: string): string =>
	text.replaceAll(search, replacement);

// Lexical operations only; extraction and interpretation live in the ReScript core.
export type Match = { text: string; groups: string[]; start: number; end: number };
export function matches(text: string, pattern: string): Match[] {
	return Array.from(text.matchAll(new RegExp(pattern, 'gimu')), (match) => ({
		text: match[0],
		groups: Array.from(match, (part) => part ?? ''),
		start: match.index!,
		end: match.index! + match[0].length
	}));
}
export const slice = (text: string, start: number, end: number): string => text.slice(start, end);
export const trim = (text: string): string => text.trim();
export const lower = (text: string): string => text.toLowerCase();
export const number = (text: string): number => Number(text);

/** Apply lexical removals while retaining original UTF-16 offsets for presentation. */
export function cleanSourceText(
	text: string,
	start: number,
	removals: readonly { start: number; end: number }[],
	patterns: readonly string[]
): { value: string; spans: { start: number; end: number }[] } {
	const offsets = Array.from({ length: text.length }, (_, index) => start + index);
	const remove = (from: number, until: number) => {
		text = text.slice(0, from) + text.slice(until);
		offsets.splice(from, until - from);
	};
	for (const span of [...removals].sort((a, b) => b.start - a.start)) {
		remove(span.start - start, span.end - start);
	}
	for (const pattern of patterns) {
		for (const match of matches(text, pattern).sort((a, b) => b.start - a.start)) {
			remove(match.start, match.end);
		}
	}
	for (const match of matches(text, '\\s{2,}').reverse()) {
		remove(match.start + 1, match.end);
		text = text.slice(0, match.start) + ' ' + text.slice(match.start + 1);
	}
	for (const match of matches(text, '^\\s+|\\s+$').reverse()) remove(match.start, match.end);
	const spans: { start: number; end: number }[] = [];
	for (const offset of offsets) {
		const previous = spans.at(-1);
		if (previous?.end === offset) previous.end++;
		else spans.push({ start: offset, end: offset + 1 });
	}
	return { value: text, spans };
}
