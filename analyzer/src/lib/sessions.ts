// Session-archive walk and grouping helpers for the Analyzer server.
//
// The archive layout is session/<question>/<model>/<datetime>/ — each
// <datetime> directory is one archived Run (see CONTEXT.md) holding the
// transcript (session.jsonl), run metadata (run.json) and the artifact files.
// This module is server-only because it reads the filesystem: it is excluded
// from the browser tsconfig, imported by the Bun server, and unit-tested under
// vitest with temp-dir fixtures.
import { existsSync, readdirSync, statSync } from 'node:fs'
import * as path from 'node:path'

/** One archived Run: a <datetime> directory under the session archive. */
export interface SessionRun {
  question: string
  model: string
  datetime: string
  /** Path of the transcript relative to the archive root, or null when the
   *  run directory has no session.jsonl (pre-JSONL archive format). */
  sessionJsonl: string | null
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
        runs.push({
          question,
          model,
          datetime,
          sessionJsonl: existsSync(path.join(runDir, 'session.jsonl'))
            ? relativeJsonl
            : null,
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
