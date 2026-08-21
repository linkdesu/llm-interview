// Pure parser that maps the raw text of a pi-format session.jsonl archive to a
// flat, ordered ledger of records. Every non-blank source line becomes at least
// one record, and an assistant message carrying tool-call blocks additionally
// emits one nested child record per tool call (depth 1) so calls are visible in
// the list rather than hidden inside the assistant payload. Each record carries
// a normalized kind (the highlight tag), a one-line summary for the ledger row,
// ordered metadata for a detail header, and structured sections for a detail
// body. No runtime dependencies and no I/O, so this module is trivially
// unit-testable under vitest and safe to import from the browser bundle.
//
// Line kinds understood:
//   - {"type":"session",...}                  session header; starts a NEW invocation
//   - {"type":"model_change",...}             model/provider switch
//   - {"type":"thinking_level_change",...}    thinking level switch
//   - {"type":"compaction",...}               context compaction event
//   - {"type":"message","message":{role,...}} user / assistant / toolResult
//   - any other kind is kept as a generic record with an "unknown" tag
//
// Tolerance rules: malformed JSON lines, unknown line kinds, and missing
// fields are never an error. Old archives that lack usage, thinking, timestamps
// or response ids degrade to empty strings, nulls, and empty arrays.

/** Normalized display kind — the tag rendered on each ledger row. */
export type RecordKind =
  | 'session'
  | 'model'
  | 'thinking'
  | 'user'
  | 'assistant'
  | 'api-error'
  | 'tool-call'
  | 'tool-result'
  | 'compaction'
  | 'unknown'

/** Overview-timeline lane: 0 = input/system, 1 = assistant/compaction, 2 = tool. */
export type TimelineLane = 0 | 1 | 2

/** One label/value pair shown in a record's detail header. */
export interface RecordMeta {
  label: string
  value: string | null
}

/** One named block of a record's detail body: either free text or JSON. */
export interface RecordSection {
  label: string
  /** Plain text content; empty string when the section is JSON-only. */
  text: string
  /** Structured value; null when the section is text-only. */
  json: unknown
}

/** Numeric token usage of one model iteration, with null for absent fields. */
export interface TokenUsage {
  input: number | null
  output: number | null
  reasoning: number | null
  cacheRead: number | null
  cacheWrite: number | null
  totalTokens: number | null
}

/** One source line of the archive, folded into a ledger record. */
export interface TrajectoryRecord {
  /** 0-based index of the source line in the session.jsonl text. */
  line: number
  /** Raw top-level type string (session | model_change | ... | message). */
  type: string
  /** Normalized kind used for the highlight tag. */
  kind: RecordKind
  /** Invocation id this record belongs to (the most recent session header). */
  invocationId: string
  /** Message role for message lines; null for non-message lines. */
  role: string | null
  /** Epoch-millisecond timestamp; null when absent or invalid. */
  timestampMs: number | null
  /** One-line summary rendered in the ledger row. */
  summary: string
  /** Ordered label/value pairs for the detail header. */
  meta: RecordMeta[]
  /** Named body blocks for the detail panel. */
  sections: RecordSection[]
  /** Numeric token usage of the model iteration; null when the record has none. */
  usage: TokenUsage | null
  /** The full parsed line (or block) for a raw JSON view. */
  raw: unknown
  /** Nesting depth: 0 for top-level records, 1 for tool-call children. */
  depth: number
  /** Index of the parent record in the flat list, or null for top-level records. */
  parentIndex: number | null
}

export interface Trajectory {
  /** Records in source order; an assistant line may emit child tool-call rows. */
  records: TrajectoryRecord[]
}

/** Uppercase display label for each record kind, rendered in the highlight tag. */
export const KIND_LABELS: Record<RecordKind, string> = {
  session: 'SESSION',
  model: 'MODEL',
  thinking: 'THINKING',
  user: 'USER',
  assistant: 'ASSISTANT',
  'api-error': 'API ERROR',
  'tool-call': 'TOOL CALL',
  'tool-result': 'TOOL RESULT',
  compaction: 'COMPACTION',
  unknown: 'UNKNOWN',
}

/**
 * Overview-timeline lane for a record kind. Non-agent-loop metadata (session,
 * model, thinking) is grouped into the input lane alongside user messages.
 */
