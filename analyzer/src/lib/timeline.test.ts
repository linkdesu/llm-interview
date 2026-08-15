import { describe, expect, it } from 'vitest'
import { deriveTimeline } from './timeline'
import type { TimelineMode } from './timeline'
import type { RecordKind, TrajectoryRecord } from './trajectory'

/** Minimal record for timeline projections. */
function record(kind: RecordKind, timestampMs: number | null): TrajectoryRecord {
  return {
    line: 0,
    type: kind,
    kind,
    invocationId: '',
    role: null,
    timestampMs,
    summary: kind,
    meta: [],
    sections: [],
    usage: null,
    raw: null,
    depth: 0,
    parentIndex: null,
  }
}

function lanes(records: TrajectoryRecord[], mode: TimelineMode): number[] {
  return deriveTimeline(records, mode).spans.map((span) => span.lane)
}

describe('deriveTimeline', () => {
  it('assigns one equal-width span per record in sequence mode', () => {
    const records = [
      record('session', null),
      record('user', null),
      record('assistant', null),
      record('tool-result', null),
    ]
    const model = deriveTimeline(records, 'sequence')

    expect(model.spans).toHaveLength(4)
    expect(lanes(records, 'sequence')).toEqual([0, 0, 1, 2])
    expect(model.spans[0].start).toBe(0)
    expect(model.spans[3].end).toBe(1)
    expect(model.spans[1].start).toBeCloseTo(0.25)
  })

  it('sizes duration-mode spans by idle-compressed time between records', () => {
    const records = [
      record('user', 1_000),
      record('assistant', 2_000), // 1 s gap
      record('tool-result', 3_000), // 1 s gap
      record('assistant', 63_000), // 60 s idle → compressed to the 60 s ceiling
    ]
    const model = deriveTimeline(records, 'duration')

    expect(model.spans).toHaveLength(4)
    expect(model.spans[0].start).toBe(0)
    expect(model.spans[3].end).toBe(1)
    // The last (idle) gap is capped, so the final span must not dominate.
    expect(model.spans[3].end - model.spans[3].start).toBeLessThan(0.99)
  })

  it('falls back to equal-width spans when no record has a timestamp', () => {
    const records = [record('user', null), record('assistant', null)]
    expect(deriveTimeline(records, 'duration').spans).toEqual(
      deriveTimeline(records, 'sequence').spans,
    )
  })

  it('reports session boundaries as marker indexes', () => {
    const records = [
      record('session', 1_000),
      record('user', 2_000),
      record('session', 3_000),
      record('assistant', 4_000),
    ]
    expect(deriveTimeline(records, 'sequence').sessionIndexes).toEqual([0, 2])
  })

  it('returns an empty model for an empty ledger', () => {
    const model = deriveTimeline([], 'sequence')
    expect(model.spans).toEqual([])
    expect(model.sessionIndexes).toEqual([])
  })
})
