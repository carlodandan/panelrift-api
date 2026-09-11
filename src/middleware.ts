import type { Context, ErrorHandler, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { cacheControl, cacheKeyFor, cacheLookup, cacheStore, POLICIES, weakETag, type Deferrable } from './lib/cache';
import { readConfig, type AppEnv, type Config, type RateLimitBinding } from './lib/env';
import { ApiError, forbidden, tooManyRequests } from './lib/errors';
import type { ApiErrorBody } from './types';

/** Attach parsed config and a request id for correlating logs. */
export const withConfig: MiddlewareHandler<AppEnv> = async (c, next) => {
	c.set('config', readConfig(c.env));
	c.set('requestId', c.req.header('cf-ray') ?? crypto.randomUUID());
	await next();
};

/**
 * Resolve the `Access-Control-Allow-Origin` value for a request, or `undefined`
 * when this Origin is not on the allowlist and no header should be sent.
 *
 * Matching is exact, so neither `https://site.example.evil.test` nor a
 * case-shifted spelling of an allowed host is accepted.
 *
 * Exported because the 405 short-circuit in `index.ts` answers before Hono runs
 * and has to reach the same verdict.
 */
export function allowOriginFor(origin: string | null | undefined, allowedOrigins: Config['allowedOrigins']): string | undefined {
	if (allowedOrigins === '*') return '*';
	return origin && allowedOrigins.includes(origin) ? origin : undefined;
}

/**
 * CORS and security headers.
 *
 * `ALLOWED_ORIGINS` denies every origin when unset, so a dropped var fails closed
 * rather than silently opening the API to every site. Set it to `*` to opt into a
 * genuinely public API, or to a comma-separated allowlist.
 *
 * Applied by both the middleware and the error handler, because Hono produces
 * error responses outside the normal middleware unwind.
 */
function applyStandardHeaders(c: Context<AppEnv>): void {
	const { allowedOrigins } = c.get('config') ?? readConfig(c.env);
	const allowOrigin = allowOriginFor(c.req.header('Origin'), allowedOrigins);

	if (allowOrigin) {
		c.header('Access-Control-Allow-Origin', allowOrigin);
		// Only useful to a caller that was actually allowed, so a refusal advertises
		// nothing about what the API would have accepted.
		c.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
		c.header('Access-Control-Allow-Headers', 'Content-Type, If-None-Match');
		c.header('Access-Control-Expose-Headers', 'ETag, Retry-After');
		c.header('Access-Control-Max-Age', '86400');
	}
	if (allowedOrigins !== '*') {
		// The header above depends on the request Origin, so any shared cache has to
		// key on it. Set this even when the Origin is refused: responses here carry
		// `Cache-Control: public`, and without Vary a cache can hand an allowed
		// visitor the header-less copy stored for some other site (or vice versa).
		c.header('Vary', 'Origin');
	}

	c.header('X-Content-Type-Options', 'nosniff');
	// Blocks `no-cors` embedding, which CORS on its own does not cover: a page can
	// load this URL as a subresource without ever reading a response header.
	c.header('Cross-Origin-Resource-Policy', 'same-origin');
	// Nothing served here is a document, so refuse every subresource and framing.
	c.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
	c.header('Referrer-Policy', 'no-referrer');
	// Search engines indexing a JSON endpoint is one of the ways an API gets found.
	c.header('X-Robots-Tag', 'noindex, nofollow');
}

/** SHA-256 of a string, as the fixed-length buffer `timingSafeEqual` requires. */
async function sha256(value: string): Promise<ArrayBuffer> {
	return crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
}

/**
 * Require the shared secret that proves a request came through the frontend's
 * Pages Function rather than straight off the internet.
 *
 * This is the control an Origin allowlist cannot be: CORS only ever constrains
 * browsers, and anyone calling with curl picks their own `Origin` header. The
 * secret lives server-side in the Pages Function, so it never reaches a browser.
 *
 * Mounted ahead of the rate limiters and the cache, so refusing a caller costs
 * two digests and nothing else.
 *
 * An unset `PROXY_SECRET` skips the check outright. That is deliberate rather than
 * a fallback: local dev and the test suite both run without one.
 */
export const withProxySecret: MiddlewareHandler<AppEnv> = async (c, next) => {
	const expected = c.env.PROXY_SECRET;
	if (!expected) return next();

	// Digest both sides first so the comparison sees two equal-length buffers,
	// leaking neither the secret's length nor where the first byte diverges.
	const [presented, wanted] = await Promise.all([sha256(c.req.header('X-Proxy-Secret') ?? ''), sha256(expected)]);
	if (!crypto.subtle.timingSafeEqual(presented, wanted)) {
		throw forbidden('missing or invalid X-Proxy-Secret');
	}

	return next();
};

export const withCors: MiddlewareHandler<AppEnv> = async (c, next) => {
	await next();
	applyStandardHeaders(c);
};

/**
 * Per-IP rate limiting.
 *
 * Keyed on CF-Connecting-IP, which the edge sets and clients cannot spoof.
 * Counters are per-colo rather than global; that is enough to stop runaway
 * clients and accidental loops, not a determined distributed attacker.
 */
export function withRateLimit(pick: (env: AppEnv['Bindings']) => RateLimitBinding | undefined): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const limiter = pick(c.env);
		if (!limiter) {
			// Binding absent (e.g. local dev without unsafe bindings). Fail open
			// rather than making the API unusable, but say so in the logs.
			console.log(JSON.stringify({ level: 'warn', msg: 'rate limiter binding missing' }));
			return next();
		}

		const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
		const { success } = await limiter.limit({ key: ip });
		if (!success) throw tooManyRequests();

		return next();
	};
}

