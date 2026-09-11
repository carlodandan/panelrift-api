import { absoluteUrl, cleanText, lastPathSegment } from '../lib/html';
import type { Chapter } from '../types';
import { TextBuffer, attr, hasClass, htmlResponse, runRewriter } from './support';

/**
 * Parse a reader page.
 *
 * Page images are `<img id="image-N" src="...">`. The previous implementation
 * filtered on a `sv2/comic/` path fragment that no longer appears anywhere in the
 * markup, so `images` was always empty — the id prefix is the stable signal.
 */
export async function parseChapter(response: Response, chapterId: string, baseUrl: string): Promise<Chapter> {
	const manhwaTitle = new TextBuffer();
	const chapterTitle = new TextBuffer();
	const images: string[] = [];
	let manhwaSlug: string | null = null;
	let prevId: string | null = null;
	let nextId: string | null = null;
	let chapterTitleDone = false;

	const rewriter = new HTMLRewriter()
		.on('h1 a', {
			element(element) {
				if (manhwaSlug) return;
				const href = attr(element, 'href');
				if (href) manhwaSlug = lastPathSegment(href);
			},
			text(chunk) {
				manhwaTitle.append(chunk.text);
			},
		})
		.on('h2', {
			element(element) {
				element.onEndTag(() => {
					// Only the first h2 is the chapter heading.
					if (!chapterTitle.isEmpty) chapterTitleDone = true;
				});
			},
			text(chunk) {
				if (!chapterTitleDone) chapterTitle.append(chunk.text);
			},
		})
		.on('.chapternav a', {
			element(element) {
				const href = attr(element, 'href');
				if (!href) return; // "#" placeholder means there is no such neighbour.
				const id = lastPathSegment(href);
				if (!id) return;
				// Both navs (top and bottom) carry the same links; keep the first seen.
				if (hasClass(element, 'prevchap')) prevId ??= id;
				else if (hasClass(element, 'nextchap')) nextId ??= id;
			},
		})
		.on('img[id^="image-"]', {
			element(element) {
				const src = attr(element, 'data-src') ?? attr(element, 'src');
				const resolved = absoluteUrl(src, baseUrl);
				if (resolved && !images.includes(resolved)) images.push(resolved);
			},
		});

	await runRewriter(rewriter, response);

	return {
		id: chapterId,
		manhwa_title: cleanText(manhwaTitle.raw) || null,
		manhwa_slug: manhwaSlug,
		chapter_title: cleanText(chapterTitle.raw) || null,
		prev_chapter_id: prevId,
		next_chapter_id: nextId,
		images,
		page_count: images.length,
	};
}

/** Parse a fixture string. Test convenience wrapper. */
export function parseChapterHtml(html: string, chapterId: string, baseUrl: string): Promise<Chapter> {
	return parseChapter(htmlResponse(html), chapterId, baseUrl);
}
