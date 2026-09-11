import type { Config, RateLimitBinding } from '../lib/env';
import type { CoverConfig } from '../lib/covers';
import { resolveCoverUrl } from '../lib/covers';
import { cleanText, toNumber } from '../lib/html';
import { fetchUpstreamJson } from '../lib/upstream';
import type { RankingPeriodKey } from '../lib/validate';
import { RANKING_PERIODS } from '../lib/validate';
import { parseError } from '../lib/errors';
import type { Home, ManhwaSummary, RankingPeriod } from '../types';

/**
 * Upstream ranking payload.
 *
 * The list key is `manga`, not `manhwa`. The previous code checked for `manhwa`,
 * so the branch that resolved cover URLs never ran and every cover came back as a
 * path like "/media/manga_covers/x.png".
 *
 * `cover_url` is still only that path even now the branch runs — this endpoint is
 * the one place covers arrive as bare storage paths rather than absolute URLs, and
 * the origin does not serve all of them. resolveCoverUrl is what fixes that.
 */
interface UpstreamRanking {
	manga?: unknown;
	manhwa?: unknown;
	period?: unknown;
}

interface UpstreamItem {
	name?: unknown;
	title?: unknown;
	slug?: unknown;
	cover_url?: unknown;
	latest_chapter?: unknown;
	last_updated?: unknown;
	rating?: unknown;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? cleanText(value) : null);

function toSummary(raw: UpstreamItem, config: CoverConfig): ManhwaSummary | null {
	const title = str(raw.name) ?? str(raw.title);
	const slug = str(raw.slug);
	if (!title || !slug) return null;

	return {
		title,
		slug,
		cover_url: resolveCoverUrl(typeof raw.cover_url === 'string' ? raw.cover_url : null, config),
		latest_chapter: str(raw.latest_chapter),
		last_updated: str(raw.last_updated),
		rating: typeof raw.rating === 'number' ? raw.rating : toNumber(str(raw.rating)),
	};
}

/**
 * Normalise an upstream ranking payload into the public shape.
 *
 * Pure and exported so the list-key and cover-URL handling can be tested without
 * any network access.
 */
export function normalizeRanking(payload: UpstreamRanking, period: string, config: CoverConfig): RankingPeriod {
	const list = payload.manga ?? payload.manhwa;
	if (!Array.isArray(list)) {
		throw parseError(`the '${period}' ranking list`, 'expected an array under "manga"');
	}

	const manhwa = list.map((item) => toSummary((item ?? {}) as UpstreamItem, config)).filter((item): item is ManhwaSummary => item !== null);

	return { period: str(payload.period) ?? period, manhwa };
}

/** Fetch one ranking period. */
export async function fetchRanking(period: RankingPeriodKey, config: Config, limiter?: RateLimitBinding): Promise<RankingPeriod> {
	const payload = await fetchUpstreamJson<UpstreamRanking>(`/api/most-viewed/?period=${encodeURIComponent(period)}`, config, {
		describe: `Ranking period '${period}'`,
		accept: 'json',
		limiter,
	});

	return normalizeRanking(payload, period, config);
}

/**
 * Fetch all three ranking periods.
 *
 * `allSettled`, not `all`: one failing period used to take the whole endpoint
 * down with it. Partial results are reported alongside the failures.
 */
export async function fetchHome(config: Config, limiter?: RateLimitBinding): Promise<Home> {
	const settled = await Promise.allSettled(RANKING_PERIODS.map((period) => fetchRanking(period, config, limiter)));

	const home: Home = { '1d': null, '1w': null, '1m': null, errors: [] };

	RANKING_PERIODS.forEach((period, index) => {
		const outcome = settled[index];
		if (outcome?.status === 'fulfilled') home[period] = outcome.value;
		else home.errors.push(period);
	});

	// Only fail outright when nothing at all could be fetched.
	if (home.errors.length === RANKING_PERIODS.length) {
		const first = settled.find((outcome) => outcome.status === 'rejected');
		throw first && first.status === 'rejected' ? first.reason : parseError('any ranking period', 'all periods failed');
	}

	return home;
}
