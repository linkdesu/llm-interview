<script setup lang="ts">
import { computed } from 'vue'
import type { TrajectoryRecord } from '../lib/trajectory'
import type { TimelineModel, TimelineSpan } from '../lib/timeline'

const props = defineProps<{
  records: TrajectoryRecord[]
  model: TimelineModel
  /** Per-record search-match flag; null when no search is active. */
  matches: boolean[] | null
}>()

defineEmits<{ select: [index: number] }>()

const LANES: Array<[lane: 0 | 1 | 2, label: string]> = [
  [0, 'Input'],
  [1, 'Assistant'],
  [2, 'Tool'],
]

function spansFor(lane: number): TimelineSpan[] {
  return props.model.spans.filter((span) => span.lane === lane)
}

/** Session markers positioned at the session record's span start. */
const sessionMarkers = computed(() => {
  const byIndex = new Map(props.model.spans.map((span) => [span.recordIndex, span]))
  return props.model.sessionIndexes
    .map((index) => byIndex.get(index))
    .filter((span): span is TimelineSpan => span !== undefined)
    .map((span) => span.start)
})

function isMatch(recordIndex: number): boolean {
  return props.matches === null || props.matches[recordIndex] === true
}

function titleOf(recordIndex: number): string {
  const record = props.records[recordIndex]
  return `#${recordIndex + 1} · ${record.kind} — ${record.summary}`
}
</script>

<template>
  <div class="timeline" aria-label="Overview timeline">
    <div v-for="[lane, label] in LANES" :key="lane" class="timeline-lane">
      <span class="timeline-lane-label">{{ label }}</span>
      <div class="timeline-track">
        <span
          v-for="span in spansFor(lane)"
          :key="span.recordIndex"
          class="timeline-span"
          :data-kind="records[span.recordIndex].kind"
          :data-match="isMatch(span.recordIndex) ? 'true' : 'false'"
          :style="{ left: (span.start * 100).toFixed(3) + '%', width: ((span.end - span.start) * 100).toFixed(3) + '%' }"
          :title="titleOf(span.recordIndex)"
          role="button"
          tabindex="0"
          @click="$emit('select', span.recordIndex)"
          @keydown.enter="$emit('select', span.recordIndex)"
        ></span>
        <span
          v-for="(marker, index) in sessionMarkers"
          :key="'s' + index"
          class="timeline-session-marker"
          :style="{ left: (marker * 100).toFixed(3) + '%' }"
        ></span>
      </div>
    </div>
  </div>
</template>
