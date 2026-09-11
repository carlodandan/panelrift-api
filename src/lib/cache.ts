/**
 * Edge caching helpers.
 *
 * IMPORTANT: `caches.default` is a no-op on *.workers.dev subdomains. Deploy
 * behind a custom domain or a zone route, otherwise every request is a miss and
 * each one costs an upstream fetch.
 */

/** Query params that participate in the cache key, per route path prefix. */
const SIGNIFICANT_PARAMS: Record<string, string[]> = {
	'/v1/search': ['term'],
	'/v1/home': ['period'],
	'/autocomplete': ['term'],
	'/v1/browse': ['sort', 'include_genres', 'exclude_genres', 'status', 'type'],
	'/browse': ['sort', 'include_genres', 'exclude_genres', 'status', 'type'],
};

/**
 * Build a normalised cache key.
 *
 * Unknown params are dropped and the survivors are sorted, so `?term=x&junk=1`
 * and `?junk=2&term=x` share one entry. Using the raw URL as the key lets any
 * client bust the cache — and therefore hit upstream — with junk params.
 */
export function cacheKeyFor(request: Request): Request {
	const url = new URL(request.url);
	const significant = Object.entries(SIGNIFICANT_PARAMS).find(([prefix]) => url.pathname.startsWith(prefix))?.[1] ?? [];

	const kept = new URLSearchParams();
	for (const name of [...significant, 'page', 'per_page'].sort()) {
		const value = url.searchParams.get(name);
		if (value !== null) kept.set(name, value);
	}

	url.search = kept.toString();
	url.hash = '';
	return new Request(url.toString(), { method: 'GET' });
}

export interface CachePolicy {
	/** Edge TTL in seconds. */
	sMaxAge: number;
	/** Browser TTL in seconds. Deliberately shorter than the edge TTL. */
	maxAge: number;
	/** Seconds a stale entry may be served while it revalidates. */
	staleWhileRevalidate: number;
}

export const POLICIES = {
	root: { maxAge: 300, sMaxAge: 3600, staleWhileRevalidate: 600 },
	home: { maxAge: 60, sMaxAge: 300, staleWhileRevalidate: 600 },
	manhwa: { maxAge: 120, sMaxAge: 600, staleWhileRevalidate: 1800 },
	chapterList: { maxAge: 120, sMaxAge: 900, staleWhileRevalidate: 1800 },
	// Chapter images never change once published, so cache them hard.
	chapter: { maxAge: 3600, sMaxAge: 86400, staleWhileRevalidate: 86400 },
	search: { maxAge: 60, sMaxAge: 300, staleWhileRevalidate: 600 },
	// New series land continuously, so this ages like the rankings do.
	recentlyAdded: { maxAge: 60, sMaxAge: 300, staleWhileRevalidate: 600 },
	/**
	 * Negative cache for 404s. Without this a client requesting a nonexistent
	 * slug in a loop hits upstream on every single request, forever.
	 */
	notFound: { maxAge: 30, sMaxAge: 60, staleWhileRevalidate: 0 },
} satisfies Record<string, CachePolicy>;

export function cacheControl(policy: CachePolicy): string {
	const parts = [`public`, `max-age=${policy.maxAge}`, `s-maxage=${policy.sMaxAge}`];
	if (policy.staleWhileRevalidate > 0) {
		parts.push(`stale-while-revalidate=${policy.staleWhileRevalidate}`);
	}
	return parts.join(', ');
}

/** Look up a cached response, tolerating environments where the API is a no-op. */
export async function cacheLookup(key: Request): Promise<Response | undefined> {
	try {
		return await caches.default.match(key);
	} catch {
		return undefined;
	}
}

/** Minimal shape of the bits of ExecutionContext this module needs. */
export interface Deferrable {
	waitUntil(promise: Promise<unknown>): void;
}

/**
 * Store a response without blocking the client.
 *
 * `ctx.waitUntil` is the point: awaiting `cache.put` inline adds its latency to
 * every cache-miss response for no benefit to the caller.
 */
export function cacheStore(ctx: Deferrable | undefined, key: Request, response: Response): void {
	if (!response.headers.has('Cache-Control')) return;
	const clone = response.clone();
	const task = (async () => {
		try {
			await caches.default.put(key, clone);
		} catch {
			// Cache API unavailable (workers.dev) or response not cacheable.
		}
	})();
	if (ctx) ctx.waitUntil(task);
}

/** Weak ETag over a JSON body, so repeat clients can be answered with a 304. */
export async function weakETag(body: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(body));
	const hex = [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('')
		.slice(0, 27);
	return `W/"${hex}"`;
}
