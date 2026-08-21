import { describe, expect, it } from 'vitest'
import { parseTranscript } from './transcript'

const FIXTURE = [
  // Non-message lines become event items.
  '{"type":"session","version":3,"id":"session","timestamp":"2026-07-23T15:27:35.342Z"}',
  '{"type":"model_change","id":"e198bc24","provider":"llamacpp-local","modelId":"qwen3.6-27b"}',
  '{"type":"thinking_level_change","id":"bea33130","thinkingLevel":"off"}',
  // User message.
  '{"type":"message","id":"6d0d77fd","timestamp":"2026-07-23T15:27:35.372Z","message":{"role":"user","content":[{"type":"text","text":"# Snake\\nBuild a snake game."}]}}',
  // Assistant message with thinking + tool calls.
  '{"type":"message","id":"b97d535e","timestamp":"2026-07-23T15:27:39.145Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"Let me read the spec."},{"type":"toolCall","id":"QRcx","name":"read","arguments":{"path":"./spec.md"}}],"stopReason":"toolUse"}}',
  // Tool result.
  '{"type":"message","id":"3c8b0234","message":{"role":"toolResult","toolCallId":"QRcx","toolName":"read","content":[{"type":"text","text":"# Snake — Spec"}]}}',
  // Failed tool result (isError: true).
  '{"type":"message","id":"9f2c41aa","message":{"role":"toolResult","toolCallId":"BaZD","toolName":"write","content":[{"type":"text","text":"Tool call \\"write\\" was not executed"}],"isError":true}}',
  // Assistant message with text and an image placeholder.
  '{"type":"message","id":"6a34161f","message":{"role":"assistant","content":[{"type":"text","text":"Done."},{"type":"image","data":"[stripped]"}]}}',
  // Unknown line types become events; malformed JSON and unknown roles are skipped.
  '{"type":"some_future_line","id":"x"}',
  'not json at all',
  '{"type":"message","id":"y","message":{"role":"system","content":[{"type":"text","text":"hidden"}]}}',
].join('\n')

describe('parseTranscript', () => {
  const items = parseTranscript(FIXTURE)

  it('keeps every parsed line, preserving order', () => {
    expect(items.map((i) => i.kind)).toEqual([
      'event',
      'event',
      'event',
      'user',
      'assistant',
      'toolResult',
      'toolResult',
      'assistant',
      'event',
    ])
  })

  it('extracts user text', () => {
    const user = items[3]
    expect(user).toMatchObject({ kind: 'user', id: '6d0d77fd', text: '# Snake\nBuild a snake game.' })
  })

  it('extracts assistant thinking and tool call parts', () => {
    const assistant = items[4]
    if (assistant.kind !== 'assistant') throw new Error('expected assistant item')
    expect(assistant.parts).toEqual([
      { type: 'thinking', thinking: 'Let me read the spec.' },
      { type: 'toolCall', id: 'QRcx', name: 'read', arguments: { path: './spec.md' } },
    ])
  })

  it('extracts tool result with tool name and text', () => {
    const result = items[5]
    expect(result).toMatchObject({
      kind: 'toolResult',
      toolName: 'read',
      toolCallId: 'QRcx',
      text: '# Snake — Spec',
      isError: false,
    })
  })

  it('parses isError:true on failed tool results', () => {
    const result = items[6]
    expect(result).toMatchObject({
      kind: 'toolResult',
      toolName: 'write',
      toolCallId: 'BaZD',
      text: 'Tool call "write" was not executed',
      isError: true,
    })
  })

  it('keeps image parts as placeholders', () => {
    const assistant = items[7]
    if (assistant.kind !== 'assistant') throw new Error('expected assistant item')
    expect(assistant.parts).toEqual([{ type: 'text', text: 'Done.' }, { type: 'image' }])
  })

  it('returns an empty list for empty input', () => {
    expect(parseTranscript('')).toEqual([])
  })

  it('renders a compaction line as an event carrying the summary', () => {
    const [item] = parseTranscript(
      '{"type":"compaction","id":"052eaa4a","timestamp":"2026-07-24T17:20:02.594Z","summary":"## Goal\\nCreate a diorama."}',
    )
    expect(item).toEqual({
      kind: 'event',
      id: '052eaa4a',
      timestamp: '2026-07-24T17:20:02.594Z',
      eventType: 'compaction',
      text: '## Goal\nCreate a diorama.',
    })
  })

  it('renders a model_change line as an event with provider and modelId', () => {
    const [item] = parseTranscript(
      '{"type":"model_change","id":"6246ea85","timestamp":"2026-07-24T17:16:05.187Z","provider":"llamacpp-local","modelId":"qwen3.6-35b-a3b-q5"}',
    )
    expect(item).toMatchObject({
      kind: 'event',
      eventType: 'model_change',
      text: 'llamacpp-local / qwen3.6-35b-a3b-q5',
    })
  })

  it('renders an unknown future line type as an event with a compact JSON payload', () => {
    const [item] = parseTranscript('{"type":"some_future_line","id":"x","foo":1}')
    expect(item).toMatchObject({
      kind: 'event',
      id: 'x',
      eventType: 'some_future_line',
      text: '{"foo":1}',
    })
  })
})
