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
import type { Question } from "./question";

const log = (msg: string) => {
  if (process.env.NODE_ENV !== "test") console.error(`[pi] ${msg}`);
};

type Section = "idle" | "thinking" | "tool" | "response";
let aiSection: Section = "idle";
let aiStarted = false;
let turnCount = 0;
let maxTurnsExceeded = false;
let killedForMaxTurns = false;
let maxTurns = 100;
/**
 * Terminal API failure observed in the event stream (final auto-retry
 * failure). Null when the invocation had no fatal API error.
 */
let apiFailure: string | null = null;

const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[39m`;
const reset = "\x1b[0m";
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

function sectionHeader(label: string): void {
  process.stdout.write(`\n${dim("━".repeat(8))} ${bold(label)} ${dim("━".repeat(8))}\n`);
}

function aiSeparator(): void {
  if (!aiStarted) {
    aiStarted = true;
    process.stdout.write(`\n${dim("━".repeat(50))}\n`);
  }
}

function switchSection(section: Section): void {
  if (aiSection === section) return;
  aiSection = section;
  aiSeparator();
  const labels: Record<Section, string> = {
    idle: "",
    thinking: "Thinking",
    tool: "Tool Calls",
    response: "Response",
  };
  sectionHeader(labels[section]);
}

function formatArgs(toolName: string, args: unknown): string {
  if (!args || typeof args !== "object") return String(args ?? "");
  const a = args as Record<string, unknown>;
  switch (toolName) {
    case "read":
      return String(a.filePath ?? a.path ?? a.file ?? "");
    case "write":
    case "edit": {
      const path = a.filePath ?? a.path ?? a.file ?? "";
      const preview = toolName === "write"
        ? String(a.content ?? a.data ?? "").slice(0, 60).replace(/\n/g, "\\n")
        : String(a.oldString ?? "").slice(0, 60).replace(/\n/g, "\\n");
      return `${path}${preview ? "\n    " + preview + (String(a.content ?? "").length > 60 ? "..." : "") : ""}`;
    }
    case "bash":
      return String(a.command ?? "");
    case "grep":
      return `${a.pattern ?? ""}${a.path ? " in " + a.path : ""}`;
    default:
      return JSON.stringify(args).slice(0, 200);
  }
}

function renderJsonEvent(line: string): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  const t = event.type as string;

  // --- Assistant message events ---
  if (t === "message_update") {
    const ev = event.assistantMessageEvent as Record<string, unknown> | undefined;
    if (!ev || typeof ev !== "object") return;
    switch (ev.type) {
      case "thinking_delta":
        switchSection("thinking");
        process.stdout.write(String(ev.delta ?? ""));
        return;
      case "text_delta":
        switchSection("response");
        process.stdout.write(String(ev.delta ?? ""));
        return;
      case "tool_use": {
        const name = ev.toolName ?? ev.name ?? "?";
        const argsStr = formatArgs(name, ev.input ?? ev.args);
        switchSection("tool");
        process.stdout.write(`${dim("  ›")} ${name}${argsStr ? " " + argsStr : ""}${reset}\n`);
        return;
      }
    }
    return;
  }

  // --- Tool execution ---
  if (t === "tool_execution_start") {
    const name = event.toolName as string ?? "?";
    const argsStr = formatArgs(name, event.args);
    switchSection("tool");
    process.stdout.write(`${dim("  ›")} ${name}${argsStr ? " " + argsStr : ""}${reset}\n`);
    return;
  }
  if (t === "tool_execution_update") {
    const preview = event.partialResult != null
      ? JSON.stringify(event.partialResult).slice(0, 200).replace(/\n/g, " ")
      : "";
    if (preview) process.stdout.write(`    ${dim(preview)}\n`);
    return;
  }
  if (t === "tool_execution_end") {
    const name = event.toolName as string ?? "?";
    const isError = event.isError === true;
    if (isError) {
      process.stdout.write(`${dim("  ›")} ${name} ${dim("— failed")}\n`);
    }
    return;
  }

  // --- Turn lifecycle ---
  if (t === "turn_start") {
    turnCount++;
    if (turnCount > maxTurns) {
      maxTurnsExceeded = true;
    }
    return;
  }
  if (t === "turn_end") {
    const results = event.toolResults as Array<unknown> | undefined;
    if (results && results.length > 0) {
      switchSection("tool");
      process.stdout.write(`${dim(`  › turn ${turnCount} (${results.length} tools)`)}${reset}\n`);
    }
    return;
  }

  // --- Queue / planning ---
  if (t === "queue_update") {
    const steering = event.steering as string[] | undefined;
    if (steering && steering.length > 0) {
      aiSeparator();
      process.stdout.write(`\n${dim("  ↳ plan:")} ${bold(steering.join(dim(" → ")))}\n`);
    }
    return;
  }

  // --- Compaction (context window management) ---
  if (t === "compaction_start") {
    aiSeparator();
    const reason = String(event.reason ?? "threshold");
    process.stdout.write(`\n${yellow(`  ⚠ compressing context (${reason})...`)}\n`);
    return;
  }
  if (t === "compaction_end") {
    if (event.aborted) {
      process.stdout.write(`${yellow("  ⚠ compression aborted")}\n`);
    } else {
      process.stdout.write(`${dim("  ✓ context compressed")}\n`);
    }
    return;
  }

  // --- Auto-retry ---
  if (t === "auto_retry_start") {
    const attempt = Number(event.attempt ?? 1);
    const maxAttempts = Number(event.maxAttempts ?? 3);
    const delaySec = (Number(event.delayMs ?? 0) / 1000).toFixed(1);
    process.stdout.write(`${yellow("  ⚠ API error")} ${bold(String(event.errorMessage ?? ""))} ${dim(`retrying ${attempt}/${maxAttempts} (${delaySec}s)...`)}\n`);
    return;
  }
  if (t === "auto_retry_end") {
    if (event.success === true) {
      process.stdout.write(`${dim("  ✓ retry succeeded")}\n`);
    } else {
      // Final retry failure: pi gives up on the request but still exits 0,
      // so this is the runner's only reliable terminal-failure signal.
      apiFailure = String(event.finalError ?? "unknown API error");
      process.stdout.write(`${yellow("  ⚠ retry failed:")} ${String(event.finalError ?? "")}\n`);
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
  /** Absolute path to the isolated working directory. */
  workdir: string;
  /** Extra pi arguments prepared during setup (e.g. --skill). */
  extraArgs: string[];
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
  const workdir = join(
    resolve(tempRoot),
    `pi-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  await mkdir(workdir, { recursive: true });
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

  // Link chrome-devtools-axi skill into workdir for HTML page testing
  const skillsDir = join(workdir, ".skills");
  const chromeDevToolsSkillSrc = join(homedir(), ".agents", "skills", "chrome-devtools-axi", "SKILL.md");
  const chromeDevToolsSkillDst = join(skillsDir, "chrome-devtools-axi", "SKILL.md");
  let extraArgs: string[] = [];
  try {
    await mkdir(join(skillsDir, "chrome-devtools-axi"), { recursive: true });
    await symlink(chromeDevToolsSkillSrc, chromeDevToolsSkillDst);
    extraArgs = ["--skill", chromeDevToolsSkillDst];
    log(`linked chrome-devtools-axi skill`);
  } catch {
    log(`chrome-devtools-axi skill not available, skipping`);
  }

  return { workdir, extraArgs };
}

