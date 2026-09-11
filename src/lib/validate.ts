import { badRequest } from './errors';

/**
 * Slugs and chapter ids are interpolated into upstream URLs, so they are
 * validated against an allowlist rather than sanitised. Rejecting junk here also
 * means a malformed request never costs an upstream fetch — without this, any
 * client can burn the outbound budget with random paths.
 */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,180}$/i;

function assertSafeSegment(value: string, field: string): string {
	if (!SLUG_PATTERN.test(value)) {
		throw badRequest(`invalid_${field}`, `${field} must be 1-181 characters of letters, digits, '.', '_' or '-'`);
	}
	if (value.includes('..')) {
		throw badRequest(`invalid_${field}`, `${field} must not contain '..'`);
	}
	return value.toLowerCase();
}

/** Validate a series slug, e.g. "solo-leveling-mg1". */
export function parseSlug(raw: string | undefined): string {
	if (!raw) throw badRequest('missing_slug', 'A manhwa slug is required');
	return assertSafeSegment(decodeURIComponent(raw), 'slug');
}

/** Validate a chapter id, e.g. "solo-leveling-chapter-155-eng-li". */
export function parseChapterId(raw: string | undefined): string {
	if (!raw) throw badRequest('missing_chapter_id', 'A chapter id is required');
	return assertSafeSegment(decodeURIComponent(raw), 'chapter_id');
}

export const MIN_SEARCH_TERM = 2;
export const MAX_SEARCH_TERM = 100;

/**
 * Validate a search term. Bounded on both ends: a single character matches
 * nearly everything upstream, and an unbounded term lets a client push
 * arbitrary payloads into the outbound URL.
 */
export function parseSearchTerm(raw: string | null): string {
	const term = (raw ?? '').trim();
	if (term.length < MIN_SEARCH_TERM) {
		throw badRequest('term_too_short', `term must be at least ${MIN_SEARCH_TERM} characters`);
	}
	if (term.length > MAX_SEARCH_TERM) {
		throw badRequest('term_too_long', `term must be at most ${MAX_SEARCH_TERM} characters`);
	}
	return term;
}

export const DEFAULT_PER_PAGE = 100;
export const MAX_PER_PAGE = 500;

/** Validate pagination params, clamping rather than rejecting out-of-range sizes. */
export function parsePagination(url: URL): { page: number; perPage: number } {
	const rawPage = url.searchParams.get('page');
	const rawPerPage = url.searchParams.get('per_page');

	const page = rawPage === null ? 1 : Number.parseInt(rawPage, 10);
	if (!Number.isFinite(page) || page < 1) {
		throw badRequest('invalid_page', 'page must be a positive integer');
	}

	let perPage = rawPerPage === null ? DEFAULT_PER_PAGE : Number.parseInt(rawPerPage, 10);
	if (!Number.isFinite(perPage) || perPage < 1) {
		throw badRequest('invalid_per_page', 'per_page must be a positive integer');
	}
	perPage = Math.min(perPage, MAX_PER_PAGE);

	return { page, perPage };
}

/**
 * Upper bound on `?page=`. Listings run to a few hundred pages, so this is not a
 * limit any real client meets; it stops a caller minting unbounded cache keys,
 * each of which costs one upstream fetch.
 */
export const MAX_PAGE = 10_000;

/**
 * Validate a 1-based `?page=` on a listing whose page size upstream fixes.
 *
 * Separate from `parsePagination` on purpose: there is no `per_page` to honour
 * here, and rejecting one the endpoint cannot act on would only mislead.
 */
export function parsePageNumber(raw: string | null): number {
	if (raw === null) return 1;

	const page = Number.parseInt(raw, 10);
	if (!Number.isFinite(page) || page < 1) {
		throw badRequest('invalid_page', 'page must be a positive integer');
	}
	if (page > MAX_PAGE) {
		throw badRequest('invalid_page', `page must be at most ${MAX_PAGE}`);
	}

	return page;
}

const RANKING_PERIODS = ['1d', '1w', '1m'] as const;
export type RankingPeriodKey = (typeof RANKING_PERIODS)[number];

/** Validate a ranking period against the three the upstream API supports. */
export function parsePeriod(raw: string | null): RankingPeriodKey {
	if (raw !== null && !RANKING_PERIODS.includes(raw as RankingPeriodKey)) {
		throw badRequest('invalid_period', `period must be one of ${RANKING_PERIODS.join(', ')}`);
	}
	return (raw ?? '1d') as RankingPeriodKey;
}

export { RANKING_PERIODS };
export interface BrowseQuery {
	page: number;
	sort?: string;
	include_genres?: string;
	exclude_genres?: string;
	status?: string;
	type?: string;
}

export function parseBrowseQuery(url: URL): BrowseQuery {
	const page = parsePageNumber(url.searchParams.get('page'));
	const sort = url.searchParams.get('sort') || undefined;
	const include_genres = url.searchParams.get('include_genres') || undefined;
	const exclude_genres = url.searchParams.get('exclude_genres') || undefined;
	const status = url.searchParams.get('status') || undefined;
	const type = url.searchParams.get('type') || undefined;

	return {
		page,
		sort,
		include_genres,
		exclude_genres,
		status,
		type,
	};
}
