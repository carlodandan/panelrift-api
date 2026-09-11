import { Hono, type Context } from 'hono';
import { POLICIES } from './lib/cache';
import { readConfig, type AppEnv } from './lib/env';
import { fetchRecentlyAdded, fetchBrowse } from './handlers/browse';
import { fetchChapter } from './handlers/chapter';
import { fetchHome, fetchRanking } from './handlers/home';
import { fetchChapterList, fetchManhwa } from './handlers/manhwa';
import { searchManhwa } from './handlers/search';
import {
	allowOriginFor,
	errorHandler,
	jsonWithCache,
	withConfig,
	withCors,
	withEdgeCache,
	withProxySecret,
	withRateLimit,
} from './middleware';
import {
	parseChapterId,
	parsePageNumber,
	parsePagination,
	parsePeriod,
	parseSearchTerm,
	parseSlug,
	parseBrowseQuery,
} from './lib/validate';

const app = new Hono<AppEnv>();

app.use('*', withConfig);
app.use('*', withCors);
// Ahead of the rate limiters and the cache: an unauthorised caller should cost a
// digest and nothing more. No-ops when PROXY_SECRET is unset.
app.use('*', withProxySecret);
app.onError(errorHandler);

// Search gets its own, tighter budget: clients fire it on every keystroke.
app.use(
	'/v1/search',
	withRateLimit((env) => env.SEARCH_LIMITER),
);
app.use(
	'/autocomplete',
	withRateLimit((env) => env.SEARCH_LIMITER),
);
app.use(
	'/v1/*',
	withRateLimit((env) => env.READ_LIMITER),
);
app.use(
	'/home',
	withRateLimit((env) => env.READ_LIMITER),
);
app.use(
	'/manhwa/*',
	withRateLimit((env) => env.READ_LIMITER),
);
app.use(
	'/recently_added',
	withRateLimit((env) => env.READ_LIMITER),
);
app.use(
	'/v1/browse',
	withRateLimit((env) => env.READ_LIMITER),
);
app.use(
	'/browse',
	withRateLimit((env) => env.READ_LIMITER),
);
app.use(
	'/reader/*',
	withRateLimit((env) => env.READ_LIMITER),
);

app.use('/v1/*', withEdgeCache);
app.use('/home', withEdgeCache);
app.use('/manhwa/*', withEdgeCache);
app.use('/recently_added', withEdgeCache);
app.use('/browse', withEdgeCache);
app.use('/reader/*', withEdgeCache);
app.use('/autocomplete', withEdgeCache);

app.options('*', (c) => c.body(null, 204));

app.get('/', (c) =>
	jsonWithCache(
		c,
		{
			name: 'manhwa-api',
			version: 'v1',
			endpoints: [
				{ path: '/v1/home', description: 'Most-viewed rankings. Optional ?period=1d|1w|1m' },
				{ path: '/v1/recently_added', description: 'Newest series first. Supports ?page= (1-based)' },
				{
					path: '/v1/browse',
					description: 'Browse/filter series. Supports ?page=, ?sort=, ?include_genres=, ?exclude_genres=, ?status=, ?type=',
				},
				{ path: '/v1/search?term={term}', description: 'Search series by title (min 2 chars)' },
				{ path: '/v1/manhwa/{slug}', description: 'Series details plus recent chapters' },
				{
					path: '/v1/manhwa/{slug}/chapters',
					description: 'Full chapter list. Supports ?page= and ?per_page=',
				},
				{ path: '/v1/chapters/{chapterId}', description: 'Chapter page images and neighbours' },
			],
			notes: [
				'chapterId comes from a chapter listing and is opaque; do not construct it.',
				'Unversioned paths (/home, /manhwa/{slug}, /autocomplete) are deprecated aliases.',
				'/recently_added is an alias of /v1/recently_added, not a deprecated path.',
				'/browse is an alias of /v1/browse, not a deprecated path.',
			],
		},
		POLICIES.root,
	),
);

app.get('/v1/home', async (c) => {
	const limiter = c.env.UPSTREAM_LIMITER;
	const config = c.get('config');
	const raw = c.req.query('period');

	// ?period= returns one period; omitting it returns all three.
	if (raw !== undefined) {
		const period = parsePeriod(raw);
		return jsonWithCache(c, await fetchRanking(period, config, limiter), POLICIES.home);
	}

	return jsonWithCache(c, await fetchHome(config, limiter), POLICIES.home);
});

/**
 * Newest series first, one upstream page at a time.
 *
 * Upstream fixes the page size, so only `?page=` is accepted — see
 * `parsePageNumber`. Shared by the versioned path and the `/recently_added` alias
 * clients asked for; unlike the aliases below, that one is not deprecated.
 */
