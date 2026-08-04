import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runLog } from "./run-log";

/**
 * Loop detection: an asynchronous supervisor (Ornith) judges sliding windows
 * of the interviewed model's tool calls and kills the Combo when the agent
 * has fallen into a non-productive repetition loop. A TypeScript port of
 * the judging logic validated in tmp/loop-detect/run_test.py (prompt v10,
 * integrated verbatim from loop-detector-prompt.txt).
 *
 * Design rules (issue #21):
 * - Judging NEVER blocks the Pi Invocation: windows are judged in the
 *   background; a kill verdict SIGKILLs pi through the onKill callback.
 * - Supervisor failure modes (transport error, timeout, unparseable answer)
 *   are always treated as NORMAL: logged, sampled, never a kill.
 * - Every judgment appends one line to loop-detect.jsonl next to the Run's
 *   session.jsonl, referencing the judged window by line numbers only
 *   (never content) so a later audit can resolve them against the archive.
 */

const log = (msg: string) => {
  runLog(`[loop-detect] ${msg}`);
};

/**
 * Sample log file name (next to the Run's session files). pi-runner must
 * exclude it when discovering an invocation's new session JSONL.
 */
export const LOOP_SAMPLE_LOG_NAME = "loop-detect.jsonl";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The [loop_detector] section of config.toml (defaults applied). */
export interface LoopDetectorConfig {
  /** Provider name in <piHome>/models.json. */
  provider: string;
  /** Supervisor model id within that provider. */
  modelId: string;
  /** Judge every `step` new tool calls (default 5; > 10 = spot check). */
  step: number;
  /** Minimum confidence for a kill (default 80). */
  confidenceThreshold: number;
}

/** Supervisor endpoint resolved from <piHome>/models.json. */
export interface SupervisorEndpoint {
  /** OpenAI-compatible chat completions URL. */
  url: string;
  /** Bearer token, or null when the provider declares none. */
  apiKey: string | null;
  /** Model id sent in the request body. */
  model: string;
}

/**
 * One window entry: the tool calls of a single assistant message, formatted
 * as `[toolname] arguments` lines joined with " || " (samples.json style).
 */
export interface ToolCallEntry {
  formatted: string;
  /** toolCall item ids — used to resolve session.jsonl line references. */
  toolCallIds: string[];
}

/** Parsed supervisor verdict; confidence/reason are null when absent. */
export interface LoopVerdict {
  loop: boolean;
  confidence: number | null;
  reason: string | null;
}

/**
 * The judging seam: maps a window of formatted tool calls to the raw
 * supervisor answer. Returns null on transport failure (the window is
 * skipped). Injectable — NODE_ENV=test suppresses the real HTTP judge.
 */
export type JudgeFn = (window: string[]) => Promise<string | null>;

/** Information carried by a kill verdict. */
export interface LoopKillInfo {
  confidence: number;
  reason: string | null;
}

/**
 * Per-invocation handle feeding the detector. Created by beginInvocation;
 * detach() when the invocation ends so late verdicts cannot kill a
 * process that already exited.
 */
export interface InvocationLoopMonitor {
  observeToolCall(entry: ToolCallEntry): void;
  detach(): void;
}

/** Per-invocation context the detector needs from the caller (pi-runner). */
export interface LoopInvocationContext {
  /** 1-based invocation index in execution order (= segment index in the
   * concatenated session.jsonl). */
  invocationIndex: number;
  /** 1-based ticket index (per-ticket Questions only). */
  ticket?: number;
  /** Total line count of the prior invocations' segments in the final
   * concatenated session.jsonl — line references add this offset. */
  sessionLineOffset: number;
  /** Locate the invocation's live session file (written by pi), or null. */
  resolveSessionFile: () => Promise<string | null>;
  /** Kill switch: SIGKILL pi and abort the whole Combo. */
  onKill: (info: LoopKillInfo) => void;
}

/** One line of loop-detect.jsonl (see issue #21, decision 6). */
interface LoopSampleLine {
  model: string;
  question: string;
  invocation: number;
  ticket?: number;
  /** 1-based line references into the Run's session.jsonl (null when a
   * tool call could not be resolved); never the turn content itself. */
  window: { lines: (number | null)[] };
  /** Raw supervisor answer (null on transport failure). */
  answer: string | null;
  verdict: LoopVerdict | null;
  /** Transport-failure note (window skipped). */
  error?: string;
  /** True when this judgment triggered the kill. */
  killed: boolean;
  judgedAt: string;
}

