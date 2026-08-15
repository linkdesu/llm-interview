<script setup lang="ts">
import { computed } from 'vue'
import type { ToolCall } from '../lib/trajectory'

const props = defineProps<{ toolCall: ToolCall }>()

/** Pretty-printed arguments, or null when the call carried none. */
const argumentsText = computed(() => {
  const args = props.toolCall.arguments
  if (Object.keys(args).length === 0) return null
  return JSON.stringify(args, null, 2)
})
</script>

<template>
  <div class="tool-entry" :class="{ error: toolCall.result?.isError === true }">
    <header class="tool-header">
      <span class="micro tool-name">{{ toolCall.name || '(unnamed tool)' }}</span>
      <span v-if="toolCall.result === null" class="tool-status in-flight">
        In flight / unanswered
      </span>
      <span v-else-if="toolCall.result.isError" class="tool-status error">Error</span>
    </header>
    <pre v-if="argumentsText !== null" class="tool-args">{{ argumentsText }}</pre>
    <div class="tool-result">
      <template v-if="toolCall.result !== null">
        <pre v-if="toolCall.result.text" class="tool-result-text">{{ toolCall.result.text }}</pre>
        <p v-else class="micro muted">Empty tool result.</p>
      </template>
      <p v-else class="micro muted">
        No result recorded — the call may still be running or was interrupted.
      </p>
    </div>
  </div>
</template>
