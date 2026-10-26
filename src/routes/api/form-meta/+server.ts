import { json } from '@sveltejs/kit';
import { readMetadata, signupSource, VENEER_ORIGIN } from '../../../lib/calendarDescription';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, request }) => {
	const headers = { 'Cache-Control': 'no-store' };
	const origin = request.headers.get('origin');
	if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
		return json({ status: 'forbidden_origin' }, { status: 403, headers });
	}
	const entries = [...url.searchParams.entries()];
	const input = url.searchParams.get('id') ?? '';
	const source = input.length <= 2048 ? signupSource(input) : undefined;
	if (entries.length !== 1 || entries[0][0] !== 'id' || !source) {
		return json({ status: 'invalid_input' }, { status: 400, headers });
	}
	try {
		// Fixed origin and path; only a validated, query-free identifier leaves this app.
		// SvelteKit's event.fetch adds our Origin to cross-origin requests. Veneer's
		// server API requires no Origin, so use native fetch with no inherited headers.
		const upstream = await globalThis.fetch(
			`${VENEER_ORIGIN}/api/form-meta?id=${encodeURIComponent(source.id)}`,
			{
				credentials: 'omit',
				redirect: 'error',
				headers: { Accept: 'application/json' },
				signal: AbortSignal.timeout(18000)
			}
		);
		if (!upstream.ok || !upstream.headers.get('content-type')?.includes('application/json')) {
			return json(
				{ status: 'upstream_error', upstreamStatus: upstream.status },
				{ status: 502, headers }
			);
		}
		// Bound the response even if the upstream contract regresses.
		const reader = upstream.body?.getReader();
		if (!reader) throw new Error('Missing response');
		const decoder = new TextDecoder();
		let text = '';
		let bytes = 0;
		try {
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				bytes += value.byteLength;
				if (bytes > 1024 * 1024) throw new Error('Metadata too large');
				text += decoder.decode(value, { stream: true });
			}
			text += decoder.decode();
		} finally {
			await reader.cancel();
		}
		return json(readMetadata(JSON.parse(text)), { headers });
	} catch {
		return json({ status: 'unavailable' }, { status: 502, headers });
	}
};
