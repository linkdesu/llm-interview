// Pure parser that maps the raw text of a pi-format session.jsonl archive to a
// trajectory model: the invocations it contains, each invocation's root prompt,
// and the assistant turns (one model iteration each) together with the tool
// calls and results those turns triggered. No runtime dependencies and no I/O,
// so this module is trivially unit-testable under vitest and safe to import
// from the browser bundle.
//
// Line kinds understood:
//   - {"type":"session",...}              header line; starts a NEW invocation
//   - {"type":"message","message":{...}}  user / assistant / toolResult messages
//   - any other kind (model_change, thinking_level_change, ...) is ignored
//
// Turn semantics (derived, never stored): a turn is one assistant message plus
// every toolResult message whose toolCallId matches one of its toolCall ids.
// Tool results may arrive after later assistant messages (delayed tool runs);
// they are paired by id, not by position. A tool call without a matching
// result is an in-flight call and its result is null.
//
// Tolerance rules: malformed JSON lines, unknown line kinds, and missing
// fields are never an error. Old archives that lack usage, thinking, timestamps
// or response ids degrade to empty strings, nulls, and empty arrays.

export interface ToolCallResult {
  /** Concatenated "text" blocks of the toolResult message content. */
  text: string
  /** True when the tool result was flagged as an error. */
  isError: boolean
  /** True when the result content carried any "image" block (stripped to "[stripped]"). */
  hasImages: boolean
  /** Epoch-millisecond timestamp of the toolResult message; null when absent. */
  timestampMs: number | null
}

export interface ToolCall {
  /** The toolCall block id, matched against toolResult.toolCallId. */
  callId: string
  /** Tool name (e.g. "read", "bash"); empty string when absent. */
  name: string
  /** Raw arguments object of the call; {} when absent. */
  arguments: Record<string, unknown>
  /** The paired result, or null when the call is still in flight (no result). */
  result: ToolCallResult | null
}

export interface TurnUsage {
  input: number | null
  output: number | null
  reasoning: number | null
  cacheRead: number | null
  cacheWrite: number | null
  totalTokens: number | null
}

export interface Turn {
  /** Concatenated "text" blocks of the assistant message; "" when none. */
  assistantText: string
  /** Concatenated "thinking" blocks; "" when thinking is off or absent. */
  thinking: string
  /** Token usage of the model iteration; null when the archive carries none. */
  usage: TurnUsage | null
  /** Assistant stop reason (e.g. "toolUse", "stop"); null when absent. */
  stopReason: string | null
  /** Model id used for this iteration; null when absent. */
  model: string | null
  /** Epoch-millisecond timestamp of the assistant message; null when absent. */
  timestampMs: number | null
  /** Tool calls issued by this turn, in content order, each with its result. */
  toolCalls: ToolCall[]
}

export interface Invocation {
  /** Id from the session header line (e.g. "t1", "t1-eval"). */
  id: string
  /** The invocation's root prompt: the text of its first user message. */
  prompt: string
  /** Epoch-millisecond start time, normalized from the header's ISO timestamp. */
  startTimestampMs: number | null
  /** Assistant turns of this invocation, in log order. */
  turns: Turn[]
}

export interface Trajectory {
  /** Invocations in log order, one per "session" header line. */
  invocations: Invocation[]
}

/** One assistant message as seen during parsing, before turn assembly. */
interface AssistantMessage {
  content: unknown
  usage: Record<string, unknown> | null
  stopReason: string | null
  model: string | null
  timestampMs: number | null
}

/** Mutable accumulation state for the invocation currently being parsed. */
interface InvocationBuilder {
  id: string
  startTimestampMs: number | null
  prompt: string
  assistantMessages: AssistantMessage[]
  toolResults: Map<string, ToolCallResult>
}

/** Parse a session.jsonl string into a trajectory model. Never throws. */
export function parseTrajectory(jsonl: string): Trajectory {
  const invocations: Invocation[] = []
  let current: InvocationBuilder | null = null

  for (const rawLine of jsonl.split('\n')) {
    const line = rawLine.trim()
    if (line === '') continue

    let record: unknown
    try {
      record = JSON.parse(line)
    } catch {
      continue // Tolerate malformed lines; they never abort the parse.
    }
    const envelope = asRecord(record)
    if (envelope === null) continue

    if (envelope.type === 'session') {
      // A header line closes the previous invocation and starts a new one.
      if (current !== null) invocations.push(finalizeInvocation(current))
      current = {
        id: stringOf(envelope.id) ?? '',
        startTimestampMs: isoToMs(stringOf(envelope.timestamp)),
        prompt: '',
        assistantMessages: [],
        toolResults: new Map(),
      }
      continue
    }

    if (envelope.type !== 'message') continue // model_change, thinking_level_change, ...
    const message = asRecord(envelope.message)
    if (message === null) continue
    const role = stringOf(message.role)

    if (role === 'user') {
      // The user message is the invocation's root prompt, not a turn.
      if (current === null) continue
      if (current.prompt === '') current.prompt = textOfContent(message.content)
    } else if (role === 'assistant') {
      if (current === null) continue
      current.assistantMessages.push({
        content: message.content,
        usage: asRecord(message.usage),
        stopReason: stringOf(message.stopReason),
        model: stringOf(message.model),
        timestampMs: numberOf(message.timestamp),
      })
    } else if (role === 'toolResult') {
      if (current === null) continue
      const callId = stringOf(message.toolCallId)
      if (callId === null) continue
      current.toolResults.set(callId, {
        text: textOfContent(message.content),
        isError: message.isError === true,
        hasImages: contentHasImages(message.content),
        timestampMs: numberOf(message.timestamp),
      })
    }
    // Any other role (steering, context, ...) is ignored.
  }

  if (current !== null) invocations.push(finalizeInvocation(current))
  return { invocations }
}

/** Fold an invocation builder into its final, derived model. */
function finalizeInvocation(builder: InvocationBuilder): Invocation {
  const turns: Turn[] = []
  for (const assistant of builder.assistantMessages) {
    const toolCalls: ToolCall[] = []
    for (const block of asArray(assistant.content)) {
      const call = asRecord(block)
      if (call === null || call.type !== 'toolCall') continue
      const callId = stringOf(call.id)
      toolCalls.push({
        callId: callId ?? '',
        name: stringOf(call.name) ?? '',
        arguments: asRecord(call.arguments) ?? {},
        result: callId === null ? null : (builder.toolResults.get(callId) ?? null),
      })
    }
    turns.push({
      assistantText: textOfContent(assistant.content),
      thinking: thinkingOfContent(assistant.content),
      usage: usageOf(assistant.usage),
      stopReason: assistant.stopReason,
      model: assistant.model,
      timestampMs: assistant.timestampMs,
      toolCalls,
    })
  }
  return {
    id: builder.id,
    prompt: builder.prompt,
    startTimestampMs: builder.startTimestampMs,
    turns,
  }
}

/** Normalized usage; null when the assistant message carried no usage field. */
function usageOf(usage: Record<string, unknown> | null): TurnUsage | null {
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

/** Parse an ISO-8601 timestamp to epoch milliseconds, or null when invalid. */
function isoToMs(value: string | null): number | null {
  if (value === null) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}
