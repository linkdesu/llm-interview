// Parser for pi session transcripts (session.jsonl).
// One JSON object per line; `message` lines become conversation items and
// every other parsed line (session header, model_change, compaction, ...)
// becomes a generic `event` item, so nothing in the file is dropped.

export interface TextPart {
  type: 'text'
  text: string
}

export interface ThinkingPart {
  type: 'thinking'
  thinking: string
}

export interface ToolCallPart {
  type: 'toolCall'
  id?: string
  name?: string
  arguments?: Record<string, unknown>
}

/** Inline image data is stripped from archived transcripts; keep a marker. */
export interface ImagePart {
  type: 'image'
}

export type AssistantPart = TextPart | ThinkingPart | ToolCallPart | ImagePart

export interface UserItem {
  kind: 'user'
  id?: string
  timestamp?: string
  text: string
}

export interface AssistantItem {
  kind: 'assistant'
  id?: string
  timestamp?: string
  parts: AssistantPart[]
}

export interface ToolResultItem {
  kind: 'toolResult'
  id?: string
  timestamp?: string
  toolName?: string
  toolCallId?: string
  text: string
  isError?: boolean
}

/** Non-message line (session header, model_change, compaction, ...) shown as a system event. */
export interface EventItem {
  kind: 'event'
  id?: string
  timestamp?: string
  eventType: string
  text: string
}

export type TranscriptItem = UserItem | AssistantItem | ToolResultItem | EventItem

interface RawContentPart {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  arguments?: Record<string, unknown>
}

interface RawMessage {
  role?: string
  content?: RawContentPart[]
  toolCallId?: string
  toolName?: string
  isError?: boolean
}

interface RawLine {
  type?: string
  id?: string
  timestamp?: string
  message?: RawMessage
  // Fields used to build human-readable payloads for known event types.
  summary?: string
  provider?: string
  modelId?: string
  thinkingLevel?: string
  version?: number
}

/** Join the text parts of a message content array, ignoring other part types. */
function collectText(content: RawContentPart[] | undefined): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('\n')
}

function parseAssistantParts(content: RawContentPart[] | undefined): AssistantPart[] {
  if (!Array.isArray(content)) return []
  const parts: AssistantPart[] = []
  for (const part of content) {
    switch (part.type) {
      case 'text':
        if (typeof part.text === 'string') parts.push({ type: 'text', text: part.text })
        break
      case 'thinking':
        if (typeof part.thinking === 'string')
          parts.push({ type: 'thinking', thinking: part.thinking })
        break
      case 'toolCall':
        parts.push({ type: 'toolCall', id: part.id, name: part.name, arguments: part.arguments })
        break
      case 'image':
        parts.push({ type: 'image' })
        break
      // Unknown part types are ignored.
    }
  }
  return parts
}

/** Human-readable payload for a non-message line; compact JSON fallback for unknown types. */
function describeEvent(raw: RawLine): string {
  switch (raw.type) {
    case 'compaction':
      if (typeof raw.summary === 'string') return raw.summary
      break
    case 'model_change':
      return [raw.provider, raw.modelId].filter((v) => typeof v === 'string').join(' / ')
    case 'thinking_level_change':
      if (typeof raw.thinkingLevel === 'string') return `thinking level: ${raw.thinkingLevel}`
      break
    case 'session':
      return typeof raw.version === 'number' ? `session (format v${raw.version})` : 'session'
  }
  const rest = { ...(raw as Record<string, unknown>) }
  delete rest.type
  delete rest.id
  delete rest.timestamp
  return JSON.stringify(rest)
}

/**
 * Parse a session.jsonl transcript into a message timeline.
 * Malformed lines are skipped; unknown message roles are skipped;
 * every other parsed line becomes an `event` item.
 */
export function parseTranscript(jsonl: string): TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let raw: RawLine
    try {
      raw = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (raw?.type !== 'message' || !raw.message) {
      if (typeof raw?.type === 'string') {
        items.push({
          kind: 'event',
          id: raw.id,
          timestamp: raw.timestamp,
          eventType: raw.type,
          text: describeEvent(raw),
        })
      }
      continue
    }
    const { id, timestamp, message } = raw
    switch (message.role) {
      case 'user':
        items.push({ kind: 'user', id, timestamp, text: collectText(message.content) })
        break
      case 'assistant':
        items.push({ kind: 'assistant', id, timestamp, parts: parseAssistantParts(message.content) })
        break
      case 'toolResult':
        items.push({
          kind: 'toolResult',
          id,
          timestamp,
          toolName: message.toolName,
          toolCallId: message.toolCallId,
          text: collectText(message.content),
          isError: message.isError === true,
        })
        break
      // Unknown roles are skipped.
    }
  }
  return items
}
