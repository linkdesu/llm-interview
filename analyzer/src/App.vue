<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

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

const grouping = ref<Grouping>('question-first')
const sessions = ref<SessionsResponse | null>(null)
const error = ref<string | null>(null)

onMounted(async () => {
  try {
    const response = await fetch('/sessions')
    if (!response.ok) {
      throw new Error(`GET /sessions failed with status ${response.status}`)
    }
    sessions.value = (await response.json()) as SessionsResponse
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
})

const runCount = computed(() => sessions.value?.flat.length ?? 0)
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
                  <li v-for="datetime in model.datetimes" :key="datetime" class="leaf micro">
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
                  <li v-for="datetime in question.datetimes" :key="datetime" class="leaf micro">
                    {{ datetime }}
                  </li>
                </ul>
              </section>
            </section>
          </template>
        </nav>
      </aside>
      <main class="page">
        <h1 class="page-title">Analyzer</h1>
        <p class="page-lede">
          Operator-facing inspector for the archived Session archive: full
          history and trajectory diagnosis. Select a run in the sidebar to
          inspect its trajectory — the detail view arrives in a later ticket.
        </p>
      </main>
    </div>
  </div>
</template>
