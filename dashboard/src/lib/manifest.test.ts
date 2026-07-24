import { describe, expect, it } from 'vitest'
import {
  comboLabel,
  filterCombos,
  formatDuration,
  formatParam,
  summarizeManifest,
  summarizeQuestions,
  type ComboEntry,
} from './manifest'

function makeCombo(overrides: Partial<ComboEntry> & { comboId: string }): ComboEntry {
  return {
    question: { name: 'snake', hasSpec: true, hasTickets: true },
    model: { name: 'model-a', provider: 'llamacpp-local', modelId: 'model-a' },
    params: { thinking: 'on', temp: 0.6 },
    piVersion: '0.81.1',
    startedAt: '2026-07-23T15:27:34.983Z',
    endedAt: '2026-07-23T15:32:27.709Z',
    durationMs: 292713,
    status: 'ok',
    contractViolations: [],
    files: {},
    ...overrides,
  }
}

const fixture: ComboEntry[] = [
  makeCombo({
    comboId: 'c3',
    question: { name: 'snake', hasSpec: true, hasTickets: true },
    model: { name: 'zephyr-7b', provider: 'llamacpp-local', modelId: 'zephyr-7b-q5' },
  }),
  makeCombo({
    comboId: 'c1',
    question: { name: 'pomodoro', hasSpec: false, hasTickets: false },
    model: { name: 'qwen3.6-27b', provider: 'llamacpp-local', modelId: 'qwen3.6-27b-fusion-q5' },
  }),
  makeCombo({
    comboId: 'c2',
    question: { name: 'snake', hasSpec: true, hasTickets: true },
    model: { name: 'qwen3.6-27b', provider: 'llamacpp-local', modelId: 'qwen3.6-27b-fusion-q5' },
  }),
]

describe('summarizeQuestions', () => {
  it('groups combos by question with models, session count and latest run time', () => {
    const summaries = summarizeQuestions(fixture)
    expect(summaries.map((q) => q.name)).toEqual(['pomodoro', 'snake'])
    expect(summaries[0]).toEqual({
      name: 'pomodoro',
      models: ['qwen3.6-27b'],
      sessionCount: 1,
      latestEndedAt: '2026-07-23T15:32:27.709Z',
    })
    const snake = summaries[1]
    expect(snake.models).toEqual(['qwen3.6-27b', 'zephyr-7b'])
    expect(snake.sessionCount).toBe(2)
  })

  it('picks the latest endedAt across a question’s combos', () => {
    const summaries = summarizeQuestions([
      makeCombo({ comboId: 'a', endedAt: '2026-07-20T00:00:00.000Z' }),
      makeCombo({ comboId: 'b', endedAt: '2026-07-22T00:00:00.000Z' }),
    ])
    expect(summaries[0].latestEndedAt).toBe('2026-07-22T00:00:00.000Z')
  })

  it('returns an empty list for no combos', () => {
    expect(summarizeQuestions([])).toEqual([])
  })
})

describe('summarizeManifest', () => {
  it('counts distinct questions and models, sessions and total duration', () => {
    expect(summarizeManifest(fixture)).toEqual({
      questionCount: 2,
      modelCount: 2,
      sessionCount: 3,
      totalDurationMs: 292713 * 3,
    })
  })

  it('returns zeros for no combos', () => {
    expect(summarizeManifest([])).toEqual({
      questionCount: 0,
      modelCount: 0,
      sessionCount: 0,
      totalDurationMs: 0,
    })
  })
})

describe('filterCombos', () => {
  it('returns all combos for an empty or whitespace query', () => {
    expect(filterCombos(fixture, '')).toEqual(fixture)
    expect(filterCombos(fixture, '   ')).toEqual(fixture)
  })

  it('matches question name case-insensitively', () => {
    const result = filterCombos(fixture, 'SNAKE')
    expect(result.map((c) => c.comboId)).toEqual(['c3', 'c2'])
  })

  it('matches model name across questions', () => {
    const result = filterCombos(fixture, 'qwen')
    expect(result.map((c) => c.comboId)).toEqual(['c1', 'c2'])
  })

  it('matches modelId', () => {
    const result = filterCombos(fixture, 'fusion-q5')
    expect(result.map((c) => c.comboId)).toEqual(['c1', 'c2'])
  })

  it('returns nothing when no field matches', () => {
    expect(filterCombos(fixture, 'gpt-5')).toEqual([])
  })
})

describe('formatDuration', () => {
  it('formats minutes and seconds', () => {
    expect(formatDuration(292713)).toBe('4m 53s')
  })

  it('formats sub-minute durations', () => {
    expect(formatDuration(42000)).toBe('42s')
  })

  it('formats hours', () => {
    expect(formatDuration(3720000)).toBe('1h 2m')
  })
})

describe('comboLabel', () => {
  it('combines question and model name', () => {
    expect(comboLabel(fixture[0])).toBe('snake / zephyr-7b')
  })
})

describe('formatParam', () => {
  it('passes strings through and JSON-encodes other values', () => {
    expect(formatParam('on')).toBe('on')
    expect(formatParam(0.6)).toBe('0.6')
    expect(formatParam(true)).toBe('true')
  })
})
