/**
 * Test-only egress policy for the isolated movement lab.
 *
 * The caller supplies the exact static URLs from the exported build and the
 * pinned engine asset list BEFORE opening the page. Observing a request never
 * adds it to this set. No same-origin, filename-extension or CDN-prefix bypass.
 * Request bodies are measured, not retained in the evidence record.
 */
export interface MovementLabRequest {
  url: string;
  method: string;
  bodyBytes: number;
}

export function movementRequestViolation(
  request: MovementLabRequest,
  expectedStaticUrls: ReadonlySet<string>,
): string | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return 'Malformed request URL';
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return `Unexpected request protocol: ${url.protocol}`;
  }
  if (url.username || url.password || url.hash) return 'Credentials or fragment in request URL';
  if (request.method !== 'GET') return `Unexpected request method: ${request.method}`;
  if (request.bodyBytes !== 0) return 'Request body is not empty';
  // The sole query-bearing URL in the browser test is its exact, predeclared
  // document URL (?delegate=cpu). App/engine assets have no accepted queries.
  if (url.search && !expectedStaticUrls.has(url.href)) return 'Unexpected request query';
  if (!expectedStaticUrls.has(url.href)) return `URL is not an expected static asset: ${url.href}`;
  return null;
}
