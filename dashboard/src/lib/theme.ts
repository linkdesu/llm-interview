// Light/dark theme switching. The choice is persisted in localStorage and
// applied as `data-theme` on <html>, where the CSS theme variables pick it
// up. index.html applies the same initial value before the bundle loads, so
// there is no flash of the wrong theme.
import { ref } from 'vue'

export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'llm-interview-theme'

function initialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const theme = ref<Theme>(initialTheme())

document.documentElement.dataset.theme = theme.value

export function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
  localStorage.setItem(STORAGE_KEY, theme.value)
  document.documentElement.dataset.theme = theme.value
}
