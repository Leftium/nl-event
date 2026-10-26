import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});
const response = (extra = {}) =>
	new Response(
		JSON.stringify({
			status: 'ok',
			type: 'form',
			documentId: 'f.SYNTHETIC',
			infoText: 'Intro',
			autoSheets: [],
			autoSheetsStatus: 'complete',
			...extra
		}),
		{ headers: { 'Content-Type': 'application/json' } }
	);

it('does no work on import, reuses in-flight and completed requests, aliases canonical Forms, and refreshes explicitly', async () => {
	let resolve!: (value: Response) => void;
	const fetcher = vi.fn(
		() =>
			new Promise<Response>((done) => {
				resolve = done;
			})
	);
	vi.stubGlobal('fetch', fetcher);
	const { loadFormMetadata } = await import('../src/lib/formMetadata');
	expect(fetcher).not.toHaveBeenCalled();
	const first = loadFormMetadata('g.SHORT');
	expect(loadFormMetadata('g.SHORT')).toBe(first);
	resolve(response());
	await first;
	expect(loadFormMetadata('f.SYNTHETIC')).toBe(first);
	expect(loadFormMetadata('g.SHORT')).toBe(first);
	expect(fetcher).toHaveBeenCalledTimes(1);
	const refreshed = loadFormMetadata('g.SHORT', true);
	expect(fetcher).toHaveBeenLastCalledWith(
		'/api/form-meta?id=f.SYNTHETIC',
		expect.objectContaining({ credentials: 'omit', cache: 'no-store' })
	);
	resolve(response({ infoText: 'New intro' }));
	expect((await refreshed).infoText).toBe('New intro');
});

it('checks JSON failure status on HTTP 200 and evicts failures for retry', async () => {
	const fetcher = vi
		.fn()
		.mockResolvedValueOnce(response({ status: 'unavailable', type: null }))
		.mockResolvedValueOnce(response());
	vi.stubGlobal('fetch', fetcher);
	const { loadFormMetadata } = await import('../src/lib/formMetadata');
	await expect(loadFormMetadata('f.SYNTHETIC')).rejects.toThrow('unavailable');
	await expect(loadFormMetadata('f.SYNTHETIC')).resolves.toMatchObject({ infoText: 'Intro' });
	expect(fetcher).toHaveBeenCalledTimes(2);
	await expect(loadFormMetadata('https://evil.example')).rejects.toThrow('Unsupported');
	expect(fetcher).toHaveBeenCalledTimes(2);
});

it('keeps a late short-link response from replacing a refreshed canonical response', async () => {
	const pending: ((value: Response) => void)[] = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)))
	);
	const { loadFormMetadata } = await import('../src/lib/formMetadata');
	const short = loadFormMetadata('g.SHORT');
	const canonical = loadFormMetadata('f.SYNTHETIC', true);
	pending[1](response({ infoText: 'New' }));
	await canonical;
	pending[0](response({ infoText: 'Old' }));
	await short;
	expect((await loadFormMetadata('g.SHORT')).infoText).toBe('New');
});

it('reports proxy and upstream HTTP errors without exposing response content', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					status: 'upstream_error',
					upstreamStatus: 403
				}),
				{ status: 502 }
			)
		)
	);
	const { loadFormMetadata } = await import('../src/lib/formMetadata');
	await expect(loadFormMetadata('f.SYNTHETIC')).rejects.toThrow(
		'HTTP 502; Veneer returned HTTP 403'
	);
});
