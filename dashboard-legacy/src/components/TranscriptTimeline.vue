<script setup lang="ts">
import type { TranscriptItem } from '../lib/transcript'

defineProps<{
  items: TranscriptItem[]
}>()

function formatTime(timestamp: string | undefined): string {
  if (!timestamp) return ''
  return new Date(timestamp).toLocaleTimeString()
}

/** Event payloads longer than this render in a collapsed details block. */
const LONG_EVENT_TEXT = 120
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

      <template v-else-if="item.kind === 'toolResult'">
        <details class="collapsible" :class="{ 'tool-result-error': item.isError }">
          <summary>tool result: {{ item.toolName ?? 'unknown' }}{{ item.isError ? ' (error)' : '' }}</summary>
          <pre class="message-text">{{ item.text }}</pre>
        </details>
      </template>

      <template v-else>
        <div class="timeline-label">{{ item.eventType }} · {{ formatTime(item.timestamp) }}</div>
        <details v-if="item.text.length > LONG_EVENT_TEXT" class="collapsible event-item">
          <summary>{{ item.eventType }}</summary>
          <pre class="message-text">{{ item.text }}</pre>
        </details>
        <div v-else class="event-item event-item-inline">
          <span class="event-type">{{ item.eventType }}</span>
          <span class="event-text">{{ item.text }}</span>
        </div>
      </template>
    </li>
  </ol>
</template>
