<script setup lang="ts">
import type { Turn } from '../lib/trajectory'
import ToolCallEntry from './ToolCallEntry.vue'

defineProps<{ turn: Turn }>()
</script>

<template>
  <article class="turn">
    <!-- Reserved for ticket #27: token usage (turn.usage) and thinking text
         (turn.thinking) render in this meta strip, above the assistant text. -->
    <div class="turn-meta" />
    <section class="turn-assistant">
      <p v-if="turn.assistantText" class="assistant-text">{{ turn.assistantText }}</p>
      <p v-else class="micro muted">No assistant text recorded for this turn.</p>
    </section>
    <section v-if="turn.toolCalls.length > 0" class="turn-tools" aria-label="Tool call ledger">
      <ToolCallEntry
        v-for="toolCall in turn.toolCalls"
        :key="toolCall.callId"
        :toolCall="toolCall"
      />
    </section>
  </article>
</template>
