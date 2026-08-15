<script setup lang="ts">
// Collapsible thinking text of one turn (ticket #27). Rendered only when the
// turn carries thinking; the native <details> disclosure keeps it collapsed
// by default with no extra state. A tiny component because the toggle markup
// is self-contained and reused once per turn that has thinking.
defineProps<{ text: string }>()
</script>

<template>
  <details class="thinking-block">
    <summary class="micro thinking-toggle">Thinking</summary>
    <pre class="thinking-text">{{ text }}</pre>
  </details>
</template>
