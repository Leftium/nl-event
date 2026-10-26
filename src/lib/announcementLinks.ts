import { find } from 'linkifyjs';

export type LinkKind = 'Form' | 'Sheet' | 'Short link' | 'Veneer' | 'Map' | 'Other';
export type LinkRole = 'Signup' | 'Confirmation' | 'Location';
export type AnnouncementLink = {
	identity: string;
	source: string;
	href: string;
	kind: LinkKind;
	form: boolean;
	sheet: boolean;
	roles: LinkRole[];
	context: string;
	start: number;
	end: number;
};

function classify(url: URL) {
	const host = url.hostname.toLowerCase();
	const path = url.pathname;
	const veneer = host === 'veneer.leftium.com' && /^\/[sfgbhu]\.[\w-]+(?:\/|$)/.test(path);
	const prefix = veneer ? path.slice(1, 2) : '';
	const form =
		(host === 'docs.google.com' && /^\/forms\/(?:u\/\d+\/)?d\/(?:e\/)?[^/]+/.test(path)) ||
		(host === 'forms.gle' && path.length > 1) ||
		(veneer && ['f', 'g'].includes(prefix));
	const sheet =
		(host === 'docs.google.com' && /^\/spreadsheets\/d\/(?:e\/)?[^/]+/.test(path)) ||
		(veneer && prefix === 's');
	const map =
		[
			'map.naver.com',
			'naver.me',
			'map.kakao.com',
			'kko.to',
			'maps.app.goo.gl',
			'maps.google.com'
		].includes(host) ||
		(/^(?:www\.)?google\.(?:com|co\.kr)$/.test(host) && /^\/maps(?:\/|$)/.test(path)) ||
		(host === 'goo.gl' && /^\/maps(?:\/|$)/.test(path));
	const kind: LinkKind = veneer
		? 'Veneer'
		: form
			? 'Form'
			: sheet
				? 'Sheet'
				: map
					? 'Map'
					: ['bit.ly', 'shorturl.at', 'url.kr'].includes(host)
						? 'Short link'
						: 'Other';
	return { kind, form, sheet };
}

/** Local metadata only; source text and source offsets are never rewritten. */
export function discoverLinks(description: string): AnnouncementLink[] {
	const matches = find(description).filter((match) => match.type === 'url');
	const links = new Map<string, AnnouncementLink>();
	for (let index = 0; index < matches.length; index++) {
		const match = matches[index];
		const href = match.href.replace(/&amp;/gi, '&');
		let url: URL;
		try {
			url = new URL(href);
		} catch {
			continue;
		}
		if (!['http:', 'https:'].includes(url.protocol)) continue;
		const identity = url.href;
		const lineStart = description.lastIndexOf('\n', match.start - 1) + 1;
		const nextNewline = description.indexOf('\n', match.end);
		const lineEnd = nextNewline < 0 ? description.length : nextNewline;
		// Cues stop at adjacent URLs so one label does not identify every link on a line.
		let before = description.slice(
			Math.max(lineStart, matches[index - 1]?.end ?? 0, match.start - 80),
			match.start
		);
		const after = description.slice(
			match.end,
			Math.min(lineEnd, matches[index + 1]?.start ?? description.length, match.end + 80)
		);
		// A standalone URL can belong to the immediately preceding label, never a
		// distant paragraph, blank line, or another URL's line.
		if (
			lineStart > 0 &&
			!description.slice(lineStart, match.start).trim() &&
			!description.slice(match.end, lineEnd).trim()
		) {
			const previousStart = description.lastIndexOf('\n', lineStart - 2) + 1;
			const previousLine = description.slice(previousStart, lineStart - 1);
			if (
				previousLine.trim() &&
				previousLine.length <= 80 &&
				(matches[index - 1]?.end ?? 0) <= previousStart
			) {
				before = previousLine + '\n' + before;
			}
		}
		const roles: LinkRole[] = [];
		for (const [role, pattern] of [
			['Signup', /신청|등록|\b(?:sign[ -]?up|register|registration)\b/i],
			['Confirmation', /확인|\b(?:confirmation|confirm|responses?)\b/i],
			['Location', /장소|위치|\b(?:location|venue|map)\b/i]
		] as const) {
			if (pattern.test(before + ' ' + after)) roles.push(role);
		}
		const existing = links.get(identity);
		if (existing) {
			existing.roles = [...new Set([...existing.roles, ...roles])];
			continue;
		}
		links.set(identity, {
			identity,
			source: match.value,
			href,
			...classify(url),
			roles,
			context: `${before}${match.value}${after}`.trim(),
			start: match.start,
			end: match.end
		});
	}
	return [...links.values()];
}

export function primarySignup(links: AnnouncementLink[], explicit?: string | null) {
	if (explicit === null) return undefined;
	if (
		explicit &&
		links.some((link) => link.identity === explicit && !link.sheet && link.kind !== 'Map')
	)
		return explicit;
	const candidates = links.filter(
		(link) => link.form || (!link.sheet && link.roles.includes('Signup') && link.kind !== 'Map')
	);
	return candidates.length === 1 && candidates[0].form ? candidates[0].identity : undefined;
}
