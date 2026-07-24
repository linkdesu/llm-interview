import { describe, expect, it } from 'vitest'
import { parseHash, routeHash, type Route } from './router'

describe('parseHash', () => {
  it('parses the home route from empty or root hashes', () => {
    expect(parseHash('')).toEqual({ name: 'home' })
    expect(parseHash('#')).toEqual({ name: 'home' })
    expect(parseHash('#/')).toEqual({ name: 'home' })
  })

  it('parses question routes', () => {
    expect(parseHash('#/q/browser-os')).toEqual({ name: 'question', question: 'browser-os' })
  })

  it('parses session routes', () => {
    expect(parseHash('#/s/4144dda9648a')).toEqual({ name: 'session', comboId: '4144dda9648a' })
  })

  it('decodes URI-encoded segments', () => {
    expect(parseHash('#/q/my%20question')).toEqual({ name: 'question', question: 'my question' })
  })

  it('falls back to home for unknown or incomplete paths', () => {
    expect(parseHash('#/q')).toEqual({ name: 'home' })
    expect(parseHash('#/s/')).toEqual({ name: 'home' })
    expect(parseHash('#/nope/x')).toEqual({ name: 'home' })
  })
})

describe('routeHash', () => {
  it('formats all route kinds', () => {
    expect(routeHash({ name: 'home' })).toBe('#/')
    expect(routeHash({ name: 'question', question: 'snake' })).toBe('#/q/snake')
    expect(routeHash({ name: 'session', comboId: 'abc123' })).toBe('#/s/abc123')
  })

  it('encodes segments that contain reserved characters', () => {
    expect(routeHash({ name: 'question', question: 'my question/2' })).toBe(
      '#/q/my%20question%2F2',
    )
  })

  it('round-trips through parseHash', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'question', question: 'city-time-machine' },
      { name: 'session', comboId: 'e1cd5a5fed98' },
    ]
    for (const route of routes) {
      expect(parseHash(routeHash(route))).toEqual(route)
    }
  })
})
