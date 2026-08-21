import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  groupByModel,
  groupByQuestion,
  listSessionRuns,
  type ModelFirstGroup,
  type QuestionFirstGroup,
  type SessionRun,
} from './sessions.ts'

/**
 * Build a fake session/<question>/<model>/<datetime> archive in a fresh temp
 * directory and return its root plus a cleanup function. Mirrors the real
 * layout under the repo's session/ (including legacy runs without a
 * transcript and dot-hidden/loose files that must be ignored).
 */
function makeArchive(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'analyzer-sessions-'))
  const transcript: Record<string, string[]> = {
    'browser-os/Qwen3.6-27B-Q5_K_M': ['20260728-024239', '20260728-111111'],
    'browser-os/Qwopus3.6-35B-A3B-Coder-Q5_K_M': ['20260729-045601'],
    'city-time-machine/Qwen3.6-27B-Q5_K_M': ['20260728-025707'],
    'snake/Qwen3.6-27B-Q5_K_M': ['20260728-032801'],
  }
  for (const [combo, datetimes] of Object.entries(transcript)) {
    for (const datetime of datetimes) {
      const runDir = path.join(root, combo, datetime)
      mkdirSync(runDir, { recursive: true })
      writeFileSync(path.join(runDir, 'session.jsonl'), '{"role":"user"}\n')
      writeFileSync(path.join(runDir, 'index.html'), '<!DOCTYPE html>\n')
    }
  }
  // A legacy run directory without a transcript or an Artifact.
  mkdirSync(path.join(root, 'city-time-machine', 'Qwopus3.6-35B-A3B-Coder-Q5_K_M', '20260729-050326'), {
    recursive: true,
  })
  // Distractors the walk must ignore: dot-hidden entries and loose files.
  mkdirSync(path.join(root, '.hidden', '20260101-000000'), { recursive: true })
  writeFileSync(path.join(root, '.hidden', '20260101-000000', 'session.jsonl'), '{}')
  writeFileSync(path.join(root, '.DS_Store'), 'junk')
  writeFileSync(path.join(root, '.gitkeep'), '')
  writeFileSync(path.join(root, 'notes.txt'), 'not a question')
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

function jsonlFor(question: string, model: string, datetime: string): string {
  return path.join(question, model, datetime, 'session.jsonl')
}

function htmlFor(question: string, model: string, datetime: string): string {
  return path.join(question, model, datetime, 'index.html')
}
function runJsonFor(question: string, model: string, datetime: string): string {
  return path.join(question, model, datetime, 'run.json')
}

