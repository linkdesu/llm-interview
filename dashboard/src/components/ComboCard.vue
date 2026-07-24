<script setup lang="ts">
import { ref } from 'vue'
import { comboLabel, formatDuration, type ComboEntry } from '../lib/manifest'
import { parseTranscript, type TranscriptItem } from '../lib/transcript'
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

function formatParam(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

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
      <div class="combo-title">
        <strong>{{ combo.model.name }}</strong>
        <span class="combo-provider">{{ combo.model.provider }}</span>
      </div>
      <div class="combo-params">
        <span v-for="(value, key) in combo.params" :key="key" class="param-chip">
          {{ key }}={{ formatParam(value) }}
        </span>
      </div>
      <div class="combo-meta">
        <span class="combo-status" :data-status="combo.status">{{ combo.status }}</span>
        <span>{{ formatDuration(combo.durationMs) }}</span>
        <span v-if="combo.maxTurnsExceeded" class="combo-warning">
          max turns ({{ combo.maxTurns }}) exceeded
        </span>
      </div>
      <p v-if="combo.contractViolations.length > 0" class="combo-warning">
        Contract violations: {{ combo.contractViolations.join('; ') }}
      </p>
    </header>

    <!-- allow-same-origin is required: without it the iframe gets an opaque
         origin and <script type="module"> artifacts fail their CORS check.
         The sandbox still blocks top navigation, popups, forms, etc. -->
    <iframe
      v-if="combo.files.artifact"
      class="artifact-frame"
      :src="combo.files.artifact"
      :title="comboLabel(combo)"
      sandbox="allow-scripts allow-same-origin"
    ></iframe>
    <div v-else class="artifact-placeholder">No artifact for this run</div>

    <section v-if="combo.files.transcript" class="transcript-section">
      <button class="transcript-toggle" @click="toggleTranscript">
        {{ transcript.status === 'collapsed' ? 'Transcript ▸' : 'Transcript ▾' }}
      </button>
      <p v-if="transcript.status === 'loading'" class="transcript-note">Loading transcript…</p>
      <p v-else-if="transcript.status === 'error'" class="transcript-note">
        Failed to load transcript: {{ transcript.message }}
      </p>
      <TranscriptTimeline v-else-if="transcript.status === 'loaded'" :items="transcript.items" />
    </section>
  </article>
</template>
