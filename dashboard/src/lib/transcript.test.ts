import { describe, expect, it } from 'vitest'
import { parseTranscript } from './transcript'

const FIXTURE = [
  // Session header and other non-message lines are skipped.
  '{"type":"session","version":3,"id":"session","timestamp":"2026-07-23T15:27:35.342Z"}',
  '{"type":"model_change","id":"e198bc24","provider":"llamacpp-local","modelId":"qwen3.6-27b"}',
  '{"type":"thinking_level_change","id":"bea33130","thinkingLevel":"off"}',
  // User message.
  '{"type":"message","id":"6d0d77fd","timestamp":"2026-07-23T15:27:35.372Z","message":{"role":"user","content":[{"type":"text","text":"# Snake\\nBuild a snake game."}]}}',
  // Assistant message with thinking + tool calls.
  '{"type":"message","id":"b97d535e","timestamp":"2026-07-23T15:27:39.145Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let me read the spec."},{"type":"toolCall","id":"QRcx","name":"read","arguments":{"path":"./spec.md"}}],"stopReason":"toolUse"}}',
  // Tool result.
  '{"type":"message","id":"3c8b0234","message":{"role":"toolResult","toolCallId":"QRcx","toolName":"read","content":[{"type":"text","text":"# Snake — Spec"}]}}',
  // Assistant message with text and an image placeholder.
  '{"type":"message","id":"6a34161f","message":{"role":"assistant","content":[{"type":"text","text":"Done."},{"type":"image","data":"[stripped]"}]}}',
  // Unknown line types, malformed JSON, and unknown roles are skipped.
  '{"type":"some_future_line","id":"x"}',
  'not json at all',
  '{"type":"message","id":"y","message":{"role":"system","content":[{"type":"text","text":"hidden"}]}}',
].join('\n')

describe('parseTranscript', () => {
  const items = parseTranscript(FIXTURE)

  it('keeps only message lines, preserving order', () => {
    expect(items.map((i) => i.kind)).toEqual(['user', 'assistant', 'toolResult', 'assistant'])
  })

  it('extracts user text', () => {
    const user = items[0]
    expect(user).toMatchObject({ kind: 'user', id: '6d0d77fd', text: '# Snake\nBuild a snake game.' })
  })

  it('extracts assistant thinking and tool call parts', () => {
    const assistant = items[1]
    if (assistant.kind !== 'assistant') throw new Error('expected assistant item')
    expect(assistant.parts).toEqual([
      { type: 'thinking', thinking: 'Let me read the spec.' },
      { type: 'toolCall', id: 'QRcx', name: 'read', arguments: { path: './spec.md' } },
    ])
  })

  it('extracts tool result with tool name and text', () => {
    const result = items[2]
    expect(result).toMatchObject({
      kind: 'toolResult',
      toolName: 'read',
      toolCallId: 'QRcx',
      text: '# Snake — Spec',
    })
  })

  it('keeps image parts as placeholders', () => {
    const assistant = items[3]
    if (assistant.kind !== 'assistant') throw new Error('expected assistant item')
    expect(assistant.parts).toEqual([{ type: 'text', text: 'Done.' }, { type: 'image' }])
  })

  it('returns an empty list for empty input', () => {
    expect(parseTranscript('')).toEqual([])
  })
})
