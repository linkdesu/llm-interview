<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { parseTrajectory, type Trajectory } from './lib/trajectory'
import TrajectoryView from './components/TrajectoryView.vue'

// View of the GET /sessions contract. The server-side source of truth lives
// in src/lib/sessions.ts; this client copy only mirrors the JSON shape.
interface SessionRun {
  question: string
  model: string
  datetime: string
  sessionJsonl: string | null
}

interface ModelNode {
  model: string
  datetimes: string[]
}

interface QuestionFirstGroup {
  question: string
  models: ModelNode[]
}

interface QuestionNode {
  question: string
  datetimes: string[]
}

interface ModelFirstGroup {
  model: string
  questions: QuestionNode[]
}

interface SessionsResponse {
  flat: SessionRun[]
  questionFirst: QuestionFirstGroup[]
  modelFirst: ModelFirstGroup[]
}

type Grouping = 'question-first' | 'model-first'

/** Detail-pane state for the run currently selected in the sidebar. */
type DetailStatus = 'idle' | 'loading' | 'ready' | 'no-transcript' | 'error'

const grouping = ref<Grouping>('question-first')
const sessions = ref<SessionsResponse | null>(null)
const error = ref<string | null>(null)

// Selection state: the chosen run plus the trajectory parsed from its
// transcript. A monotonically increasing sequence guards against stale
// fetches when the operator clicks a second leaf while the first loads.
const selected = ref<SessionRun | null>(null)
const trajectory = ref<Trajectory | null>(null)
const detailStatus = ref<DetailStatus>('idle')
const detailError = ref<string | null>(null)
let selectionSeq = 0

onMounted(async () => {
  try {
    const response = await fetch('/sessions')
    if (!response.ok) {
      throw new Error('GET /sessions failed with status ' + response.status)
    }
    sessions.value = (await response.json()) as SessionsResponse
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
})

const runCount = computed(() => sessions.value?.flat.length ?? 0)

/** Collision-free identity key for a run within the flat session list. */
function runKey(question: string, model: string, datetime: string): string {
  return JSON.stringify([question, model, datetime])
}

/** Index the flat run list by question/model/datetime identity. */
const runsByKey = computed(() => {
  const index = new Map<string, SessionRun>()
  for (const run of sessions.value?.flat ?? []) {
    index.set(runKey(run.question, run.model, run.datetime), run)
  }
  return index
})

function isSelected(question: string, model: string, datetime: string): boolean {
  const run = selected.value
  return (
    run !== null &&
    run.question === question &&
    run.model === model &&
    run.datetime === datetime
  )
}

/** Select a run from the sidebar: fetch its transcript and parse the trajectory. */
async function selectRun(question: string, model: string, datetime: string) {
  const run = runsByKey.value.get(runKey(question, model, datetime))
  if (run === undefined) return
  selected.value = run
  trajectory.value = null
  detailError.value = null

  // Runs without a session.jsonl (pre-JSONL archive format) have nothing to parse.
  if (run.sessionJsonl === null) {
    detailStatus.value = 'no-transcript'
    return
  }

  detailStatus.value = 'loading'
  const requestSeq = ++selectionSeq
  try {
    const encodedPath = [run.question, run.model, run.datetime]
      .map(encodeURIComponent)
      .join('/')
    const response = await fetch('/session/' + encodedPath + '/session.jsonl')
    if (requestSeq !== selectionSeq) return // superseded by a newer selection
    if (!response.ok) {
      throw new Error('GET transcript failed with status ' + response.status)
    }
    trajectory.value = parseTrajectory(await response.text())
    detailStatus.value = 'ready'
  } catch (cause) {
    if (requestSeq !== selectionSeq) return
    detailError.value = cause instanceof Error ? cause.message : String(cause)
    detailStatus.value = 'error'
  }
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <span class="brand"><span class="brand-accent">LLM</span>-INTERVIEW</span>
      <span class="micro">Analyzer</span>
    </header>
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-head">
          <span class="micro">Sessions</span>
          <span class="micro run-count">{{ runCount }} runs</span>
        </div>
        <div class="toggle" role="group" aria-label="Session grouping">
          <button
            type="button"
            :class="{ active: grouping === 'question-first' }"
            @click="grouping = 'question-first'"
          >
            Question first
          </button>
          <button
            type="button"
            :class="{ active: grouping === 'model-first' }"
            @click="grouping = 'model-first'"
          >
            Model first
          </button>
        </div>
        <p v-if="error" class="error micro">{{ error }}</p>
        <p v-else-if="!sessions" class="micro muted">Loading…</p>
        <nav v-else class="tree" aria-label="Archived sessions">
          <!-- Question first: question → model → datetime -->
          <template v-if="grouping === 'question-first'">
            <section
              v-for="group in sessions.questionFirst"
              :key="'q:' + group.question"
              class="branch"
            >
              <h2 class="level question">{{ group.question }}</h2>
              <section
                v-for="model in group.models"
                :key="'m:' + group.question + '/' + model.model"
                class="branch"
              >
                <h3 class="level model">{{ model.model }}</h3>
                <ul class="leaves">
                  <li
                    v-for="datetime in model.datetimes"
                    :key="datetime"
                    class="leaf micro"
                    :class="{ active: isSelected(group.question, model.model, datetime) }"
                    role="button"
                    tabindex="0"
                    @click="selectRun(group.question, model.model, datetime)"
                    @keydown.enter="selectRun(group.question, model.model, datetime)"
                  >
                    {{ datetime }}
                  </li>
                </ul>
              </section>
            </section>
          </template>
          <!-- Model first: model → question → datetime -->
          <template v-else>
            <section v-for="group in sessions.modelFirst" :key="'m:' + group.model" class="branch">
              <h2 class="level model">{{ group.model }}</h2>
              <section
                v-for="question in group.questions"
                :key="'q:' + group.model + '/' + question.question"
                class="branch"
              >
                <h3 class="level question">{{ question.question }}</h3>
                <ul class="leaves">
                  <li
                    v-for="datetime in question.datetimes"
                    :key="datetime"
                    class="leaf micro"
                    :class="{ active: isSelected(question.question, group.model, datetime) }"
                    role="button"
                    tabindex="0"
                    @click="selectRun(question.question, group.model, datetime)"
                    @keydown.enter="selectRun(question.question, group.model, datetime)"
                  >
                    {{ datetime }}
                  </li>
                </ul>
              </section>
            </section>
          </template>
        </nav>
      </aside>
      <main class="page">
        <template v-if="selected === null">
          <h1 class="page-title">Analyzer</h1>
          <p class="page-lede">
            Operator-facing inspector for the archived Session archive: full
            history and trajectory diagnosis. Select a run in the sidebar to
            inspect its trajectory.
          </p>
        </template>
        <template v-else>
          <header class="run-header">
            <p class="micro run-path">{{ selected.question }} · {{ selected.model }}</p>
            <h1 class="page-title run-title">{{ selected.datetime }}</h1>
          </header>
          <p v-if="detailStatus === 'loading'" class="micro muted">Loading transcript…</p>
          <p v-else-if="detailStatus === 'no-transcript'" class="page-lede">
            This archived run has no transcript (pre-JSONL archive format).
          </p>
          <p v-else-if="detailStatus === 'error'" class="error micro">{{ detailError }}</p>
          <TrajectoryView v-else-if="trajectory !== null" :trajectory="trajectory" />
        </template>
      </main>
    </div>
  </div>
</template>
