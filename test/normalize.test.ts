import { describe, expect, it } from 'vitest';
import { normalizeRanking } from '../src/handlers/home';
import { normalizeBrowse } from '../src/handlers/browse';
import { readConfig } from '../src/lib/env';
import { resolveCoverUrl } from '../src/lib/covers';
import { absoluteUrl, cleanText, decodeEntities, toInteger, toNumber } from '../src/lib/html';
import { parsePageNumber, parsePagination, parseSearchTerm, parseSlug, parseChapterId, MAX_PAGE } from '../src/lib/validate';
import { cacheKeyFor } from '../src/lib/cache';

const BASE = 'https://upstream.example.test';
const CONFIG = readConfig({ UPSTREAM_BASE_URL: BASE });
const PROXIED = 'https://imgsrv5.com/avatar/288x412';

describe('normalizeRanking', () => {
	it('reads the list from the "manga" key upstream actually uses', () => {
		const result = normalizeRanking(
			{ manga: [{ name: 'Alpha', slug: 'alpha-x1', cover_url: '/media/a.png' }], period: '1d' },
			'1d',
			CONFIG,
		);
		expect(result.period).toBe('1d');
		expect(result.manhwa).toHaveLength(1);
		expect(result.manhwa[0]?.title).toBe('Alpha');
	});

	it('sends the bare cover paths this endpoint returns through the image proxy', () => {
		const result = normalizeRanking({ manga: [{ name: 'Alpha', slug: 'alpha-x1', cover_url: '/media/a.png' }] }, '1d', CONFIG);
		// Two regressions in one line. The branch used to key off "manhwa" and never
		// ran, so clients received a bare path; then it resolved against the site
		// origin, which does not serve every stored cover and 404'd for some series.
		expect(result.manhwa[0]?.cover_url).toBe(`${PROXIED}/media/a.png`);
	});

	it('still accepts a "manhwa" key if upstream ever renames it back', () => {
		const result = normalizeRanking({ manhwa: [{ name: 'Beta', slug: 'beta-x2' }] }, '1w', CONFIG);
		expect(result.manhwa[0]?.slug).toBe('beta-x2');
	});

	it('yields null covers instead of fabricating a URL', () => {
		const result = normalizeRanking({ manga: [{ name: 'Alpha', slug: 'alpha-x1' }] }, '1d', CONFIG);
		// The old absoluteUrl(undefined) produced "<base>/undefined".
		expect(result.manhwa[0]?.cover_url).toBeNull();
	});

	it('drops entries missing a title or slug', () => {
		const result = normalizeRanking({ manga: [{ name: 'Alpha', slug: 'alpha-x1' }, { name: 'No slug' }, {}, null] }, '1d', CONFIG);
		expect(result.manhwa).toHaveLength(1);
	});

	it('coerces a string rating and rejects junk', () => {
		const result = normalizeRanking(
			{
				manga: [
					{ name: 'A', slug: 'a', rating: '8.4' },
					{ name: 'B', slug: 'b', rating: 'n/a' },
				],
			},
			'1d',
			CONFIG,
		);
		expect(result.manhwa[0]?.rating).toBe(8.4);
		expect(result.manhwa[1]?.rating).toBeNull();
	});

	it('throws a 502 when the payload is not shaped like a ranking', () => {
		expect(() => normalizeRanking({ manga: 'nope' as unknown }, '1d', CONFIG)).toThrowError(/markup may have changed|ranking list/);
	});
});

