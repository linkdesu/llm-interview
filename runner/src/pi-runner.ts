import { spawn } from "node:child_process";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rename,
  copyFile,
  stat,
  symlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { runLog } from "./run-log";
import type { Question } from "./question";

// runLog side only: the console channel is the compact progress view in
// run.ts (driven by the onTurn/onApiRetry callbacks below), so pi-runner
// itself no longer writes to the console at all.
const log = (msg: string) => {
  runLog(`[pi] ${msg}`);
};

/**
 * Per-invocation mutable state. Local to runInvocation (never module
 * scope): under Concurrency several invocations run side by side in one
 * process, and shared counters would leak turns, kills, and terminal API
 * failures across Combos.
 */
interface InvocationState {
  turnCount: number;
  maxTurnsExceeded: boolean;
  killedForMaxTurns: boolean;
  maxTurns: number;
  /**
   * Terminal API failure observed in the event stream (final auto-retry
   * failure). Null when the invocation had no fatal API error.
   */
  apiFailure: string | null;
}

/**
 * Shrink one stdout event line for the on-disk log. Streaming delta events
 * (`message_update` with a `*_delta` assistant event) carry two cumulative
 * snapshots — the top-level `message` and `assistantMessageEvent.partial` —
 * which grow quadratically when a large write/edit argument streams in
 * (observed: 181MB for one invocation, 99.9% of it these snapshots). Keep
 * only the delta itself; the full message is available in `message_end`.
 * `tool_execution_update.partialResult` is cumulative too, so it is dropped
 * as well (the final result lands in `tool_execution_end`). All other lines
 * pass through untouched.
 */
function filterLogLine(line: string): string {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return line;
  }
  if (event.type === "message_update") {
    const ev = event.assistantMessageEvent as Record<string, unknown> | undefined;
    if (ev && typeof ev.type === "string" && ev.type.endsWith("_delta")) {
      return JSON.stringify({
        type: "message_update",
        assistantMessageEvent: {
          type: ev.type,
          contentIndex: ev.contentIndex,
          delta: ev.delta,
        },
      });
    }
    return line;
  }
  if (event.type === "tool_execution_update") {
    const rest = { ...event };
    delete rest.partialResult;
    return JSON.stringify(rest);
  }
  return line;
}

/**
 * Process one stdout event line: track turns, detect terminal API
 * failures, and forward progress events to the caller's callbacks. The
 * full agent stream itself is deliberately NOT rendered to the console
 * (the compact progress view in run.ts replaced it) — it remains
 * available per invocation in the pi-output log and its archive.
 */
function processJsonEvent(
  line: string,
  options: InvocationOptions,
  state: InvocationState
): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  const t = event.type as string;

  // --- Turn lifecycle ---
  if (t === "turn_start") {
    state.turnCount++;
    if (state.turnCount > state.maxTurns) {
      state.maxTurnsExceeded = true;
    }
    return;
  }
  if (t === "turn_end") {
    options.onTurn?.(state.turnCount);
    return;
  }

  // --- Auto-retry ---
  if (t === "auto_retry_start") {
    options.onApiRetry?.({
      attempt: Number(event.attempt ?? 1),
      maxAttempts: Number(event.maxAttempts ?? 3),
      errorMessage: String(event.errorMessage ?? ""),
    });
    return;
  }
  if (t === "auto_retry_end") {
    if (event.success !== true) {
      // Final retry failure: pi gives up on the request but still exits 0,
      // so this is the runner's only reliable terminal-failure signal.
      state.apiFailure = String(event.finalError ?? "unknown API error");
    }
    return;
  }
}

/**
 * Shared pi execution environment: which binary, which config home,
 * where isolated workdirs live, and the internal-turn budget per invocation.
 */
export interface PiEnvironment {
  /** Absolute path to the pi executable (injectable for tests). */
  piBin: string;
  /** Absolute path for PI_CODING_AGENT_DIR environment variable. */
  piHome: string;
  /** Directory under which the isolated working directory is created. */
  tempRoot: string;
  /** Maximum assistant turns before the process is killed (per invocation). */
  maxTurns: number;
}

/**
 * An isolated workdir prepared for a run's invocations.
 */
