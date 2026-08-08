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
import type { RunJson } from "./run";
import type { Question } from "./question";

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

// ---------------------------------------------------------------------------
// Integration: loop detection through runInvocation and runMatrix
// ---------------------------------------------------------------------------

async function listDir(path: string): Promise<string[]> {
  const { readdir } = await import("node:fs/promises");
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

/**
 * A stub pi whose every invocation writes a live session file (1 header +
 * N assistant toolCall message lines with ids c1..cN) and emits the
 * matching message_end events on stdout, then optionally idles (so a kill
 * verdict can SIGKILL it mid-invocation). Extra session lines can be
 * appended per 1-based invocation (dirty signals, eval verdicts).
 */
async function createLoopStubPi(
  stubPath: string,
  options: {
    toolCallCount?: number;
    idleSeconds?: number;
    extraSessionLines?: Record<number, string[]>;
  } = {}
) {
  const count = options.toolCallCount ?? 12;
  const idle = options.idleSeconds ?? 0;
  const command = 'npx -y chrome-devtools-axi snapshot --full 2>&1 | grep "4_2"';
  const toolCall = (i: number) => ({
    type: "toolCall",
    id: `c${i}`,
    name: "bash",
    arguments: { command },
  });
  const assistantMsg = (i: number) => ({
    role: "assistant",
    content: [toolCall(i)],
  });
  // Precompute the lines in TS (bash-side quoting of JSON ids is brittle).
  const sessionLines = Array.from({ length: count }, (_, i) =>
    JSON.stringify({ type: "message", message: assistantMsg(i + 1) })
  );
  const eventLines = Array.from({ length: count }, (_, i) =>
    JSON.stringify({ type: "message_end", message: assistantMsg(i + 1) })
  );
  const extras = Object.entries(options.extraSessionLines ?? {})
    .map(
      ([n, lines]) =>
        `  ${n}) EXTRA=${JSON.stringify(lines.join("\n"))} ;;`
    )
    .join("\n");
  const script = `#!/usr/bin/env bash
COUNT=$(cat .stub-count 2>/dev/null || echo 0)
COUNT=$((COUNT+1))
echo "$COUNT" > .stub-count
SESSION_DIR=""
SESSION_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session-dir) SESSION_DIR="$2"; shift 2 ;;
    --session-id) SESSION_ID="$2"; shift 2 ;;
    *) shift ;;
  esac
done
SESSION_DIR="\${SESSION_DIR:-.}"
EXTRA=""
case "$COUNT" in
${extras}
esac
{
  echo '{"type":"session","id":"live"}'
${sessionLines.map((l) => `  echo '${l}'`).join("\n")}
  if [ -n "$EXTRA" ]; then printf '%s\\n' "$EXTRA"; fi
} > "$SESSION_DIR/\${SESSION_ID:-session}_session.jsonl"
${eventLines.map((l) => `echo '${l}'`).join("\n")}
echo '<!DOCTYPE html><html></html>' > index.html
echo 'body {}' > style.css
echo 'console.log("hi");' > script.js
${idle > 0 ? `if [[ "$SESSION_ID" == t* ]]; then sleep ${idle}; fi` : ""}
exit 0
`;
  const { chmod } = await import("node:fs/promises");
  await writeFile(stubPath, script, "utf-8");
  await chmod(stubPath, 0o755);
}

/** Fixture: one model, a 3-ticket question, an optional second question,
 * and a config.toml with (or without) the [loop_detector] section. */
async function writeLoopFixtures(
  repoDir: string,
  options: { ticketCount?: number; secondQuestion?: boolean; loopSection?: boolean } = {}
): Promise<{ configPath: string; questionDir: string; sessionRoot: string }> {
  const configPath = join(repoDir, "config.toml");
  const loopSection =
    options.loopSection === false
      ? ""
      : `\n[loop_detector]\nprovider = "ornith"\nmodelId = "ai-01/ornith-1.0-35b-5"\n`;
  await writeFile(
    configPath,
    `max_turns = 100\nrun_rules = ""\n${loopSection}\n[[models]]\nname = "model-alpha"\nprovider = "llamacpp-local"\nmodelId = "alpha.gguf"\n[models.params]\ntemp = 0.7\n`,
    "utf-8"
  );

  const questionDir = join(repoDir, "questions");
  const qDir = join(questionDir, "q-ticketed");
  await mkdir(qDir, { recursive: true });
  await writeFile(join(qDir, "intent.md"), "Build a multi-ticket project.", "utf-8");
  const ticketCount = options.ticketCount ?? 3;
  const ticketLines = Array.from(
    { length: ticketCount },
    (_, i) => `[ ]${i + 1}. Ticket number ${i + 1}\n  - subtask`
  ).join("\n");
  await writeFile(join(qDir, "tickets.md"), `# Tickets\n\n${ticketLines}\n`, "utf-8");

  if (options.secondQuestion) {
    const q2 = join(questionDir, "q-zznext");
    await mkdir(q2, { recursive: true });
    await writeFile(join(q2, "intent.md"), "Build a hello page.", "utf-8");
  }
  return { configPath, questionDir, sessionRoot: join(repoDir, "session") };
}

/** models.json declaring the ornith supervisor provider (unreachable
 * baseUrl — tests always inject a fake judge). */
async function writeSupervisorModelsJson(piHome: string): Promise<void> {
  await mkdir(piHome, { recursive: true });
  await writeFile(
    join(piHome, "models.json"),
    JSON.stringify({
      providers: {
        ornith: {
          baseUrl: "http://127.0.0.1:9/v1",
          apiKey: "test-key",
          models: [{ id: "ai-01/ornith-1.0-35b-5" }],
        },
      },
    }),
    "utf-8"
  );
}

async function readArchivedRunJson(sessionRoot: string, question = "q-ticketed"): Promise<{ runJson: RunJson; archiveDir: string }> {
  const dirs = await listDir(join(sessionRoot, question, "model-alpha"));
  expect(dirs).toHaveLength(1);
  const archiveDir = join(sessionRoot, question, "model-alpha", dirs[0]);
  const runJson = JSON.parse(
    await readFile(join(archiveDir, "run.json"), "utf-8")
  ) as RunJson;
  return { runJson, archiveDir };
}

describe("runMatrix loop detection", () => {
  it("kills a looping Combo early, archives it as a loop defect, and continues the Matrix", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(testRoot, "repo-loop-kill");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeLoopFixtures(
      repoDir,
      { ticketCount: 3, secondQuestion: true }
    );
    const piHome = join(testRoot, "pi-home-loop-kill");
    await writeSupervisorModelsJson(piHome);
    const stub = join(testRoot, "stub-loop-kill");
    await createLoopStubPi(stub, { idleSeconds: 30 });

    // Only the first judgment (Combo 1) returns a kill verdict; Combo 2's
    // windows are healthy, so the Matrix runs to completion there.
    let judgments = 0;
    const judge: JudgeFn = async () => {
      judgments++;
      return judgments === 1
        ? '{"loop": true, "confidence": 95, "reason": "10 identical snapshot commands"}'
        : '{"loop": false, "confidence": 5, "reason": "healthy progression"}';
    };

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: join(testRoot, "runs-loop-kill"),
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      loopJudge: judge,
    });

    expect(results).toHaveLength(2);
    expect(results[0].question.name).toBe("q-ticketed");
    expect(results[0].status).toBe("error");
    // The Matrix continued to the next Combo.
    expect(results[1].question.name).toBe("q-zznext");
    expect(results[1].status).toBe("ok");

    const { runJson, archiveDir } = await readArchivedRunJson(sessionRoot);
    expect(runJson.status).toBe("error");
    expect(runJson.loopDetected).toBe(true);
    expect(runJson.loopConfidence).toBe(95);
    expect(runJson.loopReason).toBe("10 identical snapshot commands");
    // Remaining tickets were skipped: only ticket 1's invocation ran.
    expect(runJson.invocations).toHaveLength(1);
    expect(runJson.invocations?.[0].ticket).toBe(1);
    expect(runJson.invocations?.[0].loopDetected).toBe(true);

    // loop-detect.jsonl sits next to session.jsonl, one line per judgment,
    // the window referenced by line numbers only.
    const samples = (await readFile(join(archiveDir, "loop-detect.jsonl"), "utf-8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(samples).toHaveLength(1);
    expect(samples[0].model).toBe("model-alpha");
    expect(samples[0].question).toBe("q-ticketed");
    expect(samples[0].invocation).toBe(1);
    expect(samples[0].ticket).toBe(1);
    expect(samples[0].killed).toBe(true);
    expect(samples[0].verdict).toEqual({
      loop: true,
      confidence: 95,
      reason: "10 identical snapshot commands",
    });
    expect(String(samples[0].answer)).toContain('"loop": true');
    const window = samples[0].window as { lines: number[] };
    expect(window.lines).toEqual(Array.from({ length: 10 }, (_, i) => i + 2));
    expect(JSON.stringify(window)).not.toContain("snapshot");

    // The references resolve into the archived session.jsonl.
    const sessionLines = (await readFile(join(archiveDir, "session.jsonl"), "utf-8"))
      .trim()
      .split("\n");
    window.lines.forEach((n, i) => {
      const obj = JSON.parse(sessionLines[n - 1]) as {
        message: { content: Array<{ id: string }> };
      };
      expect(obj.message.content[0].id).toBe(`c${i + 1}`);
    });
  });

  it("runs the Combo to completion when confidence stays below the threshold", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(testRoot, "repo-loop-below");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeLoopFixtures(
      repoDir,
      { ticketCount: 3 }
    );
    const piHome = join(testRoot, "pi-home-loop-below");
    await writeSupervisorModelsJson(piHome);
    const stub = join(testRoot, "stub-loop-below");
    await createLoopStubPi(stub);

    const judge: JudgeFn = async () =>
      '{"loop": true, "confidence": 50, "reason": "borderline repetition"}';

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: join(testRoot, "runs-loop-below"),
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      loopJudge: judge,
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("ok");

    const { runJson, archiveDir } = await readArchivedRunJson(sessionRoot);
    expect(runJson.status).toBe("ok");
    expect(runJson.loopDetected).toBe(false);
    expect(runJson.loopConfidence).toBeUndefined();
    // All three tickets ran; no evaluation arbitration was triggered.
    expect(runJson.invocations).toHaveLength(3);

    // One judgment per invocation (12 calls, default step 5 → judge at 10).
    const samples = (await readFile(join(archiveDir, "loop-detect.jsonl"), "utf-8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(samples).toHaveLength(3);
    for (const s of samples) expect(s.killed).toBe(false);
    // Each segment is 13 lines (1 header + 12 messages), so invocation 2's
    // window lands at lines 15-24 of the concatenated session.jsonl.
    expect(samples[1].invocation).toBe(2);
    expect(samples[1].ticket).toBe(2);
    expect(samples[1].window).toEqual({
      lines: Array.from({ length: 10 }, (_, i) => 13 + i + 2),
    });
  });

  it("treats unparseable answers and supervisor failures as normal", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(testRoot, "repo-loop-flaky");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeLoopFixtures(
      repoDir,
      { ticketCount: 3 }
    );
    const piHome = join(testRoot, "pi-home-loop-flaky");
    await writeSupervisorModelsJson(piHome);
    const stub = join(testRoot, "stub-loop-flaky");
    await createLoopStubPi(stub);

    const answers: (string | null)[] = [
      "Let me analyze these 10 tool calls carefully. Turn 1: ...",
      null,
      '{"loop": false, "confidence": 10, "reason": "fine"}',
    ];
    let call = 0;
    const judge: JudgeFn = async () => answers[call++ % answers.length];

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: join(testRoot, "runs-loop-flaky"),
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      loopJudge: judge,
    });

    expect(results[0].status).toBe("ok");
    const { runJson, archiveDir } = await readArchivedRunJson(sessionRoot);
    expect(runJson.loopDetected).toBe(false);

    const samples = (await readFile(join(archiveDir, "loop-detect.jsonl"), "utf-8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(samples).toHaveLength(3);
    // Unparseable answer: recorded raw, verdict null, never a kill.
    expect(String(samples[0].answer)).toContain("Let me analyze");
    expect(samples[0].verdict).toBeNull();
    expect(samples[0].killed).toBe(false);
    // Transport failure: answer null with an error note, window skipped.
    expect(samples[1].answer).toBeNull();
    expect(typeof samples[1].error).toBe("string");
    expect(samples[1].killed).toBe(false);
    expect(samples[2].verdict).toEqual({
      loop: false,
      confidence: 10,
      reason: "fine",
    });
  });

  it("changes nothing when the [loop_detector] section is absent", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(testRoot, "repo-loop-off");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeLoopFixtures(
      repoDir,
      { ticketCount: 2, loopSection: false }
    );
    const piHome = join(testRoot, "pi-home-loop-off");
    await mkdir(piHome, { recursive: true });
    const stub = join(testRoot, "stub-loop-off");
    await createLoopStubPi(stub);

    let judgeCalls = 0;
    const judge: JudgeFn = async () => {
      judgeCalls++;
      return '{"loop": true, "confidence": 99, "reason": "should never be consulted"}';
    };

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: join(testRoot, "runs-loop-off"),
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      loopJudge: judge,
    });

    expect(results[0].status).toBe("ok");
    // Zero supervisor traffic, no sample log, no run.json marking.
    expect(judgeCalls).toBe(0);
    const { runJson, archiveDir } = await readArchivedRunJson(sessionRoot);
    expect("loopDetected" in runJson).toBe(false);
    expect(await listDir(archiveDir)).not.toContain("loop-detect.jsonl");
  });

  it("refuses to start the Matrix when the supervisor provider is missing from models.json", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(testRoot, "repo-loop-noprovider");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeLoopFixtures(
      repoDir,
      { ticketCount: 2 }
    );
    const piHome = join(testRoot, "pi-home-loop-noprovider");
    await mkdir(piHome, { recursive: true });
    await writeFile(
      join(piHome, "models.json"),
      JSON.stringify({ providers: {} }),
      "utf-8"
    );
    const stub = join(testRoot, "stub-loop-noprovider");
    await createLoopStubPi(stub);

    await expect(
      runMatrix({
        questionDir,
        configPath,
        sessionRoot,
        piBin: stub,
        piHome,
        tempRoot: join(testRoot, "runs-loop-noprovider"),
        piVersion: "test-1.0",
        maxTurns: 100,
        runRules: "",
        loopJudge: async () => null,
      })
    ).rejects.toThrow(/loop_detector.*ornith|ornith/);
    expect(await listDir(sessionRoot)).toHaveLength(0);
  });

  it("never monitors evaluation invocations", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(testRoot, "repo-loop-eval");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeLoopFixtures(
      repoDir,
      { ticketCount: 2 }
    );
    const piHome = join(testRoot, "pi-home-loop-eval");
    await writeSupervisorModelsJson(piHome);
    const stub = join(testRoot, "stub-loop-eval");
    // Ticket 1's session ends dirty (failed write tool result) → an
    // evaluation invocation arbitrates it (verdict COMPLETE). The eval
    // invocation emits the same 12 tool calls but must NOT be judged.
    await createLoopStubPi(stub, {
      extraSessionLines: {
        1: [
          '{"type":"message","message":{"role":"toolResult","toolCallId":"c9","toolName":"write","content":[{"type":"text","text":"boom"}],"isError":true}}',
        ],
        2: [
          '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"Judged. <verdict>COMPLETE</verdict>"}]}}',
        ],
      },
    });

    let judgeCalls = 0;
    const judge: JudgeFn = async () => {
      judgeCalls++;
      return '{"loop": false, "confidence": 10, "reason": "fine"}';
    };

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: join(testRoot, "runs-loop-eval"),
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      loopJudge: judge,
    });

    expect(results[0].status).toBe("ok");
    const { runJson } = await readArchivedRunJson(sessionRoot);
    // t1 (dirty) + t1-eval + t2: three invocations recorded...
    expect(runJson.invocations).toHaveLength(3);
    expect(runJson.invocations?.[0].ticket).toBe(1);
    expect(runJson.invocations?.[1].evaluation).toBe(true);
    expect(runJson.invocations?.[2].ticket).toBe(2);
    // ...but only the two WORK invocations produced judgments.
    expect(judgeCalls).toBe(2);
  });
});