describe('normalizeBrowse', () => {
	const CARD = `
		<article class="comic-card">
			<div class="comic-card__cover"><a href="/manga/alpha-x1/"><img src="/media/a.png" alt="Alpha"></a></div>
			<div class="comic-card__content"><h3 class="comic-card__title"><a href="/manga/alpha-x1/">Alpha</a></h3></div>
		</article>`;

	it('passes the paginator counts through and reports the page size it got', async () => {
		const list = await normalizeBrowse(
			{ results_html: CARD, total_results: 6961, page: 1, num_pages: 291 },
			{ page: 1, sort: 'recently_added' },
			CONFIG,
		);
		expect(list).toMatchObject({ sort: 'recently_added', page: 1, count: 1, total: 6961, total_pages: 291 });
		expect(list.results[0]?.cover_url).toBe(`${PROXIED}/media/a.png`);
	});

	it('trusts the page upstream says it served over the one that was asked for', async () => {
		const list = await normalizeBrowse({ results_html: CARD, page: 291, num_pages: 291 }, { page: 999, sort: 'recently_added' }, CONFIG);
		expect(list.page).toBe(291);
	});

	it('nulls the counts rather than guessing when upstream omits them', async () => {
		const list = await normalizeBrowse({ results_html: CARD }, { page: 1, sort: 'recently_added' }, CONFIG);
		expect(list.total).toBeNull();
		expect(list.total_pages).toBeNull();
	});

	it('relabels the badge to "New" and leaves a card without one alone', async () => {
		// Upstream stamps "Trending" on every card, page 150 included, so its wording
		// says nothing. Presence stays upstream's call; the label is ours.
		const badged = `
			<article class="comic-card">
				<div class="comic-card__cover">
					<span class="comic-card__badge comic-card__badge--trending">Trending</span>
					<a href="/manga/alpha-x1/"><img src="/media/a.png" alt="Alpha"></a>
				</div>
			</article>`;
		const list = await normalizeBrowse({ results_html: badged + CARD, num_pages: 1 }, { page: 1, sort: 'recently_added' }, CONFIG);
		expect(list.results.map((entry) => entry.badge)).toEqual(['New', null]);
	});

	it('throws a 502 when the payload carries no results_html at all', async () => {
		await expect(normalizeBrowse({ total_results: 10, num_pages: 1 }, { page: 1, sort: 'recently_added' }, CONFIG)).rejects.toThrowError(
			/markup may have changed/,
		);
	});

	it('throws a 502 when a page upstream claims exists yields no cards', async () => {
		// Cards present but unrecognised is exactly what an upstream markup change
		// looks like, and it must not come back as an empty 200.
		await expect(
			normalizeBrowse({ results_html: '<div class="not-a-card"></div>', num_pages: 291 }, { page: 2, sort: 'recently_added' }, CONFIG),
		).rejects.toThrowError(/markup may have changed/);
	});

	it('accepts an empty page past the end of the listing', async () => {
		const list = await normalizeBrowse(
			{ results_html: '\n\n', total_results: 6961, page: 400, num_pages: 291 },
			{ page: 400, sort: 'recently_added' },
			CONFIG,
		);
		expect(list.count).toBe(0);
		expect(list.results).toEqual([]);
	});
});

describe('resolveCoverUrl', () => {
	it('prefixes a bare storage path with the proxy and size', () => {
		expect(resolveCoverUrl('/media/manga_covers/x.jpg', CONFIG)).toBe(`${PROXIED}/media/manga_covers/x.jpg`);
	});

	it('rewrites an absolute proxy URL onto the configured size', () => {
		// Listings and detail pages hand us 288x412 already, but upstream also emits
		// 157x211 for its own thumbnails. Normalising both means one canonical URL
		// per cover across every endpoint, which keeps client caches warm.
		expect(resolveCoverUrl('https://imgsrv5.com/avatar/157x211/media/manga_covers/x.jpg', CONFIG)).toBe(
			`${PROXIED}/media/manga_covers/x.jpg`,
		);
	});

	it('treats the shared placeholder as no cover', () => {
		expect(resolveCoverUrl('https://imgsrv5.com/avatar/288x412/media/manga_covers/default-placeholder.png', CONFIG)).toBeNull();
		expect(resolveCoverUrl('/media/manga_covers/default-placeholder.webp', CONFIG)).toBeNull();
	});

	it('leaves a URL alone when it is not an upstream media path', () => {
		expect(resolveCoverUrl('https://other.test/covers/x.jpg', CONFIG)).toBe('https://other.test/covers/x.jpg');
	});

	it('returns null for absent or unparseable input', () => {
		expect(resolveCoverUrl(null, CONFIG)).toBeNull();
		expect(resolveCoverUrl('  ', CONFIG)).toBeNull();
	});

	it('falls back to the origin when the proxy is switched off', () => {
		const direct = readConfig({ UPSTREAM_BASE_URL: BASE, COVER_BASE_URL: '' });
		expect(resolveCoverUrl('/media/manga_covers/x.jpg', direct)).toBe(`${BASE}/media/manga_covers/x.jpg`);
	});

	it('honours an overridden proxy and size', () => {
		const custom = readConfig({ UPSTREAM_BASE_URL: BASE, COVER_BASE_URL: 'https://images.test/', COVER_SIZE: '157x211' });
		expect(resolveCoverUrl('/media/manga_covers/x.jpg', custom)).toBe('https://images.test/avatar/157x211/media/manga_covers/x.jpg');
	});
});

describe('html helpers', () => {
	it('decodes named, decimal and hex entities', () => {
		// Escapes rather than literals: the difference between U+0020 and U+00A0 is
		// invisible in source and makes a failure impossible to read.
		expect(decodeEntities('a &amp; b &#39;c&#39; &#x2014; d')).toBe("a & b 'c' — d");
		expect(decodeEntities('x&nbsp;y')).toBe('x y');
		// cleanText then collapses the non-breaking space like any other whitespace.
		expect(cleanText('x&nbsp;&nbsp;y')).toBe('x y');
	});

	it('leaves unknown entities untouched', () => {
		expect(decodeEntities('&notreal; &#xZZZZ;')).toBe('&notreal; &#xZZZZ;');
	});

	it('collapses whitespace after decoding', () => {
		expect(cleanText('  Hello \n\t  &amp;  world  ')).toBe('Hello & world');
	});

	it('returns null for absent or unparseable URLs', () => {
		expect(absoluteUrl(null, BASE)).toBeNull();
		expect(absoluteUrl(undefined, BASE)).toBeNull();
		expect(absoluteUrl('   ', BASE)).toBeNull();
		expect(absoluteUrl('/x.png', BASE)).toBe(`${BASE}/x.png`);
		expect(absoluteUrl('https://other.test/x.png', BASE)).toBe('https://other.test/x.png');
	});

	it('returns null instead of NaN for numbers', () => {
		expect(toNumber('8.7')).toBe(8.7);
		expect(toNumber('1,234')).toBe(1234);
		expect(toNumber('n/a')).toBeNull();
		expect(toNumber(null)).toBeNull();
		expect(toInteger('12,345')).toBe(12345);
		expect(toInteger('')).toBeNull();
	});
});

