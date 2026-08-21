<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

// Cycles through phrases with a typewriter effect: types a phrase character
// by character, holds it, deletes it, then types the next one. With reduced
// motion the first phrase is shown statically.

const props = defineProps<{
  phrases: string[]
}>()

const TYPE_MS = 32
const DELETE_MS = 14
const HOLD_MS = 3200
const GAP_MS = 400

const text = ref('')
const staticMode = ref(false)
// Idle means the typist is pausing (holding a finished phrase or between
// phrases): the cursor stays solid while typing/erasing and blinks only
// when idle, like a terminal cursor.
const idle = ref(false)
let timer = 0

onMounted(() => {
  if (
    props.phrases.length === 0 ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    text.value = props.phrases[0] ?? ''
    staticMode.value = true
    return
  }
  let phrase = 0
  let char = 0
  const type = () => {
    const current = props.phrases[phrase]
    if (char > current.length) {
      idle.value = true
      timer = window.setTimeout(erase, HOLD_MS)
      return
    }
    idle.value = false
    text.value = current.slice(0, char)
    char++
    timer = window.setTimeout(type, TYPE_MS)
  }
  const erase = () => {
    if (text.value.length === 0) {
      phrase = (phrase + 1) % props.phrases.length
      char = 0
      idle.value = true
      timer = window.setTimeout(type, GAP_MS)
      return
    }
    idle.value = false
    text.value = text.value.slice(0, -1)
    timer = window.setTimeout(erase, DELETE_MS)
  }
  type()
})

onUnmounted(() => clearTimeout(timer))
</script>

<template>
  <p class="hero-lede">
    {{ text
    }}<span class="typewriter-cursor" :class="{ static: staticMode, idle }" aria-hidden="true"
      >▍</span
    >
  </p>
</template>
