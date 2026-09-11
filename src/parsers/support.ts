//
// Shared plumbing for HTMLRewriter-based parsing.
//
// HTMLRewriter replaces the previous regex approach for three reasons: it streams
// instead of buffering the whole document into memory, it cannot silently match
// across unrelated markup, and lazy patterns like /<li ...>([\s\S]*?)<\/li>/g
// degrade badly on large pages whose tags are not closed as expected.

/** Drive a rewriter over a response body and discard the output. */
export async function runRewriter(rewriter: HTMLRewriter, response: Response): Promise<void> {
	const transformed = rewriter.transform(response);
	// The body must be consumed for handlers to run.
	await transformed.arrayBuffer();
}

/** Wrap an HTML string as a Response so parsers can be tested against fixtures. */
export function htmlResponse(html: string): Response {
	return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/**
 * Accumulates text chunks for one field.
 *
 * HTMLRewriter delivers text in arbitrary chunks, so a handler that assigns
 * instead of appending will silently truncate any value that spans a chunk
 * boundary — which is exactly what happens to long descriptions.
 */
export class TextBuffer {
	private chunks: string[] = [];

	append(chunk: string): void {
		this.chunks.push(chunk);
	}

	get raw(): string {
		return this.chunks.join('');
	}

	get isEmpty(): boolean {
		return this.chunks.length === 0;
	}

	reset(): void {
		this.chunks = [];
	}
}

/** Read an attribute, treating empty strings and "#" placeholders as absent. */
export function attr(element: Element, name: string): string | null {
	const value = element.getAttribute(name);
	if (value === null) return null;
	const trimmed = value.trim();
	if (!trimmed || trimmed === '#' || trimmed.startsWith('javascript:')) return null;
	return trimmed;
}

/** True when an element's class list contains `candidate`. */
export function hasClass(element: Element, candidate: string): boolean {
	const value = element.getAttribute('class');
	if (!value) return false;
	return value.split(/\s+/).includes(candidate);
}
