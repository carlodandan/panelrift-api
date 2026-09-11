import type { Config, RateLimitBinding } from '../lib/env';
import { parseError } from '../lib/errors';
import { fetchUpstream } from '../lib/upstream';
import { parseChapter } from '../parsers/chapter';
import type { Chapter } from '../types';

/**
 * Reader pages live at `/reader/en/{chapterId}/`, where `chapterId` is upstream's
 * own chapter slug — e.g. `some-series-chapter-155-eng-li`.
 *
 * It is NOT `{seriesSlug}-chapter-{n}`: the series slug and the reader slug
 * differ, so the old `/reader/en/{slug}-chapter-{n}` route always 404'd. Treat the
 * id as opaque and take it from a chapter listing.
 */
function readerPath(chapterId: string): string {
	return `/reader/en/${encodeURIComponent(chapterId)}/`;
}

/** Fetch and parse one chapter, including its page images. */
export async function fetchChapter(chapterId: string, config: Config, limiter?: RateLimitBinding): Promise<Chapter> {
	const response = await fetchUpstream(readerPath(chapterId), config, {
		describe: `Chapter '${chapterId}'`,
		limiter,
	});

	const chapter = await parseChapter(response, chapterId, config.baseUrl);

	// A reader page with no images is never legitimate: either the chapter is
	// paywalled/removed, or the image markup changed. Fail loudly.
	if (chapter.images.length === 0) {
		throw parseError(`page images for '${chapterId}'`, readerPath(chapterId));
	}

	return chapter;
}
