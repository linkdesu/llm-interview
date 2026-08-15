<script setup lang="ts">
import { computed } from 'vue'
import type { Turn, TurnUsage } from '../lib/trajectory'
import ThinkingBlock from './ThinkingBlock.vue'
import ToolCallEntry from './ToolCallEntry.vue'

const props = defineProps<{ turn: Turn }>()

/** One rendered token-usage pair: label, count, and whether it is the total. */
type UsageField = [label: string, value: number, isTotal: boolean]

/** Token usage as label/value pairs, omitting every null field. An all-null
 *  usage object (present but empty) yields no fields at all. */
const usageFields = computed<UsageField[]>(() => {
  const usage: TurnUsage | null = props.turn.usage
  if (usage === null) return []
  const fields: UsageField[] = []
  if (usage.input !== null) fields.push(['input', usage.input, false])
  if (usage.output !== null) fields.push(['output', usage.output, false])
  if (usage.reasoning !== null) fields.push(['reasoning', usage.reasoning, false])
  if (usage.cacheRead !== null) fields.push(['cache read', usage.cacheRead, false])
  if (usage.cacheWrite !== null) fields.push(['cache write', usage.cacheWrite, false])
  if (usage.totalTokens !== null) fields.push(['total', usage.totalTokens, true])
  return fields
})

/** The meta strip renders only when there is something to show. */
const hasMeta = computed(() => usageFields.value.length > 0 || props.turn.thinking !== '')
</script>

<template>
  <article class="turn">
    <div v-if="hasMeta" class="turn-meta">
      <dl v-if="usageFields.length > 0" class="usage-row" aria-label="Token usage">
        <div v-for="[label, value, isTotal] in usageFields" :key="label" class="usage-field">
          <dt class="usage-label">{{ label }}</dt>
          <dd class="usage-value" :class="{ total: isTotal }">{{ value.toLocaleString('en-US') }}</dd>
        </div>
      </dl>
      <ThinkingBlock v-if="turn.thinking !== ''" :text="turn.thinking" />
    </div>
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
