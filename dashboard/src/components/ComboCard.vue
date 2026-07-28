<script setup lang="ts">
import { computed, ref } from 'vue'
import { comboLabel, formatDuration, type ComboEntry } from '../lib/manifest'
import { parseTranscript, type TranscriptItem } from '../lib/transcript'
import { routeHash } from '../lib/router'
import TranscriptTimeline from './TranscriptTimeline.vue'

const props = defineProps<{
  combo: ComboEntry
}>()

type TranscriptState =
  | { status: 'collapsed' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; items: TranscriptItem[] }

const transcript = ref<TranscriptState>({ status: 'collapsed' })

const expandHash = computed(() => routeHash({ name: 'session', comboId: props.combo.comboId }))

async function toggleTranscript() {
  if (transcript.value.status !== 'collapsed') {
    transcript.value = { status: 'collapsed' }
    return
  }
  transcript.value = { status: 'loading' }
  try {
    // Paths in the Manifest are relative to the app base.
    const response = await fetch(props.combo.files.transcript as string)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const jsonl = await response.text()
    transcript.value = { status: 'loaded', items: parseTranscript(jsonl) }
  } catch (error) {
    transcript.value = {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
</script>

<template>
  <article class="combo-card">
    <header class="combo-header">
      <div class="combo-top">
        <span class="status-dot" :data-status="combo.status"></span>
        <strong class="combo-model">{{ combo.model.name }}</strong>
        <span class="combo-provider">{{ combo.model.provider }}</span>
        <span class="micro combo-duration">{{ formatDuration(combo.durationMs) }}</span>
      </div>
      <p v-if="combo.maxTurnsExceeded" class="combo-warning">
        max turns ({{ combo.maxTurns }}) exceeded
      </p>
      <p v-if="combo.contractViolations.length > 0" class="combo-warning">
        Contract violations: {{ combo.contractViolations.join('; ') }}
      </p>
    </header>

    <!-- allow-same-origin is required: without it the iframe gets an opaque
         origin and <script type="module"> artifacts fail their CORS check.
         The sandbox still blocks top navigation, popups, forms, etc. -->
    <template v-if="combo.files.artifact">
      <iframe
        class="artifact-frame"
        :src="combo.files.artifact"
        :title="comboLabel(combo)"
        sandbox="allow-scripts allow-same-origin"
      ></iframe>
      <p class="micro artifact-hint">Live preview · interactive on desktop</p>
    </template>
    <div v-else class="artifact-placeholder">No artifact for this run</div>

    <div class="combo-actions">
      <a class="card-link" :href="expandHash">⛶ Expand</a>
      <button v-if="combo.files.transcript" class="card-link" @click="toggleTranscript">
        {{ transcript.status === 'collapsed' ? 'Transcript ▸' : 'Transcript ▾' }}
      </button>
    </div>
    <p v-if="transcript.status === 'loading'" class="transcript-note">Loading transcript…</p>
    <p v-else-if="transcript.status === 'error'" class="transcript-note">
      Failed to load transcript: {{ transcript.message }}
    </p>
    <TranscriptTimeline v-else-if="transcript.status === 'loaded'" :items="transcript.items" />
  </article>
</template>
