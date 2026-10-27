export const VENEER_ORIGIN = 'https://veneer.leftium.com';
const ID = '[A-Za-z0-9_-]+';
const formId = new RegExp(`^[fgbhu]\\.${ID}$`);
const sheetId = new RegExp(`^s\\.${ID}$`);

export type SignupSource = { id: string; veneerUrl: string };
export type FormMetadata = {
	status: string;
	type: 'form' | 'sheet' | null;
	documentId: string | null;
	title: string;
	infoText: string | null;
	autoSheets: { veneerId: string; title: string }[];
	autoSheetsStatus: 'complete' | 'partial' | null;
};

function httpsUrl(value: string): URL | undefined {
	try {
		const url = new URL(value);
		if (url.protocol === 'https:' && !url.username && !url.password && !url.port) return url;
	} catch {
		// Unsupported text stays local; it is never sent to the metadata service.
	}
}

/** Accept only the API's supported Form identifiers; never resolve opaque URLs locally. */
export function signupSource(value: string): SignupSource | undefined {
	if (formId.test(value)) return { id: value, veneerUrl: `${VENEER_ORIGIN}/${value}` };
	const url = httpsUrl(value);
	if (!url) return;
	if (url.origin === VENEER_ORIGIN) {
		const parts = url.pathname.replace(/\/$/, '').slice(1).split('/');
		if (
			formId.test(parts[0]) &&
			(parts.length === 1 || (parts.length === 2 && sheetId.test(parts[1])))
		)
			return { id: parts[0], veneerUrl: url.href };
		return;
	}
	let id: string | undefined;
	if (url.hostname === 'docs.google.com') {
		const match = url.pathname.match(
			new RegExp(`^/forms/d/e/(${ID})/(?:viewform|edit|preview)/?$`)
		);
		if (match) id = `f.${match[1]}`;
	} else {
		const prefix = (
			{ 'forms.gle': 'g', 'bit.ly': 'b', 'shorturl.at': 'h', 'url.kr': 'u' } as Record<
				string,
				string
			>
		)[url.hostname];
		const match = url.pathname.match(new RegExp(`^/(${ID})/?$`));
		if (prefix && match) id = `${prefix}.${match[1]}`;
	}
	return id ? { id, veneerUrl: `${VENEER_ORIGIN}/${id}` } : undefined;
}

export function sheetIdentity(value: string): string | undefined {
	if (sheetId.test(value)) return value;
	const url = httpsUrl(value);
	if (!url) return;
	const match =
		url.hostname === 'docs.google.com'
			? url.pathname.match(
					new RegExp(`^/spreadsheets/d/(?:e/)?(${ID})(?:/(?:edit|view|preview|pubhtml|pub))?/?$`)
				)
			: url.origin === VENEER_ORIGIN
				? url.pathname.match(new RegExp(`^/(s\\.${ID})/?$`))
				: null;
	if (match) return url.hostname === 'docs.google.com' ? `s.${match[1]}` : match[1];
}

export function veneerLink(source?: SignupSource, sheetOverride?: string): string | undefined {
	if (!source) return;
	if (sheetOverride === undefined || (sheetOverride !== '' && !sheetId.test(sheetOverride)))
		return source.veneerUrl;
	const url = new URL(source.veneerUrl);
	url.pathname = `/${source.id}${sheetOverride ? `/${sheetOverride}` : ''}`;
	return url.href;
}

/** Preserve each source verbatim, including repeated prose and trailing whitespace. */
function composeDescription(original: string, veneer?: string): string {
	return [veneer, original]
		.filter((section) => section != null && section !== '')
		.join('\n\n---\n\n');
}

export function formIntroduction(metadata: FormMetadata): string {
	return [metadata.title, metadata.infoText]
		.filter((text) => text != null && text !== '')
		.join('\n\n');
}

function leadingVeneerLink(description: string): (SignupSource & { length: number }) | undefined {
	const match = description.match(/^\s*(https:\/\/veneer\.leftium\.com\/\S+)[ \t]*(?:\r?\n|$)/i);
	const source = match && signupSource(match[1]);
	return source ? { ...source, length: match![0].length } : undefined;
}

function withoutLeadingVeneer(description: string): string {
	const leading = leadingVeneerLink(description);
	if (!leading) return description;
	return description.slice(leading.length).replace(/^\r?\n---\r?\n\r?\n|^\r?\n/, '');
}

function existingVeneerLinks(description: string) {
	return find(description, 'url').flatMap((match) => {
		const source = signupSource(match.href);
		return source && new URL(match.href).origin === VENEER_ORIGIN
			? [{ ...source, start: match.start, end: match.end }]
			: [];
	});
}

