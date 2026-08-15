<script setup lang="ts">
import type { Invocation } from '../lib/trajectory'
import TurnBlock from './TurnBlock.vue'

defineProps<{ invocation: Invocation }>()
</script>

<template>
  <section class="invocation">
    <header class="invocation-header">
      <span class="micro invocation-id">{{ invocation.id }}</span>
      <p class="invocation-prompt">{{ invocation.prompt }}</p>
    </header>
    <TurnBlock
      v-for="(turn, index) in invocation.turns"
      :key="index"
      :turn="turn"
    />
    <p v-if="invocation.turns.length === 0" class="micro muted">
      No turns recorded for this invocation.
    </p>
  </section>
</template>
