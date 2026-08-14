import { readFileSync } from "node:fs";
import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { runLog } from "./run-log";
import type { LoopDetectorConfig } from "./registry";

const log = (msg: string) => {
  runLog(`[loop-detector] ${msg}`);
};

/**
 * The validated v10 supervision prompt (tmp/loop-detect/loop-detect-prompt.txt),
 * integrated verbatim so production-collected judgments stay comparable with
 * the round10 baseline. Read from the colocated copy at module load; the copy
 * is byte-identical to the experiment file (refinement happens later from
 * production-collected samples, never by editing this copy in place).
 */
export const LOOP_DETECTOR_PROMPT: string = readFileSync(
  join(__dirname, "loop-detector-prompt.txt"),
  "utf-8"
);

/** A parsed supervisor verdict. */
export interface LoopVerdict {
  loop: boolean;
  confidence: number;
  reason: string;
}

/** Connection details for the supervisor model's OpenAI-compatible endpoint. */
export interface SupervisorEndpoint {
  baseUrl: string;
  apiKey?: string;
  modelId: string;
}

/**
 * The judge seam: given the formatted window, return the supervisor's raw
 * answer, or null on transport failure (after the single retry). Tests inject
 * a stub here; production uses createHttpJudge. A judge NEVER throws — every
 * failure mode resolves to null so a sick supervisor can never kill a Combo.
 */
export type LoopJudge = (window: string[]) => Promise<string | null>;

/** Fixed formatting policy: each formatted tool call is capped at 500 chars. */
const MAX_FORMATTED_CALL = 500;

/**
 * Format one observed tool call as `[toolname] arguments`, matching the
 * samples in tmp/loop-detect/samples.json: bash renders its command, read its
 * path, write its path plus content, edit its path plus `<old -> new>`, and
 * anything else falls back to compact JSON. Truncated at 500 characters
 * (fixed policy) so a single huge write payload cannot swamp the window.
 */
export function formatToolCall(name: string, args: unknown): string {
  let body: string;
  if (args !== null && typeof args === "object" && !Array.isArray(args)) {
    const a = args as Record<string, unknown>;
    if (typeof a.command === "string") {
      // bash
      body = a.command;
    } else if (typeof a.path === "string" && Array.isArray(a.edits)) {
      // edit: <old -> new> of the first edit block
      const first = (a.edits[0] ?? {}) as Record<string, unknown>;
      body = `${a.path} || <${String(first.oldText ?? "")} -> ${String(first.newText ?? "")}>`;
    } else if (typeof a.path === "string" && typeof a.content === "string") {
      // write
      body = `${a.path} || ${a.content}`;
    } else if (typeof a.path === "string") {
      // read and other single-path tools
      body = a.path;
    } else {
      body = JSON.stringify(a);
    }
  } else {
    body = String(args ?? "");
  }
  const text = `[${name}] ${body}`;
  return text.length > MAX_FORMATTED_CALL
    ? text.slice(0, MAX_FORMATTED_CALL)
    : text;
}

/**
 * Parse the supervisor's answer into a verdict. The prompt demands a bare
 * JSON object, but the baseline showed 11/17 answers wrapped in ```json
 * fences despite that — so fences and surrounding prose are tolerated.
 * Returns null when no object with a boolean "loop" field can be extracted
 * (treated as a supervisor failure: logged, never a kill).
 */
export function parseSupervisorAnswer(raw: string): LoopVerdict | null {
  const candidates: string[] = [raw.trim()];
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) candidates.push(fence[1].trim());
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (typeof obj.loop !== "boolean") continue;
    const confidence = Number(obj.confidence);
    return {
      loop: obj.loop,
      confidence: Number.isFinite(confidence) ? confidence : 0,
      reason: typeof obj.reason === "string" ? obj.reason : "",
    };
  }
  return null;
}

/**
 * Resolve the supervisor endpoint from <piHome>/models.json — the same file
 * assertModelsAvailable reads. Refuses to start the Matrix (throws) when the
 * configured provider is absent or declares no baseUrl: a loop_detector
 * section that cannot reach its supervisor is a config error, not a runtime
 * surprise.
 */