export function laneForKind(kind: RecordKind): TimelineLane {
  switch (kind) {
    case 'assistant':
    case 'api-error':
    case 'compaction':
      return 1
    case 'tool-call':
    case 'tool-result':
      return 2
    case 'session':
    case 'model':
    case 'thinking':
    case 'user':
    case 'unknown':
      return 0
  }
}

/**
 * Full searchable text of a record. Meta values (not labels) are included so
 * that searching for a model name, provider or stop reason works, while derived
 * token-count labels such as "cache write tokens" never pollute the index with
 * words like "write".
 */
export function searchableText(record: TrajectoryRecord): string {
  const parts: string[] = [record.summary, record.type, record.role ?? '']
  for (const entry of record.meta) parts.push(entry.value ?? '')
  for (const section of record.sections) {
    parts.push(section.label)
    if (section.text !== '') parts.push(section.text)
    if (section.json !== null) parts.push(JSON.stringify(section.json))
  }
  return parts.join('\n')
}

/** True when every whitespace-separated term of `query` appears in the record. */
export function recordMatches(record: TrajectoryRecord, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter((term) => term !== '')
  if (terms.length === 0) return true
  const haystack = searchableText(record).toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

/**
 * Per-record visibility for a filter query. A record is visible when it matches
 * itself, when a nested child of it matches (keep the parent), or when its
 * parent matches (keep children of a matching assistant).
 */
export function visibleIndexes(records: TrajectoryRecord[], query: string): boolean[] {
  const self = records.map((record) => recordMatches(record, query))
  const visible = self.slice()
  for (let index = 0; index < records.length; index++) {
    const parent = records[index].parentIndex
    if (parent === null || parent < 0) continue
    if (self[index]) visible[parent] = true
    if (self[parent]) visible[index] = true
  }
  return visible
}

/** Aggregate totals over a parsed ledger: turns plus summed token usage. */
export interface RunStats {
  turns: number
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  totalTokens: number
}

/** Sum token usage across every assistant turn in the ledger. */
export function computeRunStats(records: TrajectoryRecord[]): RunStats {
  const stats: RunStats = {
    turns: 0,
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
  }
  for (const record of records) {
    if (record.kind !== 'assistant') continue
    stats.turns++
    if (record.usage === null) continue
    stats.input += record.usage.input ?? 0
    stats.output += record.usage.output ?? 0
    stats.reasoning += record.usage.reasoning ?? 0
    stats.cacheRead += record.usage.cacheRead ?? 0
    stats.cacheWrite += record.usage.cacheWrite ?? 0
    stats.totalTokens += record.usage.totalTokens ?? 0
  }
  return stats
}

/** Map a message role to its record kind, defaulting to "unknown". */
function kindForRole(role: string | null): RecordKind {
  if (role === 'user') return 'user'
  if (role === 'assistant') return 'assistant'
  if (role === 'toolResult') return 'tool-result'
  return 'unknown'
}

/** Collapse whitespace and truncate free text to a single summary line. */
function preview(text: string, max: number = 160): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  return collapsed.slice(0, max - 1).trimEnd() + '…'
}

/** Concatenated "text" blocks of a message content array. */
function textOfContent(content: unknown): string {
  const parts: string[] = []
  for (const block of asArray(content)) {
    const record = asRecord(block)
    if (record !== null && record.type === 'text' && typeof record.text === 'string') {
      parts.push(record.text)
    }
  }
  return parts.join('')
}

/** Concatenated "thinking" blocks of a message content array. */
function thinkingOfContent(content: unknown): string {
  const parts: string[] = []
  for (const block of asArray(content)) {
    const record = asRecord(block)
    if (record !== null && record.type === 'thinking' && typeof record.thinking === 'string') {
      parts.push(record.thinking)
    }
  }
  return parts.join('')
}

/** Tool-call blocks of a message content array, in content order. */
interface RawToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

function toolCallsOfContent(content: unknown): RawToolCall[] {
  const calls: RawToolCall[] = []
  for (const block of asArray(content)) {
    const record = asRecord(block)
    if (record === null || record.type !== 'toolCall') continue
    calls.push({
      id: stringOf(record.id) ?? '',
      name: stringOf(record.name) ?? '',
      arguments: asRecord(record.arguments) ?? {},
    })
  }
  return calls
}