/** Reuse an existing URL in place, preserving the surrounding announcement. */
export function setSignupLink(description: string, url?: string, id?: string): string {
	const target = signupSource(url ?? '')?.id ?? id ?? leadingVeneerLink(description)?.id;
	const existing = existingVeneerLinks(description).filter((link) => link.id === target);
	if (url) {
		if (existing.some((link) => link.veneerUrl === url)) return description;
		if (existing.length) {
			const link = existing[0];
			return description.slice(0, link.start) + url + description.slice(link.end);
		}
		return composeDescription(withoutLeadingVeneer(description), url);
	}
	let text = description;
	for (const link of [...existing].reverse()) {
		if (leadingVeneerLink(text)?.id === target && link.start === existing[0].start) {
			text = withoutLeadingVeneer(text);
		} else text = text.slice(0, link.start) + text.slice(link.end);
	}
	return text;
}

export type FormIntroductionSection = { start: number; end: number; text: string };

export function writeFormIntroduction(
	description: string,
	text: string,
	previous?: FormIntroductionSection
): { description: string; section: FormIntroductionSection } {
	let next: string;
	let start: number;
	if (previous) {
		start = previous.start;
		next = description.slice(0, start) + text + description.slice(previous.end);
	} else {
		const leading = leadingVeneerLink(description);
		const body = leading ? withoutLeadingVeneer(description) : description;
		if (leading && (!body || signupSource(body.trim()))) {
			next = composeDescription(body ? `${text}\n\n${body}` : text, leading.veneerUrl);
			start = leading.veneerUrl.length + '\n\n---\n\n'.length;
		} else if (!description || signupSource(description.trim())) {
			next = description ? `${text}\n\n${description}` : text;
			start = 0;
		} else {
			next = `${description}\n\n---\n\n${text}`;
			start = next.length - text.length;
		}
	}
	return { description: next, section: { start, end: start + text.length, text } };
}

/** Follow textarea edits without treating a new announcement as an old imported section. */
export function trackFormIntroduction(
	previous: string,
	next: string,
	section?: FormIntroductionSection
): FormIntroductionSection | undefined {
	if (!section || previous === next) return section;
	const current = previous.slice(section.start, section.end);
	const found = current ? next.indexOf(current) : -1;
	if (
		found !== -1 &&
		next.indexOf(current, found + 1) === -1 &&
		previous.indexOf(current) === section.start &&
		previous.indexOf(current, section.start + 1) === -1
	)
		return { ...section, start: found, end: found + current.length };
	let start = 0;
	while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
	let end = previous.length;
	let nextEnd = next.length;
	while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) {
		end--;
		nextEnd--;
	}
	if (start <= section.start && end >= section.end && (start < section.start || end > section.end))
		return;
	const delta = nextEnd - end;
	const from =
		section.start <= start ? section.start : section.start >= end ? section.start + delta : start;
	const to =
		section.end <= start ? section.end : section.end >= end ? section.end + delta : nextEnd;
	return to > from ? { ...section, start: from, end: to } : undefined;
}

/** Keep only the documented plain-text metadata, never question or response data. */
export function readMetadata(value: unknown): FormMetadata {
	if (!value || typeof value !== 'object') throw new Error('Invalid metadata response');
	const data = value as Record<string, unknown>;
	if (typeof data.status !== 'string') throw new Error('Invalid metadata status');
	const type = data.type === 'form' || data.type === 'sheet' ? data.type : null;
	if (
		data.status === 'ok' &&
		(!type ||
			typeof data.documentId !== 'string' ||
			!(type === 'form' ? new RegExp(`^f\\.${ID}$`) : sheetId).test(data.documentId) ||
			(type === 'form' && typeof data.infoText !== 'string'))
	)
		throw new Error('Incomplete metadata response');
	return {
		status: data.status,
		type,
		documentId: typeof data.documentId === 'string' ? data.documentId : null,
		title: typeof data.title === 'string' ? data.title : '',
		infoText: typeof data.infoText === 'string' ? data.infoText : null,
		autoSheets: Array.isArray(data.autoSheets)
			? data.autoSheets.flatMap((sheet) =>
					sheet &&
					typeof sheet.veneerId === 'string' &&
					sheetId.test(sheet.veneerId) &&
					typeof sheet.title === 'string'
						? [{ veneerId: sheet.veneerId, title: sheet.title }]
						: []
				)
			: [],
		autoSheetsStatus:
			data.autoSheetsStatus === 'complete' || data.autoSheetsStatus === 'partial'
				? data.autoSheetsStatus
				: null
	};
}
import { find } from 'linkifyjs';
