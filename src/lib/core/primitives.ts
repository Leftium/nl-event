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
