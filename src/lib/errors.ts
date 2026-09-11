/**
 * An error with an HTTP status attached. Anything thrown that is not an
 * ApiError becomes an opaque 500 so internals never reach clients.
 */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		readonly code: string,
		message: string,
		/** Detail for logs only. Never serialised into a response. */
		readonly detail?: string,
	) {
		super(message);
		this.name = 'ApiError';
	}
}

/** The client asked for something that does not exist upstream. */
export function notFound(what: string): ApiError {
	return new ApiError(404, 'not_found', `${what} not found`);
}

/** The request itself is malformed. */
export function badRequest(code: string, message: string): ApiError {
	return new ApiError(400, code, message);
}

/**
 * The caller is not the trusted proxy. Deliberately says nothing about why: a
 * probe should not learn whether the secret is unset, wrong, or merely absent.
 */
export function forbidden(detail?: string): ApiError {
	return new ApiError(403, 'forbidden', 'Forbidden', detail);
}

/** Client exceeded its rate limit. */
export function tooManyRequests(message = 'Rate limit exceeded'): ApiError {
	return new ApiError(429, 'rate_limited', message);
}

/**
 * The upstream site failed or changed shape. 502 rather than 500: the fault is
 * not in this worker, and the distinction matters when reading logs.
 */
export function upstreamError(message: string, detail?: string): ApiError {
	return new ApiError(502, 'upstream_error', message, detail);
}

/** Upstream did not answer within the timeout. */
export function upstreamTimeout(detail?: string): ApiError {
	return new ApiError(504, 'upstream_timeout', 'Upstream did not respond in time', detail);
}

/**
 * A required field was missing after parsing, which almost always means the
 * upstream markup changed. Fails loudly instead of returning half a record.
 */
export function parseError(what: string, detail?: string): ApiError {
	return new ApiError(502, 'parse_error', `Could not extract ${what} from the upstream page; its markup may have changed`, detail);
}
