import type { CoverConfig } from '../lib/covers';
import { resolveCoverUrl } from '../lib/covers';
import { cleanText, lastPathSegment, toInteger, toNumber } from '../lib/html';
import type { Manhwa } from '../types';
import { TextBuffer, attr, htmlResponse, runRewriter } from './support';
import { parseChapterList } from './chapterList';

const STATUS_CLASSES = ['ongoing', 'completed', 'hiatus', 'dropped', 'cancelled'];

interface StatDraft {
	value: TextBuffer;
	label: TextBuffer;
	statusClass: string | null;
}

/**
 * Parse the series detail page.
 *
 * Two passes over one body is not possible, so the chapter list on this page is
 * parsed separately from a tee'd copy. Note that upstream truncates the detail
 * page's list — the caller sets `chapters_truncated` accordingly.
 */
export async function parseManhwa(
	response: Response,
	slug: string,
	config: CoverConfig,
): Promise<Omit<Manhwa, 'chapters' | 'chapters_truncated'>> {
	const title = new TextBuffer();
	const altTitle = new TextBuffer();
	const author = new TextBuffer();
	const description = new TextBuffer();
	const lastUpdated = new TextBuffer();
	const ratingCandidates: TextBuffer[] = [];
	const genres: string[] = [];
	const stats: StatDraft[] = [];
	let cover: string | null = null;
	let currentGenre: TextBuffer | null = null;
	let currentRating: TextBuffer | null = null;
	// True while inside a Material Icons <i> element within a stat value.
	let inStatIcon = false;

	const rewriter = new HTMLRewriter()
		.on('h1.novel-title', {
			text: (chunk) => title.append(chunk.text),
		})
		.on('h2.alternative-title', {
			text: (chunk) => altTitle.append(chunk.text),
		})
		.on('[itemprop="author"]', {
			text: (chunk) => author.append(chunk.text),
		})
		.on('p.description', {
			text: (chunk) => description.append(chunk.text),
		})
		.on('.updinfo strong', {
			text: (chunk) => lastUpdated.append(chunk.text),
		})
		.on('img.lazy', {
			element(element) {
				if (cover) return;
				// `src` is a shared placeholder image; the real cover is in `data-src`.
				cover = attr(element, 'data-src') ?? attr(element, 'src');
			},
		})
		.on('.categories ul li a', {
			element(element) {
				currentGenre = new TextBuffer();
				element.onEndTag(() => {
					const value = cleanText(currentGenre?.raw ?? '');
					if (value && !genres.includes(value)) genres.push(value);
					currentGenre = null;
				});
			},
			text(chunk) {
				currentGenre?.append(chunk.text);
			},
		})
		.on('.rating strong', {
			element(element) {
				currentRating = new TextBuffer();
				ratingCandidates.push(currentRating);
				element.onEndTag(() => {
					currentRating = null;
				});
			},
			text(chunk) {
				currentRating?.append(chunk.text);
			},
		})
		.on('.header-stats span', {
			element(element) {
				const draft: StatDraft = {
					value: new TextBuffer(),
					label: new TextBuffer(),
					statusClass: null,
				};
				stats.push(draft);
				element.onEndTag(() => {});
			},
		})
		.on('.header-stats span strong', {
			element(element) {
				const draft = stats[stats.length - 1];
				if (!draft) return;
				const classes = (element.getAttribute('class') ?? '').split(/\s+/);
				draft.statusClass = classes.find((name) => STATUS_CLASSES.includes(name)) ?? null;
			},
			text(chunk) {
				// Skip the icon's ligature keyword; it is presentation, not a value.
				if (!inStatIcon) stats[stats.length - 1]?.value.append(chunk.text);
			},
		})
		.on('.header-stats span strong i', {
			element(element) {
				// Upstream renders stats as `<strong><i class="material-icons">visibility
				// </i>4.2M</strong>`. Without this the view count reads "visibility4.2M".
				inStatIcon = true;
				element.onEndTag(() => {
					inStatIcon = false;
				});
			},
		})
		.on('.header-stats span small', {
			text(chunk) {
				stats[stats.length - 1]?.label.append(chunk.text);
			},
		});

	await runRewriter(rewriter, response);

	// Rating is rendered as `<strong>8.5<span>(1,234)</span></strong>`, so the
	// number and its vote count arrive concatenated in one text run.
	let rating: number | null = null;
	let ratingCount: number | null = null;
	for (const candidate of ratingCandidates) {
		const match = /([\d.]+)\s*\(\s*([\d,]+)\s*\)/.exec(cleanText(candidate.raw));
		if (match) {
			rating = toNumber(match[1]);
			ratingCount = toInteger(match[2]);
			break;
		}
	}

	let status: string | null = null;
	let views: string | null = null;
	let bookmarks: string | null = null;
	let chapterCount: string | null = null;

	for (const stat of stats) {
		const value = cleanText(stat.value.raw);
		const label = cleanText(stat.label.raw).toLowerCase();
		if (stat.statusClass) {
			status = value || stat.statusClass;
			continue;
		}
		if (!value) continue;
		if (label.startsWith('view')) views = value;
		else if (label.startsWith('bookmark')) bookmarks = value;
		else if (label.startsWith('chapter')) chapterCount = value;
	}

	return {
		title: cleanText(title.raw),
		slug,
		alternative_title: cleanText(altTitle.raw) || null,
		author: cleanText(author.raw) || null,
		status,
		cover_url: resolveCoverUrl(cover, config),
		description: cleanText(description.raw).replace(/^the summary is\s*/i, '') || null,
		genres,
		rating,
		rating_count: ratingCount,
		views,
		bookmarks,
		chapter_count: chapterCount,
		last_updated: cleanText(lastUpdated.raw) || null,
	};
}

/**
 * Parse detail fields and the (partial) chapter list from one upstream response.
 *
 * The body is tee'd because HTMLRewriter consumes it and the two parsers need
 * different handler sets.
 */
export async function parseManhwaPage(response: Response, slug: string, config: CoverConfig): Promise<Manhwa> {
	const body = response.body;
	if (!body) {
		const details = await parseManhwa(response, slug, config);
		return { ...details, chapters: [], chapters_truncated: true };
	}

	const [forDetails, forChapters] = body.tee();
	const headers = response.headers;
	const [details, chapters] = await Promise.all([
		parseManhwa(new Response(forDetails, { headers }), slug, config),
		parseChapterList(new Response(forChapters, { headers })),
	]);

	return { ...details, chapters, chapters_truncated: true };
}

/** Parse a fixture string. Test convenience wrapper. */
export function parseManhwaHtml(html: string, slug: string, config: CoverConfig): Promise<Manhwa> {
	return parseManhwaPage(htmlResponse(html), slug, config);
}

export { lastPathSegment };