describe('validation', () => {
	it('accepts ordinary slugs and chapter ids', () => {
		expect(parseSlug('alpha-tale-x1')).toBe('alpha-tale-x1');
		expect(parseChapterId('alpha-tale-chapter-205-eng-li')).toBe('alpha-tale-chapter-205-eng-li');
	});

	it('rejects path traversal and separators', () => {
		for (const bad of ['../etc', 'a/b', '..', 'a b', '', 'a?b=1', 'a#b', '%2e%2e']) {
			expect(() => parseSlug(bad)).toThrowError();
		}
	});

	it('rejects percent-encoded traversal after decoding', () => {
		expect(() => parseSlug('%2E%2E%2Fadmin')).toThrowError();
	});

	it('bounds search terms at both ends', () => {
		expect(parseSearchTerm('  solo ')).toBe('solo');
		expect(() => parseSearchTerm('a')).toThrowError(/at least/);
		expect(() => parseSearchTerm(null)).toThrowError(/at least/);
		expect(() => parseSearchTerm('x'.repeat(101))).toThrowError(/at most/);
	});

	it('clamps per_page rather than rejecting it', () => {
		const url = new URL('https://api.test/v1/manhwa/a/chapters?page=2&per_page=99999');
		expect(parsePagination(url)).toEqual({ page: 2, perPage: 500 });
	});

	it('rejects non-numeric pagination', () => {
		expect(() => parsePagination(new URL('https://api.test/x?page=0'))).toThrowError();
		expect(() => parsePagination(new URL('https://api.test/x?page=abc'))).toThrowError();
	});

	it('defaults a listing page to 1 and bounds it', () => {
		expect(parsePageNumber(null)).toBe(1);
		expect(parsePageNumber('7')).toBe(7);
		expect(parsePageNumber(String(MAX_PAGE))).toBe(MAX_PAGE);
		for (const bad of ['0', '-3', 'abc', '', String(MAX_PAGE + 1)]) {
			// An unbounded page is an unbounded supply of cache keys, one upstream
			// fetch apiece.
			expect(() => parsePageNumber(bad)).toThrowError(/page must be/);
		}
	});
});

describe('cacheKeyFor', () => {
	it('drops params that do not affect the response', () => {
		const key = cacheKeyFor(new Request('https://api.test/v1/search?term=solo&utm_source=x&r=9'));
		// Without this, ?junk=N is an unbounded cache-buster straight to upstream.
		expect(key.url).toBe('https://api.test/v1/search?term=solo');
	});

	it('orders params so equivalent requests share one entry', () => {
		const a = cacheKeyFor(new Request('https://api.test/v1/manhwa/a/chapters?page=2&per_page=50'));
		const b = cacheKeyFor(new Request('https://api.test/v1/manhwa/a/chapters?per_page=50&page=2'));
		expect(a.url).toBe(b.url);
	});
});

describe('readConfig', () => {
	it('falls back to defaults for absent or invalid values', () => {
		const config = readConfig({});
		expect(config.baseUrl).toBe('https://www.mgeko.cc');
		expect(config.timeoutMs).toBe(8000);
		// Deny by default: an absent ALLOWED_ORIGINS must not silently open the API
		// to every site, so it resolves to an empty allowlist rather than "*".
		expect(config.allowedOrigins).toEqual([]);
		expect(config.coverBaseUrl).toBe('https://imgsrv5.com');
		expect(config.coverSize).toBe('288x412');
	});

	it('opens up to any origin only when asked explicitly', () => {
		expect(readConfig({ ALLOWED_ORIGINS: '*' }).allowedOrigins).toBe('*');
	});

	it('parses an explicit origin allowlist and trims the base URL', () => {
		const config = readConfig({
			UPSTREAM_BASE_URL: 'https://example.test/',
			UPSTREAM_TIMEOUT_MS: '2500',
			ALLOWED_ORIGINS: 'https://a.test, https://b.test',
		});
		expect(config.baseUrl).toBe('https://example.test');
		expect(config.timeoutMs).toBe(2500);
		expect(config.allowedOrigins).toEqual(['https://a.test', 'https://b.test']);
	});

	it('ignores a non-numeric timeout', () => {
		expect(readConfig({ UPSTREAM_TIMEOUT_MS: 'soon' }).timeoutMs).toBe(8000);
	});
});
