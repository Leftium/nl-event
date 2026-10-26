import { afterEach, expect, it, vi } from 'vitest';
import { GET } from '../src/routes/api/form-meta/+server';

afterEach(() => vi.unstubAllGlobals());

function call(query: string, fetcher = vi.fn(), headers = {}) {
	const url = new URL(`http://localhost:5173/api/form-meta?${query}`);
	vi.stubGlobal('fetch', fetcher);
	return GET({
		url,
		request: new Request(url, { headers }),
		fetch: () => {
			throw new Error('Do not use SvelteKit event.fetch: it injects Origin');
		}
	} as unknown as Parameters<typeof GET>[0]);
}

it.each([
	'id=s.SHEET',
	'id=https://evil.example',
	'id=f.FORM&id=f.OTHER',
	'id=f.FORM&announcement=PRIVATE',
	'id=http://forms.gle/SHORT',
	'id=https://user:pass@forms.gle/SHORT',
	'id=' + 'A'.repeat(2049)
])('rejects unsupported proxy inputs without fetching upstream: %s', async (query) => {
	const fetcher = vi.fn();
	const response = await call(query, fetcher);
	expect(response.status).toBe(400);
	expect(fetcher).not.toHaveBeenCalled();
});

it('sends only a canonical identifier to a fixed upstream without credentials or redirects', async () => {
	const fetcher = vi.fn().mockResolvedValue(
		new Response(
			JSON.stringify({
				status: 'ok',
				type: 'form',
				documentId: 'f.FORM',
				infoText: 'Public introduction',
				autoSheets: [],
				autoSheetsStatus: 'complete',
				questions: ['PRIVATE'],
				html: '<b>PRIVATE</b>'
			}),
			{ headers: { 'Content-Type': 'application/json' } }
		)
	);
	const url = 'https://docs.google.com/forms/d/e/FORM/viewform?entry.123=PRIVATE#section';
	const response = await call(`id=${encodeURIComponent(url)}`, fetcher);
	expect(response.status).toBe(200);
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(fetcher).toHaveBeenCalledWith(
		'https://veneer.leftium.com/api/form-meta?id=f.FORM',
		expect.objectContaining({
			credentials: 'omit',
			redirect: 'error',
			headers: { Accept: 'application/json' }
		})
	);
	const body = await response.json();
	expect(body.infoText).toBe('Public introduction');
	expect(body).not.toHaveProperty('questions');
	expect(body).not.toHaveProperty('html');
});

it('preserves JSON failure status on HTTP 200 and reports upstream or malformed failures', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(
			new Response('{"status":"timeout"}', { headers: { 'Content-Type': 'application/json' } })
		)
		.mockResolvedValueOnce(new Response('<html>Unavailable</html>'))
		.mockResolvedValueOnce(
			new Response('not json', { headers: { 'Content-Type': 'application/json' } })
		)
		.mockRejectedValueOnce(new Error('timeout'));
	expect(await (await call('id=f.FORM', fetcher)).json()).toMatchObject({ status: 'timeout' });
	for (let i = 0; i < 3; i++) expect((await call('id=f.FORM', fetcher)).status).toBe(502);
});

it('rejects cross-origin requests before reaching Veneer', async () => {
	const fetcher = vi.fn();
	expect((await call('id=f.FORM', fetcher, { Origin: 'https://evil.example' })).status).toBe(403);
	expect((await call('id=f.FORM', fetcher, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
	expect(fetcher).not.toHaveBeenCalled();
});
