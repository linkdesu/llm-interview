// Hash-based routing (no vue-router): the dashboard is statically hosted on
// GitHub Pages, so routes live in the URL hash and deep links work without
// server rewrites.
//
//   #/                  home (project intro + question index)
//   #/questions         question pages hub (in progress; placeholder view)
//   #/runs              all archived runs, preview page (in progress; placeholder view)
//   #/q/<question>      question detail (combo comparison grid)
//   #/s/<comboId>       session fullscreen (artifact + run metadata)

export type Route =
  | { name: 'home' }
  | { name: 'questions' }
  | { name: 'runs' }
  | { name: 'question'; question: string }
  | { name: 'session'; comboId: string }

/** Parse a location hash into a Route. Unknown or empty paths fall back to home. */
export function parseHash(hash: string): Route {
  const segments = hash
    .replace(/^#/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment))
  if (segments[0] === 'q' && segments[1]) return { name: 'question', question: segments[1] }
  if (segments[0] === 's' && segments[1]) return { name: 'session', comboId: segments[1] }
  if (segments.length === 1 && segments[0] === 'questions') return { name: 'questions' }
  if (segments.length === 1 && segments[0] === 'runs') return { name: 'runs' }
  return { name: 'home' }
}

/** Format a Route as a location hash suitable for href / location.hash. */
export function routeHash(route: Route): string {
  switch (route.name) {
    case 'question':
      return `#/q/${encodeURIComponent(route.question)}`
    case 'session':
      return `#/s/${encodeURIComponent(route.comboId)}`
    case 'questions':
      return '#/questions'
    case 'runs':
      return '#/runs'
    default:
      return '#/'
  }
}
