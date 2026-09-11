//
// Cover URLs need their own resolution step, separate from absoluteUrl, because
// upstream does not serve covers from its own origin.
//
// Upstream's JSON ranking API returns a bare storage path — "/media/manga_covers/
// x.jpg" — and resolving that against the site origin produces a URL that works
// for most files and 404s for the rest, because not every stored cover exists on
// the origin. Upstream's own pages never link the origin: they build
// `https://imgsrv5.com/avatar/288x412${cover_url}` client-side. Doing the same
// here is what makes every series come back with a cover that loads, and as a
// bonus the proxy returns a resized image — roughly 30KB against 1MB for the
// full-size original, which is the difference between a cover grid that paints
// and one that crawls.
//
// The size segment is not free-form: only the presets upstream itself requests
// exist. 288x412 and 157x211 are known good; anything else 404s. See COVER_SIZE
// in the README.

import { absoluteUrl } from './html';

/** The slice of `Config` cover resolution needs. */
export interface CoverConfig {
	baseUrl: string;
	coverBaseUrl: string;
	coverSize: string;
}

/**
 * Upstream's shared "no cover yet" image.
 *
 * It arrives as the `src` of a lazy-loaded `<img>`, so a page whose `data-src` is
 * missing would otherwise hand clients a grey placeholder as if it were artwork.
 * Returning null instead lets the frontend draw its own.
 */
const PLACEHOLDER = /(^|\/)default-placeholder\.[a-z0-9]+$/i;

/** The stored-file portion of an upstream URL, with any `/avatar/{size}` prefix dropped. */
const MEDIA_PATH = /\/media\/.*/;

/**
 * Turn whatever upstream gave us into a cover URL that loads.
 *
 * Accepts all three forms the parsers encounter — a bare path from the ranking
 * JSON, an absolute proxy URL from a listing or detail page, and an absolute URL
 * on some unrelated host — and normalises the first two onto the configured
 * proxy and size. Anything that is not a `/media/` path is returned untouched,
 * since the `/avatar/{size}` scheme is only known to apply to upstream's own
 * storage. Absent or unparseable input yields null rather than a fabricated URL.
 */
export function resolveCoverUrl(raw: string | null | undefined, config: CoverConfig): string | null {
	const absolute = absoluteUrl(raw, config.baseUrl);
	if (!absolute) return null;

	const { pathname } = new URL(absolute);
	if (PLACEHOLDER.test(pathname)) return null;

	const media = MEDIA_PATH.exec(pathname)?.[0];
	// An empty COVER_BASE_URL is the escape hatch: leave covers on the origin.
	if (!media || !config.coverBaseUrl) return absolute;

	return `${config.coverBaseUrl}/avatar/${config.coverSize}${media}`;
}
