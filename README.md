# manhwa-api

A read-only JSON API over [mgeko.cc](https://www.mgeko.cc), running on Cloudflare Workers.
It scrapes HTML with `HTMLRewriter`, normalises it into a stable contract, and puts an
edge cache plus per-IP rate limits in front of the upstream site.

Nothing is stored: every response is derived from a live upstream fetch or from the
edge cache.

## Quick start

```bash
npm install
npm run dev      # local worker on http://localhost:8787
npm run check    # typecheck + tests
npm run deploy   # wrangler deploy
```

## Endpoints

All responses are `application/json; charset=utf-8` and carry a weak `ETag`;
send `If-None-Match` to get a `304`.

| Method | Path | Description |
| --- | --- | --- |
| GET | `/` | Endpoint index and version marker. |
| GET | `/v1/home` | All three most-viewed rankings. `?period=1d\|1w\|1m` returns just one. |
| GET | `/v1/recently_added` | Newest series first, one upstream page at a time. `?page=` (1-based). |
| GET | `/v1/browse` | Generic filtered listing. `?page=`, `sort=`, `type=`, `status=`, `include_genres=`, `exclude_genres=`. |
| GET | `/v1/search?term={term}` | Search by title. `term` is 2–100 characters. |
| GET | `/v1/manhwa/{slug}` | Series detail plus the most recent chapters. |
| GET | `/v1/manhwa/{slug}/chapters` | Full chapter list. `?page=` (1-based), `?per_page=` (clamped to 500). |
| GET | `/v1/chapters/{chapterId}` | Chapter page images and neighbour ids. |

`GET`, `HEAD` and `OPTIONS` are supported; `HEAD` runs the `GET` route and drops the
body. Anything else gets `405` with an `Allow` header.

`/recently_added` and `/browse` are aliases of their `/v1/` counterparts — same payload, same policy. They are
not deprecated; the versioned paths are simply the canonical ones.

### Deprecated aliases

`/home`, `/autocomplete?term=`, `/manhwa/{slug}` and `/reader/en/{chapterId}` are kept
so existing clients keep working. Prefer the `/v1/` paths — `/autocomplete` in
particular returns a bare array rather than the `{ term, count, results }` envelope.

## Identifiers

`slug` is the series identifier from a listing, e.g. `some-series-x7`.

`chapterId` is **opaque**. It comes from a chapter listing and must not be constructed:
upstream's reader ids look like `{series}-chapter-{n}-eng-li`, the series part does not
always match the detail-page slug, and the shape is upstream's to change. Read it from
`chapters[].id` and pass it through.

## Response shapes

The full set lives in [`src/types.ts`](src/types.ts) — that file is the contract. Two
things worth calling out:

`/v1/manhwa/{slug}` returns `chapters_truncated: true`, because upstream's detail page
only renders the most recent chapters. Use `/v1/manhwa/{slug}/chapters` for everything.

`/v1/home` degrades per period rather than as a whole. Each of `1d`, `1w` and `1m` is
either a ranking or `null`, and `errors` names the periods that failed:

```json
{
  "1d": { "period": "1d", "manhwa": [] },
  "1w": null,
  "1m": { "period": "1m", "manhwa": [] },
  "errors": ["1w"]
}
```

`/v1/browse` and `/v1/recently_added` return `BrowseEntry`, not `ManhwaSummary`. Upstream's browse grid
carries a description, an exact view count and a badge, and carries nothing at all about
chapters or update times — so rather than shipping two fields that are permanently
`null`, it is its own shape. The four a cover grid needs (`title`, `slug`, `cover_url`,
`rating`) are common to both. Upstream fixes the page size, so there is no `per_page`;
`count` reports what the page held and `total_pages` bounds `?page=`:

```json
{
  "sort": "recently_added",
  "page": 1,
  "count": 24,
  "total": 6961,
  "total_pages": 291,
  "results": [
    {
      "title": "Some Series",
      "slug": "some-series-x7",
      "cover_url": "https://imgsrv5.com/avatar/288x412/media/manga_covers/x.png",
      "description": "Upstream's own teaser, truncated by upstream with a trailing …",
      "rating": 4.9,
      "views": 117815,
      "badge": "New"
    }
  ]
}
```

`description` is a truncated teaser, not the full text — read that from
`/v1/manhwa/{slug}`. `badge` is `"New"` rather than upstream's own wording: its card
template stamps "Trending" on every entry, including the months-old ones on page 150, so
the text carries nothing. Whether a badge is shown at all is still upstream's call, and
`null` means it showed none. `page` echoes what upstream served rather than what was
asked for: upstream clamps a page past the end to the last one, so `?page=400` of 291
comes back as `"page": 291` with the final page's results.

Missing values are `null` rather than omitted or faked — an absent cover is `null`, not
a URL pointing at nothing. Fields the endpoint exists to deliver are the exception: if a
series has no title, or a chapter no images, the parser fails with `502 parse_error`
instead of returning a hollow `200`. That turns an upstream markup change into a loud
error rather than silently empty results.

### Cover images

`cover_url` is not an upstream-origin URL. Upstream serves covers through an image
proxy, and its own pages never link the origin — they build
`https://imgsrv5.com/avatar/288x412{path}` client-side. That is not cosmetic: the
origin is missing a portion of the files it stores, so resolving covers against
`UPSTREAM_BASE_URL` leaves a scattering of series with a `404` where the artwork
should be. The proxy has all of them, and returns a resized image — tens of
kilobytes against roughly a megabyte for the original.

So every `cover_url` is normalised onto `COVER_BASE_URL` at the configured size,
whichever endpoint it came from and whether upstream gave a bare path (`/v1/home`,
which reads a JSON API) or an already-absolute proxy URL (`/v1/search` and
`/v1/manhwa/{slug}`, which scrape HTML). One canonical URL per cover across all
three keeps client caches warm.

Two things to know. `COVER_SIZE` is not free-form — only the presets upstream
requests exist, `288x412` and `157x211` verified, everything else `404`. And
upstream's shared `default-placeholder` image resolves to `null` rather than being
passed through, so a series with no artwork gets the client's own empty state
instead of upstream's grey box. Only `/media/` paths are rewritten; a cover hosted
somewhere else is returned untouched.

### Errors

Every non-2xx response uses one envelope:

```json
{ "error": { "code": "not_found", "message": "Unknown endpoint" } }
```

| Status | Codes |
| --- | --- |
| 400 | `missing_slug`, `invalid_slug`, `missing_chapter_id`, `invalid_chapter_id`, `term_too_short`, `term_too_long`, `invalid_page`, `invalid_per_page`, `invalid_period` |
| 404 | `not_found` |
| 405 | `method_not_allowed` |
| 429 | `rate_limited` (with `Retry-After`) |
| 500 | `internal_error` |
| 502 | `upstream_error`, `parse_error` |
| 504 | `upstream_timeout` |

Diagnostic detail — upstream URLs, parser state — is written to the worker logs with a
request id, never to the response body.

## Caching

Responses are cached twice: in the Cloudflare edge cache (read-through, keyed on a
normalised URL) and in whatever client cache honours `Cache-Control`. `X-Cache: HIT` or
`MISS` tells you which side served you.

| Route | `max-age` | `s-maxage` | `stale-while-revalidate` |
| --- | --- | --- | --- |
| `/` | 300 | 3600 | 600 |
| `/v1/home` | 60 | 300 | 600 |
| `/v1/recently_added` | 60 | 300 | 600 |
| `/v1/browse` | 60 | 300 | 600 |
| `/v1/search` | 60 | 300 | 600 |
| `/v1/manhwa/{slug}` | 120 | 600 | 1800 |
| `/v1/manhwa/{slug}/chapters` | 120 | 900 | 1800 |
| `/v1/chapters/{id}` | 3600 | 86400 | 86400 |
| 404 responses | 30 | 60 | — |

Chapter pages get the long TTL because published images do not change. 404s are
negative-cached so a client looping on a bad slug stops reaching upstream. Other error
responses are `no-store`.

Cache keys drop query parameters the route does not use and sort the rest, so
`?page=2&per_page=50` and `?per_page=50&page=2` share one entry and `?junk=12345` is not
a free cache-buster into upstream. `?page=` is bounded at 10000 for the same reason: an
unbounded page is an unbounded supply of distinct keys, one upstream fetch apiece.

> **`caches.default` does nothing on `*.workers.dev`.** The Cache API is silently a
> no-op on the workers.dev subdomain — the code runs, stores nothing, and every request
> is a `MISS`. Deploy to a custom domain or a zone route to actually get edge caching.
> `Cache-Control` still works for clients either way.

## Rate limiting

Three limiters, all keyed on `CF-Connecting-IP`, configured under `unsafe.bindings` in
[`wrangler.jsonc`](wrangler.jsonc):

| Binding | Applies to | Limit |
| --- | --- | --- |
| `SEARCH_LIMITER` | `/v1/search`, `/autocomplete` | 20 requests / 10 s |
| `READ_LIMITER` | every other data route | 60 requests / 60 s |
| `UPSTREAM_LIMITER` | outbound fetches, in aggregate | 600 / 60 s |

Search gets the tighter window because clients tend to fire it on every keystroke.
`UPSTREAM_LIMITER` is a global ceiling on the traffic this worker sends upstream, which
per-IP limits alone cannot bound.

Two caveats. Counters are enforced **per colo, not globally**, so a distributed client
can reach roughly `limit x colo-count` — this stops runaway clients and accidental
retry loops, not a determined attacker. And if a binding is missing (local dev without
unsafe bindings, for instance) the middleware **fails open** and logs a warning, so
development is not blocked by an absent limiter.

Exceeding a limit returns `429` with `Retry-After: 60`.

## Configuration

Set in `vars` in [`wrangler.jsonc`](wrangler.jsonc); all are optional and fall back to
the defaults below.

| Var | Default | Purpose |
| --- | --- | --- |
| `UPSTREAM_BASE_URL` | `https://www.mgeko.cc` | Origin to scrape. Trailing slashes are stripped. |
| `UPSTREAM_TIMEOUT_MS` | `8000` | Per-request upstream timeout. Non-numeric values are ignored. |
| `ALLOWED_ORIGINS` | *(none)* | Comma-separated origin allowlist, or `*` for any. |
| `COVER_BASE_URL` | `https://imgsrv5.com` | Image proxy cover URLs are rewritten onto. `""` disables the rewrite. |
| `COVER_SIZE` | `288x412` | Size segment in the proxy path. Only upstream's presets exist. |

`ALLOWED_ORIGINS` allows nothing when unset, so dropping the var fails closed instead
of quietly opening the API to every site. Matching is exact — neither a case-shifted
spelling nor `https://allowed.example.evil.test` gets through — and responses always
vary on `Origin` unless the value is `*`, so a shared cache cannot replay one origin's
response to another.

Two things it does not do. It only constrains browsers: curl, a server, or a mobile
app still gets full responses, and `Origin` is trivially spoofed outside a browser.
And preview URLs are separate origins, so `https://<branch>.panelrift.pages.dev` and
`http://localhost:5173` need adding explicitly if you want them working.

Genuine enforcement lives one layer out: the [Panelrift frontend](../manhwa-web) calls
this worker through a Pages Function over a service binding, which lets `workers_dev`
be switched off so the public hostname disappears altogether.

### Secrets

| Secret | Purpose |
| --- | --- |
| `PROXY_SECRET` | Shared with the Pages Function; presented in `X-Proxy-Secret`. |

`PROXY_SECRET` is the control an Origin allowlist cannot be. The frontend's Pages
Function adds the header server-side, so it never reaches a browser, and anything
arriving without it gets an opaque `403` — before the rate limiters and before any
upstream fetch, so a refused caller costs two digests. The compare digests both sides
to SHA-256 first, which keeps it constant-time and leaks neither the secret's length
nor where a guess diverged.

Set it on both ends, with the same value:

```bash
wrangler secret put PROXY_SECRET                       # here
cd ../manhwa-web && wrangler pages secret put PROXY_SECRET
```

An unset `PROXY_SECRET` skips the check entirely, which is what keeps `wrangler dev`
and the test suite usable without one. That does mean a deploy that loses the secret
fails *open* on this control — unlike `ALLOWED_ORIGINS` — so it is the second lock
rather than the first. `workers_dev: false` remains the one that removes the door.

To rotate: set the new value on the worker, then on Pages. Requests in flight during
the gap get a 403, so do it at a quiet moment or accept a few seconds of errors.

### Response headers

Every response, refused ones included, carries `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none';
frame-ancestors 'none'`, `X-Robots-Tag: noindex, nofollow` — search engines indexing a
JSON endpoint is one of the ways an API gets discovered — and
`Cross-Origin-Resource-Policy: same-origin`, which blocks the `no-cors` embedding that
CORS by itself does not cover.

The `Access-Control-Allow-Methods`, `-Headers`, `-Expose-Headers` and `-Max-Age`
quartet is sent only to a caller that passed the allowlist, so a refusal advertises
nothing about what would have been accepted. `Access-Control-Allow-Credentials` is
deliberately never sent: there are no cookies to carry, and combined with origin
reflection it would be a real hole.

## Layout

```
src/
  index.ts         routes and the fetch handler
  middleware.ts    config, CORS, rate limits, edge cache, error envelope
  types.ts         public response contract
  lib/             env, errors, cache policy, HTML helpers, validation, upstream fetch
  parsers/         HTMLRewriter parsers, one per upstream page shape
  handlers/        parser output -> public shape
test/
  fixtures/        synthetic HTML mirroring upstream markup
```

Upstream requests go through `lib/upstream.ts`, which sets a browser `User-Agent`,
applies `AbortSignal.timeout`, retries a bounded set of statuses with jittered backoff,
and maps upstream 404/410 to a `404` rather than retrying it.

Parsing uses `HTMLRewriter` rather than regexes over the whole document — it streams,
and selectors survive attribute reordering and whitespace changes that break regexes.

## Tests

```bash
npm test          # 100 tests
npm run typecheck
npm run check     # both
```

Tests run in `workerd` via `@cloudflare/vitest-pool-workers`, so route tests exercise
the real worker through `SELF.fetch`. The three suites cover parsers against fixtures,
pure normalisation and validation helpers, and end-to-end route behaviour — validation,
methods, CORS, and the error envelope, all of which resolve before any outbound fetch.

Fixtures are hand-written HTML that mirrors upstream's markup skeleton with invented
content; no scraped pages are committed. Because upstream markup is the real dependency
here, each fixture keeps the specific quirks that have broken this scraper before —
icon-font ligature text inside stat values, lazy-loaded covers on `data-src`, chapter
dates in `a.m.`/`p.m.` form, entities in titles, list items with no anchor at all, and
headings the browse grid truncates while the neighbouring `alt` keeps the full title.

## Notes

Scraping is inherently fragile: upstream can change its markup at any time, and when it
does, the parsers fail loudly with `502 parse_error`. That is the intended behaviour —
check the logs for the failing selector, update the parser, and add the new markup to a
fixture. Respect upstream's terms and keep `UPSTREAM_LIMITER` conservative.
