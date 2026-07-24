<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { ComboEntry, Manifest } from './lib/manifest'
import { parseHash, type Route } from './lib/router'
import { theme, toggleTheme } from './lib/theme'
import HomeView from './views/HomeView.vue'
import QuestionView from './views/QuestionView.vue'
import SessionView from './views/SessionView.vue'

type ManifestState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; manifest: Manifest }

type View =
  | { kind: 'home' }
  | { kind: 'question'; question: string; combos: ComboEntry[] }
  | { kind: 'session'; combo: ComboEntry | undefined }

const state = ref<ManifestState>({ status: 'loading' })
const route = ref<Route>(parseHash(window.location.hash))

function onHashChange() {
  route.value = parseHash(window.location.hash)
  window.scrollTo(0, 0)
}

onMounted(async () => {
  window.addEventListener('hashchange', onHashChange)
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

onUnmounted(() => window.removeEventListener('hashchange', onHashChange))

const combos = computed<ComboEntry[]>(() =>
  state.value.status === 'loaded' ? state.value.manifest.combos : [],
)

const generatedAt = computed(() =>
  state.value.status === 'loaded' ? state.value.manifest.generatedAt.slice(0, 10) : null,
)

const view = computed<View>(() => {
  const current = route.value
  if (current.name === 'question') {
    return {
      kind: 'question',
      question: current.question,
      combos: combos.value.filter((combo) => combo.question.name === current.question),
    }
  }
  if (current.name === 'session') {
    return {
      kind: 'session',
      combo: combos.value.find((combo) => combo.comboId === current.comboId),
    }
  }
  return { kind: 'home' }
})
</script>

<template>
  <div class="app">
    <!-- The session view is a fullscreen takeover with its own chrome. -->
    <SessionView
      v-if="view.kind === 'session'"
      :key="view.combo?.comboId ?? 'unknown'"
      :combo="view.combo"
    />
    <template v-else>
      <header class="topbar">
        <a class="topbar-brand" href="#/"><span class="brand-accent">LLM</span>-INTERVIEW</a>
        <div class="topbar-right">
          <span v-if="generatedAt" class="micro">Vol. 01 · Generated {{ generatedAt }}</span>
          <button class="theme-toggle" @click="toggleTheme">
            {{ theme === 'dark' ? 'Light' : 'Dark' }}
          </button>
        </div>
      </header>
      <p v-if="state.status === 'loading'" class="state-note">Loading manifest…</p>
      <p v-else-if="state.status === 'error'" class="state-note">
        Failed to load manifest: {{ state.message }}
      </p>
      <HomeView v-else-if="view.kind === 'home'" :combos="combos" />
      <QuestionView v-else :question="view.question" :combos="view.combos" />
    </template>
  </div>
</template>
