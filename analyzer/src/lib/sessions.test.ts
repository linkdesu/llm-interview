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
    }
  }
  // A legacy run directory without a transcript.
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

describe('listSessionRuns', () => {
  it('lists every archived run, full history across all combos', () => {
    const { root, cleanup } = makeArchive()
    try {
      const runs = listSessionRuns(root)
      expect(runs).toEqual([
        { question: 'browser-os', model: 'Qwen3.6-27B-Q5_K_M', datetime: '20260728-024239', sessionJsonl: jsonlFor('browser-os', 'Qwen3.6-27B-Q5_K_M', '20260728-024239') },
        { question: 'browser-os', model: 'Qwen3.6-27B-Q5_K_M', datetime: '20260728-111111', sessionJsonl: jsonlFor('browser-os', 'Qwen3.6-27B-Q5_K_M', '20260728-111111') },
        { question: 'browser-os', model: 'Qwopus3.6-35B-A3B-Coder-Q5_K_M', datetime: '20260729-045601', sessionJsonl: jsonlFor('browser-os', 'Qwopus3.6-35B-A3B-Coder-Q5_K_M', '20260729-045601') },
        { question: 'city-time-machine', model: 'Qwen3.6-27B-Q5_K_M', datetime: '20260728-025707', sessionJsonl: jsonlFor('city-time-machine', 'Qwen3.6-27B-Q5_K_M', '20260728-025707') },
        { question: 'city-time-machine', model: 'Qwopus3.6-35B-A3B-Coder-Q5_K_M', datetime: '20260729-050326', sessionJsonl: null },
        { question: 'snake', model: 'Qwen3.6-27B-Q5_K_M', datetime: '20260728-032801', sessionJsonl: jsonlFor('snake', 'Qwen3.6-27B-Q5_K_M', '20260728-032801') },
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
      { question: 'zeta', model: 'alpha', datetime: '20260101-000002', sessionJsonl: null },
      { question: 'alpha', model: 'beta', datetime: '20260101-000001', sessionJsonl: null },
      { question: 'zeta', model: 'alpha', datetime: '20260101-000003', sessionJsonl: null },
      { question: 'alpha', model: 'alpha', datetime: '20260101-000004', sessionJsonl: null },
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
      { question: 'q1', model: 'm2', datetime: '20260101-000001', sessionJsonl: null },
      { question: 'q2', model: 'm1', datetime: '20260101-000002', sessionJsonl: null },
      { question: 'q1', model: 'm1', datetime: '20260101-000003', sessionJsonl: null },
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
