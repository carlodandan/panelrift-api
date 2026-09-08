// src/handlers/browse.ts

import type { CoverConfig } from '../lib/covers';
import type { Config, RateLimitBinding } from '../lib/env';
import { parseError } from '../lib/errors';
import { fetchUpstreamJson } from '../lib/upstream';
import { parseComicCardsHtml } from '../parsers/browse';
import type { BrowseList } from '../types';
import type { BrowseQuery } from '../lib/validate';

/** Upstream's sort key for this listing. */
export const RECENTLY_ADDED = 'recently_added';

/**
 * What a badge on this listing is relabelled to.
 *
 * Upstream stamps every card "Trending" - all 24 on page 1, and all 24 on page
 * 150, where the series are months old. It is boilerplate from its shared card
 * template rather than a signal, and on a listing sorted by recency it is simply
 * wrong. Entries that carry a badge get the label the endpoint can actually
 * stand behind; the parser still reports upstream's own text, so a change there
 * stays visible in the fixtures.
 */
const BADGE = 'New';

/**
 * The browse endpoint answers with JSON, not a page: an HTML fragment of cards
 * plus the paginator's own counts. `page` is validated to a bounded integer
 * before it reaches here, so interpolating it needs no further escaping.
 */
function browsePath(query: BrowseQuery): string {
	const params = new URLSearchParams();
	params.set('page', query.page.toString());
	if (query.sort) params.set('sort', query.sort);
	if (query.include_genres) params.set('include_genres', query.include_genres);
	if (query.exclude_genres) params.set('exclude_genres', query.exclude_genres);
	if (query.status) params.set('status', query.status);
	if (query.type) params.set('type', query.type);
	return `/browse-comics/data/?${params.toString()}`;
}

/**
 * Upstream's browse payload. `results_html` is the grid; the rest is the Django
 * paginator's state, which is cheaper to pass through than to recompute.
 */
interface UpstreamBrowse {
	results_html?: unknown;
	total_results?: unknown;
	page?: unknown;
	num_pages?: unknown;
}

const int = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : null);

/**
 * Normalise a browse payload into the public shape.
 *
 * Exported so the envelope handling and the empty-page rule can be tested with
 * no network access.
 */
export async function normalizeBrowse(payload: UpstreamBrowse, query: BrowseQuery, config: CoverConfig): Promise<BrowseList> {
	if (typeof payload.results_html !== 'string') {
		throw parseError('the browse listing', 'no "results_html" string in the browse payload');
	}

	const cards = await parseComicCardsHtml(payload.results_html, config);

	const isRecentlyAdded = query.sort === RECENTLY_ADDED;
	// Presence is upstream's to decide, the wording is ours if sort=recently_added. See BADGE.
	const results = cards.map((entry) => {
		if (isRecentlyAdded && entry.badge !== null) {
			return { ...entry, badge: BADGE };
		}
		return entry;
	});
	const totalPages = int(payload.num_pages);

	// Zero cards on a page upstream itself claims exists means the card markup
	// changed. A page past the end is a different thing and stays a valid empty
	// answer rather than a 502.
	// Only throw if there are no filters, because with filters, 0 results can be valid even on page 1.
	const hasFilters = query.include_genres || query.exclude_genres || query.status || query.type;
	if (results.length === 0 && (totalPages === null || query.page <= totalPages)) {
		if (totalPages !== 0 && !hasFilters) {
			throw parseError('any series from the browse listing', browsePath(query));
		}
	}

	return {
		sort: query.sort ?? 'default',
		// Upstream's echo is what it actually served, which may differ from the ask.
		page: int(payload.page) ?? query.page,
		count: results.length,
		total: int(payload.total_results),
		total_pages: totalPages,
		results,
	};
}

/** Fetch one page of the recently-added listing. */
export async function fetchRecentlyAdded(page: number, config: Config, limiter?: RateLimitBinding): Promise<BrowseList> {
	return fetchBrowse({ page, sort: RECENTLY_ADDED }, config, limiter);
}

/** Fetch one page of a generic browse listing with filters. */
export async function fetchBrowse(query: BrowseQuery, config: Config, limiter?: RateLimitBinding): Promise<BrowseList> {
	const payload = await fetchUpstreamJson<UpstreamBrowse>(browsePath(query), config, {
		describe: `Browse page ${query.page}`,
		accept: 'json',
		limiter,
	});

	return normalizeBrowse(payload, query, config);
}
