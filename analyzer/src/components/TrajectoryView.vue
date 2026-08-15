<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { KIND_LABELS, visibleIndexes, type TrajectoryRecord } from '../lib/trajectory'
import { deriveTimeline, type TimelineMode } from '../lib/timeline'
import TimelineOverview from './TimelineOverview.vue'
import RecordDetail from './RecordDetail.vue'

const props = defineProps<{ records: TrajectoryRecord[] }>()

/** 0-based index of the selected record, or null when nothing is selected. */
const selectedIndex = ref<number | null>(null)
const searchQuery = ref('')
const mode = ref<TimelineMode>('sequence')

const ledgerPane = ref<HTMLElement | null>(null)

const timelineModel = computed(() => deriveTimeline(props.records, mode.value))

/** Per-record search-match flag; null when no search is active. */
const matches = computed<boolean[] | null>(() => {
  if (searchQuery.value.trim() === '') return null
  return visibleIndexes(props.records, searchQuery.value)
})

/** Records to render, carrying their original index for selection/detail. */
const visible = computed(() =>
  props.records
    .map((record, index) => ({ record, index }))
    .filter((_, index) => matches.value === null || matches.value[index]),
)

const selected = computed<TrajectoryRecord | null>(() => {
  if (selectedIndex.value === null) return null
  return props.records[selectedIndex.value] ?? null
})

/** Wall-clock time of a record, formatted HH:MM:SS; null when absent. */
function timeOf(record: TrajectoryRecord): string | null {
  if (record.timestampMs === null) return null
  const date = new Date(record.timestampMs)
  if (!Number.isFinite(date.getTime())) return null
  return date.toISOString().slice(11, 19)
}

async function select(index: number) {
  selectedIndex.value = index
  await nextTick()
  ledgerPane.value?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
}

function closeDetail() {
  selectedIndex.value = null
}
</script>

<template>
  <div class="trajectory">
    <p v-if="records.length === 0" class="micro muted">This transcript contains no records.</p>
    <template v-else>
      <div class="ledger-pane">
        <div class="toolbar">
          <label class="search">
            <span class="micro search-label">Search</span>
            <input
              v-model="searchQuery"
              type="search"
              placeholder="Filter records…"
              aria-label="Filter records"
            />
          </label>
          <div class="mode-toggle" role="group" aria-label="Timeline mode">
            <button
              type="button"
              :class="{ active: mode === 'sequence' }"
              @click="mode = 'sequence'"
            >
              Sequence
            </button>
            <button
              type="button"
              :class="{ active: mode === 'duration' }"
              @click="mode = 'duration'"
            >
              Duration
            </button>
          </div>
        </div>

        <TimelineOverview
          :records="records"
          :model="timelineModel"
          :matches="matches"
          @select="select"
        />

        <div class="ledger-scroll" ref="ledgerPane" data-trajectory-scroll>
          <table class="ledger" aria-label="Trajectory records" :aria-rowcount="records.length">
            <thead>
              <tr>
                <th class="col-line">#</th>
                <th class="col-kind">Type</th>
                <th class="col-summary">Record</th>
                <th class="col-time">Time</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="entry in visible"
                :key="entry.index"
                :data-selected="entry.index === selectedIndex ? 'true' : 'false'"
                :data-kind="entry.record.kind"
                :data-depth="entry.record.depth"
                tabindex="0"
                @click="select(entry.index)"
                @keydown.enter="select(entry.index)"
                @keydown.space.prevent="select(entry.index)"
              >
                <td class="col-line">{{ entry.index + 1 }}</td>
                <td class="col-kind">
                  <span class="kind-tag" :data-kind="entry.record.kind">{{ KIND_LABELS[entry.record.kind] }}</span>
                </td>
                <td class="col-summary">{{ entry.record.summary }}</td>
                <td class="col-time">{{ timeOf(entry.record) ?? '—' }}</td>
              </tr>
            </tbody>
          </table>
          <p v-if="visible.length === 0" class="ledger-empty">No records match the filter.</p>
        </div>
      </div>
      <RecordDetail
        v-if="selected !== null"
        :record="selected"
        @close="closeDetail"
      />
    </template>
  </div>
</template>