describe('listSessionRuns', () => {
  it('lists every archived run, full history across all combos', () => {
    const { root, cleanup } = makeArchive()
    try {
      const runs = listSessionRuns(root)
      expect(runs).toEqual([
        { question: 'browser-os', model: 'Qwen3.6-27B-Q5_K_M', datetime: '20260728-024239', sessionJsonl: jsonlFor('browser-os', 'Qwen3.6-27B-Q5_K_M', '20260728-024239'), artifactHtml: htmlFor('browser-os', 'Qwen3.6-27B-Q5_K_M', '20260728-024239'), status: null, failureReason: null },
        { question: 'browser-os', model: 'Qwen3.6-27B-Q5_K_M', datetime: '20260728-111111', sessionJsonl: jsonlFor('browser-os', 'Qwen3.6-27B-Q5_K_M', '20260728-111111'), artifactHtml: htmlFor('browser-os', 'Qwen3.6-27B-Q5_K_M', '20260728-111111'), status: null, failureReason: null },
        { question: 'browser-os', model: 'Qwopus3.6-35B-A3B-Coder-Q5_K_M', datetime: '20260729-045601', sessionJsonl: jsonlFor('browser-os', 'Qwopus3.6-35B-A3B-Coder-Q5_K_M', '20260729-045601'), artifactHtml: htmlFor('browser-os', 'Qwopus3.6-35B-A3B-Coder-Q5_K_M', '20260729-045601'), status: null, failureReason: null },
        { question: 'city-time-machine', model: 'Qwen3.6-27B-Q5_K_M', datetime: '20260728-025707', sessionJsonl: jsonlFor('city-time-machine', 'Qwen3.6-27B-Q5_K_M', '20260728-025707'), artifactHtml: htmlFor('city-time-machine', 'Qwen3.6-27B-Q5_K_M', '20260728-025707'), status: null, failureReason: null },
        { question: 'city-time-machine', model: 'Qwopus3.6-35B-A3B-Coder-Q5_K_M', datetime: '20260729-050326', sessionJsonl: null, artifactHtml: null, status: null, failureReason: null },
        { question: 'snake', model: 'Qwen3.6-27B-Q5_K_M', datetime: '20260728-032801', sessionJsonl: jsonlFor('snake', 'Qwen3.6-27B-Q5_K_M', '20260728-032801'), artifactHtml: htmlFor('snake', 'Qwen3.6-27B-Q5_K_M', '20260728-032801'), status: null, failureReason: null },
      ])
    } finally {
      cleanup()
    }
  })

  it('ignores dot-hidden entries and loose files at every level', () => {
    const { root, cleanup } = makeArchive()
    try {
      const runs = listSessionRuns(root)
      const identities = runs.map((r) => [r.question, r.model, r.datetime])
      expect(identities).not.toContainEqual(['.hidden', '20260101-000000'])
      expect(runs).toHaveLength(6)
    } finally {
      cleanup()
    }
  })

  it('is deterministic across repeated walks', () => {
    const { root, cleanup } = makeArchive()
    try {
      expect(listSessionRuns(root)).toEqual(listSessionRuns(root))
    } finally {
      cleanup()
    }
  })

  it('reads status and failureReason from run.json when present', () => {
    const { root, cleanup } = makeArchive()
    try {
      writeFileSync(
        path.join(root, runJsonFor('browser-os', 'Qwen3.6-27B-Q5_K_M', '20260728-024239')),
        JSON.stringify({ status: 'error', failureReason: { kind: 'max-turns', message: 'hit the 100-turn limit' } }),
      )
      const runs = listSessionRuns(root)
      const errored = runs.find((r) => r.datetime === '20260728-024239')
      expect(errored?.status).toBe('error')
      expect(errored?.failureReason).toEqual({ kind: 'max-turns', message: 'hit the 100-turn limit' })
      const clean = runs.find((r) => r.datetime === '20260728-111111')
      expect(clean?.status).toBeNull()
      expect(clean?.failureReason).toBeNull()
    } finally {
      cleanup()
    }
  })

  it('is lenient with a legacy run.json that has no failureReason', () => {
    const { root, cleanup } = makeArchive()
    try {
      writeFileSync(
        path.join(root, runJsonFor('snake', 'Qwen3.6-27B-Q5_K_M', '20260728-032801')),
        JSON.stringify({ status: 'ok', exitCode: 0 }),
      )
      const runs = listSessionRuns(root)
      const legacy = runs.find((r) => r.datetime === '20260728-032801')
      expect(legacy?.status).toBe('ok')
      expect(legacy?.failureReason).toBeNull()
    } finally {
      cleanup()
    }
  })

  it('does not throw when run.json is corrupt', () => {
    const { root, cleanup } = makeArchive()
    try {
      writeFileSync(
        path.join(root, runJsonFor('snake', 'Qwen3.6-27B-Q5_K_M', '20260728-032801')),
        '{ not valid json',
      )
      const runs = listSessionRuns(root)
      const broken = runs.find((r) => r.datetime === '20260728-032801')
      expect(broken?.status).toBeNull()
      expect(broken?.failureReason).toBeNull()
    } finally {
      cleanup()
    }
  })
  it('rebuilds a legacy api-failure reason for an error run without failureReason', () => {
    const { root, cleanup } = makeArchive()
    try {
      writeFileSync(
        path.join(root, runJsonFor('snake', 'Qwen3.6-27B-Q5_K_M', '20260728-032801')),
        JSON.stringify({ status: 'error', apiError: '500: upstream error: do request failed' }),
      )
      const runs = listSessionRuns(root)
      const legacy = runs.find((r) => r.datetime === '20260728-032801')
      expect(legacy?.status).toBe('error')
      expect(legacy?.failureReason).toEqual({
        kind: 'api-failure',
        message: 'Terminal API failure: 500: upstream error: do request failed',
      })
    } finally {
      cleanup()
    }
  })

  it('rebuilds a legacy max-turns reason for an error run without failureReason', () => {
    const { root, cleanup } = makeArchive()
    try {
      writeFileSync(
        path.join(root, runJsonFor('city-time-machine', 'Qwen3.6-27B-Q5_K_M', '20260728-025707')),
        JSON.stringify({ status: 'error', maxTurnsExceeded: true }),
      )
      const runs = listSessionRuns(root)
      const legacy = runs.find((r) => r.datetime === '20260728-025707')
      expect(legacy?.failureReason).toEqual({
        kind: 'max-turns',
        message: 'The run was killed for exceeding the max turn limit',
      })
    } finally {
      cleanup()
    }
  })

  it('rebuilds a legacy incomplete reason from an evaluation verdict', () => {
    const { root, cleanup } = makeArchive()
    try {
      writeFileSync(
        path.join(root, runJsonFor('browser-os', 'Qwen3.6-27B-Q5_K_M', '20260728-024239')),
        JSON.stringify({
          status: 'error',
          invocations: [
            { ticket: 1, evaluation: true, verdict: 'complete' },
            { ticket: 2, ticketTitle: 'Wallpaper', evaluation: true, verdict: 'incomplete' },
          ],
        }),
      )
      const runs = listSessionRuns(root)
      const legacy = runs.find((r) => r.datetime === '20260728-024239')
      expect(legacy?.failureReason).toEqual({
        kind: 'incomplete',
        message: 'ticket 2 (Wallpaper) was judged INCOMPLETE by its evaluation',
      })
    } finally {
      cleanup()
    }
  })


  it('returns an empty list for an empty root', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'analyzer-sessions-'))
    try {
      expect(listSessionRuns(root)).toEqual([])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('groupByQuestion', () => {
  it('groups question -> model -> datetime with every level sorted', () => {
    const { root, cleanup } = makeArchive()
    try {
      const groups: QuestionFirstGroup[] = groupByQuestion(listSessionRuns(root))
      expect(groups).toEqual([
        {
          question: 'browser-os',
          models: [
            { model: 'Qwen3.6-27B-Q5_K_M', datetimes: ['20260728-024239', '20260728-111111'] },
            { model: 'Qwopus3.6-35B-A3B-Coder-Q5_K_M', datetimes: ['20260729-045601'] },
          ],
        },
        {
          question: 'city-time-machine',
          models: [
            { model: 'Qwen3.6-27B-Q5_K_M', datetimes: ['20260728-025707'] },
            { model: 'Qwopus3.6-35B-A3B-Coder-Q5_K_M', datetimes: ['20260729-050326'] },
          ],
        },
        {
          question: 'snake',
          models: [{ model: 'Qwen3.6-27B-Q5_K_M', datetimes: ['20260728-032801'] }],
        },
      ])
    } finally {
      cleanup()
    }
  })

  it('is a pure projection: input order does not affect the tree', () => {
    const runs: SessionRun[] = [
      { question: 'zeta', model: 'alpha', datetime: '20260101-000002', sessionJsonl: null, artifactHtml: null, status: null, failureReason: null },
      { question: 'alpha', model: 'beta', datetime: '20260101-000001', sessionJsonl: null, artifactHtml: null, status: null, failureReason: null },
      { question: 'zeta', model: 'alpha', datetime: '20260101-000003', sessionJsonl: null, artifactHtml: null, status: null, failureReason: null },
      { question: 'alpha', model: 'alpha', datetime: '20260101-000004', sessionJsonl: null, artifactHtml: null, status: null, failureReason: null },
    ]
    const shuffled = [...runs].reverse()
    expect(groupByQuestion(runs)).toEqual(groupByQuestion(shuffled))
    expect(groupByQuestion(runs)).toEqual([
      {
        question: 'alpha',
        models: [
          { model: 'alpha', datetimes: ['20260101-000004'] },
          { model: 'beta', datetimes: ['20260101-000001'] },
        ],
      },
      {
        question: 'zeta',
        models: [{ model: 'alpha', datetimes: ['20260101-000002', '20260101-000003'] }],
      },
    ])
  })
})

describe('groupByModel', () => {
  it('groups model -> question -> datetime with every level sorted', () => {
    const { root, cleanup } = makeArchive()
    try {
      const groups: ModelFirstGroup[] = groupByModel(listSessionRuns(root))
      expect(groups).toEqual([
        {
          model: 'Qwen3.6-27B-Q5_K_M',
          questions: [
            { question: 'browser-os', datetimes: ['20260728-024239', '20260728-111111'] },
            { question: 'city-time-machine', datetimes: ['20260728-025707'] },
            { question: 'snake', datetimes: ['20260728-032801'] },
          ],
        },
        {
          model: 'Qwopus3.6-35B-A3B-Coder-Q5_K_M',
          questions: [
            { question: 'browser-os', datetimes: ['20260729-045601'] },
            { question: 'city-time-machine', datetimes: ['20260729-050326'] },
          ],
        },
      ])
    } finally {
      cleanup()
    }
  })

  it('is a pure projection: input order does not affect the tree', () => {
    const runs: SessionRun[] = [
      { question: 'q1', model: 'm2', datetime: '20260101-000001', sessionJsonl: null, artifactHtml: null, status: null, failureReason: null },
      { question: 'q2', model: 'm1', datetime: '20260101-000002', sessionJsonl: null, artifactHtml: null, status: null, failureReason: null },
      { question: 'q1', model: 'm1', datetime: '20260101-000003', sessionJsonl: null, artifactHtml: null, status: null, failureReason: null },
    ]
    expect(groupByModel([...runs].reverse())).toEqual([
      {
        model: 'm1',
        questions: [
          { question: 'q1', datetimes: ['20260101-000003'] },
          { question: 'q2', datetimes: ['20260101-000002'] },
        ],
      },
      { model: 'm2', questions: [{ question: 'q1', datetimes: ['20260101-000001'] }] },
    ])
  })
})