/**
 * Map thrown errors onto the response envelope, keeping internals in the logs.
 *
 * Registered via `app.onError`, not as try/catch middleware: Hono turns a handler
 * throw into a response inside its own dispatch, so a wrapping middleware's catch
 * block never sees it and every 400 came back as a 500.
 */
export const errorHandler: ErrorHandler<AppEnv> = (error, c) => {
	const api =
		error instanceof ApiError
			? error
			: new ApiError(
					500,
					'internal_error',
					'Internal server error',
					error instanceof Error ? `${error.name}: ${error.message}` : String(error),
				);

	console.log(
		JSON.stringify({
			level: api.status >= 500 ? 'error' : 'warn',
			requestId: c.get('requestId'),
			path: new URL(c.req.url).pathname,
			status: api.status,
			code: api.code,
			// Detail is logged, never returned: it carries upstream URLs.
			detail: api.detail,
		}),
	);

	const body: ApiErrorBody = { error: { code: api.code, message: api.message } };
	c.status(api.status as ContentfulStatusCode);
	c.header('Content-Type', 'application/json; charset=utf-8');

	if (api.status === 429) c.header('Retry-After', '60');
	// Negative-cache 404s so a bad slug requested in a loop stops hitting upstream.
	if (api.status === 404) c.header('Cache-Control', cacheControl(POLICIES.notFound));
	else c.header('Cache-Control', 'no-store');

	applyStandardHeaders(c);

	return c.body(JSON.stringify(body));
};

/**
 * Edge cache read-through.
 *
 * Reminder: `caches.default` silently does nothing on *.workers.dev. On a custom
 * domain this is what keeps a cache miss — and therefore an upstream fetch — off
 * the hot path for repeat requests.
 */
export const withEdgeCache: MiddlewareHandler<AppEnv> = async (c, next) => {
	const key = cacheKeyFor(c.req.raw);
	const hit = await cacheLookup(key);

	if (hit) {
		const etag = hit.headers.get('ETag');
		if (etag && c.req.header('If-None-Match') === etag) {
			return new Response(null, { status: 304, headers: hit.headers });
		}
		const headers = new Headers(hit.headers);
		headers.set('X-Cache', 'HIT');
		return new Response(hit.body, { status: hit.status, headers });
	}

	await next();

	if (c.res.ok) {
		let ctx: Deferrable | undefined;
		try {
			ctx = c.executionCtx;
		} catch {
			ctx = undefined; // Not available in some test environments.
		}
		cacheStore(ctx, key, c.res);
		c.header('X-Cache', 'MISS');
	}
};

/** Serialise a payload as JSON with a cache policy and an ETag. */
export async function jsonWithCache<T>(
	c: Parameters<MiddlewareHandler<AppEnv>>[0],
	payload: T,
	policy: (typeof POLICIES)[keyof typeof POLICIES],
): Promise<Response> {
	const body = JSON.stringify(payload);
	const etag = await weakETag(body);

	if (c.req.header('If-None-Match') === etag) {
		c.status(304);
		c.header('ETag', etag);
		c.header('Cache-Control', cacheControl(policy));
		return c.body(null);
	}

	c.header('Content-Type', 'application/json; charset=utf-8');
	c.header('Cache-Control', cacheControl(policy));
	c.header('ETag', etag);
	return c.body(body);
}
