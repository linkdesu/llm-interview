import { describe, expect, it } from 'vitest'
import { computeRunStats, laneForKind, parseTrajectory, recordMatches, visibleIndexes } from './trajectory'
import type { TrajectoryRecord } from './trajectory'

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
  const message: Record<string, unknown> = {
    role: 'assistant',
    content: opts.content,
    api: 'openai-completions',
    provider: 'llamacpp-local',
    responseId: 'chatcmpl-abc',
  }
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
    toolName: 'read',
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

/** Parsed records of a JSONL string, with line index + kind + summary only. */
function digest(jsonl: string): Array<[number, string, string]> {
  return parseTrajectory(jsonl).records.map((record) => [
    record.line,
    record.kind,
    record.summary,
  ])
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parseTrajectory', () => {
  it('emits one record per line and assigns a kind tag to every line type', () => {
    const jsonl = [
      header('t1'),
      modelChange(),
      thinkingLevelChange('off'),
      userMessage('u1', 'h1', 'Build a snake game'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [textBlock('Let me read the spec.')],
        stopReason: 'toolUse',
      }),
      toolResultMessage({ id: 'r1', parentId: 'a1', toolCallId: 'c1', content: [textBlock('ok')] }),
    ].join('\n')

    const { records } = parseTrajectory(jsonl)
    expect(records).toHaveLength(6)
    expect(records.map((record) => record.kind)).toEqual([
      'session',
      'model',
      'thinking',
      'user',
      'assistant',
      'tool-result',
    ])
    expect(records.map((record) => record.type)).toEqual([
      'session',
      'model_change',
      'thinking_level_change',
      'message',
      'message',
      'message',
    ])
  })

  it('derives a one-line summary for each kind', () => {
    const jsonl = [
      header('t1'),
      modelChange(),
      thinkingLevelChange('off'),
      userMessage('u1', 'h1', 'Build a snake game'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [textBlock('Let me read the spec.'), toolCall('c1', 'read', { path: './spec.md' })],
        stopReason: 'toolUse',
      }),
      toolResultMessage({ id: 'r1', parentId: 'a1', toolCallId: 'c1', content: [textBlock('# Spec\nOverview')] }),
    ].join('\n')

    expect(digest(jsonl)).toEqual([
      [0, 'session', 't1'],
      [1, 'model', 'llamacpp-local · qwopus'],
      [2, 'thinking', 'thinking off'],
      [3, 'user', 'Build a snake game'],
      [4, 'assistant', 'Let me read the spec.'],
      [4, 'tool-call', 'read {"path":"./spec.md"}'],
      [5, 'tool-result', '# Spec Overview'],
    ])
  })

  it('expands assistant tool calls into nested child records', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Go'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [toolCall('c1', 'read', {}), toolCall('c2', 'bash', {})],
        stopReason: 'toolUse',
      }),
    ].join('\n')

    const { records } = parseTrajectory(jsonl)
    expect(records).toHaveLength(5)

    const assistant = records[2]
    expect(assistant.kind).toBe('assistant')
    expect(assistant.summary).toBe('(no text)')
    expect(assistant.depth).toBe(0)
    expect(assistant.parentIndex).toBeNull()

    const read = records[3]
    expect(read.kind).toBe('tool-call')
    expect(read.summary).toBe('read')
    expect(read.depth).toBe(1)
    expect(read.parentIndex).toBe(2)
    expect(read.meta).toContainEqual({ label: 'tool', value: 'read' })

    const bash = records[4]
    expect(bash.kind).toBe('tool-call')
    expect(bash.summary).toBe('bash')
    expect(bash.parentIndex).toBe(2)
  })

  it('exposes assistant metadata, usage, and structured sections', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Think hard'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [
          { type: 'thinking', thinking: 'Plan the architecture.' },
          textBlock('Plan ready.'),
          toolCall('c1', 'read', { path: './spec.md' }),
        ],
        usage: { input: 687, output: 72, reasoning: 0, cacheRead: 1675, cacheWrite: 0, totalTokens: 2434 },
        stopReason: 'toolUse',
        model: 'qwopus',
        timestamp: 1785272607633,
      }),
    ].join('\n')

    const assistant: TrajectoryRecord = parseTrajectory(jsonl).records[2]
    expect(assistant.meta).toContainEqual({ label: 'model', value: 'qwopus' })
    expect(assistant.meta).toContainEqual({ label: 'provider', value: 'llamacpp-local' })
    expect(assistant.meta).toContainEqual({ label: 'api', value: 'openai-completions' })
    expect(assistant.meta).toContainEqual({ label: 'stopReason', value: 'toolUse' })
    expect(assistant.meta).toContainEqual({ label: 'responseId', value: 'chatcmpl-abc' })
    expect(assistant.meta).toContainEqual({ label: 'input tokens', value: '687' })
    expect(assistant.meta).toContainEqual({ label: 'total tokens', value: '2,434' })

    expect(assistant.sections.map((section) => section.label)).toEqual(['Text', 'Thinking'])
    expect(assistant.sections[0].text).toBe('Plan ready.')
    expect(assistant.sections[1].text).toBe('Plan the architecture.')

    // The tool call is no longer a section of the assistant; it is a child row.
    const child = parseTrajectory(jsonl).records[3]
    expect(child.kind).toBe('tool-call')
    expect(child.summary).toBe('read {"path":"./spec.md"}')
    expect(child.sections[0].json).toEqual({ path: './spec.md' })
  })

  it('surfaces tool-result error and image flags in meta', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Run'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [toolCall('c1', 'bash', { command: 'exit 1' })],
        stopReason: 'toolUse',
      }),
      toolResultMessage({
        id: 'r1',
        parentId: 'a1',
        toolCallId: 'c1',
        content: [textBlock('Command exited with code 1'), { type: 'image', data: '[stripped]', mimeType: 'image/png' }],
        isError: true,
      }),
    ].join('\n')

    const result: TrajectoryRecord = parseTrajectory(jsonl).records[4]
    expect(result.kind).toBe('tool-result')
    expect(result.meta).toContainEqual({ label: 'isError', value: 'true' })
    expect(result.meta).toContainEqual({ label: 'hasImages', value: 'true' })
    expect(result.sections[0].label).toBe('Result (error)')
  })

  it('tracks the invocation id across session boundaries', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'One'),
      assistantMessage({ id: 'a1', parentId: 'u1', content: [textBlock('x')], stopReason: 'stop' }),
      header('t2'),
      userMessage('u2', 'h2', 'Two'),
      assistantMessage({ id: 'a2', parentId: 'u2', content: [textBlock('y')], stopReason: 'stop' }),
    ].join('\n')

    const { records } = parseTrajectory(jsonl)
    expect(records.map((record) => record.invocationId)).toEqual([
      't1',
      't1',
      't1',
      't2',
      't2',
      't2',
    ])
  })

  it('prefers the message epoch-ms timestamp over the envelope ISO timestamp', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Go'),
      assistantMessage({ id: 'a1', parentId: 'u1', content: [textBlock('ok')], stopReason: 'stop', timestamp: 1785272607633 }),
    ].join('\n')

    const assistant = parseTrajectory(jsonl).records[2]
    expect(assistant.timestampMs).toBe(1785272607633)

    // The user message has no message.timestamp, so it falls back to the envelope ISO.
    const user = parseTrajectory(jsonl).records[1]
    expect(user.timestampMs).toBe(1785272607580)
  })

  it('keeps unknown line kinds and unknown roles as "unknown" records instead of dropping them', () => {
    const jsonl = [
      header('t1'),
      JSON.stringify({ type: 'mystery_event', value: 1 }),
      JSON.stringify({ type: 'message', message: { role: 'steering', content: [] } }),
    ].join('\n')

    const { records } = parseTrajectory(jsonl)
    expect(records).toHaveLength(3)
    expect(records[1].kind).toBe('unknown')
    expect(records[1].summary).toBe('mystery_event')
    expect(records[2].kind).toBe('unknown')
    expect(records[2].role).toBe('steering')
  })

  it('collapses whitespace and truncates long summaries', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'a\n  b\tc ' + 'x'.repeat(400)),
    ].join('\n')

    const user = parseTrajectory(jsonl).records[1]
    expect(user.summary.startsWith('a b c')).toBe(true)
    expect(user.summary.length).toBeLessThanOrEqual(160)
    expect(user.summary.endsWith('…')).toBe(true)
  })

  it('skips malformed lines without throwing and returns nothing for empty input', () => {
    const jsonl = ['{not json', header('t1'), userMessage('u1', 'h1', 'Go'), 'garbage!!!'].join('\n')
    expect(parseTrajectory(jsonl).records).toHaveLength(2)

    expect(parseTrajectory('').records).toEqual([])
    expect(parseTrajectory('\n  \n\t\n').records).toEqual([])
  })
})

