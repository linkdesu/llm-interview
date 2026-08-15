import { describe, expect, it } from 'vitest'
import { parseTrajectory } from './trajectory'
import type { Trajectory } from './trajectory'

// ---------------------------------------------------------------------------
// Fixture builders — emit realistic pi-format session.jsonl lines.
// ---------------------------------------------------------------------------

const HEADER_TS = '2026-07-28T21:03:27.580Z'

function header(id: string, timestamp: string = HEADER_TS): string {
  return JSON.stringify({ type: 'session', version: 3, id, timestamp, cwd: '/work' })
}

function modelChange(): string {
  return JSON.stringify({
    type: 'model_change',
    id: 'm1',
    parentId: null,
    timestamp: HEADER_TS,
    provider: 'llamacpp-local',
    modelId: 'qwopus',
  })
}

function thinkingLevelChange(level: string): string {
  return JSON.stringify({
    type: 'thinking_level_change',
    id: 'tl1',
    parentId: 'm1',
    timestamp: HEADER_TS,
    thinkingLevel: level,
  })
}

function userMessage(id: string, parentId: string, text: string): string {
  return JSON.stringify({
    type: 'message',
    id,
    parentId,
    timestamp: HEADER_TS,
    message: { role: 'user', content: [{ type: 'text', text }] },
  })
}

interface AssistantOpts {
  id: string
  parentId: string | null
  content: unknown[]
  usage?: Record<string, unknown>
  stopReason?: string
  model?: string
  timestamp?: number
}

function assistantMessage(opts: AssistantOpts): string {
  const message: Record<string, unknown> = { role: 'assistant', content: opts.content }
  if (opts.usage !== undefined) message.usage = opts.usage
  if (opts.stopReason !== undefined) message.stopReason = opts.stopReason
  if (opts.model !== undefined) message.model = opts.model
  if (opts.timestamp !== undefined) message.timestamp = opts.timestamp
  return JSON.stringify({
    type: 'message',
    id: opts.id,
    parentId: opts.parentId,
    timestamp: HEADER_TS,
    message,
  })
}

interface ToolResultOpts {
  id: string
  parentId: string
  toolCallId: string
  content: unknown[]
  isError?: boolean
  timestamp?: number
}

function toolResultMessage(opts: ToolResultOpts): string {
  const message: Record<string, unknown> = {
    role: 'toolResult',
    toolCallId: opts.toolCallId,
    content: opts.content,
  }
  if (opts.isError !== undefined) message.isError = opts.isError
  if (opts.timestamp !== undefined) message.timestamp = opts.timestamp
  return JSON.stringify({
    type: 'message',
    id: opts.id,
    parentId: opts.parentId,
    timestamp: HEADER_TS,
    message,
  })
}

function textBlock(text: string): unknown {
  return { type: 'text', text }
}