export async function resolveSupervisorEndpoint(
  piHome: string,
  config: LoopDetectorConfig
): Promise<SupervisorEndpoint> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await readFile(join(piHome, "models.json"), "utf-8"));
  } catch {
    throw new Error(
      `[loop_detector] cannot read ${join(piHome, "models.json")} — the supervisor provider "${config.provider}" must be declared there (baseUrl/apiKey)`
    );
  }
  const providers = (data.providers ?? {}) as Record<string, unknown>;
  const entry = providers[config.provider] as Record<string, unknown> | undefined;
  if (!entry) {
    throw new Error(
      `[loop_detector] provider "${config.provider}" not found in ${join(piHome, "models.json")} — declare it there or remove the [loop_detector] section from config.toml`
    );
  }
  const baseUrl = String(entry.baseUrl ?? "").trim();
  if (!baseUrl) {
    throw new Error(
      `[loop_detector] provider "${config.provider}" in models.json declares no baseUrl`
    );
  }
  const apiKey = String(entry.apiKey ?? "").trim();
  return {
    baseUrl,
    apiKey: apiKey || undefined,
    modelId: config.modelId,
  };
}

/** Supervisor request parameters, fixed by the experiment (v10). */
const SUPERVISOR_TEMPERATURE = 0.0;
const SUPERVISOR_MAX_TOKENS = 800;
/** Matches the reference runner's 240s read timeout. */
const SUPERVISOR_TIMEOUT_MS = 240_000;

/**
 * Build the production judge: one OpenAI-compatible /chat/completions call
 * per window, temperature 0.0, max_tokens 800, one retry on transport
 * failure, then the window is skipped (null). As a hard safety net the real
 * HTTP call is suppressed under NODE_ENV=test — tests inject their judge at
 * the LoopDetector seam instead.
 */
