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
  /** Loop-defect marking (issue #21); present only when recorded in run.json. */
  loopDetected?: boolean
  loopConfidence?: number
  loopReason?: string
  files: ComboFiles
}

export interface Manifest {
  generatedAt: string
  combos: ComboEntry[]
}

export interface QuestionSummary {
  name: string
  /** Model names that ran this question, sorted alphabetically. */
  models: string[]
  sessionCount: number
  /** End time of the latest run across this question's combos. */
  latestEndedAt: string
}

/**
 * Group combos into the home-page question index: one row per question with
 * its models, session count and latest run time. Questions are sorted
 * alphabetically by name.
 */
export function summarizeQuestions(combos: ComboEntry[]): QuestionSummary[] {
  const byQuestion = new Map<string, ComboEntry[]>()
  for (const combo of combos) {
    const entries = byQuestion.get(combo.question.name) ?? []
    entries.push(combo)
    byQuestion.set(combo.question.name, entries)
  }
  return [...byQuestion.entries()]
    .map(([name, entries]) => ({
      name,
      models: entries.map((entry) => entry.model.name).sort((a, b) => a.localeCompare(b)),
      sessionCount: entries.length,
      latestEndedAt: entries.reduce((max, entry) => (entry.endedAt > max ? entry.endedAt : max), ''),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export interface ManifestStats {
  questionCount: number
  /** Distinct model names across all combos. */
  modelCount: number
  sessionCount: number
  totalDurationMs: number
}

/** Hero statistics: distinct questions and models, session count, total run time. */
export function summarizeManifest(combos: ComboEntry[]): ManifestStats {
  return {
    questionCount: new Set(combos.map((combo) => combo.question.name)).size,
    modelCount: new Set(combos.map((combo) => combo.model.name)).size,
    sessionCount: combos.length,
    totalDurationMs: combos.reduce((sum, combo) => sum + combo.durationMs, 0),
  }
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

/** Format a sampling parameter value for display (strings as-is, others as JSON). */
export function formatParam(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}
