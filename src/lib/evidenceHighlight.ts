export type EvidenceRange = { readonly start: number; readonly end: number };
export type EvidenceSegment = { text: string; highlighted: boolean };

/** UTF-16 offsets are parser-owned; reject invalid ranges rather than clipping them. */
export function evidenceSegments(
	text: string,
	ranges: readonly EvidenceRange[] = []
): EvidenceSegment[] {
	const sorted = ranges
		.filter(
			({ start, end }) =>
				Number.isInteger(start) &&
				Number.isInteger(end) &&
				start >= 0 &&
				end > start &&
				end <= text.length
		)
		.map(({ start, end }) => ({ start, end }))
		.sort((a, b) => a.start - b.start || a.end - b.end);
	const merged: { start: number; end: number }[] = [];
	for (const range of sorted) {
		const previous = merged.at(-1);
		if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
		else merged.push(range);
	}
	const segments: EvidenceSegment[] = [];
	let cursor = 0;
	for (const { start, end } of merged) {
		if (cursor < start) segments.push({ text: text.slice(cursor, start), highlighted: false });
		segments.push({ text: text.slice(start, end), highlighted: true });
		cursor = end;
	}
	if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
	return segments;
}

type EvidenceKind = 'hovered' | 'selected' | 'unselected';
export type EvidenceLayer = { kind: EvidenceKind; ranges: readonly EvidenceRange[] };

/** Preserve selection state and transient preview independently on overlapping evidence. */
export function styledEvidenceSegments(text: string, layers: readonly EvidenceLayer[]) {
	const events: { at: number; kind: EvidenceKind; delta: number }[] = [];
	for (const { kind, ranges } of layers) {
		for (const { start, end } of ranges ?? []) {
			if (
				!Number.isInteger(start) ||
				!Number.isInteger(end) ||
				start < 0 ||
				end <= start ||
				end > text.length
			)
				continue;
			events.push({ at: start, kind, delta: 1 }, { at: end, kind, delta: -1 });
		}
	}
	events.sort((a, b) => a.at - b.at);
	const active: Record<EvidenceKind, number> = { hovered: 0, selected: 0, unselected: 0 };
	const segments: {
		text: string;
		kind: 'selected' | 'unselected' | undefined;
		hovered: boolean;
	}[] = [];
	let cursor = 0;
	const append = (end: number) => {
		if (end === cursor) return;
		const kind = active.selected ? 'selected' : active.unselected ? 'unselected' : undefined;
		const hovered = active.hovered > 0;
		const previous = segments.at(-1);
		if (previous && previous.kind === kind && previous.hovered === hovered)
			previous.text += text.slice(cursor, end);
		else segments.push({ text: text.slice(cursor, end), kind, hovered });
		cursor = end;
	};
	for (const event of events) {
		append(event.at);
		active[event.kind] += event.delta;
	}
	append(text.length);
	return segments;
}
