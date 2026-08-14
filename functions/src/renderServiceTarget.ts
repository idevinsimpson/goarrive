export interface RenderServiceTarget {
  targetUrl: string;
  audience: string;
}

/**
 * Validate and normalize the private Cloud Run service target.
 * Cloud Run's default service origin is the OIDC audience even when the HTTP
 * request targets a path below that origin.
 */
export function parseRenderServiceTarget(rawUrl: string | undefined): RenderServiceTarget {
  if (!rawUrl) throw new Error('RENDER_SERVICE_URL is required');

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('RENDER_SERVICE_URL must be a valid URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('RENDER_SERVICE_URL must use https');
  }
  if (!parsed.hostname.endsWith('.run.app') || /placeholder/i.test(parsed.hostname)) {
    throw new Error('RENDER_SERVICE_URL must use the deployed default run.app hostname');
  }
  if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash) {
    throw new Error(
      'RENDER_SERVICE_URL must not include credentials, port, query, or fragment',
    );
  }

  const path = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
  return { targetUrl: `${parsed.origin}${path}`, audience: parsed.origin };
}
