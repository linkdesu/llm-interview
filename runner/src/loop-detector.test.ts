import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LoopDetector,
  formatToolCall,
  parseSupervisorAnswer,
  resolveSupervisorEndpoint,
  LOOP_DETECTOR_PROMPT,
  type LoopJudge,
} from "./loop-detector";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), "loop-detector-test-"));
});

// ---------------------------------------------------------------------------
// Prompt (v10, integrated verbatim)
// ---------------------------------------------------------------------------
describe("LOOP_DETECTOR_PROMPT", () => {
  it("carries the v10 prompt's key markers", () => {
    expect(LOOP_DETECTOR_PROMPT).toContain(
      "runtime supervisor for an autonomous AI coding agent"
    );
    expect(LOOP_DETECTOR_PROMPT).toContain("RESET-AND-RECHECK ROTATION");
    expect(LOOP_DETECTOR_PROMPT).toContain(
      '{"loop": true, "confidence": 85'
    );
    // v10 is the final round-10 prompt: > 4KB of guidance text
    expect(LOOP_DETECTOR_PROMPT.length).toBeGreaterThan(4000);
  });
});

// ---------------------------------------------------------------------------
// formatToolCall: [toolname] arguments, truncated at ~500 chars
// ---------------------------------------------------------------------------
describe("formatToolCall", () => {
  it("renders a bash call as its command", () => {
    expect(
      formatToolCall("bash", { command: 'ls -la | grep "foo"', timeout: 30 })
    ).toBe('[bash] ls -la | grep "foo"');
  });

  it("renders a read call as its path", () => {
    expect(formatToolCall("read", { path: "./spec.md" })).toBe(
      "[read] ./spec.md"
    );
  });

  it("renders a write call as path plus content", () => {
    const out = formatToolCall("write", {
      path: "./index.html",
      content: "<html></html>",
    });
    expect(out).toBe("[write] ./index.html || <html></html>");
  });

  it("renders an edit call as path plus <old -> new>", () => {
    const out = formatToolCall("edit", {
      path: "./style.css",
      edits: [{ oldText: "body {}", newText: "body { margin: 0 }" }],
    });
    expect(out).toBe("[edit] ./style.css || <body {} -> body { margin: 0 }>");
  });

  it("falls back to JSON for unknown argument shapes", () => {
    expect(formatToolCall("grep", { pattern: "foo" })).toBe(
      '[grep] {"pattern":"foo"}'
    );
  });

  it("truncates a formatted call at ~500 characters", () => {
    const out = formatToolCall("bash", { command: "x".repeat(5000) });
    expect(out.length).toBe(500);
    expect(out.startsWith("[bash] xxx")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// parseSupervisorAnswer: JSON verdict extraction, fence-tolerant
// ---------------------------------------------------------------------------
describe("parseSupervisorAnswer", () => {
  it("parses a plain JSON verdict", () => {
    const v = parseSupervisorAnswer(
      '{"loop": true, "confidence": 95, "reason": "same command 10x"}'
    );
    expect(v).toEqual({ loop: true, confidence: 95, reason: "same command 10x" });
  });

  it("parses a ```json fenced verdict (11/17 baseline answers were fenced)", () => {
    const v = parseSupervisorAnswer(
      '```json\n{"loop": false, "confidence": 90, "reason": "progressing"}\n```'
    );
    expect(v).toEqual({ loop: false, confidence: 90, reason: "progressing" });
  });

  it("parses a verdict embedded in surrounding prose", () => {
    const v = parseSupervisorAnswer(
      'After analysis:\n{"loop": true, "confidence": 82, "reason": "rotation"}\nDone.'
    );
    expect(v).toEqual({ loop: true, confidence: 82, reason: "rotation" });
  });

  it("returns null when the answer has no loop field", () => {
    expect(parseSupervisorAnswer('{"confidence": 90}')).toBeNull();
    expect(parseSupervisorAnswer("I cannot decide")).toBeNull();
    expect(parseSupervisorAnswer("")).toBeNull();
  });

  it("defaults a missing confidence to 0 and a missing reason to empty", () => {
    const v = parseSupervisorAnswer('{"loop": true}');
    expect(v).toEqual({ loop: true, confidence: 0, reason: "" });
  });
});

// ---------------------------------------------------------------------------
// LoopDetector cadence: sliding window of 10, judge every `step` new calls
// ---------------------------------------------------------------------------
function recordJudge(
  calls: string[][]
): { judge: LoopJudge; windows: string[][] } {
  return {
    windows: calls,
    judge: async (window: string[]) => {
      calls.push(window);
      return '{"loop": false, "confidence": 90, "reason": "fine"}';
    },
  };
}

function makeDetector(
  judge: LoopJudge,
  options: { step?: number; confidenceThreshold?: number; onKill?: (v: unknown) => void } = {}
): { detector: LoopDetector; logPath: string } {
  const logPath = join(tempRoot, `loop-detect-${Math.random().toString(36).slice(2)}.jsonl`);
  return {
    logPath,
    detector: new LoopDetector({
      step: options.step ?? 5,
      confidenceThreshold: options.confidenceThreshold ?? 80,
      judge,
      logPath,
      identity: { model: "model-alpha", question: "q-hello", sessionId: "t1" },
      onKill: options.onKill ?? (() => {}),
    }),
  };
}

describe("LoopDetector cadence", () => {
  it("judges every 5 new tool calls by default with a growing window up to 10", async () => {
    const windows: string[][] = [];
    const { judge } = recordJudge(windows);
    const { detector } = makeDetector(judge);

    for (let i = 1; i <= 23; i++) {
      detector.observe({ text: `[bash] cmd-${i}`, line: i });
    }
    await detector.flush();

    // Judgments at calls 5, 10, 15, 20
    expect(windows.map((w) => w.length)).toEqual([5, 10, 10, 10]);
    // Window is the LAST 10 calls
    expect(windows[3][0]).toBe("[bash] cmd-11");
    expect(windows[3][9]).toBe("[bash] cmd-20");
  });

  it("honors a custom step", async () => {
    const windows: string[][] = [];
    const { judge } = recordJudge(windows);
    const { detector } = makeDetector(judge, { step: 3 });

    for (let i = 1; i <= 9; i++) {
      detector.observe({ text: `[bash] cmd-${i}`, line: i });
    }
    await detector.flush();

    // Judgments at calls 3, 6, 9
    expect(windows.map((w) => w.length)).toEqual([3, 6, 9]);
  });

  it("allows step > 10 as a spot-check with gaps between windows", async () => {
    const windows: string[][] = [];
    const { judge } = recordJudge(windows);
    const { detector } = makeDetector(judge, { step: 15 });

    for (let i = 1; i <= 30; i++) {
      detector.observe({ text: `[bash] cmd-${i}`, line: i });
    }
    await detector.flush();

    // Judgments at calls 15 and 30; each window is the last 10 calls
    expect(windows).toHaveLength(2);
    expect(windows[0][0]).toBe("[bash] cmd-6");
    expect(windows[1][0]).toBe("[bash] cmd-21");
  });
});

// ---------------------------------------------------------------------------
// Kill gate: loop:true + confidence >= threshold kills; anything else never
// ---------------------------------------------------------------------------
describe("LoopDetector kill gate", () => {
  it("kills on loop:true with confidence >= threshold", async () => {
    const kills: unknown[] = [];
    const judge: LoopJudge = async () =>
      '{"loop": true, "confidence": 95, "reason": "10 identical snapshots"}';
    const { detector } = makeDetector(judge, { onKill: (v) => kills.push(v) });

    for (let i = 1; i <= 5; i++) detector.observe({ text: `[bash] same`, line: i });
    await detector.flush();

    expect(kills).toHaveLength(1);
    expect(detector.killVerdict).toEqual({
      loop: true,
      confidence: 95,
      reason: "10 identical snapshots",
    });
  });

  it("does not kill below the confidence threshold", async () => {
    const kills: unknown[] = [];
    const judge: LoopJudge = async () =>
      '{"loop": true, "confidence": 79, "reason": "unsure"}';
    const { detector } = makeDetector(judge, { onKill: (v) => kills.push(v) });

    for (let i = 1; i <= 5; i++) detector.observe({ text: `[bash] same`, line: i });
    await detector.flush();

    expect(kills).toHaveLength(0);
    expect(detector.killVerdict).toBeNull();
  });

  it("honors a custom confidence threshold", async () => {
    const kills: unknown[] = [];
    const judge: LoopJudge = async () =>
      '{"loop": true, "confidence": 60, "reason": "unsure"}';
    const { detector } = makeDetector(judge, {
      confidenceThreshold: 50,
      onKill: (v) => kills.push(v),
    });

    for (let i = 1; i <= 5; i++) detector.observe({ text: `[bash] same`, line: i });
    await detector.flush();

    expect(kills).toHaveLength(1);
  });

  it("treats an unparseable supervisor answer as normal (never a kill)", async () => {
    const kills: unknown[] = [];
    const judge: LoopJudge = async () => "I think the agent is looping but I ramble";
    const { detector, logPath } = makeDetector(judge, { onKill: (v) => kills.push(v) });

    for (let i = 1; i <= 5; i++) detector.observe({ text: `[bash] same`, line: i });
    await detector.flush();

    expect(kills).toHaveLength(0);
    const lines = (await readFile(logPath, "utf-8")).trim().split("\n");
    const record = JSON.parse(lines[0]);
    expect(record.verdict).toBeNull();
    expect(record.killed).toBe(false);
  });

  it("treats a supervisor transport failure as normal (never a kill)", async () => {
    const kills: unknown[] = [];
    const judge: LoopJudge = async () => null; // failure after retry
    const { detector, logPath } = makeDetector(judge, { onKill: (v) => kills.push(v) });

    for (let i = 1; i <= 5; i++) detector.observe({ text: `[bash] same`, line: i });
    await detector.flush();

    expect(kills).toHaveLength(0);
    const lines = (await readFile(logPath, "utf-8")).trim().split("\n");
    const record = JSON.parse(lines[0]);
    expect(record.verdict).toBeNull();
    expect(record.answer).toBeNull();
    expect(record.killed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sample collection: one loop-detect.jsonl line per judgment
// ---------------------------------------------------------------------------
describe("LoopDetector sample collection", () => {
  it("appends one jsonl line per judgment with identity, line refs, raw answer and verdict", async () => {
    let n = 0;
    const judge: LoopJudge = async () =>
      n++ === 0
        ? '{"loop": false, "confidence": 88, "reason": "healthy"}'
        : '{"loop": true, "confidence": 95, "reason": "stuck"}';
    const kills: unknown[] = [];
    const { detector, logPath } = makeDetector(judge, { onKill: (v) => kills.push(v) });

    for (let i = 1; i <= 10; i++) detector.observe({ text: `[bash] cmd-${i}`, line: 100 + i });
    await detector.flush();

    const lines = (await readFile(logPath, "utf-8")).trim().split("\n");
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0]);
    expect(first.model).toBe("model-alpha");
    expect(first.question).toBe("q-hello");
    expect(first.sessionId).toBe("t1");
    // The judged window as line-number references into session.jsonl —
    // never the turn content itself.
    expect(first.sessionLines).toEqual([101, 105]);
    expect(JSON.stringify(first)).not.toContain("cmd-1");
    expect(first.answer).toContain("healthy");
    expect(first.verdict).toEqual({ loop: false, confidence: 88, reason: "healthy" });
    expect(first.killed).toBe(false);

    const second = JSON.parse(lines[1]);
    expect(second.sessionLines).toEqual([101, 110]);
    expect(second.verdict).toEqual({ loop: true, confidence: 95, reason: "stuck" });
    expect(second.killed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveSupervisorEndpoint: models.json provider resolution
// ---------------------------------------------------------------------------
describe("resolveSupervisorEndpoint", () => {
  async function writeModelsJson(piHome: string, data: unknown): Promise<void> {
    await mkdir(piHome, { recursive: true });
    await writeFile(join(piHome, "models.json"), JSON.stringify(data), "utf-8");
  }

  it("resolves baseUrl and apiKey for a declared provider", async () => {
    const piHome = join(tempRoot, "pi-home-ok");
    await writeModelsJson(piHome, {
      providers: {
        ornith: {
          baseUrl: "http://localhost:8080/v1",
          apiKey: "sk-test",
          models: [{ id: "ai-01/ornith-1.0-35b-5" }],
        },
      },
    });

    const endpoint = await resolveSupervisorEndpoint(piHome, {
      provider: "ornith",
      modelId: "ai-01/ornith-1.0-35b-5",
      step: 5,
      confidenceThreshold: 80,
    });
    expect(endpoint.baseUrl).toBe("http://localhost:8080/v1");
    expect(endpoint.apiKey).toBe("sk-test");
    expect(endpoint.modelId).toBe("ai-01/ornith-1.0-35b-5");
  });

  it("refuses to start when the provider is missing from models.json", async () => {
    const piHome = join(tempRoot, "pi-home-missing");
    await writeModelsJson(piHome, { providers: {} });

    await expect(
      resolveSupervisorEndpoint(piHome, {
        provider: "ornith",
        modelId: "ai-01/ornith-1.0-35b-5",
        step: 5,
        confidenceThreshold: 80,
      })
    ).rejects.toThrow(/loop_detector.*ornith/i);
  });

  it("refuses to start when models.json itself is missing", async () => {
    const piHome = join(tempRoot, "pi-home-absent");
    await expect(
      resolveSupervisorEndpoint(piHome, {
        provider: "ornith",
        modelId: "ai-01/ornith-1.0-35b-5",
        step: 5,
        confidenceThreshold: 80,
      })
    ).rejects.toThrow(/loop_detector/i);
  });

  it("refuses to start when the provider declares no baseUrl", async () => {
    const piHome = join(tempRoot, "pi-home-nobase");
    await writeModelsJson(piHome, { providers: { ornith: { models: [] } } });

    await expect(
      resolveSupervisorEndpoint(piHome, {
        provider: "ornith",
        modelId: "ai-01/ornith-1.0-35b-5",
        step: 5,
        confidenceThreshold: 80,
      })
    ).rejects.toThrow(/baseUrl/i);
  });
});
