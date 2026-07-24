<script setup lang="ts">
import type { TranscriptItem } from '../lib/transcript'

defineProps<{
  items: TranscriptItem[]
}>()

function formatTime(timestamp: string | undefined): string {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleTimeString()
}
</script>

<template>
  <ol class="timeline">
    <li v-for="(item, index) in items" :key="item.id ?? index" class="timeline-item">
      <template v-if="item.kind === 'user'">
        <div class="timeline-label">user · {{ formatTime(item.timestamp) }}</div>
        <pre class="message-text">{{ item.text }}</pre>
      </template>

      <template v-else-if="item.kind === 'assistant'">
        <div class="timeline-label">assistant · {{ formatTime(item.timestamp) }}</div>
        <template v-for="(part, partIndex) in item.parts" :key="partIndex">
          <pre v-if="part.type === 'text'" class="message-text">{{ part.text }}</pre>
          <details v-else-if="part.type === 'thinking'" class="collapsible">
            <summary>thinking</summary>
            <pre class="message-text">{{ part.thinking }}</pre>
          </details>
          <details v-else-if="part.type === 'toolCall'" class="collapsible">
            <summary>tool call: {{ part.name ?? 'unknown' }}</summary>
            <pre class="message-text">{{ JSON.stringify(part.arguments ?? {}, null, 2) }}</pre>
          </details>
          <span v-else class="image-placeholder">[image]</span>
        </template>
      </template>

      <template v-else>
        <details class="collapsible">
          <summary>tool result: {{ item.toolName ?? 'unknown' }}</summary>
          <pre class="message-text">{{ item.text }}</pre>
        </details>
      </template>
    </li>
  </ol>
</template>
