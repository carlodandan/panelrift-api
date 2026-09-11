import { cleanText, lastPathSegment } from '../lib/html';
import type { ChapterRef } from '../types';
import { TextBuffer, attr, htmlResponse, runRewriter } from './support';

interface Draft {
	id: string | null;
	number: TextBuffer;
	date: TextBuffer;
	datetime: string | null;
}

const newDraft = (): Draft => ({
	id: null,
	number: new TextBuffer(),
	date: new TextBuffer(),
	datetime: null,
});

/**
 * Recover a chapter label from its id, e.g. "...-chapter-155-eng-li" -> "155".
 *
 * The label must start with a digit, otherwise any hyphenated id containing the
 * word "chapter" would yield a nonsense label.
 */
export function numberFromId(id: string): string | null {
	const match = /-chapter-(\d[\w.-]*?)(?:-eng(?:-li)?)?\/?$/.exec(id);
	return match?.[1] ?? null;
}

/**
 * Upstream writes dates like "July 13, 2024, 5:46 a.m." in `datetime`.
 *
 * Date.parse rejects both the "a.m." spelling and the comma before the time, so
 * normalise before parsing rather than silently returning null.
 *
 * The value carries no timezone, so it is interpreted as UTC. Letting the runtime
 * apply its local zone instead would make the same page parse to different
 * timestamps depending on where the code runs.
 */
function toIso(raw: string | null): string | null {
	if (!raw) return null;
	const normalized = raw
		// No trailing \b here: "a.m." ends on a period, so there is no word boundary
		// after it and an anchored pattern would never match.
		.replace(/\ba\.?m\.?/i, 'AM')
		.replace(/\bp\.?m\.?/i, 'PM')
		.replace(/(\d{4}),\s*/, '$1 ')
		.trim();
	for (const candidate of [`${normalized} UTC`, normalized, raw]) {
		const parsed = Date.parse(candidate);
		if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
	}
	return null;
}

function finish(draft: Draft): ChapterRef | null {
	if (!draft.id) return null;
	const text = cleanText(draft.number.raw).replace(/^chapter[:\s-]*/i, '');
	const number = text || numberFromId(draft.id) || draft.id;
	return {
		number,
		id: draft.id,
		date: cleanText(draft.date.raw) || null,
		published_at: toIso(draft.datetime),
	};
}

/**
 * Parse a chapter list.
 *
 * Handles both markup variants with one pass: the series detail page nests the
 * label in `div.chapter-number` with a `span.chapter-stats` date inside it, while
 * `/all-chapters/` uses `strong.chapter-title` plus `time.chapter-update`.
 */
export async function parseChapterList(response: Response): Promise<ChapterRef[]> {
	const chapters: ChapterRef[] = [];
	let draft: Draft | null = null;
	// Text inside .chapter-number belongs to the nested date span once this is set.
	let inNestedStats = false;

	const flush = () => {
		if (!draft) return;
		const done = finish(draft);
		if (done) chapters.push(done);
		draft = null;
	};

	const rewriter = new HTMLRewriter()
		.on('ul.chapter-list li', {
			element(element) {
				flush();
				draft = newDraft();
				element.onEndTag(flush);
			},
		})
		.on('ul.chapter-list li a', {
			element(element) {
				if (!draft || draft.id) return;
				const href = attr(element, 'href');
				if (href) draft.id = lastPathSegment(href);
			},
		})
		.on('ul.chapter-list li .chapter-stats', {
			element(element) {
				inNestedStats = true;
				element.onEndTag(() => {
					inNestedStats = false;
				});
			},
			text(chunk) {
				draft?.date.append(chunk.text);
			},
		})
		.on('ul.chapter-list li .chapter-number', {
			text(chunk) {
				// Skip text belonging to the nested date span; it is not the label.
				if (draft && !inNestedStats) draft.number.append(chunk.text);
			},
		})
		.on('ul.chapter-list li .chapter-title', {
			text(chunk) {
				draft?.number.append(chunk.text);
			},
		})
		.on('ul.chapter-list li time.chapter-update', {
			element(element) {
				if (draft) draft.datetime = attr(element, 'datetime');
			},
			text(chunk) {
				draft?.date.append(chunk.text);
			},
		});

	await runRewriter(rewriter, response);
	flush();

	return chapters;
}

/** Parse a fixture string. Test convenience wrapper. */
export function parseChapterListHtml(html: string): Promise<ChapterRef[]> {
	return parseChapterList(htmlResponse(html));
}
