export const codePoints = (text: string): string[] => Array.from(text);
export const byteLength = (text: string): number => new TextEncoder().encode(text).length;
export const replaceAll = (text: string, search: string, replacement: string): string =>
	text.replaceAll(search, replacement);
