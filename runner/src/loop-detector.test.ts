import { describe, it, expect, afterAll } from "bun:test";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import {
  LoopDetector,
  formatToolCall,
  formatToolCallEntry,
  parseLoopVerdict,
  resolveSupervisor,
  type JudgeFn,
  type LoopKillInfo,
  type ToolCallEntry,
} from "./loop-detector";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const testRoot = join(tmpdir(), `loop-detector-test-${randomUUID()}`);

afterAll(async () => {
  try {
    await rm(testRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

async function makeDir(name: string): Promise<string> {
  const dir = join(testRoot, name);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Build a detector with a fake judge; captures kill callbacks per invocation. */
function makeDetector(options: {
  dir: string;
  judge: JudgeFn;
  step?: number;
  confidenceThreshold?: number;
}) {
  const detector = new LoopDetector({
    config: {
      provider: "ornith",
      modelId: "ai-01/ornith-1.0-35b-5",
      step: options.step ?? 5,
      confidenceThreshold: options.confidenceThreshold ?? 80,
    },
    supervisor: {
      url: "http://127.0.0.1:9/v1/chat/completions",
      apiKey: "test-key",
      model: "ai-01/ornith-1.0-35b-5",
    },
    combo: { model: "model-alpha", question: "q-loop" },
    sampleLogPath: join(options.dir, "loop-detect.jsonl"),
    judge: options.judge,
  });
  return detector;
}

function entry(i: number, ids?: string[]): ToolCallEntry {
  return { formatted: `call-${i}`, toolCallIds: ids ?? [`c${i}`] };
}

/** Feed n tool-call entries into a fresh invocation monitor. */
function feedEntries(
  detector: LoopDetector,
  n: number,
  ctx: {
    onKill?: (info: LoopKillInfo) => void;
    resolveSessionFile?: () => Promise<string | null>;
    invocationIndex?: number;
    ticket?: number;
    sessionLineOffset?: number;
    /** Keep the monitor attached (simulating a still-running invocation). */
    detach?: boolean;
  } = {}
) {
  const monitor = detector.beginInvocation({
    invocationIndex: ctx.invocationIndex ?? 1,
    ticket: ctx.ticket,
    sessionLineOffset: ctx.sessionLineOffset ?? 0,
    resolveSessionFile: ctx.resolveSessionFile ?? (async () => null),
    onKill: ctx.onKill ?? (() => {}),
  });
  for (let i = 1; i <= n; i++) {
    monitor.observeToolCall(entry(i));
  }
  if (ctx.detach !== false) monitor.detach();
  return monitor;
}

async function readSampleLines(dir: string): Promise<Array<Record<string, unknown>>> {
  const content = await readFile(join(dir, "loop-detect.jsonl"), "utf-8");
  return content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Extractor formatting: [toolname] arguments, matching samples.json
// ---------------------------------------------------------------------------
describe("formatToolCall", () => {
  it("formats bash calls as the command string", () => {
    expect(
      formatToolCall("bash", { command: "npx -y foo --bar", timeout: 120 })
    ).toBe("[bash] npx -y foo --bar");
  });

  it("formats read calls as the path", () => {
    expect(formatToolCall("read", { path: "./spec.md" })).toBe(
      "[read] ./spec.md"
    );
  });

  it("formats write calls as a dict-style repr of path and content", () => {
    expect(
      formatToolCall("write", { path: "./a.js", content: "line1\nline2" })
    ).toBe("[write] {'path': './a.js', 'content': 'line1\\nline2'}");
  });

  it("formats edit calls as path plus <old -> new> diffs", () => {
    expect(
      formatToolCall("edit", {
        path: "./a.js",
        edits: [{ oldText: "const a = 1;", newText: "const a = 2;" }],
      })
    ).toBe("[edit] ./a.js || <const a = 1; -> const a = 2;>");
  });

  it("formats unknown tools as JSON arguments", () => {
    expect(formatToolCall("screenshot", { full: true })).toBe(
      '[screenshot] {"full":true}'
    );
  });

  it("truncates a formatted call at ~500 characters with a remainder marker", () => {
    const long = "x".repeat(600);
    const formatted = formatToolCall("bash", { command: long });
    expect(formatted.length).toBeLessThanOrEqual(510);
    expect(formatted).toMatch(/…\[\+\d+\]$/);
    expect(formatted.startsWith("[bash] ")).toBe(true);
  });

  it("joins the tool calls of one assistant message with ' || '", () => {
    const joined = formatToolCallEntry([
      { id: "c1", name: "read", arguments: { path: "./spec.md" } },
      { id: "c2", name: "read", arguments: { path: "./tickets.md" } },
    ]);
    expect(joined.formatted).toBe("[read] ./spec.md || [read] ./tickets.md");
    expect(joined.toolCallIds).toEqual(["c1", "c2"]);
  });
});

// ---------------------------------------------------------------------------
// Verdict parsing: plain JSON, fenced JSON, free text
// ---------------------------------------------------------------------------
describe("parseLoopVerdict", () => {
  it("parses a plain JSON verdict", () => {
    const verdict = parseLoopVerdict(
      '{"loop": true, "confidence": 95, "reason": "10 identical bash commands"}'
    );
    expect(verdict).toEqual({
      loop: true,
      confidence: 95,
      reason: "10 identical bash commands",
    });
  });

  it("parses a ```json-fenced verdict", () => {
    const answer =
      '```json\n{"loop": false, "confidence": 90, "reason": "progression to new targets"}\n```';
    expect(parseLoopVerdict(answer)).toEqual({
      loop: false,
      confidence: 90,
      reason: "progression to new targets",
    });
  });

  it("parses a verdict with surrounding prose", () => {
    const answer =
      'After reviewing:\n{"loop": true, "confidence": 82, "reason": "reset rotation"}\nThat is my judgment.';
    const verdict = parseLoopVerdict(answer);
    expect(verdict?.loop).toBe(true);
    expect(verdict?.confidence).toBe(82);
  });

  it("returns null for free text without a loop field", () => {
    expect(
      parseLoopVerdict("Let me analyze these 10 tool calls carefully.\n1. Turn 1: ...")
    ).toBeNull();
  });

  it("keeps confidence null when the field is missing", () => {
    const verdict = parseLoopVerdict('{"loop": true, "reason": "repeats"}');
    expect(verdict?.loop).toBe(true);
    expect(verdict?.confidence).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Judgment cadence: window of the last 10 calls, judged every `step` calls
// ---------------------------------------------------------------------------
describe("LoopDetector cadence", () => {
  it("judges every 5 new tool calls by default once the window is full", async () => {
    const dir = await makeDir("cadence-default");
    const windows: string[][] = [];
    const detector = makeDetector({
      dir,
      judge: async (window) => {
        windows.push(window);
        return '{"loop": false, "confidence": 10, "reason": "fine"}';
      },
    });

    feedEntries(detector, 20);
    await detector.close();

    expect(windows).toEqual([
      Array.from({ length: 10 }, (_, i) => `call-${i + 1}`),
      Array.from({ length: 10 }, (_, i) => `call-${i + 6}`),
      Array.from({ length: 10 }, (_, i) => `call-${i + 11}`),
    ]);
  });

  it("honours a custom step", async () => {
    const dir = await makeDir("cadence-custom");
    const windows: string[][] = [];
    const detector = makeDetector({
      dir,
      step: 3,
      judge: async (window) => {
        windows.push(window);
        return '{"loop": false, "confidence": 10, "reason": "fine"}';
      },
    });

    feedEntries(detector, 16);
    await detector.close();

    expect(windows).toEqual([
      Array.from({ length: 10 }, (_, i) => `call-${i + 1}`),
      Array.from({ length: 10 }, (_, i) => `call-${i + 4}`),
      Array.from({ length: 10 }, (_, i) => `call-${i + 7}`),
    ]);
  });

  it("treats step > 10 as a spot check with gaps between windows", async () => {
    const dir = await makeDir("cadence-spot");
    const windows: string[][] = [];
    const detector = makeDetector({
      dir,
      step: 15,
      judge: async (window) => {
        windows.push(window);
        return '{"loop": false, "confidence": 10, "reason": "fine"}';
      },
    });

    feedEntries(detector, 30);
    await detector.close();

    expect(windows).toEqual([
      Array.from({ length: 10 }, (_, i) => `call-${i + 1}`),
      Array.from({ length: 10 }, (_, i) => `call-${i + 16}`),
    ]);
  });

  it("never judges before 10 tool calls have been observed", async () => {
    const dir = await makeDir("cadence-short");
    let judged = 0;
    const detector = makeDetector({
      dir,
      step: 2,
      judge: async () => {
        judged++;
        return '{"loop": false, "confidence": 10, "reason": "fine"}';
      },
    });

    feedEntries(detector, 9);
    await detector.close();

    expect(judged).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Kill gate: single loop:true + confidence >= threshold kills; anything else
// is treated as normal.
// ---------------------------------------------------------------------------
describe("LoopDetector kill gate", () => {
  it("kills on loop:true with confidence at or above the threshold", async () => {
    const dir = await makeDir("gate-kill");
    const kills: LoopKillInfo[] = [];
    const detector = makeDetector({
      dir,
      judge: async () => '{"loop": true, "confidence": 95, "reason": "same command repeated"}',
    });

    feedEntries(detector, 12, { onKill: (info) => kills.push(info), detach: false });
    await detector.close();

    expect(kills).toEqual([{ confidence: 95, reason: "same command repeated" }]);
    expect(detector.killed).toBe(true);

    const lines = await readSampleLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0].killed).toBe(true);
    expect(lines[0].verdict).toEqual({
      loop: true,
      confidence: 95,
      reason: "same command repeated",
    });
  });

  it("does not kill below the confidence threshold", async () => {
    const dir = await makeDir("gate-below");
    const kills: LoopKillInfo[] = [];
    const detector = makeDetector({
      dir,
      judge: async () => '{"loop": true, "confidence": 79, "reason": "maybe looping"}',
    });

    feedEntries(detector, 12, { onKill: (info) => kills.push(info), detach: false });
    await detector.close();

    expect(kills).toHaveLength(0);
    expect(detector.killed).toBe(false);
    const lines = await readSampleLines(dir);
    expect(lines[0].killed).toBe(false);
  });

  it("does not kill on an unparseable answer", async () => {
    const dir = await makeDir("gate-unparseable");
    const kills: LoopKillInfo[] = [];
    const detector = makeDetector({
      dir,
      judge: async () => "Let me analyze these calls one by one...",
    });

    feedEntries(detector, 12, { onKill: (info) => kills.push(info), detach: false });
    await detector.close();

    expect(kills).toHaveLength(0);
    const lines = await readSampleLines(dir);
    expect(lines[0].verdict).toBeNull();
    expect(lines[0].killed).toBe(false);
  });

  it("does not kill when the supervisor is unreachable (window skipped)", async () => {
    const dir = await makeDir("gate-transport");
    const kills: LoopKillInfo[] = [];
    const detector = makeDetector({
      dir,
      judge: async () => null,
    });

    feedEntries(detector, 12, { onKill: (info) => kills.push(info), detach: false });
    await detector.close();

    expect(kills).toHaveLength(0);
    const lines = await readSampleLines(dir);
    expect(lines[0].answer).toBeNull();
    expect(lines[0].verdict).toBeNull();
    expect(lines[0].killed).toBe(false);
    expect(typeof lines[0].error).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Sample log: identity, window line references, raw answer, verdict, kill flag
// ---------------------------------------------------------------------------
describe("LoopDetector sample log", () => {
  it("records combo identity, invocation/ticket index, and the raw answer", async () => {
    const dir = await makeDir("sample-identity");
    const detector = makeDetector({
      dir,
      judge: async () => '```json\n{"loop": false, "confidence": 90, "reason": "healthy"}\n```',
    });

    feedEntries(detector, 10, { invocationIndex: 2, ticket: 2 });
    await detector.close();

    const lines = await readSampleLines(dir);
    expect(lines).toHaveLength(1);
    expect(lines[0].model).toBe("model-alpha");
    expect(lines[0].question).toBe("q-loop");
    expect(lines[0].invocation).toBe(2);
    expect(lines[0].ticket).toBe(2);
    expect(String(lines[0].answer)).toContain("```json");
    expect(lines[0].verdict).toEqual({
      loop: false,
      confidence: 90,
      reason: "healthy",
    });
    expect(lines[0].killed).toBe(false);
  });

  it("resolves the judged window to line references into session.jsonl", async () => {
    const dir = await makeDir("sample-lines");
    // Fake live session file: 1 header line, then one assistant message line
    // per tool call, each carrying the toolCall id the extractor observed.
    const sessionFile = join(dir, "t1_session.jsonl");
    const lines = [
      '{"type":"session","id":"t1"}',
      ...Array.from({ length: 12 }, (_, i) =>
        JSON.stringify({
          type: "message",
          message: {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: `c${i + 1}`,
                name: "bash",
                arguments: { command: "same command" },
              },
            ],
          },
        })
      ),
    ];
    await writeFile(sessionFile, lines.join("\n") + "\n", "utf-8");

    const detector = makeDetector({
      dir,
      judge: async () => '{"loop": true, "confidence": 95, "reason": "same command"}',
    });

    feedEntries(detector, 10, {
      resolveSessionFile: async () => sessionFile,
      sessionLineOffset: 100,
    });
    await detector.close();

    const samples = await readSampleLines(dir);
    expect(samples).toHaveLength(1);
    // Window = calls 1-10 at session lines 2-11, plus the offset of prior
    // invocations' segments in the concatenated session.jsonl.
    expect(samples[0].window).toEqual({
      lines: Array.from({ length: 10 }, (_, i) => 100 + i + 2),
    });
    // References only — never the turn content itself.
    expect(JSON.stringify(samples[0].window)).not.toContain("same command");
  });

  it("records null for window entries whose tool call cannot be resolved", async () => {
    const dir = await makeDir("sample-lines-missing");
    const detector = makeDetector({
      dir,
      judge: async () => '{"loop": false, "confidence": 10, "reason": "fine"}',
    });

    // No session file available (race / pi wrote nothing yet).
    feedEntries(detector, 10, { resolveSessionFile: async () => null });
    await detector.close();

    const samples = await readSampleLines(dir);
    expect(samples[0].window).toEqual({ lines: Array(10).fill(null) });
  });
});

// ---------------------------------------------------------------------------
// Supervisor resolution from <piHome>/models.json
// ---------------------------------------------------------------------------
describe("resolveSupervisor", () => {
  const config = {
    provider: "ornith",
    modelId: "ai-01/ornith-1.0-35b-5",
    step: 5,
    confidenceThreshold: 80,
  };

  it("resolves the chat-completions URL and api key from models.json", async () => {
    const piHome = await makeDir("supervisor-ok");
    await writeFile(
      join(piHome, "models.json"),
      JSON.stringify({
        providers: {
          ornith: {
            baseUrl: "http://192.0.2.1:8080/v1/",
            apiKey: "secret",
            models: [{ id: "ai-01/ornith-1.0-35b-5" }],
          },
        },
      }),
      "utf-8"
    );

    const endpoint = await resolveSupervisor(piHome, config);
    expect(endpoint).toEqual({
      url: "http://192.0.2.1:8080/v1/chat/completions",
      apiKey: "secret",
      model: "ai-01/ornith-1.0-35b-5",
    });
  });

  it("refuses to start when the provider is missing from models.json", async () => {
    const piHome = await makeDir("supervisor-missing");
    await writeFile(
      join(piHome, "models.json"),
      JSON.stringify({ providers: { other: { baseUrl: "http://x", models: [] } } }),
      "utf-8"
    );

    await expect(resolveSupervisor(piHome, config)).rejects.toThrow(/ornith/);
  });

  it("refuses to start when models.json does not exist", async () => {
    const piHome = await makeDir("supervisor-no-file");
    await expect(resolveSupervisor(piHome, config)).rejects.toThrow(/ornith/);
  });
});
