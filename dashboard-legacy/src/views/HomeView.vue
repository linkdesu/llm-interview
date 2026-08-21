<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  filterCombos,
  formatDuration,
  summarizeManifest,
  summarizeQuestions,
  type ComboEntry,
} from '../lib/manifest'
import { routeHash } from '../lib/router'
import TypewriterText from '../components/TypewriterText.vue'

const props = defineProps<{
  combos: ComboEntry[]
}>()

const LEDE_PHRASES = [
  'pi.dev builds small web projects under different Question × Model combos. Every run is fully archived — transcript, parameters, artifact — and rendered here for side-by-side comparison.',
  'Same intent, different models. Watch how each one plans, codes and ships — every step captured in the transcript.',
  'No cherry-picked demos. Full session archives: the artifact each model produced, and the complete transcript of how it got there.',
  'Compare agent output like for like — identical questions, isolated runs, every artifact rendered side by side.',
]

const COUNT_UP_MS = 1400

const query = ref('')
// Animated total run time, counts up from zero on page load.
const displayedDurationMs = ref(0)
let countUpFrame = 0

const stats = computed(() => summarizeManifest(props.combos))
const questions = computed(() => summarizeQuestions(filterCombos(props.combos, query.value)))

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDate(iso: string): string {
  return iso.slice(0, 10)
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function scrollToQuestions() {
  document.getElementById('questions')?.scrollIntoView({ behavior: 'smooth' })
}

onMounted(() => {
  const target = stats.value.totalDurationMs
  if (target === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    displayedDurationMs.value = target
    return
  }
  const start = performance.now()
  const step = (now: number) => {
    const progress = Math.min(1, (now - start) / COUNT_UP_MS)
    // easeOutQuint: fast start, decelerates hard near the end — the feel of
    // the classic cubic-bezier(0.16, 1, 0.3, 1).
    const eased = 1 - Math.pow(1 - progress, 5)
    displayedDurationMs.value = Math.round(target * eased)
    if (progress < 1) countUpFrame = requestAnimationFrame(step)
  }
  countUpFrame = requestAnimationFrame(step)
})

onUnmounted(() => cancelAnimationFrame(countUpFrame))
</script>

<template>
  <main>
    <section class="hero">
      <p class="micro hero-label">Agent Generation Showcase · β</p>
      <h1 class="hero-title">Same question.<br />Different minds.</h1>
      <TypewriterText :phrases="LEDE_PHRASES" />
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-value">{{ stats.questionCount }}</div>
          <div class="micro stat-label">Questions</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{ stats.modelCount }}</div>
          <div class="micro stat-label">Models</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{ stats.sessionCount }}</div>
          <div class="micro stat-label">Sessions</div>
        </div>
        <div class="stat">
          <div class="stat-value">{{ formatDuration(displayedDurationMs) }}</div>
          <div class="micro stat-label">Total run time</div>
        </div>
      </div>
      <button class="hero-cta" @click="scrollToQuestions">Browse questions ↓</button>
    </section>

    <section id="questions" class="section">
      <header class="section-header">
        <span class="section-title">§ 01 · Questions</span>
        <input
          v-model="query"
          class="section-filter"
          type="search"
          name="question-filter"
          placeholder="Filter ⌕"
          aria-label="Filter questions and models"
        />
      </header>
      <a
        v-for="(question, index) in questions"
        :key="question.name"
        class="question-row"
        :href="routeHash({ name: 'question', question: question.name })"
      >
        <span class="question-index">{{ pad(index + 1) }} / {{ pad(questions.length) }}</span>
        <span class="question-name">{{ question.name }}</span>
        <span class="micro question-meta">
          {{ plural(question.models.length, 'model') }} ·
          {{ plural(question.sessionCount, 'session') }} · latest
          {{ formatDate(question.latestEndedAt) }}
        </span>
        <span class="question-arrow">→</span>
      </a>
      <p v-if="questions.length === 0" class="section-empty">No matching combos</p>
    </section>
  </main>
</template>