/** One-line summary for a tool-call child: name plus compact JSON arguments. */
function toolCallSummary(call: RawToolCall): string {
  const name = call.name === '' ? '(unnamed)' : call.name
  const args = Object.keys(call.arguments).length === 0 ? '' : ' ' + JSON.stringify(call.arguments)
  return preview(name + args, 160)
}

/** True when any content block is an "image" block. */
function contentHasImages(content: unknown): boolean {
  return asArray(content).some((block) => {
    const record = asRecord(block)
    return record !== null && record.type === 'image'
  })
}

/** Coerce a value to a record, or null for anything that is not a plain object. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Coerce a value to an array, or [] for anything that is not an array. */
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Coerce a value to a string, or null for anything that is not a string. */
function stringOf(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Coerce a value to a finite number, or null for anything else. */
function numberOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Coerce a value to a list of strings, or [] for anything that is not an array. */
function stringArrayOf(value: unknown): string[] {
  return asArray(value).flatMap((entry) => {
    const text = stringOf(entry)
    return text === null ? [] : [text]
  })
}

/** Coerce a value to a display string, or null when it is null/undefined. */
function displayOf(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

/** Parse an ISO-8601 timestamp to epoch milliseconds, or null when invalid. */
function isoToMs(value: string | null): number | null {
  if (value === null) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Timestamp of a message line: prefer the message's own epoch-ms timestamp,
 * falling back to the envelope's ISO timestamp.
 */
function messageTimestamp(envelope: Record<string, unknown>, message: Record<string, unknown>): number | null {
  return numberOf(message.timestamp) ?? isoToMs(stringOf(envelope.timestamp))
}

/** Numeric token usage from a raw usage object, or null when absent. */
function usageOf(usage: Record<string, unknown> | null): TokenUsage | null {
  if (usage === null) return null
  return {
    input: numberOf(usage.input),
    output: numberOf(usage.output),
    reasoning: numberOf(usage.reasoning),
    cacheRead: numberOf(usage.cacheRead),
    cacheWrite: numberOf(usage.cacheWrite),
    totalTokens: numberOf(usage.totalTokens),
  }
}

/** Usage entries for a detail header, omitting absent token fields. */
function usageMeta(usage: Record<string, unknown> | null): RecordMeta[] {
  if (usage === null) return []
  const entries: [string, string][] = [
    ['input', 'input'],
    ['output', 'output'],
    ['reasoning', 'reasoning'],
    ['cache read', 'cacheRead'],
    ['cache write', 'cacheWrite'],
    ['total', 'totalTokens'],
  ]
  const meta: RecordMeta[] = []
  for (const [label, key] of entries) {
    const value = numberOf(usage[key])
    if (value !== null) meta.push({ label: label + ' tokens', value: value.toLocaleString('en-US') })
  }
  return meta
}

/** Format an epoch-ms value as an ISO string, or null for null input. */
function formatMs(ms: number | null): string | null {
  if (ms === null) return null
  const date = new Date(ms)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

/**
 * Fold one non-blank, already-parsed line into one or more records. The first
 * returned record is always the top-level record for the line; assistant lines
 * may return additional depth-1 tool-call children after it.
 */
function foldRecord(
  line: number,
  envelope: Record<string, unknown>,
  invocationId: string,
): TrajectoryRecord[] {
  const type = stringOf(envelope.type) ?? ''
  const timestampMs = numberOf(envelope.timestamp) ?? isoToMs(stringOf(envelope.timestamp))
  const base = { line, type, invocationId, timestampMs, depth: 0, parentIndex: null, usage: null }

  if (type === 'session') {
    const id = stringOf(envelope.id)
    return [
      {
        ...base,
        kind: 'session',
        role: null,
        summary: id === null ? 'session' : id,
        meta: [
          { label: 'version', value: displayOf(envelope.version) },
          { label: 'id', value: id },
          { label: 'timestamp', value: stringOf(envelope.timestamp) },
          { label: 'cwd', value: stringOf(envelope.cwd) },
        ],
        sections: [],
        raw: envelope,
      },
    ]
  }

  if (type === 'model_change') {
    const provider = stringOf(envelope.provider)
    const modelId = stringOf(envelope.modelId)
    const summary =
      provider !== null && modelId !== null ? provider + ' · ' + modelId : (modelId ?? provider ?? 'model change')
    return [
      {
        ...base,
        kind: 'model',
        role: null,
        summary,
        meta: [
          { label: 'provider', value: provider },
          { label: 'modelId', value: modelId },
          { label: 'id', value: stringOf(envelope.id) },
          { label: 'parentId', value: stringOf(envelope.parentId) },
          { label: 'timestamp', value: stringOf(envelope.timestamp) },
        ],
        sections: [],
        raw: envelope,
      },
    ]
  }

  if (type === 'thinking_level_change') {
    const level = stringOf(envelope.thinkingLevel)
    return [
      {
        ...base,
        kind: 'thinking',
        role: null,
        summary: level === null ? 'thinking level change' : 'thinking ' + level,
        meta: [
          { label: 'thinkingLevel', value: level },
          { label: 'id', value: stringOf(envelope.id) },
          { label: 'parentId', value: stringOf(envelope.parentId) },
          { label: 'timestamp', value: stringOf(envelope.timestamp) },
        ],
        sections: [],
        raw: envelope,
      },
    ]
  }

  if (type === 'compaction') {
    // A context-compaction event: pi summarized older messages and appended a
    // CompactionEntry. `summary` is the generated markdown; `details` carries
    // the cumulatively tracked read/modified files; `tokensBefore` records the
    // pre-compaction context size being replaced.
    const summaryText = stringOf(envelope.summary) ?? ''
    const tokensBefore = numberOf(envelope.tokensBefore)
    const details = asRecord(envelope.details)
    const readFiles = stringArrayOf(details?.readFiles)
    const modifiedFiles = stringArrayOf(details?.modifiedFiles)
    const extraKeys = Object.keys(details ?? {}).filter(
      (key) => key !== 'readFiles' && key !== 'modifiedFiles',
    )

    const meta: RecordMeta[] = [
      { label: 'id', value: stringOf(envelope.id) },
      { label: 'parentId', value: stringOf(envelope.parentId) },
      { label: 'timestamp', value: stringOf(envelope.timestamp) },
      { label: 'firstKeptEntryId', value: stringOf(envelope.firstKeptEntryId) },
      { label: 'tokensBefore', value: tokensBefore === null ? null : tokensBefore.toLocaleString('en-US') },
      { label: 'fromHook', value: displayOf(envelope.fromHook) },
      ...usageMeta(asRecord(envelope.usage)),
    ]

    const sections: RecordSection[] = []
    if (summaryText !== '') sections.push({ label: 'Summary', text: summaryText, json: null })
    if (readFiles.length > 0) sections.push({ label: 'Read files', text: '', json: readFiles })
    if (modifiedFiles.length > 0) sections.push({ label: 'Modified files', text: '', json: modifiedFiles })
    if (extraKeys.length > 0) sections.push({ label: 'Details', text: '', json: details })

    return [
      {
        ...base,
        kind: 'compaction',
        role: null,
        summary: preview(summaryText) || 'compaction',
        meta,
        sections,
        usage: usageOf(asRecord(envelope.usage)),
        raw: envelope,
      },
    ]
  }

  if (type === 'message') {
    const message = asRecord(envelope.message) ?? {}
    const role = stringOf(message.role)
    const kind = kindForRole(role)
    const ts = messageTimestamp(envelope, message)

    if (kind === 'user') {
      const text = textOfContent(message.content)
      return [
        {
          ...base,
          kind,
          role,
          timestampMs: ts,
          summary: preview(text) || '(empty prompt)',
          meta: [{ label: 'role', value: role }, { label: 'timestamp', value: formatMs(ts) }],
          sections: text === '' ? [] : [{ label: 'Prompt', text, json: null }],
          raw: envelope,
        },
      ]
    }

    if (kind === 'assistant') {
      const text = textOfContent(message.content)
      const thinking = thinkingOfContent(message.content)
      const calls = toolCallsOfContent(message.content)
      const errorMessage = stringOf(message.errorMessage) ?? ''
      // A failed upstream call surfaces as an assistant message with a
      // stopReason of "error" and a non-empty errorMessage. Mark those as
      // api-error so the ledger shows the failure instead of "(no text)".
      const isApiError = errorMessage !== '' || stringOf(message.stopReason) === 'error'
      const recordKind: RecordKind = isApiError ? 'api-error' : 'assistant'

      const meta: RecordMeta[] = [
        { label: 'role', value: role },
        { label: 'timestamp', value: formatMs(ts) },
        { label: 'model', value: stringOf(message.model) },
        { label: 'provider', value: stringOf(message.provider) },
        { label: 'api', value: stringOf(message.api) },
        { label: 'stopReason', value: stringOf(message.stopReason) },
        { label: 'responseId', value: stringOf(message.responseId) },
        ...usageMeta(asRecord(message.usage)),
      ]

      const sections: RecordSection[] = []
      if (errorMessage !== '') sections.push({ label: 'Error', text: errorMessage, json: null })
      if (text !== '') sections.push({ label: 'Text', text, json: null })
      if (thinking !== '') sections.push({ label: 'Thinking', text: thinking, json: null })

      const records: TrajectoryRecord[] = [
        {
          ...base,
          kind: recordKind,
          role,
          timestampMs: ts,
          summary:
            errorMessage !== ''
              ? preview(errorMessage)
              : text !== ''
                ? preview(text)
                : isApiError
                  ? 'API error'
                  : '(no text)',
          meta,
          sections,
          usage: usageOf(asRecord(message.usage)),
          raw: envelope,
        },
      ]

      // Tool-call blocks become nested child rows so they surface in the list.
      for (const call of calls) {
        records.push({
          line,
          type: 'toolCall',
          kind: 'tool-call',
          invocationId,
          role: null,
          timestampMs: ts,
          summary: toolCallSummary(call),
          meta: [
            { label: 'callId', value: call.id === '' ? null : call.id },
            { label: 'tool', value: call.name === '' ? null : call.name },
          ],
          sections: [{ label: 'Arguments', text: '', json: call.arguments }],
          usage: null,
          raw: { type: 'toolCall', id: call.id, name: call.name, arguments: call.arguments },
          depth: 1,
          parentIndex: null,
        })
      }
      return records
    }

    if (kind === 'tool-result') {
      const text = textOfContent(message.content)
      const hasImages = contentHasImages(message.content)
      const isError = message.isError === true
      return [
        {
          ...base,
          kind,
          role,
          timestampMs: ts,
          summary: preview(text) || (hasImages ? '[image result]' : '[empty result]'),
          meta: [
            { label: 'role', value: role },
            { label: 'timestamp', value: formatMs(ts) },
            { label: 'toolName', value: stringOf(message.toolName) },
            { label: 'toolCallId', value: stringOf(message.toolCallId) },
            { label: 'isError', value: displayOf(isError) },
            { label: 'hasImages', value: displayOf(hasImages) },
          ],
          sections:
            text === '' ? [] : [{ label: isError ? 'Result (error)' : 'Result', text, json: null }],
          raw: envelope,
        },
      ]
    }

    // Unknown message role: keep a generic record with the role as its tag.
    return [
      {
        ...base,
        kind: 'unknown',
        role,
        timestampMs: ts,
        summary: role === null ? 'message' : role,
        meta: [{ label: 'role', value: role }],
        sections: [],
        raw: envelope,
      },
    ]
  }

  // Unknown line kind: keep it visible rather than dropping it.
  return [
    {
      ...base,
      kind: 'unknown',
      role: null,
      summary: type === '' ? '(unknown)' : type,
      meta: [],
      sections: [],
      raw: envelope,
    },
  ]
}

/** Parse a session.jsonl string into a flat ledger of records. Never throws. */
export function parseTrajectory(jsonl: string): Trajectory {
  const records: TrajectoryRecord[] = []
  let invocationId = ''

  const lines = jsonl.split('\n')
  for (let line = 0; line < lines.length; line++) {
    const rawLine = lines[line].trim()
    if (rawLine === '') continue

    let record: unknown
    try {
      record = JSON.parse(rawLine)
    } catch {
      continue // Tolerate malformed lines; they never abort the parse.
    }
    const envelope = asRecord(record)
    if (envelope === null) continue

    if (envelope.type === 'session') invocationId = stringOf(envelope.id) ?? ''

    const folded = foldRecord(line, envelope, invocationId)
    const parentIndex = records.length
    for (let index = 0; index < folded.length; index++) {
      const entry = folded[index]
      records.push(index === 0 ? entry : { ...entry, parentIndex })
    }
  }

  return { records }
}
