const NAMED_ENTITIES: Record<string, string> = {
	amp: '&',
	lt: '<',
	gt: '>',
	quot: '"',
	apos: "'",
	// Real U+00A0. cleanText collapses it afterwards (JS \s matches it); callers
	// wanting the raw character use decodeEntities directly.
	nbsp: ' ',
	ndash: '–',
	mdash: '—',
	hellip: '…',
	lsquo: '‘',
	rsquo: '’',
	ldquo: '“',
	rdquo: '”',
	middot: '·',
	bull: '•',
	times: '×',
	deg: '°',
	eacute: 'é',
	copy: '©',
	reg: '®',
	trade: '™',
};

/**
 * Decode the HTML entities that actually appear in scraped titles and
 * descriptions. Without this, apostrophes and ampersands surface to clients as
 * literal `&#39;` and `&amp;`.
 */
export function decodeEntities(text: string): string {
	return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
		if (body.startsWith('#')) {
			const isHex = body[1] === 'x' || body[1] === 'X';
			const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
			if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
			try {
				return String.fromCodePoint(code);
			} catch {
				return match;
			}
		}
		return NAMED_ENTITIES[body.toLowerCase()] ?? match;
	});
}

/** Collapse all whitespace runs to single spaces and trim. */
export function normalizeWhitespace(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/**
 * Clean a run of scraped text: decode entities, collapse whitespace, trim.
 *
 * Unlike the previous regex-strip approach this does not attempt to remove
 * tags — HTMLRewriter only ever hands us text nodes, so there are none.
 */
export function cleanText(text: string): string {
	return normalizeWhitespace(decodeEntities(text));
}

/**
 * Resolve a possibly-relative URL against `base`.
 *
 * Returns null for absent or unparseable input rather than fabricating a URL.
 * The old implementation turned a null cover into "<base>/undefined".
 */
export function absoluteUrl(path: string | null | undefined, base: string): string | null {
	if (typeof path !== 'string') return null;
	const trimmed = path.trim();
	if (!trimmed) return null;
	try {
		return new URL(trimmed, base).toString();
	} catch {
		return null;
	}
}

/** Parse a decimal number, returning null instead of NaN. */
export function toNumber(text: string | null | undefined): number | null {
	if (!text) return null;
	const value = Number.parseFloat(text.replace(/,/g, '').trim());
	return Number.isFinite(value) ? value : null;
}

/** Parse an integer, returning null instead of NaN. */
export function toInteger(text: string | null | undefined): number | null {
	if (!text) return null;
	const value = Number.parseInt(text.replace(/[,\s]/g, ''), 10);
	return Number.isFinite(value) ? value : null;
}

/** The last non-empty path segment of a URL or path, e.g. a slug. */
export function lastPathSegment(href: string): string | null {
	const withoutQuery = href.split(/[?#]/)[0] ?? '';
	const segments = withoutQuery.split('/').filter(Boolean);
	return segments.length > 0 ? (segments[segments.length - 1] ?? null) : null;
}