function toolCall(id: string, name: string, args: Record<string, unknown>): unknown {
  return { type: 'toolCall', id, name, arguments: args }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseTrajectory', () => {
  it('derives one turn from an assistant message plus its matched tool result', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Build a snake game'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [textBlock('Let me read the spec.'), toolCall('c1', 'read', { path: './spec.md' })],
        usage: { input: 687, output: 72, reasoning: 0, cacheRead: 1675, cacheWrite: 0, totalTokens: 2434, cost: { total: 0 } },
        stopReason: 'toolUse',
        model: 'qwopus',
        timestamp: 1785272607633,
      }),
      toolResultMessage({
        id: 'r1',
        parentId: 'a1',
        toolCallId: 'c1',
        content: [textBlock('# Spec\nOverview')],
        isError: false,
        timestamp: 1785272608963,
      }),
    ].join('\n')

    const trajectory: Trajectory = parseTrajectory(jsonl)
    expect(trajectory.invocations).toHaveLength(1)

    const invocation = trajectory.invocations[0]
    expect(invocation.id).toBe('t1')
    expect(invocation.prompt).toBe('Build a snake game')
    expect(invocation.turns).toHaveLength(1)

    const turn = invocation.turns[0]
    expect(turn.assistantText).toBe('Let me read the spec.')
    expect(turn.thinking).toBe('')
    expect(turn.usage).toEqual({
      input: 687,
      output: 72,
      reasoning: 0,
      cacheRead: 1675,
      cacheWrite: 0,
      totalTokens: 2434,
    })
    expect(turn.stopReason).toBe('toolUse')
    expect(turn.model).toBe('qwopus')
    expect(turn.timestampMs).toBe(1785272607633)

    expect(turn.toolCalls).toHaveLength(1)
    const call = turn.toolCalls[0]
    expect(call.callId).toBe('c1')
    expect(call.name).toBe('read')
    expect(call.arguments).toEqual({ path: './spec.md' })
    expect(call.result).toEqual({
      text: '# Spec\nOverview',
      isError: false,
      hasImages: false,
      timestampMs: 1785272608963,
    })
  })

  it('keeps multiple turns of one invocation in log order', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Build a snake game'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [toolCall('c1', 'read', { path: './spec.md' })],
        stopReason: 'toolUse',
        timestamp: 1000,
      }),
      toolResultMessage({ id: 'r1', parentId: 'a1', toolCallId: 'c1', content: [textBlock('spec text')], timestamp: 1100 }),
      assistantMessage({
        id: 'a2',
        parentId: 'r1',
        content: [textBlock('Writing code...'), toolCall('c2', 'write', { path: './index.html' })],
        stopReason: 'toolUse',
        timestamp: 2000,
      }),
      toolResultMessage({ id: 'r2', parentId: 'a2', toolCallId: 'c2', content: [textBlock('wrote index.html')], timestamp: 2100 }),
      assistantMessage({ id: 'a3', parentId: 'r2', content: [textBlock('Done.')], stopReason: 'stop', timestamp: 3000 }),
    ].join('\n')

    const { invocations } = parseTrajectory(jsonl)
    expect(invocations).toHaveLength(1)
    const turns = invocations[0].turns
    expect(turns).toHaveLength(3)
    expect(turns.map((turn) => turn.assistantText)).toEqual(['', 'Writing code...', 'Done.'])
    expect(turns[0].toolCalls[0].result?.text).toBe('spec text')
    expect(turns[1].toolCalls[0].result?.text).toBe('wrote index.html')
    expect(turns[2].stopReason).toBe('stop')
    expect(turns[2].toolCalls).toHaveLength(0)
  })

  it('leaves a tool call without a matching result as in-flight (result null)', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Do it'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [toolCall('c1', 'bash', { command: 'sleep 60' })],
        stopReason: 'toolUse',
        timestamp: 1000,
      }),
      // The transcript ends before the tool result arrives.
    ].join('\n')

    const turn = parseTrajectory(jsonl).invocations[0].turns[0]
    expect(turn.toolCalls).toHaveLength(1)
    expect(turn.toolCalls[0].callId).toBe('c1')
    expect(turn.toolCalls[0].result).toBeNull()
  })

  it('captures thinking text when present and an empty string when thinking is off', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Think hard'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [{ type: 'thinking', thinking: 'Let me plan the architecture.' }, textBlock('Plan ready.')],
        stopReason: 'toolUse',
        timestamp: 1000,
      }),
      assistantMessage({ id: 'a2', parentId: 'a1', content: [textBlock('No thinking here.')], stopReason: 'stop', timestamp: 2000 }),
    ].join('\n')

    const turns = parseTrajectory(jsonl).invocations[0].turns
    expect(turns).toHaveLength(2)
    expect(turns[0].thinking).toBe('Let me plan the architecture.')
    expect(turns[0].assistantText).toBe('Plan ready.')
    expect(turns[1].thinking).toBe('')
    expect(turns[1].assistantText).toBe('No thinking here.')
  })

  it('splits a concatenated archive into invocations with their own prompts and turns', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Ticket 1 prompt'),
      assistantMessage({ id: 'a1', parentId: 'u1', content: [textBlock('Working on ticket 1')], stopReason: 'stop', timestamp: 1000 }),
      header('t2', '2026-07-28T21:43:53.374Z'),
      userMessage('u2', 'h2', 'Ticket 2 prompt'),
      assistantMessage({
        id: 'a2',
        parentId: 'u2',
        content: [toolCall('c1', 'read', { path: './tickets.md' })],
        stopReason: 'toolUse',
        timestamp: 2000,
      }),
      header('t1-eval', '2026-07-28T21:43:39.508Z'),
      userMessage('u3', 'h3', 'Evaluate the work'),
      assistantMessage({ id: 'a3', parentId: 'u3', content: [textBlock('Reviewing...')], stopReason: 'stop', timestamp: 3000 }),
    ].join('\n')

    const { invocations } = parseTrajectory(jsonl)
    expect(invocations.map((invocation) => invocation.id)).toEqual(['t1', 't2', 't1-eval'])
    expect(invocations.map((invocation) => invocation.prompt)).toEqual([
      'Ticket 1 prompt',
      'Ticket 2 prompt',
      'Evaluate the work',
    ])
    expect(invocations.map((invocation) => invocation.turns.length)).toEqual([1, 1, 1])
    // A tool call in one invocation must not pick up a result from another.
    expect(invocations[1].turns[0].toolCalls[0].result).toBeNull()
  })

  it('degrades gracefully on old/minimal messages that lack usage, thinking, and timestamps', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Hello'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [textBlock('Hi there'), toolCall('c1', 'read', {})],
        // No usage, stopReason, model, or timestamp at all.
      }),
      toolResultMessage({
        id: 'r1',
        parentId: 'a1',
        toolCallId: 'c1',
        content: [textBlock('ok')],
        // No isError or timestamp at all.
      }),
    ].join('\n')

    const turn = parseTrajectory(jsonl).invocations[0].turns[0]
    expect(turn.assistantText).toBe('Hi there')
    expect(turn.thinking).toBe('')
    expect(turn.usage).toBeNull()
    expect(turn.stopReason).toBeNull()
    expect(turn.model).toBeNull()
    expect(turn.timestampMs).toBeNull()
    expect(turn.toolCalls[0].result).toEqual({ text: 'ok', isError: false, hasImages: false, timestampMs: null })
  })

  it('returns an all-null usage object when usage exists but has no token fields', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Go'),
      assistantMessage({ id: 'a1', parentId: 'u1', content: [textBlock('x')], usage: { cost: { total: 0 } }, stopReason: 'stop', timestamp: 1000 }),
    ].join('\n')

    const turn = parseTrajectory(jsonl).invocations[0].turns[0]
    expect(turn.usage).toEqual({
      input: null,
      output: null,
      reasoning: null,
      cacheRead: null,
      cacheWrite: null,
      totalTokens: null,
    })
  })

  it('normalizes the envelope ISO timestamp to epoch milliseconds', () => {
    const jsonl = [
      header('t1', '2026-07-28T21:03:27.580Z'),
      userMessage('u1', 'h1', 'Go'),
      assistantMessage({ id: 'a1', parentId: 'u1', content: [textBlock('ok')], stopReason: 'stop', timestamp: 1785272607633 }),
      toolResultMessage({ id: 'r1', parentId: 'a1', toolCallId: 'c1', content: [textBlock('r')], timestamp: 1785272608963 }),
    ].join('\n')

    const invocation = parseTrajectory(jsonl).invocations[0]
    expect(invocation.startTimestampMs).toBe(1785272607580)
    expect(invocation.turns[0].timestampMs).toBe(1785272607633)
  })

  it('returns null for unparseable header timestamps instead of throwing', () => {
    const jsonl = [header('t1', 'not-a-date'), userMessage('u1', 'h1', 'Go')].join('\n')
    expect(parseTrajectory(jsonl).invocations[0].startTimestampMs).toBeNull()
  })

  it('ignores unknown line kinds such as model_change and thinking_level_change', () => {
    const jsonl = [
      header('t1'),
      modelChange(),
      thinkingLevelChange('off'),
      userMessage('u1', 'h1', 'Go'),
      assistantMessage({ id: 'a1', parentId: 'u1', content: [textBlock('ok')], stopReason: 'stop', timestamp: 1000 }),
    ].join('\n')

    const { invocations } = parseTrajectory(jsonl)
    expect(invocations).toHaveLength(1)
    expect(invocations[0].turns).toHaveLength(1)
    expect(invocations[0].turns[0].assistantText).toBe('ok')
  })

  it('skips malformed JSON lines without throwing', () => {
    const jsonl = [
      '{this is not json',
      header('t1'),
      userMessage('u1', 'h1', 'Go'),
      'garbage!!!',
      assistantMessage({ id: 'a1', parentId: 'u1', content: [textBlock('ok')], stopReason: 'stop', timestamp: 1000 }),
    ].join('\n')

    const { invocations } = parseTrajectory(jsonl)
    expect(invocations).toHaveLength(1)
    expect(invocations[0].turns).toHaveLength(1)
    expect(invocations[0].turns[0].assistantText).toBe('ok')
  })

  it('returns no invocations for empty input', () => {
    expect(parseTrajectory('').invocations).toEqual([])
    expect(parseTrajectory('\n  \n\t\n').invocations).toEqual([])
  })

  it('flags image blocks in tool results and keeps only text blocks in the text', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Show me'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [toolCall('c1', 'read', { path: './a.png' })],
        stopReason: 'toolUse',
        timestamp: 1000,
      }),
      toolResultMessage({
        id: 'r1',
        parentId: 'a1',
        toolCallId: 'c1',
        content: [textBlock('Read image file [image/png]'), { type: 'image', data: '[stripped]', mimeType: 'image/png' }],
        timestamp: 1100,
      }),
    ].join('\n')

    const call = parseTrajectory(jsonl).invocations[0].turns[0].toolCalls[0]
    expect(call.result).not.toBeNull()
    expect(call.result?.text).toBe('Read image file [image/png]')
    expect(call.result?.hasImages).toBe(true)
  })

  it('surfaces the isError flag of a tool result', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Run'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [toolCall('c1', 'bash', { command: 'exit 1' })],
        stopReason: 'toolUse',
        timestamp: 1000,
      }),
      toolResultMessage({
        id: 'r1',
        parentId: 'a1',
        toolCallId: 'c1',
        content: [textBlock('Command exited with code 1')],
        isError: true,
        timestamp: 1100,
      }),
    ].join('\n')

    const call = parseTrajectory(jsonl).invocations[0].turns[0].toolCalls[0]
    expect(call.result?.isError).toBe(true)
  })

  it('pairs a tool call with a result that arrives after later assistant messages', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Investigate'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [toolCall('c1', 'bash', { command: 'which chrome' })],
        stopReason: 'toolUse',
        timestamp: 1000,
      }),
      assistantMessage({
        id: 'a2',
        parentId: 'a1',
        content: [toolCall('c2', 'bash', { command: 'ls' })],
        stopReason: 'toolUse',
        timestamp: 2000,
      }),
      toolResultMessage({ id: 'r2', parentId: 'a2', toolCallId: 'c2', content: [textBlock('file list')], timestamp: 2100 }),
      // The result for c1 arrives only after turn a2 has already started.
      toolResultMessage({ id: 'r1', parentId: 'a2', toolCallId: 'c1', content: [textBlock('/usr/bin/chrome')], timestamp: 5000 }),
    ].join('\n')

    const turns = parseTrajectory(jsonl).invocations[0].turns
    expect(turns).toHaveLength(2)
    expect(turns[0].toolCalls[0].result?.text).toBe('/usr/bin/chrome')
    expect(turns[1].toolCalls[0].result?.text).toBe('file list')
  })

  it('captures multiple tool calls in one turn, each paired with its own result', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Read both'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [toolCall('c1', 'read', { path: './spec.md' }), toolCall('c2', 'read', { path: './tickets.md' })],
        stopReason: 'toolUse',
        timestamp: 1000,
      }),
      toolResultMessage({ id: 'r1', parentId: 'a1', toolCallId: 'c1', content: [textBlock('spec text')], timestamp: 1100 }),
      toolResultMessage({ id: 'r2', parentId: 'a1', toolCallId: 'c2', content: [textBlock('tickets text')], timestamp: 1200 }),
    ].join('\n')

    const calls = parseTrajectory(jsonl).invocations[0].turns[0].toolCalls
    expect(calls).toHaveLength(2)
    expect(calls[0].result?.text).toBe('spec text')
    expect(calls[1].result?.text).toBe('tickets text')
  })

  it('concatenates multiple text blocks of a message exactly', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Go'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }],
        stopReason: 'stop',
        timestamp: 1000,
      }),
    ].join('\n')

    expect(parseTrajectory(jsonl).invocations[0].turns[0].assistantText).toBe('Hello world')
  })

  it('ignores messages that appear before the first session header', () => {
    const jsonl = [
      assistantMessage({ id: 'a0', parentId: null, content: [textBlock('orphan')], stopReason: 'stop', timestamp: 0 }),
      header('t1'),
      userMessage('u1', 'h1', 'Go'),
      assistantMessage({ id: 'a1', parentId: 'u1', content: [textBlock('ok')], stopReason: 'stop', timestamp: 1000 }),
    ].join('\n')

    const { invocations } = parseTrajectory(jsonl)
    expect(invocations).toHaveLength(1)
    expect(invocations[0].turns).toHaveLength(1)
    expect(invocations[0].turns[0].assistantText).toBe('ok')
  })
})
