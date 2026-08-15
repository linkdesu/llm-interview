// Pure projection of a flat record ledger into an overview timeline: three
// lanes (0 input/system, 1 assistant/compaction, 2 tool) with one span per
// record. Two modes:
//   - sequence: every record is an equal-width slot, in source order.
//   - duration: spans are sized by the (idle-compressed) time to the next
//     record, so activity clusters are visible without idle gaps dominating.
// No runtime dependencies; safe to import from the browser bundle.

import { laneForKind, type TrajectoryRecord } from './trajectory'

export type TimelineMode = 'sequence' | 'duration'

/** One horizontal span in the timeline, positioned in normalized [0, 1]. */
export interface TimelineSpan {
  /** Index into the source record list. */
  recordIndex: number
  lane: 0 | 1 | 2
  start: number
  end: number
}

export interface TimelineModel {
  mode: TimelineMode
  spans: TimelineSpan[]
  /** Record indexes of session boundaries (drawn as vertical markers). */
  sessionIndexes: number[]
}

/** Idle gaps longer than this (ms) are compressed to this ceiling. */
const MAX_IDLE_MS = 60_000

/** Equal-width spans, one per record, in source order. */
function sequenceSpans(records: TrajectoryRecord[]): TimelineSpan[] {
  const count = records.length
  if (count === 0) return []
  return records.map((record, index) => ({
    recordIndex: index,
    lane: laneForKind(record.kind),
    start: index / count,
    end: (index + 1) / count,
  }))
}

/** Median of a number array, or null when the array is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Time-based spans with idle compression. Records without a timestamp inherit
 * the nearest known neighbour; if no record carries a timestamp the projection
 * falls back to equal-width slots.
 */
function durationSpans(records: TrajectoryRecord[]): TimelineSpan[] {
  const count = records.length
  if (count === 0) return []

  // Resolve timestamps: forward-fill, then back-fill leading nulls.
  const times: Array<number | null> = records.map((record) => record.timestampMs)
  let lastKnown: number | null = null
  for (let index = 0; index < count; index++) {
    if (times[index] === null) times[index] = lastKnown
    else lastKnown = times[index]
  }
  for (let index = count - 1; index >= 0; index--) {
    if (times[index] === null) times[index] = lastKnown
    else lastKnown = times[index]
  }
  if (times.some((time) => time === null)) return sequenceSpans(records)

  // Width of each record = idle-compressed time until the next record; the
  // last record takes the median gap so its span stays visible.
  const gaps: number[] = []
  for (let index = 0; index < count - 1; index++) {
    const gap = (times[index + 1] as number) - (times[index] as number)
    gaps.push(Math.min(Math.max(0, gap), MAX_IDLE_MS))
  }
  const widths = [...gaps, median(gaps) ?? 1]
  const total = widths.reduce((sum, width) => sum + width, 0)
  if (total <= 0) return sequenceSpans(records)

  const spans: TimelineSpan[] = []
  let cursor = 0
  for (let index = 0; index < count; index++) {
    const start = cursor / total
    cursor += widths[index]
    spans.push({
      recordIndex: index,
      lane: laneForKind(records[index].kind),
      start,
      end: cursor / total,
    })
  }
  return spans
}

/** Project a record ledger into a three-lane overview timeline. */
export function deriveTimeline(records: TrajectoryRecord[], mode: TimelineMode): TimelineModel {
  const spans = mode === 'sequence' ? sequenceSpans(records) : durationSpans(records)
  const sessionIndexes = records
    .map((record, index) => (record.kind === 'session' ? index : -1))
    .filter((index) => index >= 0)
  return { mode, spans, sessionIndexes }
}
