<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  buildSidebarTree,
  filterCombos,
  type Manifest,
} from './lib/manifest'
import SidebarNav from './components/SidebarNav.vue'
import ComboCard from './components/ComboCard.vue'

type ManifestState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; manifest: Manifest }

const state = ref<ManifestState>({ status: 'loading' })
const query = ref('')
const selectedQuestion = ref<string | null>(null)

// Typing a keyword starts a new search across all questions (story 17), so a
// question selection made before filtering must not keep scoping the main
// area — otherwise filtering by a model name could show an empty grid.
watch(query, () => {
  selectedQuestion.value = null
})

onMounted(async () => {
  try {
    // Relative path so the app works when served from a sub-path.
    const response = await fetch('manifest.json')
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const manifest = (await response.json()) as Manifest
    state.value = { status: 'loaded', manifest }
  } catch (error) {
    state.value = {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
})

const visibleCombos = computed(() => {
  if (state.value.status !== 'loaded') return []
  const filtered = filterCombos(state.value.manifest.combos, query.value)
  if (selectedQuestion.value === null) return filtered
  return filtered.filter((combo) => combo.question.name === selectedQuestion.value)
})

const sidebarTree = computed(() =>
  state.value.status === 'loaded'
    ? buildSidebarTree(filterCombos(state.value.manifest.combos, query.value))
    : [],
)

const generatedAt = computed(() =>
  state.value.status === 'loaded' ? state.value.manifest.generatedAt : null,
)
</script>

<template>
  <div class="app">
    <SidebarNav
      v-model:query="query"
      :questions="sidebarTree"
      :selected-question="selectedQuestion"
      :generated-at="generatedAt"
      @select="selectedQuestion = $event"
    />
    <main class="main">
      <p v-if="state.status === 'loading'" class="state-note">Loading manifest…</p>
      <p v-else-if="state.status === 'error'" class="state-note">
        Failed to load manifest: {{ state.message }}
      </p>
      <p v-else-if="visibleCombos.length === 0" class="state-note">No combos to show</p>
      <div v-else class="combo-grid">
        <ComboCard v-for="combo in visibleCombos" :key="combo.comboId" :combo="combo" />
      </div>
    </main>
  </div>
</template>