/**
 * Options for a single pi invocation within a run.
 */
export interface InvocationOptions {
  /** The prompt to give to the agent. */
  prompt: string;
  /** The prepared isolated working directory (pi's cwd and session dir). */
  workdir: string;
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
 * - Captures stdout+stderr to pi-output-<sessionId>.log in the workdir.
 * - Kills the process if it exceeds maxTurns.
 * - Renames the invocation's new session JSONL file to <sessionId>.jsonl.
 */
export async function runInvocation(options: InvocationOptions): Promise<InvocationResult> {
  // Reset module state for this invocation
  aiSection = "idle";
  aiStarted = false;
  turnCount = 0;
  maxTurnsExceeded = false;
  killedForMaxTurns = false;
  maxTurns = options.maxTurns;
  apiFailure = null;

  const {
    prompt,
    workdir,
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
    (await readdir(workdir)).filter((f) => f.endsWith(".jsonl"))
  );

  // Path for capturing stdout+stderr
  const stdoutFile = join(workdir, `pi-output-${sessionId}.log`);

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
    workdir,
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

  // Collect all output (stdout + stderr) into chunks for the log file
  const chunks: Buffer[] = [];

  // Prefix pi stderr lines with [pi>error] for visibility
  let stderrBuffer = "";
  child.stderr.on("data", (d: Buffer) => {
    chunks.push(d);
    stderrBuffer += d.toString("utf-8");
    const lines = stderrBuffer.split("\n");
    stderrBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      process.stderr.write(`[pi>error] ${line}\n`);
    }
  });

