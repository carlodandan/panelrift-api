/**
 * Runtime configuration and bindings.
 *
 * The generated `worker-configuration.d.ts` declares `Env` from wrangler.jsonc.
 * This module narrows it into validated, typed config so handlers never parse
 * strings themselves.
 */
export interface Config {
	baseUrl: string;
	timeoutMs: number;
	allowedOrigins: '*' | string[];
	coverBaseUrl: string;
	coverSize: string;
}

const DEFAULT_BASE_URL = 'https://www.mgeko.cc';
const DEFAULT_TIMEOUT_MS = 8000;
/**
 * Upstream's image proxy. Covers are not served from the site origin — see
 * lib/covers.ts for why resolving them against `baseUrl` loses some of them.
 */
const DEFAULT_COVER_BASE_URL = 'https://imgsrv5.com';
/** Only upstream's own presets exist; 288x412 and 157x211 are verified, others 404. */
const DEFAULT_COVER_SIZE = '288x412';

/**
 * The vars this module reads.
 *
 * Declared structurally rather than as `Partial<Env>` because `wrangler types`
 * narrows vars to the literal values in wrangler.jsonc, which would reject any
 * other string a caller (or a test) supplies.
 */
export interface ConfigVars {
	UPSTREAM_BASE_URL?: string;
	UPSTREAM_TIMEOUT_MS?: string;
	ALLOWED_ORIGINS?: string;
	COVER_BASE_URL?: string;
	COVER_SIZE?: string;
}

export function readConfig(env: ConfigVars): Config {
	const baseUrl = (env.UPSTREAM_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');

	const parsedTimeout = Number.parseInt(env.UPSTREAM_TIMEOUT_MS ?? '', 10);
	const timeoutMs = Number.isFinite(parsedTimeout) && parsedTimeout > 0 ? parsedTimeout : DEFAULT_TIMEOUT_MS;

	const rawOrigins = (env.ALLOWED_ORIGINS ?? '').trim();
	const allowedOrigins =
		rawOrigins === '*'
			? '*'
			: rawOrigins
					.split(',')
					.map((origin) => origin.trim())
					.filter(Boolean);

	// Unlike the others, an explicitly empty COVER_BASE_URL is meaningful: it turns
	// the proxy rewrite off and leaves covers pointing at the upstream origin.
	const coverBaseUrl = (env.COVER_BASE_URL ?? DEFAULT_COVER_BASE_URL).trim().replace(/\/+$/, '');
	const coverSize = (env.COVER_SIZE ?? '').trim() || DEFAULT_COVER_SIZE;

	return { baseUrl, timeoutMs, allowedOrigins, coverBaseUrl, coverSize };
}

/**
 * A Cloudflare rate limit binding. Declared locally because the binding is
 * configured under `unsafe` and is not always present in generated types.
 */
export interface RateLimitBinding {
	limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Bindings {
	READ_LIMITER?: RateLimitBinding;
	SEARCH_LIMITER?: RateLimitBinding;
	UPSTREAM_LIMITER?: RateLimitBinding;
	/**
	 * Shared secret the Pages Function presents in `X-Proxy-Secret`, proving the
	 * request came through the frontend rather than straight off the internet.
	 *
	 * Set with `wrangler secret put PROXY_SECRET`; it is a secret rather than a
	 * `vars` entry so it never lands in wrangler.jsonc. When unset the check is
	 * skipped, which is what keeps local dev and the test suite working.
	 */
	PROXY_SECRET?: string;
}

/** Hono generic parameter: what `c.env` and `c.var` hold. */
export interface AppEnv {
	Bindings: Env & Bindings;
	Variables: {
		config: Config;
		requestId: string;
	};
}
