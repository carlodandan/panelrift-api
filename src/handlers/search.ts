import type { Config, RateLimitBinding } from '../lib/env';
import { fetchUpstream } from '../lib/upstream';
import { parseSearch } from '../parsers/search';
import type { ManhwaSummary } from '../types';

/** Search for series by term. Upstream returns an HTML fragment, not JSON. */
export async function searchManhwa(term: string, config: Config, limiter?: RateLimitBinding): Promise<ManhwaSummary[]> {
	const response = await fetchUpstream(`/autocomplete?term=${encodeURIComponent(term)}`, config, {
		describe: `Search for '${term}'`,
		limiter,
	});

	// An empty result set is a valid answer here, so no parse-error guard: a term
	// that genuinely matches nothing must not look like a scraper failure.
	return parseSearch(response, config);
}
