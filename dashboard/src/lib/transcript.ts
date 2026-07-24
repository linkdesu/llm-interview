// Parser for pi session transcripts (session.jsonl).
// One JSON object per line; only `message` lines become timeline items,
// other line types (session header, model_change, ...) are skipped.

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
}

export type TranscriptItem = UserItem | AssistantItem | ToolResultItem

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
}

interface RawLine {
  type?: string
  id?: string
  timestamp?: string
  message?: RawMessage
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

/**
 * Parse a session.jsonl transcript into a message timeline.
 * Tolerant of malformed lines and unknown line/message/part types: they are skipped.
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
    if (raw?.type !== 'message' || !raw.message) continue
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
        })
        break
      // Unknown roles are skipped.
    }
  }
  return items
}
