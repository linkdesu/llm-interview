// Session-archive walk and grouping helpers for the Analyzer server.
//
// The archive layout is session/<question>/<model>/<datetime>/ — each
// <datetime> directory is one archived Run (see CONTEXT.md) holding the
// transcript (session.jsonl), run metadata (run.json) and the artifact files.
// This module is server-only because it reads the filesystem: it is excluded
// from the browser tsconfig, imported by the Bun server, and unit-tested under
// vitest with temp-dir fixtures.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import * as path from 'node:path'

/** One archived Run: a <datetime> directory under the session archive. */
export interface SessionRun {
  question: string
  model: string
  datetime: string
  /** Path of the transcript relative to the archive root, or null when the
   *  run directory has no session.jsonl (pre-JSONL archive format). */
  sessionJsonl: string | null
  /** Path of the Artifact's index.html relative to the archive root, or null
   *  when the run directory has no index.html. */
  artifactHtml: string | null
  /** Terminal status from run.json ("ok" or "error"), or null when the run
   *  has no run.json or the file is unreadable (older archives). */
  status: string | null
  /** Structured failure reason from run.json, or null when the field is
   *  absent (ok runs, older archives) or run.json is unreadable. */
  failureReason: FailureReason | null
}

/** Structured failure reason recorded in run.json for error runs. `kind` is
 *  the stable, append-only vocabulary written by the runner; `message` is
 *  the operator-facing explanation. Mirrors the runner's RunJson contract. */
export interface FailureReason {
  kind: string
  message: string
}

/** A model under a question, with its run datetimes sorted. */
export interface ModelNode {
  model: string
  datetimes: string[]
}

/** Question-first projection: question -> model -> datetime, each level sorted. */
export interface QuestionFirstGroup {
  question: string
  models: ModelNode[]
}

/** A question under a model, with its run datetimes sorted. */
export interface QuestionNode {
  question: string
  datetimes: string[]
}

/** Model-first projection: model -> question -> datetime, each level sorted. */
export interface ModelFirstGroup {
  model: string
  questions: QuestionNode[]
}

/** True when `entry` inside `dir` is a visible (non-dot-hidden) directory. */
function isVisibleDirectory(dir: string, entry: string): boolean {
  return !entry.startsWith('.') && statSync(path.join(dir, entry)).isDirectory()
}

/**
 * Terminal status and failure reason for one run, read from its run.json.
 * Lenient by design: a missing, truncated, or unparseable run.json yields
 * nulls rather than an error, so legacy archives keep listing. The failure
 * reason is only surfaced when both `kind` and `message` are non-empty
 * strings — anything else (absent, malformed, empty) degrades to null.
 */
function readRunMeta(runDir: string): { status: string | null; failureReason: FailureReason | null } {
  const fallback = { status: null, failureReason: null }
  let raw: string
  try {
    if (!existsSync(path.join(runDir, 'run.json'))) return fallback
    raw = readFileSync(path.join(runDir, 'run.json'), 'utf8')
  } catch {
    return fallback
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }
  if (typeof parsed !== 'object' || parsed === null) return fallback
  const record = parsed as Record<string, unknown>
  const status = typeof record['status'] === 'string' ? record['status'] : null
  const rawReason = record['failureReason']
  let failureReason: FailureReason | null = null
  if (typeof rawReason === 'object' && rawReason !== null) {
    const reason = rawReason as Record<string, unknown>
    if (typeof reason['kind'] === 'string' && reason['kind'] !== ''
      && typeof reason['message'] === 'string' && reason['message'] !== '') {
      failureReason = { kind: reason['kind'], message: reason['message'] }
    }
  }
  // Legacy archives predate the structured failureReason field: their
  // failure signals still live in apiError / maxTurnsExceeded /
  // invocations[].verdict etc. Rebuild the reason for an error-status run
  // so the sidebar hover explains why it failed instead of a bare "error".
  if (failureReason === null && status === 'error') {
    failureReason = deriveLegacyFailureReason(record)
  }
  return { status, failureReason }
}

/**
 * Rebuild a human-readable failure reason from the pre-failureReason
 * run.json fields, mirroring the runner's deriveFailureReason priority:
 * terminal API failure, then a loop defect, then an INCOMPLETE verdict,
 * then a max-turn kill, then a non-zero exit code. Returns null when none
 * of the legacy signals is present (a bare "error" with no recorded cause).
 */
