// Bun server for the Analyzer SPA.
//
// Single process: serves the built SPA (analyzer/dist/) with an SPA fallback
// to index.html for any non-file GET, plus a trivial /health route. It is run
// directly by Bun ("bun src/server.ts"); there is no separate compile step.
// The JSON API and session listing arrive in later tickets.
import * as path from 'node:path'
import { contentTypeFor, isFileLikePath, resolveStaticPath } from './lib/spa.ts'

const PORT = Number(process.env.PORT ?? 3090)
const DIST_DIR = path.join(import.meta.dir, '..', 'dist')

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

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url)

    if (request.method === 'GET') {
      if (url.pathname === '/health') {
        return Response.json({ ok: true })
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
