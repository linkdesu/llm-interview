// Bun server for the Analyzer SPA.
//
// Single process: serves the built SPA (analyzer/dist/) with an SPA fallback
// to index.html for any non-file GET, plus the JSON API — GET /health,
// GET /sessions (the session listing with both grouping projections), and
// GET /session/<question>/<model>/<datetime>/session.jsonl (an archived
// transcript, served verbatim). It is run directly by Bun ("bun
// src/server.ts"); there is no separate compile step.
import * as path from 'node:path'
import { contentTypeFor, isFileLikePath, resolveStaticPath } from './lib/spa.ts'
import { groupByModel, groupByQuestion, listSessionRuns } from './lib/sessions.ts'

const PORT = Number(process.env.PORT ?? 3090)
const DIST_DIR = path.join(import.meta.dir, '..', 'dist')
// Session archive root: the repo's session/ directory by default, overridable
// via SESSION_ROOT (tests and deployments point it at a specific archive).
const SESSION_ROOT =
  process.env.SESSION_ROOT ?? path.join(import.meta.dir, '..', '..', 'session')

/** Serve a static file from dist/ for a GET request, or null when absent. */
async function serveStatic(urlPath: string): Promise<Response | null> {
  const filePath = resolveStaticPath(DIST_DIR, urlPath)
  if (!filePath) return null
  const file = Bun.file(filePath)
  if (!(await file.exists())) return null
  return new Response(file, {
    headers: { 'Content-Type': contentTypeFor(filePath) },
  })
}

/** The SPA shell document, or a 404 when dist/ has not been built yet. */
async function spaDocument(): Promise<Response> {
  try {
    const index = await Bun.file(path.join(DIST_DIR, 'index.html')).text()
    return new Response(index, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  } catch {
    return new Response('Analyzer SPA not built yet — run "bun run build" first.', {
      status: 404,
    })
  }
}

// Matches the transcript route /session/<question>/<model>/<datetime>/
// session.jsonl with exactly one path segment per archive level.
const SESSION_FILE_PATTERN =
  /^\/session\/([^/]+)\/([^/]+)\/([^/]+)\/session\.jsonl$/

/**
 * Serve a single archived transcript for GET /session/<question>/<model>/
 * <datetime>/session.jsonl, or null when the URL does not name one. The path
 * is percent-decoded before matching and normalized with the same traversal
 * guard used for static files (see resolveStaticPath in lib/spa.ts), so
 * encoded or double-encoded '..' can never escape the archive root.
 */
async function serveSessionFile(urlPath: string): Promise<Response | null> {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null // malformed percent-encoding
  }
  if (!SESSION_FILE_PATTERN.test(decoded)) return null
  const filePath = resolveStaticPath(SESSION_ROOT, decoded.slice('/session/'.length))
  if (!filePath) return null
  const file = Bun.file(filePath)
  if (!(await file.exists())) return null
  return new Response(file, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
  })
}

/**
 * GET /sessions: every archived run (full history) plus the two grouping
 * projections over it. The flat list is the source of truth; the projections
 * are derived from it server-side so clients only need this one request.
 */
function sessionsResponse(): Response {
  try {
    const runs = listSessionRuns(SESSION_ROOT)
    return Response.json({
      flat: runs,
      questionFirst: groupByQuestion(runs),
      modelFirst: groupByModel(runs),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return Response.json({ error: message }, { status: 500 })
  }
}

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === 'GET') {
      if (url.pathname === '/health') {
        return Response.json({ ok: true })
      }
      if (url.pathname === '/sessions') {
        return sessionsResponse()
      }
      // Anything under /session/ is archive data: serve the transcript or 404.
      if (url.pathname.startsWith('/session/')) {
        return (
          (await serveSessionFile(url.pathname)) ??
          new Response('Not Found', { status: 404 })
        )
      }
      // Non-file GET → SPA fallback to the shell document.
      if (url.pathname !== '/' && !isFileLikePath(url.pathname)) {
        return spaDocument()
      }
      const file = await serveStatic(url.pathname)
      return file ?? spaDocument()
    }

    return new Response('Method Not Allowed', { status: 405 })
  },
})

console.log(`Analyzer listening on http://localhost:${PORT}`)