async function recentlyAdded(c: Context<AppEnv>): Promise<Response> {
	const page = parsePageNumber(c.req.query('page') ?? null);
	const list = await fetchRecentlyAdded(page, c.get('config'), c.env.UPSTREAM_LIMITER);
	return jsonWithCache(c, list, POLICIES.recentlyAdded);
}

app.get('/v1/recently_added', recentlyAdded);
app.get('/recently_added', recentlyAdded);

async function browseSeries(c: Context<AppEnv>): Promise<Response> {
	const query = parseBrowseQuery(new URL(c.req.url));
	const list = await fetchBrowse(query, c.get('config'), c.env.UPSTREAM_LIMITER);
	// We can reuse the recentlyAdded cache policy since they have the same shape and constraints.
	return jsonWithCache(c, list, POLICIES.recentlyAdded);
}

app.get('/v1/browse', browseSeries);
app.get('/browse', browseSeries);

app.get('/v1/search', async (c) => {
	const term = parseSearchTerm(c.req.query('term') ?? null);
	const results = await searchManhwa(term, c.get('config'), c.env.UPSTREAM_LIMITER);
	return jsonWithCache(c, { term, count: results.length, results }, POLICIES.search);
});

app.get('/v1/manhwa/:slug/chapters', async (c) => {
	const slug = parseSlug(c.req.param('slug'));
	const { page, perPage } = parsePagination(new URL(c.req.url));
	const list = await fetchChapterList(slug, page, perPage, c.get('config'), c.env.UPSTREAM_LIMITER);
	return jsonWithCache(c, list, POLICIES.chapterList);
});

app.get('/v1/manhwa/:slug', async (c) => {
	const slug = parseSlug(c.req.param('slug'));
	const manhwa = await fetchManhwa(slug, c.get('config'), c.env.UPSTREAM_LIMITER);
	return jsonWithCache(c, manhwa, POLICIES.manhwa);
});

app.get('/v1/chapters/:chapterId', async (c) => {
	const chapterId = parseChapterId(c.req.param('chapterId'));
	const chapter = await fetchChapter(chapterId, c.get('config'), c.env.UPSTREAM_LIMITER);
	return jsonWithCache(c, chapter, POLICIES.chapter);
});

/**
 * Deprecated unversioned aliases, kept so existing clients keep working.
 *
 * `/reader/en/{chapterId}` is preserved in shape only: the id is upstream's own
 * chapter slug, not `{slug}-chapter-{n}` as the original route documented.
 */
app.get('/home', async (c) => jsonWithCache(c, await fetchHome(c.get('config'), c.env.UPSTREAM_LIMITER), POLICIES.home));

app.get('/autocomplete', async (c) => {
	const term = parseSearchTerm(c.req.query('term') ?? null);
	const results = await searchManhwa(term, c.get('config'), c.env.UPSTREAM_LIMITER);
	return jsonWithCache(c, results, POLICIES.search);
});

app.get('/manhwa/:slug', async (c) => {
	const slug = parseSlug(c.req.param('slug'));
	const manhwa = await fetchManhwa(slug, c.get('config'), c.env.UPSTREAM_LIMITER);
	return jsonWithCache(c, manhwa, POLICIES.manhwa);
});

app.get('/reader/en/:chapterId', async (c) => {
	const chapterId = parseChapterId(c.req.param('chapterId'));
	const chapter = await fetchChapter(chapterId, c.get('config'), c.env.UPSTREAM_LIMITER);
	return jsonWithCache(c, chapter, POLICIES.chapter);
});

app.notFound((c) => {
	c.header('Content-Type', 'application/json; charset=utf-8');
	c.header('Cache-Control', 'no-store');
	return c.body(JSON.stringify({ error: { code: 'not_found', message: 'Unknown endpoint' } }), 404);
});

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// HEAD is handled by running the GET route and dropping the body, so clients
		// can probe cheaply instead of getting a 405.
		if (request.method === 'HEAD') {
			const response = await app.fetch(new Request(request.url, { method: 'GET', headers: request.headers }), env, ctx);
			return new Response(null, { status: response.status, headers: response.headers });
		}

		if (request.method !== 'GET' && request.method !== 'OPTIONS') {
			// This path answers before Hono runs, so it applies the allowlist itself
			// instead of inheriting it from `withCors`.
			const allowOrigin = allowOriginFor(request.headers.get('Origin'), readConfig(env).allowedOrigins);
			return new Response(JSON.stringify({ error: { code: 'method_not_allowed', message: 'Only GET is supported' } }), {
				status: 405,
				headers: {
					'Content-Type': 'application/json; charset=utf-8',
					Allow: 'GET, HEAD, OPTIONS',
					...(allowOrigin ? { 'Access-Control-Allow-Origin': allowOrigin } : {}),
					Vary: 'Origin',
				},
			});
		}

		return app.fetch(request, env, ctx);
	},
} satisfies ExportedHandler<Env>;
