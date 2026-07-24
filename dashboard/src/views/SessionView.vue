<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { comboLabel, formatDuration, formatParam, type ComboEntry } from '../lib/manifest'
import { parseTranscript, type TranscriptItem } from '../lib/transcript'
import { routeHash } from '../lib/router'
import TranscriptTimeline from '../components/TranscriptTimeline.vue'

const props = defineProps<{
  combo: ComboEntry | undefined
}>()

type TranscriptState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; items: TranscriptItem[] }
  | { status: 'missing' }

const transcript = ref<TranscriptState>({ status: 'loading' })

const closeHash = computed(() =>
  props.combo
    ? routeHash({ name: 'question', question: props.combo.question.name })
    : routeHash({ name: 'home' }),
)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') window.location.hash = closeHash.value
}

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  const transcriptPath = props.combo?.files.transcript
  if (!transcriptPath) {
    transcript.value = { status: 'missing' }
    return
  }
  try {
    // Paths in the Manifest are relative to the app base.
    const response = await fetch(transcriptPath)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const jsonl = await response.text()
    transcript.value = { status: 'loaded', items: parseTranscript(jsonl) }
  } catch (error) {
    transcript.value = {
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
    }
  }
})

onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div v-if="combo" class="session-view">
    <header class="session-topbar">
      <a class="session-close" :href="closeHash">✕ Close</a>
      <span class="session-title">{{ comboLabel(combo) }}</span>
      <span class="micro">
        {{ combo.startedAt.slice(0, 10) }} · {{ formatDuration(combo.durationMs) }}
      </span>
    </header>

    <div class="session-body">
      <div class="session-stage">
        <!-- allow-same-origin is required: without it the iframe gets an opaque
             origin and <script type="module"> artifacts fail their CORS check.
             The sandbox still blocks top navigation, popups, forms, etc. -->
        <iframe
          v-if="combo.files.artifact"
          class="session-frame"
          :src="combo.files.artifact"
          :title="comboLabel(combo)"
          sandbox="allow-scripts allow-same-origin"
        ></iframe>
        <div v-else class="artifact-placeholder">No artifact for this run</div>
      </div>

      <aside class="session-panel">
        <section class="panel-section">
          <h2 class="panel-heading">Run parameters</h2>
          <dl class="param-rows">
            <dt>Model</dt>
            <dd>{{ combo.model.name }}</dd>
            <dt>Provider</dt>
            <dd>{{ combo.model.provider }}</dd>
            <dt>Model ID</dt>
            <dd>{{ combo.model.modelId }}</dd>
            <dt>pi version</dt>
            <dd>{{ combo.piVersion }}</dd>
            <template v-for="(value, key) in combo.params" :key="key">
              <dt>{{ key }}</dt>
              <dd>{{ formatParam(value) }}</dd>
            </template>
            <dt>Started</dt>
            <dd>{{ new Date(combo.startedAt).toLocaleString() }}</dd>
            <dt>Duration</dt>
            <dd>{{ formatDuration(combo.durationMs) }}</dd>
            <dt>Status</dt>
            <dd>{{ combo.status }}</dd>
            <template v-if="combo.maxTurns !== undefined">
              <dt>Max turns</dt>
              <dd>{{ combo.maxTurns }}{{ combo.maxTurnsExceeded ? ' (exceeded)' : '' }}</dd>
            </template>
          </dl>
        </section>

        <section class="panel-section">
          <h2 class="panel-heading">Contract</h2>
          <p v-if="combo.contractViolations.length === 0" class="panel-note">violations: none</p>
          <p v-else class="panel-note panel-warning">
            {{ combo.contractViolations.join('; ') }}
          </p>
        </section>

        <section class="panel-section">
          <h2 class="panel-heading">session.jsonl</h2>
          <p v-if="transcript.status === 'loading'" class="transcript-note">Loading transcript…</p>
          <p v-else-if="transcript.status === 'missing'" class="transcript-note">
            No transcript for this run
          </p>
          <p v-else-if="transcript.status === 'error'" class="transcript-note">
            Failed to load transcript: {{ transcript.message }}
          </p>
          <TranscriptTimeline v-else :items="transcript.items" />
        </section>
      </aside>
    </div>

    <footer class="session-footer micro">
      sessions/{{ combo.comboId }}/ · status: {{ combo.status }}
    </footer>
  </div>

  <div v-else class="session-view">
    <header class="session-topbar">
      <a class="session-close" href="#/">✕ Close</a>
    </header>
    <div class="session-missing">Unknown session — no such combo in the manifest.</div>
  </div>
</template>
