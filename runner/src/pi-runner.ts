import { spawn } from "node:child_process";
import {
  mkdir,
  writeFile,
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
      process.stdout.write(`${yellow("  ⚠ retry failed:")} ${String(event.finalError ?? "")}\n`);
    }
    return;
  }
}

/**
 * Shared pi execution environment: which binary, which config home,
 * where isolated workdirs live, and the turn budget per run.
 */
export interface PiEnvironment {
  /** Absolute path to the pi executable (injectable for tests). */
  piBin: string;
  /** Absolute path for PI_CODING_AGENT_DIR environment variable. */
  piHome: string;
  /** Directory under which the isolated working directory is created. */
  tempRoot: string;
  /** Maximum assistant turns before the process is killed. */
  maxTurns: number;
}

/**
 * Options for invoking the pi coding agent.
 */
export interface PiRunOptions extends PiEnvironment {
  /** The prompt to give to the agent. */
  prompt: string;
  /** The question being executed. */
  question: Question;
  /** Pi provider name (e.g., "llamacpp-local"). */
  provider: string;
  /** Model id within that provider. */
  modelId: string;
}

/**
 * Result of a pi run.
 */
export interface PiRunResult {
  /** Absolute path to the isolated working directory. */
  workdir: string;
  /** Exit code of the pi process, or null if killed (e.g. max turns exceeded). */
  exitCode: number | null;
  /** True if the process was killed because it exceeded the max turn limit. */
  maxTurnsExceeded: boolean;
  /** Duration of the run in milliseconds. */
  durationMs: number;
  /**
   * Absolute path of the normalized session.jsonl inside workdir,
   * or null if pi produced no JSONL session file.
   */
  sessionFile: string | null;
  /** Absolute path to the file capturing pi's stdout+stderr inside workdir. */
  stdoutFile: string;
}

/**
 * Run the pi coding agent with strict isolation:
 *
 * - Creates a fresh subdirectory under tempRoot (outside the repo).
 * - Copies spec.md / tickets.md from the question directory if present.
 * - Spawns piBin with the given prompt and model arguments.
 * - Captures stdout+stderr to pi-output.log in the workdir.
 * - Kills the process if it exceeds maxTurns.
 * - Renames the session JSONL file to session.jsonl.
 */
export async function runPi(options: PiRunOptions): Promise<PiRunResult> {
  // Reset module state for this run
  aiSection = "idle";
  aiStarted = false;
  turnCount = 0;
  maxTurnsExceeded = false;
  killedForMaxTurns = false;
  maxTurns = options.maxTurns;

  const {
    prompt,
    question,
    provider,
    modelId,
    piBin,
    piHome,
    tempRoot,
  } = options;

  // Create an isolated working directory under tempRoot
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

  // Path for capturing stdout+stderr
  const stdoutFile = join(workdir, "pi-output.log");

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
    "session",
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

  // Find and normalize the session JSONL file
  let sessionFile: string | null = null;
  try {
    const entries = await readdir(workdir);
    const jsonlFiles = entries.filter((f) => f.endsWith(".jsonl"));

    if (jsonlFiles.length >= 1) {
      // pi normally writes exactly one session file (--session-dir + --session-id);
      // if several exist, keep the most recently modified one.
      let newest = jsonlFiles[0];
      let newestMtime = 0;
      for (const f of jsonlFiles) {
        const mtime = (await stat(join(workdir, f))).mtimeMs;
        if (mtime >= newestMtime) {
          newest = f;
          newestMtime = mtime;
        }
      }
      const srcPath = join(workdir, newest);
      const dstPath = join(workdir, "session.jsonl");
      // Only rename if it's not already named session.jsonl
      if (newest !== "session.jsonl") {
        await rename(srcPath, dstPath);
        log(`renamed ${newest} to session.jsonl`);
      }
      sessionFile = dstPath;
      log(`found session file: ${sessionFile}`);
    } else {
      log(`no .jsonl files found in workdir`);
    }
  } catch (err) {
    log(`error finding session file: ${err}`);
  }

  const durationMs = Date.now() - startTime;

  return {
    workdir,
    exitCode,
    maxTurnsExceeded: killedForMaxTurns,
    durationMs,
    sessionFile,
    stdoutFile,
  };
}