function deriveLegacyFailureReason(record: Record<string, unknown>): FailureReason | null {
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

  const apiError = str(record['apiError'])
  if (apiError !== null) {
    return { kind: 'api-failure', message: `Terminal API failure: ${apiError}` }
  }

  if (record['loopDetected'] === true) {
    const confidence = typeof record['loopConfidence'] === 'number' ? record['loopConfidence'] : null
    const reason = str(record['loopReason'])
    const confidencePart = confidence !== null ? ` (confidence ${confidence})` : ''
    const reasonPart = reason !== null ? ` — ${reason}` : ''
    return { kind: 'loop-detected', message: `Loop defect detected${confidencePart}${reasonPart}` }
  }

  const invocations = Array.isArray(record['invocations']) ? record['invocations'] : []
  for (const inv of invocations) {
    if (typeof inv !== 'object' || inv === null) continue
    const r = inv as Record<string, unknown>
    if (r['evaluation'] !== true) continue
    if (r['verdict'] === 'complete') continue
    const ticket = typeof r['ticket'] === 'number' ? r['ticket'] : null
    const title = str(r['ticketTitle'])
    const which = ticket !== null
      ? `ticket ${ticket}${title !== null ? ` (${title})` : ''}`
      : 'the run'
    const reason = r['verdict'] === 'incomplete'
      ? 'was judged INCOMPLETE by its evaluation'
      : 'ended with no parseable verdict (treated as INCOMPLETE)'
    return { kind: 'incomplete', message: `${which} ${reason}` }
  }

  if (record['maxTurnsExceeded'] === true) {
    return { kind: 'max-turns', message: 'The run was killed for exceeding the max turn limit' }
  }

  const exitCode = record['exitCode']
  if (typeof exitCode === 'number' && exitCode !== 0) {
    return { kind: 'exit-code', message: `The run exited with code ${exitCode}` }
  }

  return null
}

/**
 * Walk a session archive root and return one flat entry per archived run —
 * every <datetime> directory, full history, not just the latest per combo.
 * Each level is visited in sorted order so the flat list is deterministic.
 * Runs whose directory lacks a session.jsonl are still listed, with a null
 * transcript path.
 */
export function listSessionRuns(root: string): SessionRun[] {
  const runs: SessionRun[] = []
  for (const question of readdirSync(root).sort()) {
    const questionDir = path.join(root, question)
    if (!isVisibleDirectory(root, question)) continue
    for (const model of readdirSync(questionDir).sort()) {
      const modelDir = path.join(questionDir, model)
      if (!isVisibleDirectory(questionDir, model)) continue
      for (const datetime of readdirSync(modelDir).sort()) {
        const runDir = path.join(modelDir, datetime)
        if (!isVisibleDirectory(modelDir, datetime)) continue
        const relativeJsonl = path.join(question, model, datetime, 'session.jsonl')
        const relativeHtml = path.join(question, model, datetime, 'index.html')
        const { status, failureReason } = readRunMeta(runDir)
        runs.push({
          question,
          model,
          datetime,
          sessionJsonl: existsSync(path.join(runDir, 'session.jsonl'))
            ? relativeJsonl
            : null,
          artifactHtml: existsSync(path.join(runDir, 'index.html'))
            ? relativeHtml
            : null,
          status,
          failureReason,
        })
      }
    }
  }
  return runs
}

/** Get (or create) the datetime list for a model inside a question group. */
function datetimesFor(byModel: Map<string, string[]>, model: string): string[] {
  let datetimes = byModel.get(model)
  if (datetimes === undefined) {
    datetimes = []
    byModel.set(model, datetimes)
  }
  return datetimes
}

/**
 * Question-first projection over a flat run list:
 * question -> model -> datetime, each level sorted. Pure: it only reads its
 * argument, so the same list produces the same tree regardless of order.
 */
export function groupByQuestion(runs: SessionRun[]): QuestionFirstGroup[] {
  const byQuestion = new Map<string, Map<string, string[]>>()
  for (const run of runs) {
    let byModel = byQuestion.get(run.question)
    if (byModel === undefined) {
      byModel = new Map<string, string[]>()
      byQuestion.set(run.question, byModel)
    }
    datetimesFor(byModel, run.model).push(run.datetime)
  }
  const groups: QuestionFirstGroup[] = []
  for (const question of [...byQuestion.keys()].sort()) {
    const byModel = byQuestion.get(question) ?? new Map<string, string[]>()
    const models: ModelNode[] = []
    for (const model of [...byModel.keys()].sort()) {
      const datetimes = byModel.get(model) ?? []
      models.push({ model, datetimes: [...datetimes].sort() })
    }
    groups.push({ question, models })
  }
  return groups
}

/**
 * Model-first projection over a flat run list:
 * model -> question -> datetime, each level sorted. Pure, like groupByQuestion.
 */
export function groupByModel(runs: SessionRun[]): ModelFirstGroup[] {
  const byModel = new Map<string, Map<string, string[]>>()
  for (const run of runs) {
    let byQuestion = byModel.get(run.model)
    if (byQuestion === undefined) {
      byQuestion = new Map<string, string[]>()
      byModel.set(run.model, byQuestion)
    }
    datetimesFor(byQuestion, run.question).push(run.datetime)
  }
  const groups: ModelFirstGroup[] = []
  for (const model of [...byModel.keys()].sort()) {
    const byQuestion = byModel.get(model) ?? new Map<string, string[]>()
    const questions: QuestionNode[] = []
    for (const question of [...byQuestion.keys()].sort()) {
      const datetimes = byQuestion.get(question) ?? []
      questions.push({ question, datetimes: [...datetimes].sort() })
    }
    groups.push({ model, questions })
  }
  return groups
}
