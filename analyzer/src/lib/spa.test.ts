import { describe, expect, it } from 'vitest'
import { contentTypeFor, isFileLikePath, resolveStaticPath } from './spa'

describe('isFileLikePath', () => {
  it('treats paths with a dotted final segment as files', () => {
    expect(isFileLikePath('/assets/app.js')).toBe(true)
    expect(isFileLikePath('/favicon.ico')).toBe(true)
  })

  it('treats extension-less paths as SPA routes', () => {
    expect(isFileLikePath('/')).toBe(false)
    expect(isFileLikePath('/sessions/2026-07-23/run-001')).toBe(false)
  })
})

describe('resolveStaticPath', () => {
  it('maps a URL path into the static root', () => {
    expect(resolveStaticPath('/srv/dist', '/assets/app.js')).toBe('/srv/dist/assets/app.js')
    expect(resolveStaticPath('/srv/dist', '/index.html')).toBe('/srv/dist/index.html')
  })

  it('returns null for the root path (server falls back to index.html)', () => {
    expect(resolveStaticPath('/srv/dist', '/')).toBeNull()
  })

  it('rejects directory traversal', () => {
    expect(resolveStaticPath('/srv/dist', '/../runner/secret')).toBeNull()
    expect(resolveStaticPath('/srv/dist', '/../../etc/passwd')).toBeNull()
  })

  it('rejects malformed percent-encoding', () => {
    expect(resolveStaticPath('/srv/dist', '/%zz')).toBeNull()
  })
})

describe('contentTypeFor', () => {
  it('maps known extensions', () => {
    expect(contentTypeFor('index.html')).toBe('text/html; charset=utf-8')
    expect(contentTypeFor('/srv/dist/assets/app.js')).toBe('text/javascript; charset=utf-8')
    expect(contentTypeFor('/srv/dist/favicon.ico')).toBe('image/x-icon')
  })

  it('falls back to octet-stream for unknown extensions', () => {
    expect(contentTypeFor('data.bin')).toBe('application/octet-stream')
    expect(contentTypeFor('LICENSE')).toBe('application/octet-stream')
  })
})
