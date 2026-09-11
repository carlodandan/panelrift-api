import type { CoverConfig } from '../lib/covers';
import { resolveCoverUrl } from '../lib/covers';
import { cleanText, lastPathSegment, toNumber } from '../lib/html';
import type { ManhwaSummary } from '../types';
import { TextBuffer, attr, htmlResponse, runRewriter } from './support';

interface Draft {
	title: TextBuffer;
	titleAttr: string | null;
	slug: string | null;
	cover: string | null;
	latestChapter: TextBuffer;
	lastUpdated: TextBuffer;
	rating: TextBuffer;
}

function newDraft(): Draft {
	return {
		title: new TextBuffer(),
		titleAttr: null,
		slug: null,
		cover: null,
		latestChapter: new TextBuffer(),
		lastUpdated: new TextBuffer(),
		rating: new TextBuffer(),
	};
}

function finish(draft: Draft, config: CoverConfig): ManhwaSummary | null {
	const title = draft.titleAttr ?? cleanText(draft.title.raw);
	if (!title || !draft.slug) return null;

	const ratingText = cleanText(draft.rating.raw).replace(/[★☆]/g, '');
	const updated = cleanText(draft.lastUpdated.raw).replace(/^[·•‧]\s*/, '');

	return {
		title,
		slug: draft.slug,
		cover_url: resolveCoverUrl(draft.cover, config),
		latest_chapter: cleanText(draft.latestChapter.raw) || null,
		last_updated: updated || null,
		rating: toNumber(ratingText),
	};
}

/**
 * Parse the upstream autocomplete fragment.
 *
 * Shape: `ul > li.novel-item > a[href][title] > (figure img, h4.novel-title,
 * div.novel-stats > (strong, span, span[style]))`. The stats block holds three
 * values distinguished only by position and inline style, so the element handler
 * classifies each span before its text arrives.
 */
export async function parseSearch(response: Response, config: CoverConfig): Promise<ManhwaSummary[]> {
	const results: ManhwaSummary[] = [];
	let draft: Draft | null = null;
	let statSpan: 'updated' | 'rating' | 'other' = 'other';

	const rewriter = new HTMLRewriter()
		.on('li.novel-item', {
			element(element) {
				if (draft) {
					const done = finish(draft, config);
					if (done) results.push(done);
				}
				draft = newDraft();
				element.onEndTag(() => {
					if (draft) {
						const done = finish(draft, config);
						if (done) results.push(done);
					}
					draft = null;
				});
			},
		})
		.on('li.novel-item a', {
			element(element) {
				if (!draft) return;
				const href = attr(element, 'href');
				if (href && !draft.slug) draft.slug = lastPathSegment(href);
				const title = attr(element, 'title');
				if (title && !draft.titleAttr) draft.titleAttr = cleanText(title);
			},
		})
		.on('li.novel-item img', {
			element(element) {
				if (!draft || draft.cover) return;
				// `data-src` first: covers are lazy-loaded and `src` is a placeholder.
				draft.cover = attr(element, 'data-src') ?? attr(element, 'src');
			},
		})
		.on('li.novel-item h4.novel-title', {
			text(chunk) {
				draft?.title.append(chunk.text);
			},
		})
		.on('li.novel-item .novel-stats strong', {
			text(chunk) {
				draft?.latestChapter.append(chunk.text);
			},
		})
		.on('li.novel-item .novel-stats span', {
			element(element) {
				const style = element.getAttribute('style') ?? '';
				// The rating span is the only one carrying an inline colour.
				statSpan = /color\s*:/i.test(style) ? 'rating' : 'updated';
			},
			text(chunk) {
				if (!draft) return;
				if (statSpan === 'rating') draft.rating.append(chunk.text);
				else if (statSpan === 'updated') draft.lastUpdated.append(chunk.text);
			},
		});

	await runRewriter(rewriter, response);

	// Flush a trailing item if the document ended without a closing tag.
	if (draft) {
		const done = finish(draft, config);
		if (done) results.push(done);
	}

	return results;
}

/** Parse a fixture string. Test convenience wrapper. */
export function parseSearchHtml(html: string, config: CoverConfig): Promise<ManhwaSummary[]> {
	return parseSearch(htmlResponse(html), config);
}
