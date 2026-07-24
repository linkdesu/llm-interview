<script setup lang="ts">
import type { SidebarQuestion } from '../lib/manifest'

const props = defineProps<{
  questions: SidebarQuestion[]
  selectedQuestion: string | null
  generatedAt: string | null
}>()

const query = defineModel<string>('query', { default: '' })

const emit = defineEmits<{
  select: [question: string | null]
}>()

function onQuestionClick(name: string) {
  // Clicking the selected question again clears the selection.
  emit('select', props.selectedQuestion === name ? null : name)
}
</script>

<template>
  <aside class="sidebar">
    <input
      v-model="query"
      class="sidebar-filter"
      type="search"
      placeholder="Filter questions / models…"
      aria-label="Filter combos"
    />
    <nav class="sidebar-tree">
      <button
        class="tree-question"
        :class="{ selected: selectedQuestion === null }"
        @click="emit('select', null)"
      >
        All questions
      </button>
      <div v-for="question in questions" :key="question.name" class="tree-group">
        <button
          class="tree-question"
          :class="{ selected: selectedQuestion === question.name }"
          @click="onQuestionClick(question.name)"
        >
          {{ question.name }}
        </button>
        <div v-for="model in question.models" :key="model.comboId" class="tree-model">
          {{ model.name }}
        </div>
      </div>
      <p v-if="questions.length === 0" class="sidebar-empty">No matching combos</p>
    </nav>
    <footer v-if="generatedAt" class="sidebar-footer">
      Generated {{ new Date(generatedAt).toLocaleString() }}
    </footer>
  </aside>
</template>
