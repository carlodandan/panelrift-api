//
// Public response shapes. These are the API's contract: change them and you
// break clients, so they are versioned along with the route prefix.

/** A manhwa as it appears in a list (search results, most-viewed rankings). */
export interface ManhwaSummary {
	title: string;
	slug: string;
	cover_url: string | null;
	latest_chapter: string | null;
	last_updated: string | null;
	rating: number | null;
}

/**
 * One card from a browse listing, e.g. `/v1/recently_added`.
 *
 * Not a `ManhwaSummary`: the browse markup carries a description, an exact view
 * count and a badge, and carries no chapter or update information at all.
 * Faking `latest_chapter`/`last_updated` as permanent nulls would be worse than
 * saying plainly that this shape is a different one. The four fields clients
 * need for a cover grid — `title`, `slug`, `cover_url`, `rating` — are common to
 * both, so one card component still covers listings and rankings alike.
 */
export interface BrowseEntry {
	title: string;
	slug: string;
	cover_url: string | null;
	/**
	 * Upstream's own teaser, truncated by upstream with a trailing "…". The full
	 * text is on `/v1/manhwa/{slug}`.
	 */
	description: string | null;
	rating: number | null;
	/**
	 * Exact view count. Unlike `Manhwa.views`, which is upstream's abbreviated
	 * display string ("4.2M"), this listing renders the raw figure.
	 */
	views: number | null;
	/**
	 * Promotional label upstream stamped on the cover, normalised per listing.
	 * `/v1/recently_added` reports "New": upstream's own card template says
	 * "Trending" on every entry, months-old ones included, so its wording carries
	 * nothing. Null when upstream showed no badge at all.
	 */
	badge: string | null;
}

/** One page of a browse listing. Upstream fixes the page size, so `count` reports it. */
export interface BrowseList {
	/** Upstream's sort key, e.g. `recently_added`. */
	sort: string;
	page: number;
	count: number;
	/** Total across every page, and the page count. Null if upstream stops sending them. */
	total: number | null;
	total_pages: number | null;
	results: BrowseEntry[];
}

/** One entry in a series' chapter list. */
export interface ChapterRef {
	/** Chapter label as shown upstream, e.g. "155" or "200-side-story-3". */
	number: string;
	/** Upstream chapter identifier, usable as `/v1/chapters/{id}`. */
	id: string;
	/** Human-readable relative date, e.g. "2 years ago". May be absent. */
	date: string | null;
	/** ISO 8601 timestamp when upstream exposes a machine-readable date. */
	published_at: string | null;
}

/** Full detail record for one series. */
export interface Manhwa {
	title: string;
	slug: string;
	alternative_title: string | null;
	author: string | null;
	status: string | null;
	cover_url: string | null;
	description: string | null;
	genres: string[];
	rating: number | null;
	rating_count: number | null;
	views: string | null;
	bookmarks: string | null;
	chapter_count: string | null;
	last_updated: string | null;
	/**
	 * Most recent chapters only — upstream truncates this list on the detail page.
	 * Use `/v1/manhwa/{slug}/chapters` for the complete set.
	 */
	chapters: ChapterRef[];
	/** True when `chapters` is known to be a partial view of the full list. */
	chapters_truncated: boolean;
}

/** A single chapter with its page images. */
export interface Chapter {
	id: string;
	manhwa_title: string | null;
	manhwa_slug: string | null;
	chapter_title: string | null;
	prev_chapter_id: string | null;
	next_chapter_id: string | null;
	images: string[];
	page_count: number;
}

/** Paginated chapter listing. */
export interface ChapterList {
	slug: string;
	total: number;
	page: number;
	per_page: number;
	chapters: ChapterRef[];
}

/** One ranking period from the most-viewed endpoint. */
export interface RankingPeriod {
	period: string;
	manhwa: ManhwaSummary[];
}

/** The `/home` payload: three ranking periods, each independently fallible. */
export interface Home {
	'1d': RankingPeriod | null;
	'1w': RankingPeriod | null;
	'1m': RankingPeriod | null;
	/** Periods that failed upstream. Empty when everything succeeded. */
	errors: string[];
}

/** Error envelope returned for every non-2xx response. */
export interface ApiErrorBody {
	error: {
		code: string;
		message: string;
	};
}
