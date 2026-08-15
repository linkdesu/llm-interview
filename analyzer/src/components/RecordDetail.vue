<script setup lang="ts">
import { computed, ref } from 'vue'
import { KIND_LABELS, type TrajectoryRecord } from '../lib/trajectory'

const props = defineProps<{ record: TrajectoryRecord }>()
defineEmits<{ close: [] }>()

type Tab = 'summary' | 'raw'

const activeTab = ref<Tab>('summary')

/** Location line under the header tag, e.g. "t2 · line 104". */
const location = computed(() => {
  const scope = props.record.invocationId === '' ? '—' : props.record.invocationId
  return scope + ' · line ' + (props.record.line + 1)
})

/** Pretty-printed raw line for the Raw tab. */
const rawJson = computed(() => JSON.stringify(props.record.raw, null, 2))

/** Pretty-printed JSON for one structured section. */
function jsonOf(value: unknown): string {
  return JSON.stringify(value, null, 2)
}
</script>

<template>
  <aside class="inspector" aria-label="Record details">
    <header class="inspector-head">
      <span class="kind-tag" :data-kind="record.kind">{{ KIND_LABELS[record.kind] }}</span>
      <span class="inspector-location">{{ location }}</span>
      <button type="button" class="inspector-close" aria-label="Close details" @click="$emit('close')">
        ×
      </button>
    </header>

    <div class="inspector-tabs" role="tablist" aria-label="Detail views">
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'summary'"
        class="inspector-tab"
        :class="{ active: activeTab === 'summary' }"
        @click="activeTab = 'summary'"
      >
        Summary
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="activeTab === 'raw'"
        class="inspector-tab"
        :class="{ active: activeTab === 'raw' }"
        @click="activeTab = 'raw'"
      >
        Raw
      </button>
    </div>

    <div class="inspector-body">
      <dl v-if="activeTab === 'summary'" class="inspector-meta">
        <template v-for="entry in record.meta" :key="entry.label">
          <dt class="inspector-meta-label">{{ entry.label }}</dt>
          <dd class="inspector-meta-value">{{ entry.value ?? '—' }}</dd>
        </template>
      </dl>

      <section v-if="activeTab === 'summary'" class="inspector-sections">
        <section
          v-for="(section, index) in record.sections"
          :key="index"
          class="inspector-section"
        >
          <h3 class="inspector-section-head">{{ section.label }}</h3>
          <pre v-if="section.text !== ''" class="inspector-text">{{ section.text }}</pre>
          <pre v-else class="inspector-json">{{ jsonOf(section.json) }}</pre>
        </section>
        <p
          v-if="record.meta.length === 0 && record.sections.length === 0"
          class="inspector-empty"
        >
          No structured detail for this record — see the Raw tab.
        </p>
      </section>

      <pre v-else class="inspector-raw">{{ rawJson }}</pre>
    </div>
  </aside>
</template>