export function createHttpJudge(endpoint: SupervisorEndpoint): LoopJudge {
  return async (window: string[]): Promise<string | null> => {
    if (process.env.NODE_ENV === "test") {
      log(`NODE_ENV=test — skipping real supervisor call (window of ${window.length})`);
      return null;
    }
    const turnsBlock = window.map((t, i) => `[turn ${i + 1}] ${t}`).join("\n");
    const userMsg =
      "Here are 10 consecutive tool calls from an AI coding agent session:\n\n" +
      `${turnsBlock}\n\nAnalyze the actions above.`;
    const body = JSON.stringify({
      model: endpoint.modelId,
      messages: [
        { role: "system", content: LOOP_DETECTOR_PROMPT },
        { role: "user", content: userMsg },
      ],
      temperature: SUPERVISOR_TEMPERATURE,
      max_tokens: SUPERVISOR_MAX_TOKENS,
    });
    const url = `${endpoint.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (endpoint.apiKey) headers.Authorization = `Bearer ${endpoint.apiKey}`;

    // One retry on transport failure (two attempts total), then skip.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const resp = await fetch(url, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(SUPERVISOR_TIMEOUT_MS),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = (await resp.json()) as Record<string, unknown>;
        const choices = data.choices as Array<Record<string, unknown>> | undefined;
        const message = choices?.[0]?.message as Record<string, unknown> | undefined;
        const content = message?.content;
        if (typeof content !== "string") throw new Error("no message content");
        return content;
      } catch (err) {
        log(`supervisor call failed (attempt ${attempt}/2): ${err}`);
      }
    }
    return null;
  };
}

/** Identity recorded on every loop-detect.jsonl line. */
export interface LoopDetectorIdentity {
  /** Model registry name. */
  model: string;
  /** Question name. */
  question: string;
  /** Invocation session id (e.g. "t3") — the ticket/invocation index. */
  sessionId: string;
}

/** One tool call observed from the pi event stream. */
export interface ObservedToolCall {
  /** Formatted `[toolname] arguments`, already truncated. */
  text: string;
  /**
   * 1-based line reference into the invocation's session transcript (the
   * ordinal of the message that carried this call in the event stream).
   */
  line: number;
}

/** Sliding window size: the supervisor always judges the last 10 calls. */
const WINDOW_SIZE = 10;

/**
 * Observe tool calls from a work invocation's event stream, judge every
 * `step` new calls over a sliding window of the last 10, and fire onKill
 * once a verdict of loop:true with confidence >= confidenceThreshold lands.
 *
 * Judging is asynchronous and never blocks the invocation: observe() only
 * appends and schedules. Every judgment — kill or not — appends one line to
 * logPath (loop-detect.jsonl) for a later prompt-refinement audit. All
 * supervisor failure modes (API error, timeout, unparseable answer) are
 * logged and treated as normal: never a kill.
 */
export class LoopDetector {
  /**
   * Kill wiring, set by the invocation runner once the child process
   * exists. Called at most once, with the verdict that crossed the gate.
   */
  public onKill: (verdict: LoopVerdict) => void;

  private readonly step: number;
  private readonly confidenceThreshold: number;
  private readonly judge: LoopJudge;
  private readonly logPath: string;
  private readonly identity: LoopDetectorIdentity;
  private readonly calls: ObservedToolCall[] = [];
  private readonly pending: Promise<void>[] = [];
  /** Serializes sample-log appends so lines stay in judgment order. */
  private appendTail: Promise<void> = Promise.resolve();
  private _killVerdict: LoopVerdict | null = null;

  constructor(options: {
    step: number;
    confidenceThreshold: number;
    judge: LoopJudge;
    logPath: string;
    identity: LoopDetectorIdentity;
    onKill?: (verdict: LoopVerdict) => void;
  }) {
    this.step = options.step;
    this.confidenceThreshold = options.confidenceThreshold;
    this.judge = options.judge;
    this.logPath = options.logPath;
    this.identity = options.identity;
    this.onKill = options.onKill ?? (() => {});
  }

  /** The verdict that triggered the kill, or null while healthy. */
  get killVerdict(): LoopVerdict | null {
    return this._killVerdict;
  }

  /** Observe one tool call from the event stream. Never blocks. */
  observe(call: ObservedToolCall): void {
    this.calls.push(call);
    if (this.calls.length % this.step !== 0) return;
    const window = this.calls.slice(-WINDOW_SIZE);
    this.pending.push(this.judgeWindow(window));
  }

  /** Await every in-flight judgment (called after the invocation exits). */
  async flush(): Promise<void> {
    await Promise.all(this.pending);
  }

  private async judgeWindow(window: ObservedToolCall[]): Promise<void> {
    let answer: string | null = null;
    let verdict: LoopVerdict | null = null;
    try {
      answer = await this.judge(window.map((c) => c.text));
      if (answer !== null) verdict = parseSupervisorAnswer(answer);
    } catch (err) {
      // A judge must never throw (its contract), but stay conservative.
      log(`judge threw unexpectedly: ${err}`);
    }

    // The kill gate: a single loop:true verdict at or above the confidence
    // threshold kills the Combo. Every other outcome is normal.
    let killed = false;
    if (
      verdict !== null &&
      verdict.loop &&
      verdict.confidence >= this.confidenceThreshold &&
      this._killVerdict === null
    ) {
      this._killVerdict = verdict;
      killed = true;
    }

    const record = {
      model: this.identity.model,
      question: this.identity.question,
      sessionId: this.identity.sessionId,
      // Line-number references into the invocation's session transcript —
      // never the turn content itself, keeping this log small.
      sessionLines: [window[0].line, window[window.length - 1].line],
      answer,
      verdict,
      killed,
      judgedAt: new Date().toISOString(),
    };
    // Serialize appends: concurrent appendFile calls to the same path can
    // land out of order, scrambling the audit log's chronology.
    this.appendTail = this.appendTail
      .then(() =>
        appendFile(this.logPath, JSON.stringify(record) + "\n", "utf-8")
      )
      .catch((err) => log(`failed to append to ${this.logPath}: ${err}`));
    await this.appendTail;

    if (killed) {
      log(
        `loop detected in ${this.identity.question} × ${this.identity.model} ` +
          `(${this.identity.sessionId}), confidence ${verdict!.confidence}: ${verdict!.reason}`
      );
      this.onKill(verdict!);
    }
  }
}