describe("runInvocation loop monitoring", () => {
  function makeMockQuestion(name: string, dir: string): Question {
    return { name, dir, intent: "Build it.", hasSpec: false, hasTickets: false, tickets: [] };
  }

  it("SIGKILLs pi on a kill verdict and reports loopDetected", async () => {
    const { setupWorkdir, runInvocation } = await import("./pi-runner");
    const dir = await makeDir("inv-kill-q");
    const stub = join(testRoot, "stub-inv-kill");
    await createLoopStubPi(stub, { idleSeconds: 30 });
    const piHome = await makeDir("inv-kill-pihome");

    const setup = await setupWorkdir(makeMockQuestion("q-inv", dir), await makeDir("inv-kill-runs"));
    const detector = makeDetector({
      dir: setup.sessionDir,
      judge: async () => '{"loop": true, "confidence": 95, "reason": "same command repeated"}',
    });

    const result = await runInvocation({
      prompt: "Build it",
      workdir: setup.workdir,
      sessionDir: setup.sessionDir,
      sessionId: "t1",
      extraArgs: setup.extraArgs,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stub,
      piHome,
      maxTurns: 100,
      loop: { detector, invocationIndex: 1, sessionLineOffset: 0 },
    });
    await detector.close();

    expect(result.loopDetected).toBe(true);
    expect(result.loopConfidence).toBe(95);
    expect(result.loopReason).toBe("same command repeated");
    expect(result.exitCode).toBeNull();
  });

  it("does not kill when the verdict stays below the threshold", async () => {
    const { setupWorkdir, runInvocation } = await import("./pi-runner");
    const dir = await makeDir("inv-nokill-q");
    const stub = join(testRoot, "stub-inv-nokill");
    await createLoopStubPi(stub);
    const piHome = await makeDir("inv-nokill-pihome");

    const setup = await setupWorkdir(makeMockQuestion("q-inv", dir), await makeDir("inv-nokill-runs"));
    const detector = makeDetector({
      dir: setup.sessionDir,
      judge: async () => '{"loop": true, "confidence": 40, "reason": "borderline"}',
    });

    const result = await runInvocation({
      prompt: "Build it",
      workdir: setup.workdir,
      sessionDir: setup.sessionDir,
      sessionId: "t1",
      extraArgs: setup.extraArgs,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stub,
      piHome,
      maxTurns: 100,
      loop: { detector, invocationIndex: 1, sessionLineOffset: 0 },
    });
    await detector.close();

    expect(result.loopDetected).toBe(false);
    expect(result.exitCode).toBe(0);
  });
});
