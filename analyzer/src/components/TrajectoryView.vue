<script setup lang="ts">
import type { Trajectory } from '../lib/trajectory'
import InvocationBlock from './InvocationBlock.vue'

defineProps<{ trajectory: Trajectory }>()
</script>

<template>
  <div class="trajectory">
    <p v-if="trajectory.invocations.length === 0" class="micro muted">
      This transcript contains no invocations.
    </p>
    <InvocationBlock
      v-for="(invocation, index) in trajectory.invocations"
      :key="`${invocation.id}-${index}`"
      :invocation="invocation"
    />
  </div>
</template>
