<script setup lang="ts">
import { computed } from 'vue'
import { computeRunStats, type TrajectoryRecord } from '../lib/trajectory'

const props = defineProps<{ records: TrajectoryRecord[] }>()

const stats = computed(() => computeRunStats(props.records))

/** Label/value pairs rendered left-to-right; totals only, no per-turn detail. */
const fields = computed(() => [
  { label: 'Turns', value: stats.value.turns },
  { label: 'Input', value: stats.value.input },
  { label: 'Output', value: stats.value.output },
  { label: 'Reasoning', value: stats.value.reasoning },
  { label: 'Cache read', value: stats.value.cacheRead },
  { label: 'Cache write', value: stats.value.cacheWrite },
  { label: 'Total tokens', value: stats.value.totalTokens },
])
</script>

<template>
  <div class="run-stats" aria-label="Run statistics">
    <div v-for="field in fields" :key="field.label" class="run-stat">
      <span class="run-stat-value">{{ field.value.toLocaleString('en-US') }}</span>
      <span class="run-stat-label micro">{{ field.label }}</span>
    </div>
  </div>
</template>