describe('compaction records', () => {
  function compactionLine(overrides: Record<string, unknown> = {}): string {
    const record: Record<string, unknown> = {
      type: 'compaction',
      id: 'c1',
      parentId: 'p1',
      timestamp: HEADER_TS,
      summary: '## Goal\nSummarized earlier work.',
      firstKeptEntryId: 'k1',
      tokensBefore: 40232,
      details: { readFiles: ['./spec.md'], modifiedFiles: ['./script.js'] },
      usage: { input: 51047, output: 485, totalTokens: 51532 },
      fromHook: false,
      ...overrides,
    }
    return JSON.stringify(record)
  }

  it('parses a compaction event with its summary, file tracking, and token metadata', () => {
    const jsonl = [header('t1'), userMessage('u1', 'h1', 'Go'), compactionLine()].join('\n')

    const compaction: TrajectoryRecord = parseTrajectory(jsonl).records[2]
    expect(compaction.kind).toBe('compaction')
    expect(compaction.summary).toBe('## Goal Summarized earlier work.')

    expect(compaction.meta).toContainEqual({ label: 'firstKeptEntryId', value: 'k1' })
    expect(compaction.meta).toContainEqual({ label: 'tokensBefore', value: '40,232' })
    expect(compaction.meta).toContainEqual({ label: 'fromHook', value: 'false' })
    expect(compaction.meta).toContainEqual({ label: 'input tokens', value: '51,047' })

    expect(compaction.sections.map((section) => section.label)).toEqual([
      'Summary',
      'Read files',
      'Modified files',
    ])
    expect(compaction.sections[0].text).toContain('Summarized earlier work.')
    expect(compaction.sections[1].json).toEqual(['./spec.md'])
    expect(compaction.sections[2].json).toEqual(['./script.js'])
  })

  it('degrades gracefully when compaction fields are absent', () => {
    const jsonl = [header('t1'), compactionLine({ summary: undefined, details: undefined, tokensBefore: undefined })].join('\n')

    const compaction: TrajectoryRecord = parseTrajectory(jsonl).records[1]
    expect(compaction.kind).toBe('compaction')
    expect(compaction.summary).toBe('compaction')
    expect(compaction.meta).toContainEqual({ label: 'tokensBefore', value: null })
    expect(compaction.sections).toEqual([])
  })
})

