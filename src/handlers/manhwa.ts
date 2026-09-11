import type { Config, RateLimitBinding } from '../lib/env';
import { parseError } from '../lib/errors';
import { fetchUpstream } from '../lib/upstream';
import { parseChapterList } from '../parsers/chapterList';
import { parseManhwaPage } from '../parsers/manhwa';
import type { ChapterList, Manhwa } from '../types';

/**
 * Series detail pages live at `/manga/{slug}/`.
 *
 * The previous implementation requested `/manhwa/{slug}/`, which upstream answers
 * with a 404 — the whole endpoint was dead.
 */
function detailPath(slug: string): string {
	return `/manga/${encodeURIComponent(slug)}/`;
}

function allChaptersPath(slug: string): string {
	return `/manga/${encodeURIComponent(slug)}/all-chapters/`;
}

/** Fetch and parse one series' detail record. */
export async function fetchManhwa(slug: string, config: Config, limiter?: RateLimitBinding): Promise<Manhwa> {
	const response = await fetchUpstream(detailPath(slug), config, {
		describe: `Manhwa '${slug}'`,
		limiter,
	});

	const manhwa = await parseManhwaPage(response, slug, config);

	// A detail page without a title means the markup changed; better to surface a
	// 502 than to hand the client a record full of nulls with a 200.
	if (!manhwa.title) {
		throw parseError(`the title for '${slug}'`, detailPath(slug));
	}

	return manhwa;
}

/**
 * Fetch the complete chapter list.
 *
 * The detail page truncates its list (about 50 entries against 200+ actual), so
 * the full set comes from the dedicated `/all-chapters/` page and is paginated
 * here rather than returned as one unbounded array.
 */
export async function fetchChapterList(
	slug: string,
	page: number,
	perPage: number,
	config: Config,
	limiter?: RateLimitBinding,
): Promise<ChapterList> {
	const response = await fetchUpstream(allChaptersPath(slug), config, {
		describe: `Chapters for '${slug}'`,
		limiter,
	});

	const chapters = await parseChapterList(response);
	if (chapters.length === 0) {
		throw parseError(`any chapters for '${slug}'`, allChaptersPath(slug));
	}

	const start = (page - 1) * perPage;
	return {
		slug,
		total: chapters.length,
		page,
		per_page: perPage,
		chapters: chapters.slice(start, start + perPage),
	};
}
