import { readMetadata, signupSource, type FormMetadata } from './calendarDescription';

// Browser session memory only. A rejected request is evicted so Retry can fetch again.
const cache = new Map<string, Promise<FormMetadata>>();
const aliases = new Map<string, string>();
const MAX_CACHED_FORMS = 32;

export function loadFormMetadata(id: string, refresh = false): Promise<FormMetadata> {
	if (signupSource(id)?.id !== id) return Promise.reject(new Error('Unsupported signup link'));
	const key = aliases.get(id) ?? id;
	const existing = cache.get(key);
	if (existing && !refresh) return existing;
	const request = fetch(`/api/form-meta?id=${encodeURIComponent(key)}`, {
		credentials: 'omit',
		cache: 'no-store',
		signal: AbortSignal.timeout(20000)
	})
		.then(async (response) => {
			if (!response.ok) {
				const failure = await response.json().catch(() => null);
				const upstream =
					failure?.status === 'upstream_error' && Number.isInteger(failure.upstreamStatus)
						? `; Veneer returned HTTP ${failure.upstreamStatus}`
						: '';
				throw new Error(`Form details request failed (HTTP ${response.status}${upstream}).`);
			}
			const metadata = readMetadata(await response.json());
			if (metadata.status !== 'ok')
				throw new Error(`Form details unavailable (${metadata.status})`);
			if (cache.get(key) === request && metadata.type === 'form' && metadata.documentId) {
				aliases.set(id, metadata.documentId);
				if (!cache.has(metadata.documentId)) cache.set(metadata.documentId, request);
				while (aliases.size > MAX_CACHED_FORMS) aliases.delete(aliases.keys().next().value!);
			}
			return metadata;
		})
		.catch((error) => {
			if (cache.get(key) === request) cache.delete(key);
			throw error;
		});
	cache.set(key, request);
	while (cache.size > MAX_CACHED_FORMS) cache.delete(cache.keys().next().value!);
	return request;
}
