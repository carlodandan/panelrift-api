import type { CoverConfig } from '../lib/covers';
import { resolveCoverUrl } from '../lib/covers';
import { cleanText, lastPathSegment, toInteger, toNumber } from '../lib/html';
import type { BrowseEntry } from '../types';
import { TextBuffer, attr, htmlResponse, runRewriter } from './support';

interface Draft {
	altTitle: string | null;
	title: TextBuffer;
	slug: string | null;
	cover: string | null;
	badge: TextBuffer;
	description: TextBuffer;
	rating: TextBuffer;
	/** The three figures upstream renders, one per sort mode. */
	weekly: TextBuffer;
	monthly: TextBuffer;
	allTime: TextBuffer;
}

function newDraft(): Draft {
	return {
		altTitle: null,
		title: new TextBuffer(),
		slug: null,
		cover: null,
		badge: new TextBuffer(),
		description: new TextBuffer(),
		rating: new TextBuffer(),
		weekly: new TextBuffer(),
		monthly: new TextBuffer(),
		allTime: new TextBuffer(),
	};
}

/** First of these buffers holding a parseable integer. */
function firstInteger(...buffers: TextBuffer[]): number | null {
	for (const buffer of buffers) {
		const value = toInteger(cleanText(buffer.raw));
		if (value !== null) return value;
	}
	return null;
}

function finish(draft: Draft, config: CoverConfig): BrowseEntry | null {
	// The `<img alt>` carries the full title; the `<h3>` is ellipsised upstream at a
	// fixed width, so preferring it hands clients "The Strongest Priest: There's
	// Nothing Wrong with Wielding a Hammer, R…".
	const title = draft.altTitle ?? cleanText(draft.title.raw);
	if (!title || !draft.slug) return null;

	return {
		title,
		slug: draft.slug,
		cover_url: resolveCoverUrl(draft.cover, config),
		description: cleanText(draft.description.raw) || null,
		// The value arrives as "⭐ 4.9", so the star has to go before parsing.
		rating: toNumber(cleanText(draft.rating.raw).replace(/[^\d.]/g, '')),
		views: firstInteger(draft.allTime, draft.monthly, draft.weekly),
		badge: cleanText(draft.badge.raw) || null,
	};
}

/**
 * Parse the card grid upstream returns in the browse endpoint's `results_html`.
 *
 * Shape: `article.comic-card > (.comic-card__cover > (span.comic-card__badge,
 * a[href] > img[src][alt]), .comic-card__content > (h3.comic-card__title > a,
 * p.comic-card__description, .comic-card__stats > (.comic-card__stat--hot >
 * (span.stat-weekly, span.stat-monthly, span.stat-alltime),
 * .comic-card__stat--rating)))`.
 *
 * All three anchors in a card point at the same series, so the first `href` wins
 * and the slug survives any one of them being restyled away.
 */
export async function parseComicCards(response: Response, config: CoverConfig): Promise<BrowseEntry[]> {
	const results: BrowseEntry[] = [];
	let draft: Draft | null = null;

	const flush = () => {
		if (!draft) return;
		const done = finish(draft, config);
		if (done) results.push(done);
		draft = null;
	};

	const rewriter = new HTMLRewriter()
		.on('article.comic-card', {
			element(element) {
				// Flush on the next start tag as well as on the end tag, so an unclosed
				// article costs one entry rather than every entry after it.
				flush();
				draft = newDraft();
				element.onEndTag(flush);
			},
		})
		.on('article.comic-card a', {
			element(element) {
				if (!draft || draft.slug) return;
				const href = attr(element, 'href');
				if (href) draft.slug = lastPathSegment(href);
			},
		})
		.on('article.comic-card img', {
			element(element) {
				if (!draft) return;
				// `data-src` first in case these covers ever become lazy-loaded like the
				// ones on listing and detail pages; today only `src` is populated.
				if (!draft.cover) draft.cover = attr(element, 'data-src') ?? attr(element, 'src');
				if (!draft.altTitle) draft.altTitle = cleanText(element.getAttribute('alt') ?? '') || null;
			},
		})
		.on('article.comic-card .comic-card__badge', {
			text: (chunk) => draft?.badge.append(chunk.text),
		})
		.on('article.comic-card h3.comic-card__title', {
			text: (chunk) => draft?.title.append(chunk.text),
		})
		.on('article.comic-card p.comic-card__description', {
			text: (chunk) => draft?.description.append(chunk.text),
		})
		.on('article.comic-card .comic-card__stat--rating', {
			text: (chunk) => draft?.rating.append(chunk.text),
		})
		.on('article.comic-card .stat-weekly', {
			text: (chunk) => draft?.weekly.append(chunk.text),
		})
		.on('article.comic-card .stat-monthly', {
			text: (chunk) => draft?.monthly.append(chunk.text),
		})
		.on('article.comic-card .stat-alltime', {
			text: (chunk) => draft?.allTime.append(chunk.text),
		});

	await runRewriter(rewriter, response);

	// Flush a trailing card if the fragment ended without a closing tag.
	flush();

	return results;
}

/** Parse an HTML fragment string, which is how upstream delivers this grid. */
export function parseComicCardsHtml(html: string, config: CoverConfig): Promise<BrowseEntry[]> {
	return parseComicCards(htmlResponse(html), config);
}
