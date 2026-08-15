// Pure helpers shared by the Bun server and its tests: path mapping, SPA
// fallback classification, and content-type lookup. No Bun, DOM, or Node
// builtins are used, so the module compiles under the browser tsconfig and is
// trivially unit-testable under vitest.

/**
 * True when a URL path looks like a file (its last segment has a dot). The
 * server treats such requests as static-asset lookups; everything else gets
 * the SPA fallback document.
 */
export function isFileLikePath(urlPath: string): boolean {
  const lastSegment = urlPath.split('/').pop() ?? ''
  return lastSegment.includes('.')
}

/**
 * Map a URL path to a file path inside `root`, or null when the path would
 * escape the root (directory traversal, malformed percent-encoding, or an
 * empty/root path — the server falls back to the SPA shell for those).
 */
export function resolveStaticPath(root: string, urlPath: string): string | null {
  try {
    const decoded = decodeURIComponent(urlPath)
    const segments: string[] = []
    for (const segment of decoded.split('/')) {
      if (segment === '' || segment === '.') continue
      if (segment === '..') {
        // A '..' with nothing left to pop escapes the static root.
        if (segments.length === 0) return null
        segments.pop()
      } else {
        segments.push(segment)
      }
    }
    if (segments.length === 0) return null
    return `${root.replace(/\/+$/, '')}/${segments.join('/')}`
  } catch {
    return null
  }
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
}

/** Extension of a file path (lowercased), without Node's path module. */
function extensionOf(filePath: string): string {
  const base = filePath.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

/** Content type for a file path, falling back to octet-stream. */
export function contentTypeFor(filePath: string): string {
  return CONTENT_TYPES[extensionOf(filePath)] ?? 'application/octet-stream'
}