  // Parse JSONL events from stdout and render human-readable text
  let lineBuffer = "";
  child.stdout.on("data", (d: Buffer) => {
    chunks.push(d);
    lineBuffer += d.toString("utf-8");
    const lines = lineBuffer.split("\n");
    // Keep the last (potentially partial) line in the buffer
    lineBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      renderJsonEvent(line);
      if (maxTurnsExceeded && !killedForMaxTurns) {
        log(`max turns exceeded (${turnCount}), killing process`);
        killedForMaxTurns = true;
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
  if (aiStarted) {
    process.stdout.write(`\n${dim("━".repeat(50))}\n\n`);
  }
  if (killedForMaxTurns) {
    log(`killed after ${elapsed}s: max turns (${maxTurns}) exceeded`);
  } else {
    log(`exited with code ${exitCode} (${elapsed}s)`);
  }

  // Write collected output to the log file
  await writeFile(stdoutFile, Buffer.concat(chunks));
  log(`wrote output log: ${stdoutFile}`);

  // Find the session JSONL this invocation produced and normalize its name
  let sessionFile: string | null = null;
  try {
    const entries = await readdir(workdir);
    const newJsonl = entries.filter(
      (f) => f.endsWith(".jsonl") && !beforeJsonl.has(f)
    );

    if (newJsonl.length >= 1) {
      // pi normally writes exactly one session file per invocation
      // (--session-dir + --session-id); if several appear, keep the newest.
      let newest = newJsonl[0];
      let newestMtime = 0;
      for (const f of newJsonl) {
        const mtime = (await stat(join(workdir, f))).mtimeMs;
        if (mtime >= newestMtime) {
          newest = f;
          newestMtime = mtime;
        }
      }
      const srcPath = join(workdir, newest);
      const dstPath = join(workdir, `${sessionId}.jsonl`);
      // Only rename if it's not already named <sessionId>.jsonl
      if (newest !== `${sessionId}.jsonl`) {
        await rename(srcPath, dstPath);
        log(`renamed ${newest} to ${sessionId}.jsonl`);
      }
      sessionFile = dstPath;
      log(`found session file: ${sessionFile}`);
    } else {
      log(`no new .jsonl files found in workdir`);
    }
  } catch (err) {
    log(`error finding session file: ${err}`);
  }

  const durationMs = Date.now() - startTime;

  // Backstop: if the event stream showed no terminal retry failure but the
  // transcript's last assistant message ended with stopReason "error", the
  // invocation still died from an API failure (e.g. auto-retry disabled).
  let apiError: string | null = apiFailure;
  if (!apiError && sessionFile && (await sessionEndedWithApiError(sessionFile))) {
    apiError = 'transcript ends with stopReason "error"';
  }

  return {
    sessionId,
    exitCode,
    maxTurnsExceeded: killedForMaxTurns,
    durationMs,
    sessionFile,
    stdoutFile,
    apiError,
  };
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