describe('laneForKind and recordMatches', () => {
  it('routes each kind to the DSH-style overview lane', () => {
    expect(laneForKind('session')).toBe(0)
    expect(laneForKind('model')).toBe(0)
    expect(laneForKind('thinking')).toBe(0)
    expect(laneForKind('user')).toBe(0)
    expect(laneForKind('assistant')).toBe(1)
    expect(laneForKind('compaction')).toBe(1)
    expect(laneForKind('tool-call')).toBe(2)
    expect(laneForKind('tool-result')).toBe(2)
    expect(laneForKind('unknown')).toBe(0)
  })

  it('matches records by summary, metadata, and section content', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Build a snake game'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [toolCall('c1', 'read', { path: './spec.md' })],
        stopReason: 'toolUse',
        model: 'qwopus',
      }),
      toolResultMessage({ id: 'r1', parentId: 'a1', toolCallId: 'c1', content: [textBlock('spec text')] }),
    ].join('\n')

    const { records } = parseTrajectory(jsonl)
    expect(recordMatches(records[1], 'snake')).toBe(true)
    expect(recordMatches(records[3], 'read')).toBe(true) // the tool-call child
    expect(recordMatches(records[2], 'qwopus')).toBe(true)
    expect(recordMatches(records[3], 'READ spec')).toBe(true) // case-insensitive, all terms
    expect(recordMatches(records[2], 'snake read')).toBe(false) // not every term matches
  })

  it('does not match derived token labels such as "cache write"', () => {
    // An assistant with usage.cacheWrite but no write tool call must not match
    // a search for "write" — the bug was that the derived label leaked in.
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Go'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [textBlock('Reading a file')],
        usage: { input: 100, cacheWrite: 0, totalTokens: 100 },
        stopReason: 'stop',
      }),
    ].join('\n')

    const { records } = parseTrajectory(jsonl)
    expect(recordMatches(records[2], 'write')).toBe(false)
    expect(recordMatches(records[2], 'reading')).toBe(true)
  })
})

describe('visibleIndexes', () => {
  it('keeps a parent when its child matches and a child when its parent matches', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Build a snake game'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [toolCall('c1', 'write', { path: './game.js' })],
        stopReason: 'toolUse',
      }),
      toolResultMessage({ id: 'r1', parentId: 'a1', toolCallId: 'c1', content: [textBlock('wrote file')] }),
    ].join('\n')

    const { records } = parseTrajectory(jsonl)
    // records: 0 session, 1 user, 2 assistant, 3 tool-call child, 4 tool-result

    // "write" matches only the child (index 3); the parent assistant must stay.
    expect(visibleIndexes(records, 'write')).toEqual([false, false, true, true, false])

    // "snake" matches only the user message.
    expect(visibleIndexes(records, 'snake')).toEqual([false, true, false, false, false])

    // "wrote" matches only the tool result.
    expect(visibleIndexes(records, 'wrote')).toEqual([false, false, false, false, true])
  })
})

describe('computeRunStats', () => {
  it('sums token usage and counts turns across assistant records only', () => {
    const jsonl = [
      header('t1'),
      userMessage('u1', 'h1', 'Go'),
      assistantMessage({
        id: 'a1',
        parentId: 'u1',
        content: [textBlock('x')],
        usage: { input: 100, output: 20, reasoning: 5, cacheRead: 10, cacheWrite: 2, totalTokens: 137 },
        stopReason: 'toolUse',
      }),
      assistantMessage({
        id: 'a2',
        parentId: 'u1',
        content: [textBlock('y')],
        usage: { input: 200, output: 30, totalTokens: 230 },
        stopReason: 'stop',
      }),
      // A tool call and a compaction carry no usage (or are ignored): they
      // must not affect the assistant-only totals.
      toolResultMessage({ id: 'r1', parentId: 'a1', toolCallId: 'c1', content: [textBlock('ok')] }),
    ].join('\n')

    expect(computeRunStats(parseTrajectory(jsonl).records)).toEqual({
      turns: 2,
      input: 300,
      output: 50,
      reasoning: 5,
      cacheRead: 10,
      cacheWrite: 2,
      totalTokens: 367,
    })
  })
})