export interface WorkdirSetup {
  /** Root directory of this run (removed after archiving). */
  runDir: string;
  /** Absolute path to the agent's isolated working directory (pi's cwd). */
  workdir: string;
  /**
   * Absolute path to the runner's bookkeeping directory (pi's --session-dir
   * and output logs). Kept OUTSIDE the agent's cwd: real runs showed agents
   * "cleaning up" *.jsonl/*.log files from their workdir so it matches the
   * three-file artifact contract — deleting the runner's transcripts.
   */
  sessionDir: string;
  /** Extra pi arguments prepared during setup (e.g. --skill). */
  extraArgs: string[];
}

/**
 * Link the chrome-devtools-axi skill into a workdir for HTML page testing.
 * Returns the extra pi arguments to use ([] when the skill is
 * unavailable). Idempotent: an already-linked workdir (adopted during a
 * resume) keeps its existing link.
 */
async function linkChromeDevToolsSkill(workdir: string): Promise<string[]> {
  const skillsDir = join(workdir, ".skills");
  const chromeDevToolsSkillSrc = join(homedir(), ".agents", "skills", "chrome-devtools-axi", "SKILL.md");
  const chromeDevToolsSkillDst = join(skillsDir, "chrome-devtools-axi", "SKILL.md");
  try {
    await mkdir(join(skillsDir, "chrome-devtools-axi"), { recursive: true });
    try {
      await symlink(chromeDevToolsSkillSrc, chromeDevToolsSkillDst);
    } catch (err) {
      // Already linked (adopted workdir) — keep the existing link.
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") throw err;
    }
    log(`linked chrome-devtools-axi skill`);
    return ["--skill", chromeDevToolsSkillDst];
  } catch {
    log(`chrome-devtools-axi skill not available, skipping`);
    return [];
  }
}

/**
 * Create an isolated working directory under tempRoot and prepare it:
 * copies spec.md / tickets.md from the question directory when present and
 * links the chrome-devtools-axi skill for HTML page verification.
 */