// ---------------------------------------------------------------------------
// Extractor formatting ([toolname] arguments, matching samples.json)
// ---------------------------------------------------------------------------

/** Formatted calls are truncated at ~500 characters (fixed policy). */
const MAX_CALL_CHARS = 500;

/**
 * Cut s to MAX_CALL_CHARS, marking the dropped remainder as `…[+N]`
 * (the truncation style used by the experiment's samples).
 */
function truncateCall(s: string): string {
  if (s.length <= MAX_CALL_CHARS) return s;
  let dropped = s.length - MAX_CALL_CHARS;
  for (;;) {
    const marker = `…[+${dropped}]`;
    const kept = MAX_CALL_CHARS - marker.length;
    const next = s.length - kept;
    if (next === dropped) return s.slice(0, kept) + marker;
    dropped = next;
  }
}

/** Python-repr-style string escaping (the experiment extractor was Python). */
function pyStr(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Format one tool call as `[toolname] arguments`, matching the samples in
 * tmp/loop-detect/samples.json: bash → command, read → path, write →
 * dict-style repr, edit → path plus `<old -> new>` diffs, anything else →
 * JSON arguments. Truncated at ~500 characters.
 */
export function formatToolCall(
  name: string,
  args: Record<string, unknown> | undefined
): string {
  const a = args ?? {};
  let body: string;
  switch (name) {
    case "bash":
      body = String(a.command ?? "");
      break;
    case "read":
      body = String(a.path ?? "");
      break;
    case "write":
      body = `{'path': '${pyStr(a.path)}', 'content': '${pyStr(a.content)}'}`;
      break;
    case "edit": {
      const edits = Array.isArray(a.edits)
        ? (a.edits as Array<Record<string, unknown>>)
        : [];
      body =
        String(a.path ?? "") +
        edits
          .map((e) => ` || <${String(e.oldText ?? "")} -> ${String(e.newText ?? "")}>`)
          .join("");
      break;
    }
    default:
      body = JSON.stringify(a);
  }
  return truncateCall(`[${name}] ${body}`);
}

/**
 * Format the toolCall content items of one assistant message as a single
 * window entry (multiple calls joined with " || ", samples.json style).
 */
export function formatToolCallEntry(
  items: Array<{ id?: unknown; name?: unknown; arguments?: unknown }>
): ToolCallEntry {
  const parts: string[] = [];
  const ids: string[] = [];
  for (const item of items) {
    parts.push(
      formatToolCall(
        String(item?.name ?? "unknown"),
        item?.arguments as Record<string, unknown> | undefined
      )
    );
    if (typeof item?.id === "string") ids.push(item.id);
  }
  return { formatted: parts.join(" || "), toolCallIds: ids };
}

// ---------------------------------------------------------------------------
// Verdict parsing (tolerates ```json fences — 11/17 baseline answers were
// fenced — and surrounding prose)
// ---------------------------------------------------------------------------

/**
 * Parse the supervisor's answer into a verdict. Returns null when no
 * parseable JSON object with a boolean "loop" field is found — an
 * unparseable answer is always treated as NORMAL (never a kill).
 */
export function parseLoopVerdict(answer: string): LoopVerdict | null {
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates = [fenced?.[1], answer];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const m = candidate.match(/\{[\s\S]*"loop"[\s\S]*\}/);
    if (!m) continue;
    try {
      const obj = JSON.parse(m[0]) as Record<string, unknown>;
      if (typeof obj.loop !== "boolean") continue;
      return {
        loop: obj.loop,
        confidence:
          typeof obj.confidence === "number" ? obj.confidence : null,
        reason: typeof obj.reason === "string" ? obj.reason : null,
      };
    } catch {
      continue;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Supervisor endpoint resolution (<piHome>/models.json)
// ---------------------------------------------------------------------------

/**
 * Resolve the supervisor's chat-completions endpoint from the same
 * models.json assertModelsAvailable reads. Refuses to start the Matrix
 * (throws) when the configured provider is not declared there — a typo
 * would otherwise silently disable loop detection for the whole Matrix.
 */
export async function resolveSupervisor(
  piHome: string,
  config: LoopDetectorConfig
): Promise<SupervisorEndpoint> {
  const modelsJsonPath = join(piHome, "models.json");
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await readFile(modelsJsonPath, "utf-8")) as Record<
      string,
      unknown
    >;
  } catch {
    throw new Error(
      `[loop_detector] provider "${config.provider}" must be declared in ${modelsJsonPath} (baseUrl/apiKey) — add it or remove the [loop_detector] section`
    );
  }
  const providers = (data.providers ?? {}) as Record<string, unknown>;
  const entry = providers[config.provider] as
    | Record<string, unknown>
    | undefined;
  if (!entry || typeof entry.baseUrl !== "string" || !entry.baseUrl.trim()) {
    throw new Error(
      `[loop_detector] provider "${config.provider}" not found in ${modelsJsonPath} (or has no baseUrl) — add it or remove the [loop_detector] section`
    );
  }
  return {
    url: `${entry.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    apiKey: typeof entry.apiKey === "string" ? entry.apiKey : null,
    model: config.modelId,
  };
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

/** Window size: judgments always cover the last 10 tool calls. */
const WINDOW_SIZE = 10;

/** Cached read of the verbatim v10 prompt (colocated with this module). */
let promptCache: Promise<string> | null = null;
function loadPrompt(): Promise<string> {
  promptCache ??= readFile(
    join(__dirname, "loop-detector-prompt.txt"),
    "utf-8"
  );
  return promptCache;
}

/**
 * Combo-scoped loop detector. Receives tool calls observed live from pi's
 * stdout event stream (one InvocationLoopMonitor per work invocation),
 * judges sliding windows in the background, appends one sample line per
 * judgment, and fires onKill on the first kill-gate verdict.
 */
export class LoopDetector {
  /** True once a kill verdict fired — the Combo is being aborted. */
  killed = false;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly options: {
      config: LoopDetectorConfig;
      supervisor: SupervisorEndpoint;
      /** Combo identity recorded in every sample line. */
      combo: { model: string; question: string };
      /** loop-detect.jsonl path (next to the Run's session files). */
      sampleLogPath: string;
      /** Judging seam; defaults to the real HTTP supervisor judge. */
      judge?: JudgeFn;
    }
  ) {}

  /** Start monitoring one work invocation. */
  beginInvocation(ctx: LoopInvocationContext): InvocationLoopMonitor {
    const entries: ToolCallEntry[] = [];
    let total = 0;
    let nextJudgmentAt = WINDOW_SIZE;
    let detached = false;
    return {
      observeToolCall: (entry) => {
        if (detached || this.killed) return;
        entries.push(entry);
        total++;
        if (total >= nextJudgmentAt) {
          // Spot check when step > window: the next window starts after
          // `step` new calls, leaving gaps between windows by design.
          nextJudgmentAt = total + this.options.config.step;
          const window = entries.slice(-WINDOW_SIZE);
          const p = this.judgeWindow(ctx, () => detached, window)
            .catch((err) => log(`judgment failed: ${err}`))
            .finally(() => this.inFlight.delete(p));
          this.inFlight.add(p);
        }
      },
      detach: () => {
        detached = true;
      },
    };
  }

  /**
   * Settle when every in-flight judgment (and its sample-line append) has
   * finished. Called by the Combo AFTER its invocations have ended — the
   * Pi Invocation itself is never blocked by judging.
   */
  async close(): Promise<void> {
    await Promise.all([...this.inFlight]);
  }

  // --- internal -----------------------------------------------------------

  private async judgeWindow(
    ctx: LoopInvocationContext,
    isDetached: () => boolean,
    window: ToolCallEntry[]
  ): Promise<void> {
    const judge = this.options.judge ?? this.httpJudge.bind(this);
    let answer: string | null;
    let error: string | undefined;
    try {
      answer = await judge(window.map((w) => w.formatted));
    } catch (err) {
      answer = null;
      error = String(err);
    }
    if (answer === null && error === undefined) {
      error = "supervisor unreachable — window skipped";
    }
    const verdict = answer !== null ? parseLoopVerdict(answer) : null;
    const lines = await this.resolveWindowLines(ctx, window);

    // Kill gate: a single loop:true with confidence >= threshold kills.
    const kill =
      !this.killed &&
      verdict?.loop === true &&
      (verdict.confidence ?? 0) >= this.options.config.confidenceThreshold;

    const sample: LoopSampleLine = {
      model: this.options.combo.model,
      question: this.options.combo.question,
      invocation: ctx.invocationIndex,
      ticket: ctx.ticket,
      window: { lines },
      answer,
      verdict,
      error,
      killed: kill,
      judgedAt: new Date().toISOString(),
    };
    await this.appendSample(sample);

    if (kill) {
      this.killed = true;
      log(
        `loop detected (confidence ${verdict?.confidence}): ${verdict?.reason ?? "no reason given"}`
      );
      // A late verdict must not kill a process that already exited.
      if (!isDetached()) {
        ctx.onKill({ confidence: verdict!.confidence!, reason: verdict!.reason });
      }
    }
  }

  /**
   * Resolve each window entry to its 1-based line number in the Run's
   * session.jsonl: scan the invocation's live session file for the line
   * whose message carries the observed toolCall id, then add the offset of
   * the prior invocations' segments. Unresolvable entries record null.
   */
  private async resolveWindowLines(
    ctx: LoopInvocationContext,
    window: ToolCallEntry[]
  ): Promise<(number | null)[]> {
    const unresolved = window.map(() => null);
    const file = await ctx.resolveSessionFile();
    if (!file) return unresolved;
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      return unresolved;
    }
    const wanted = new Set(window.flatMap((w) => w.toolCallIds));
    if (wanted.size === 0) return unresolved;

    const idToLine = new Map<string, number>();
    const fileLines = content.split("\n");
    for (let i = 0; i < fileLines.length; i++) {
      const line = fileLines[i];
      if (!line.includes('"toolCall"')) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      const msg = obj.message as Record<string, unknown> | undefined;
      if (!msg || !Array.isArray(msg.content)) continue;
      for (const item of msg.content as Array<Record<string, unknown>>) {
        const id = item?.id;
        if (
          item?.type === "toolCall" &&
          typeof id === "string" &&
          wanted.has(id) &&
          !idToLine.has(id)
        ) {
          idToLine.set(id, i + 1);
        }
      }
    }
    return window.map((w) => {
      for (const id of w.toolCallIds) {
        const line = idToLine.get(id);
        if (line !== undefined) return ctx.sessionLineOffset + line;
      }
      return null;
    });
  }

  /** Append one sample line; failures are logged, never fatal. */
  private async appendSample(sample: LoopSampleLine): Promise<void> {
    try {
      await appendFile(
        this.options.sampleLogPath,
        JSON.stringify(sample) + "\n",
        "utf-8"
      );
    } catch (err) {
      log(`failed to append to loop-detect.jsonl: ${err}`);
    }
  }

  /**
   * The real supervisor judge (port of run_test.py): one chat-completions
   * call, temperature 0.0, max_tokens 800, one retry on transport failure,
   * then the window is skipped (null). Suppressed under NODE_ENV=test —
   * tests inject a fake judge instead of hitting the network.
   */
  private async httpJudge(window: string[]): Promise<string | null> {
    if (process.env.NODE_ENV === "test") {
      log("NODE_ENV=test: real supervisor HTTP suppressed — window skipped");
      return null;
    }
    const prompt = await loadPrompt();
    const turnsBlock = window
      .map((t, i) => `[turn ${i + 1}] ${t}`)
      .join("\n");
    const userMsg = `Here are 10 consecutive tool calls from an AI coding agent session:\n\n${turnsBlock}\n\nAnalyze the actions above.`;
    const body = {
      model: this.options.supervisor.model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: userMsg },
      ],
      temperature: 0.0,
      max_tokens: 800,
    };
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.options.supervisor.apiKey) {
      headers.Authorization = `Bearer ${this.options.supervisor.apiKey}`;
    }
    // One retry on transport failure (two attempts total), then skip.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const resp = await fetch(this.options.supervisor.url, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(240_000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as Record<string, unknown>;
        const choices = data.choices as
          | Array<{ message?: { content?: unknown } }>
          | undefined;
        return String(choices?.[0]?.message?.content ?? "");
      } catch (err) {
        log(`supervisor attempt ${attempt} failed: ${err}`);
      }
    }
    return null;
  }
}
