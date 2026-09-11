import type { Config, RateLimitBinding } from './env';
import { notFound, tooManyRequests, upstreamError, upstreamTimeout } from './errors';

/**
 * Headers sent to the upstream site.
 *
 * A real browser User-Agent matters: scraping targets routinely block the
 * default Workers UA, and the failure mode is a 403 that looks like a parse bug.
 */
function upstreamHeaders(config: Config, accept: string): HeadersInit {
	return {
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
		Accept: accept,
		'Accept-Language': 'en-US,en;q=0.9',
		Referer: `${config.baseUrl}/`,
	};
}

export interface UpstreamOptions {
	/** What the caller expects back; controls the Accept header. */
	accept?: 'html' | 'json';
	/** What to name this resource in a 404, e.g. "Manhwa 'foo'". */
	describe: string;
	/** Retry attempts for transient failures. Defaults to 2 (3 tries total). */
	retries?: number;
	/** Shared outbound budget, protecting the upstream site from all clients. */
	limiter?: RateLimitBinding | undefined;
}

const ACCEPT_HEADERS = {
	html: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	json: 'application/json, text/plain, */*',
} as const;

/** Status codes worth retrying: transient upstream or edge failures. */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

function backoffMs(attempt: number): number {
	// 150ms, 400ms, plus jitter to avoid synchronising retries across colos.
	const base = attempt === 0 ? 150 : 400;
	return base + Math.floor(Math.random() * 100);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch a URL from the upstream site with a timeout, browser headers, bounded
 * retries and a shared outbound budget.
 *
 * Throws an ApiError with a status that reflects the real cause: 404 when the
 * resource is genuinely absent, 504 on timeout, 502 for everything else.
 */
export async function fetchUpstream(path: string, config: Config, options: UpstreamOptions): Promise<Response> {
	const url = new URL(path, config.baseUrl).toString();
	const accept = ACCEPT_HEADERS[options.accept ?? 'html'];
	const maxRetries = options.retries ?? 2;

	if (options.limiter) {
		const { success } = await options.limiter.limit({ key: 'upstream' });
		if (!success) {
			throw tooManyRequests('Upstream request budget exhausted; try again shortly');
		}
	}

	let lastDetail = 'no attempt made';

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		let response: Response;
		try {
			response = await fetch(url, {
				method: 'GET',
				headers: upstreamHeaders(config, accept),
				// Without this a hung origin holds the request open until the worker's
				// wall-clock limit and the client gets nothing at all.
				signal: AbortSignal.timeout(config.timeoutMs),
				redirect: 'follow',
			});
		} catch (error) {
			const isTimeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
			lastDetail = `${url}: ${error instanceof Error ? error.name : 'unknown'}`;
			if (attempt < maxRetries) {
				await sleep(backoffMs(attempt));
				continue;
			}
			throw isTimeout ? upstreamTimeout(lastDetail) : upstreamError('Upstream request failed', lastDetail);
		}

		if (response.ok) return response;

		// A 404 is a real answer, not a failure: do not retry it.
		if (response.status === 404 || response.status === 410) {
			throw notFound(options.describe);
		}

		lastDetail = `${url}: HTTP ${response.status}`;
		if (RETRYABLE.has(response.status) && attempt < maxRetries) {
			await sleep(backoffMs(attempt));
			continue;
		}

		throw upstreamError(`Upstream responded with ${response.status}`, lastDetail);
	}

	throw upstreamError('Upstream request failed', lastDetail);
}

/** Fetch and parse JSON from upstream, without trusting the payload's shape. */
export async function fetchUpstreamJson<T>(path: string, config: Config, options: UpstreamOptions): Promise<T> {
	const response = await fetchUpstream(path, config, { ...options, accept: 'json' });
	try {
		return (await response.json()) as T;
	} catch (error) {
		throw upstreamError('Upstream returned malformed JSON', `${path}: ${error instanceof Error ? error.message : 'unknown'}`);
	}
}
