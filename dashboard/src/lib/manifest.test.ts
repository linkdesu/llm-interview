import { describe, expect, it } from 'vitest'
import {
  buildSidebarTree,
  comboLabel,
  filterCombos,
  formatDuration,
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

describe('buildSidebarTree', () => {
  it('groups combos by question with models nested, sorted alphabetically', () => {
    const tree = buildSidebarTree(fixture)
    expect(tree.map((q) => q.name)).toEqual(['pomodoro', 'snake'])
    const snake = tree[1]
    expect(snake.models).toEqual([
      { comboId: 'c2', name: 'qwen3.6-27b' },
      { comboId: 'c3', name: 'zephyr-7b' },
    ])
  })

  it('returns an empty tree for no combos', () => {
    expect(buildSidebarTree([])).toEqual([])
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
