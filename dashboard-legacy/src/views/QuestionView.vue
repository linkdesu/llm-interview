<script setup lang="ts">
import { computed, ref } from 'vue'
import { filterCombos, type ComboEntry } from '../lib/manifest'
import ComboCard from '../components/ComboCard.vue'

const props = defineProps<{
  question: string
  /** Combos belonging to this question (already filtered by the router shell). */
  combos: ComboEntry[]
}>()

const query = ref('')

const visibleCombos = computed(() => filterCombos(props.combos, query.value))

const latestEndedAt = computed(() =>
  props.combos.reduce((max, combo) => (combo.endedAt > max ? combo.endedAt : max), ''),
)
</script>

<template>
  <main class="page">
    <a class="back-link" href="#/">← All questions</a>
    <h1 class="page-title">{{ question }}</h1>
    <p class="micro page-meta">
      {{ combos.length }} {{ combos.length === 1 ? 'model' : 'models' }} · latest run
      {{ latestEndedAt.slice(0, 10) }}
    </p>
    <input
      v-model="query"
      class="section-filter page-filter"
      type="search"
      name="model-filter"
      placeholder="Filter models ⌕"
      aria-label="Filter models"
    />
    <p v-if="combos.length === 0" class="state-note">Unknown question — no sessions recorded.</p>
    <p v-else-if="visibleCombos.length === 0" class="state-note">No matching combos</p>
    <div v-else class="combo-grid">
      <ComboCard v-for="combo in visibleCombos" :key="combo.comboId" :combo="combo" />
    </div>
  </main>
</template>