export async function setupWorkdir(
  question: Question,
  tempRoot: string
): Promise<WorkdirSetup> {
  const runDir = join(
    resolve(tempRoot),
    `pi-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  const workdir = join(runDir, "work");
  const sessionDir = join(runDir, "sessions");
  await mkdir(workdir, { recursive: true });
  await mkdir(sessionDir, { recursive: true });
  log(`created workdir: ${workdir}`);

  // Copy question files into the workdir if they exist
  if (question.hasSpec) {
    await copyFile(
      join(question.dir, "spec.md"),
      join(workdir, "spec.md")
    );
    log(`copied spec.md to workdir`);
  }
  if (question.hasTickets) {
    await copyFile(
      join(question.dir, "tickets.md"),
      join(workdir, "tickets.md")
    );
    log(`copied tickets.md to workdir`);
  }

  const extraArgs = await linkChromeDevToolsSkill(workdir);

  return { runDir, workdir, sessionDir, extraArgs };
}

/**
 * Adopt a surviving run dir from an interrupted Matrix (resume) instead of
 * creating a fresh one: keeps the workdir's files (the completed tickets'
 * work every later ticket builds on) and the session dir's transcripts
 * (the completed invocations' records that flow into the new archive).
 * Question files and the skill link are already inside from the original
 * setup. Returns null when the recorded dir is gone or lacks the expected
 * layout (temp cleanup, reboot) — the caller then degrades to a fresh
 * setup and a full re-run.
 */
export async function adoptWorkdir(
  runDir: string
): Promise<WorkdirSetup | null> {
  const workdir = join(runDir, "work");
  const sessionDir = join(runDir, "sessions");
  try {
    if (!(await stat(workdir)).isDirectory()) return null;
    if (!(await stat(sessionDir)).isDirectory()) return null;
  } catch {
    return null;
  }
  const extraArgs = await linkChromeDevToolsSkill(workdir);
  log(`adopted existing run dir: ${runDir}`);
  return { runDir, workdir, sessionDir, extraArgs };
}

/**
 * Options for a single pi invocation within a run.
 */
export interface InvocationOptions {
  /** The prompt to give to the agent. */
  prompt: string;
  /** The prepared isolated working directory (pi's cwd). */
  workdir: string;
  /**
   * Directory for pi's --session-dir and the captured output log. Outside
   * the agent's cwd so the agent cannot delete the runner's transcripts.
   */
  sessionDir: string;
  /**
   * Unique session id for this invocation (e.g. "session", "t1", "t1-eval").
   * The produced JSONL is normalized to <sessionId>.jsonl in the workdir.
   */
  sessionId: string;
  /** Extra pi arguments from workdir setup (e.g. --skill). */
  extraArgs: string[];
  /** Pi provider name (e.g., "llamacpp-local"). */
  provider: string;
  /** Model id within that provider. */
  modelId: string;
  /** Absolute path to the pi executable. */
  piBin: string;
  /** Absolute path for PI_CODING_AGENT_DIR environment variable. */
  piHome: string;
  /** Maximum assistant turns before the process is killed. */
  maxTurns: number;
  /**
   * Progress callback fired at each turn end with the count of completed
   * turns — the caller (run.ts) renders the compact console turn line.
   */
  onTurn?: (turnCount: number) => void;
  /**
   * Progress callback fired when pi starts auto-retrying a failed API
   * request — the caller renders the compact console warning line.
   */
  onApiRetry?: (retry: {
    attempt: number;
    maxAttempts: number;
    errorMessage: string;
  }) => void;
}

/**
 * Result of a single pi invocation.
 */
export interface InvocationResult {
  /** The session id that was invoked. */
  sessionId: string;
  /** Exit code of the pi process, or null if killed (e.g. max turns exceeded). */
  exitCode: number | null;
  /** True if the process was killed because it exceeded the max turn limit. */
  maxTurnsExceeded: boolean;
  /** Duration of the invocation in milliseconds. */
  durationMs: number;
  /**
   * Absolute path of the normalized <sessionId>.jsonl inside the workdir,
   * or null if pi produced no new JSONL session file.
   */
  sessionFile: string | null;
  /** Absolute path to the captured stdout+stderr log inside the workdir. */
  stdoutFile: string;
  /**
   * Terminal API failure (e.g. connection loss after all retries), or null.
   * pi exits 0 even when every request failed, so the runner must rely on
   * this signal — never on the exit code — to detect infrastructure failure.
   */
  apiError: string | null;
}

/**
 * Run one pi invocation in an already-prepared workdir:
 *
 * - Spawns piBin with the given prompt, model arguments, and --session-id.
 * - Captures stdout+stderr to pi-output-<sessionId>.log in the session dir.
 * - Kills the process if it exceeds maxTurns.
 * - Renames the invocation's new session JSONL file to <sessionId>.jsonl.
 */
export async function runInvocation(options: InvocationOptions): Promise<InvocationResult> {
  // Fresh per-invocation state (see InvocationState)
  const state: InvocationState = {
    turnCount: 0,
    maxTurnsExceeded: false,
    killedForMaxTurns: false,
    maxTurns: options.maxTurns,
    apiFailure: null,
  };

  const {
    prompt,
    workdir,
    sessionDir,
    sessionId,
    extraArgs,
    provider,
    modelId,
    piBin,
    piHome,
  } = options;

  // Snapshot existing session files so we can tell which one this
  // invocation produced.
  const beforeJsonl = new Set(
    (await readdir(sessionDir)).filter((f) => f.endsWith(".jsonl"))
  );

  // Path for capturing stdout+stderr
  const stdoutFile = join(sessionDir, `pi-output-${sessionId}.log`);

  // Build the pi command arguments
  const args: string[] = [
    "-p",
    "--mode",
    "json",
    "--no-extensions",
    "--no-skills",
    ...extraArgs,
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    `--model`,
    `${provider}/${modelId}`,
    `--session-dir`,
    sessionDir,
    `--session-id`,
    sessionId,
    prompt,
  ];

  // Spawn pi with the isolated workdir as cwd
  const env = {
    ...process.env,
    PI_CODING_AGENT_DIR: resolve(piHome),
  };

  const truncatedArgs = args.map((a) =>
    a.length > 120 ? a.slice(0, 120) + "..." : a
  );
  log(`spawning: ${piBin} ${truncatedArgs.join(" ")}`);

  const child = spawn(piBin, args, {
    cwd: workdir,
    env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  // Collect all output (stdout + stderr) into chunks for the log file.
  // pi's stderr is captured here only — it is no longer forwarded to the
  // console (compact progress view); the pi-output log keeps it verbatim.
  const chunks: Buffer[] = [];
  child.stderr.on("data", (d: Buffer) => chunks.push(d));

  // Parse JSONL events from stdout for turn tracking, terminal API failure
  // detection, and the caller's progress callbacks. The log file gets a
  // filtered copy: streaming deltas carry cumulative snapshots that bloat
  // the log quadratically (see filterLogLine).
  let lineBuffer = "";
  child.stdout.on("data", (d: Buffer) => {
    lineBuffer += d.toString("utf-8");
    const lines = lineBuffer.split("\n");
    // Keep the last (potentially partial) line in the buffer
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      chunks.push(Buffer.from(filterLogLine(line) + "\n"));
      processJsonEvent(line, options, state);
      if (state.maxTurnsExceeded && !state.killedForMaxTurns) {
        log(`max turns exceeded (${state.turnCount}), killing process`);
        state.killedForMaxTurns = true;
        child.kill("SIGKILL");
        break;
      }
    }
  });

  // Wait for the process to exit (the only kill switch is the max turn
  // limit enforced while parsing stdout events above)
  let exitCode: number | null = null;
  const startTime = Date.now();

  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => {
      exitCode = code;
      resolve();
    });
    child.on("error", (err) => {
      reject(err);
    });
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if (state.killedForMaxTurns) {
    log(`killed after ${elapsed}s: max turns (${state.maxTurns}) exceeded`);
  } else {
    log(`exited with code ${exitCode} (${elapsed}s)`);
  }

  // Write collected output to the log file (flushing any unterminated
  // trailing line from stdout first)
  if (lineBuffer.trim().length > 0) {
    chunks.push(Buffer.from(filterLogLine(lineBuffer) + "\n"));
  }
  await writeFile(stdoutFile, Buffer.concat(chunks));
  log(`wrote output log: ${stdoutFile}`);

  // Find the session JSONL this invocation produced and normalize its name
  let sessionFile: string | null = null;
  try {
    const entries = await readdir(sessionDir);
    const newJsonl = entries.filter(
      (f) => f.endsWith(".jsonl") && !beforeJsonl.has(f)
    );

    if (newJsonl.length >= 1) {
      // pi normally writes exactly one session file per invocation
      // (--session-dir + --session-id); if several appear, keep the newest.
      let newest = newJsonl[0];
      let newestMtime = 0;
      for (const f of newJsonl) {
        const mtime = (await stat(join(sessionDir, f))).mtimeMs;
        if (mtime >= newestMtime) {
          newest = f;
          newestMtime = mtime;
        }
      }
      const srcPath = join(sessionDir, newest);
      const dstPath = join(sessionDir, `${sessionId}.jsonl`);
      // Only rename if it's not already named <sessionId>.jsonl
      if (newest !== `${sessionId}.jsonl`) {
        await rename(srcPath, dstPath);
        log(`renamed ${newest} to ${sessionId}.jsonl`);
      }
      sessionFile = dstPath;
      log(`found session file: ${sessionFile}`);
    } else {
      log(`no new .jsonl files found in session dir`);
    }
  } catch (err) {
    log(`error finding session file: ${err}`);
  }

  const durationMs = Date.now() - startTime;

  // Backstop: if the event stream showed no terminal retry failure but the
  // transcript's last assistant message ended with stopReason "error", the
  // invocation still died from an API failure (e.g. auto-retry disabled).
  let apiError: string | null = state.apiFailure;
  if (!apiError && sessionFile && (await sessionEndedWithApiError(sessionFile))) {
    apiError = 'transcript ends with stopReason "error"';
  }

  return {
    sessionId,
    exitCode,
    maxTurnsExceeded: state.killedForMaxTurns,
    durationMs,
    sessionFile,
    stdoutFile,
    apiError,
  };
}

/**
 * Validate that every given model id exists in pi's models.json
 * (<piHome>/models.json) before any invocation runs. pi treats an unknown
 * model id as a "custom model" and runs it anyway — a typo in config.toml
 * would silently burn the whole matrix on a model that does not exist, so
 * the runner refuses to start instead.
 *
 * Validation is skipped when models.json is missing or unparseable (pi may
 * rely on built-in providers only; pi will report its own error), and for
 * providers not declared in models.json (built-in providers cannot be
 * validated offline).
 *
 * @throws Error listing the unknown ids and the available ids per provider.
 */
export async function assertModelsAvailable(
  piHome: string,
  models: Array<{ provider: string; modelId: string }>
): Promise<void> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(await readFile(join(piHome, "models.json"), "utf-8"));
  } catch {
    return; // no readable custom provider config — nothing to validate against
  }
  const providers = (data.providers ?? {}) as Record<string, unknown>;

  const problems: string[] = [];
  for (const m of models) {
    const entry = providers[m.provider] as Record<string, unknown> | undefined;
    if (!entry || !Array.isArray(entry.models)) continue; // built-in provider
    const ids = (entry.models as Array<Record<string, unknown>>).map((x) =>
      String(x.id ?? "")
    );
    if (!ids.includes(m.modelId)) {
      problems.push(
        `  model "${m.modelId}" not found for provider "${m.provider}". Available: ${ids.join(", ")}`
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `Unknown model id(s) — fix config.toml before running:\n${problems.join("\n")}`
    );
  }
}

/**
 * Tool names whose failures are treated as benign probing noise: read-only
 * operations (read, grep, glob, ls, ...). A failed read never makes an
 * invocation dirty. Failures of anything else — edit, write, bash, or an
 * unknown tool — count as write-operation failures, since they may mean an
 * intended change (or verification command) did not land.
 */
const READ_ONLY_TOOLS = new Set([
  "read",
  "grep",
  "glob",
  "ls",
  "find",
  "search",
]);

/**
 * Check whether a session transcript contains a failed WRITE-side tool
 * result (`isError: true` from edit/write/bash/unknown tools) — one of the
 * signals that mark an invocation dirty. Failures of read-only tools are
 * ignored: models probe paths all the time.
 */
export async function sessionHasWriteToolErrors(sessionFile: string): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(sessionFile, "utf-8");
  } catch {
    return false;
  }

  const isWriteSide = (toolName: unknown): boolean =>
    !READ_ONLY_TOOLS.has(String(toolName ?? "").toLowerCase());

  for (const line of content.split("\n")) {
    if (!line.includes("isError")) continue;
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== "message") continue;
    const msg = obj.message as Record<string, unknown> | undefined;
    if (!msg) continue;

    // pi's native format: role "toolResult" with isError + toolName on the message
    if (msg.isError === true && isWriteSide(msg.toolName)) {
      return true;
    }
    // Content-item format: toolResult items inside an assistant message
    if (Array.isArray(msg.content)) {
      for (const item of msg.content as Array<Record<string, unknown>>) {
        if (item.type === "toolResult" && item.isError === true) {
          // No tool name available on the item → conservatively write-side
          if (isWriteSide(item.toolName ?? msg.toolName)) return true;
        }
      }
    }
  }
  return false;
}

/**
 * Check whether a session transcript's LAST assistant message ended with
 * stopReason "error" — the signature of a terminal API failure (pi persists
 * one such message per failed request, including the final one). Only the
 * last message matters: earlier error messages may belong to retry attempts
 * that eventually succeeded.
 */
export async function sessionEndedWithApiError(sessionFile: string): Promise<boolean> {
  let content: string;
  try {
    content = await readFile(sessionFile, "utf-8");
  } catch {
    return false;
  }

  const lines = content.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const msg = obj.message as Record<string, unknown> | undefined;
    if (obj.type !== "message" || msg?.role !== "assistant") continue;
    return msg.stopReason === "error";
  }
  return false;
}

/**
 * Parse the verdict from an evaluation invocation's transcript: the last
 * `<verdict>COMPLETE</verdict>` / `<verdict>INCOMPLETE</verdict>` marker in
 * an assistant message. Returns null when no marker is present (the runner
 * treats an unparseable verdict as INCOMPLETE, conservatively).
 */
export async function parseVerdict(
  sessionFile: string
): Promise<"complete" | "incomplete" | null> {
  let content: string;
  try {
    content = await readFile(sessionFile, "utf-8");
  } catch {
    return null;
  }

  const lines = content.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const msg = obj.message as Record<string, unknown> | undefined;
    if (obj.type !== "message" || msg?.role !== "assistant" || !Array.isArray(msg.content)) {
      continue;
    }
    const text = (msg.content as Array<Record<string, unknown>>)
      .filter((item) => item.type === "text")
      .map((item) => String(item.text ?? ""))
      .join("\n");
    const m = text.match(/<verdict>\s*(COMPLETE|INCOMPLETE)\s*<\/verdict>/i);
    if (m) {
      return m[1].toLowerCase() === "complete" ? "complete" : "incomplete";
    }
  }
  return null;
}
