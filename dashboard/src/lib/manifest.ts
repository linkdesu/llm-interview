// Manifest data model and pure sidebar/filter logic for the Dashboard.
// The Manifest is generated at build time (see docs/spec.md) and served as
// `manifest.json`; all file paths in it are relative to the app base.

export interface ManifestQuestion {
  name: string
  hasSpec: boolean
  hasTickets: boolean
}

export interface ManifestModel {
  name: string
  provider: string
  modelId: string
}

export interface ComboFiles {
  artifact?: string
  style?: string
  script?: string
  transcript?: string
  run?: string
}

export interface ComboEntry {
  comboId: string
  question: ManifestQuestion
  model: ManifestModel
  params: Record<string, unknown>
  piVersion: string
  startedAt: string
  endedAt: string
  durationMs: number
  status: string
  contractViolations: string[]
  maxTurnsExceeded?: boolean
  maxTurns?: number
  files: ComboFiles
}

export interface Manifest {
  generatedAt: string
  combos: ComboEntry[]
}

export interface SidebarModelEntry {
  comboId: string
  name: string
}

export interface SidebarQuestion {
  name: string
  models: SidebarModelEntry[]
}

/**
 * Group combos into the two-level sidebar tree (question → model).
 * Questions and models are sorted alphabetically by name.
 */
export function buildSidebarTree(combos: ComboEntry[]): SidebarQuestion[] {
  const byQuestion = new Map<string, SidebarModelEntry[]>()
  for (const combo of combos) {
    const entries = byQuestion.get(combo.question.name) ?? []
    entries.push({ comboId: combo.comboId, name: combo.model.name })
    byQuestion.set(combo.question.name, entries)
  }
  return [...byQuestion.entries()]
    .map(([name, models]) => ({
      name,
      models: models.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Case-insensitive keyword match across question name, model name and modelId.
 * An empty (or whitespace-only) query matches all combos.
 */
export function filterCombos(combos: ComboEntry[], query: string): ComboEntry[] {
  const keyword = query.trim().toLowerCase()
  if (!keyword) return combos
  return combos.filter(
    (combo) =>
      combo.question.name.toLowerCase().includes(keyword) ||
      combo.model.name.toLowerCase().includes(keyword) ||
      combo.model.modelId.toLowerCase().includes(keyword),
  )
}

/** Format a run duration, e.g. 292713 ms → "4m 53s". */
export function formatDuration(durationMs: number): string {
  const totalSeconds = Math.round(durationMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

/** Human-readable combo label, used for card headers and iframe titles. */
export function comboLabel(combo: ComboEntry): string {
  return `${combo.question.name} / ${combo.model.name}`
}
