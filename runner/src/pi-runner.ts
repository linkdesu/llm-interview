import { spawn } from "node:child_process";
import {
  mkdir,
  writeFile,
  readdir,
  rename,
  copyFile,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Question } from "./question";

const log = (msg: string) => {
  if (process.env.NODE_ENV !== "test") console.error(`[pi] ${msg}`);
};

type Section = "idle" | "thinking" | "tool" | "response";
let aiSection: Section = "idle";
let aiStarted = false;

const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const reset = "\x1b[0m";
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

function sectionHeader(label: string): void {
  process.stdout.write(`\n${dim("\u2501".repeat(8))} ${bold(label)} ${dim("\u2501".repeat(8))}\n`);
}

function aiSeparator(): void {
  if (!aiStarted) {
    aiStarted = true;
    process.stdout.write(`\n${dim("\u2501".repeat(50))}\n`);
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

function renderJsonEvent(line: string): void {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }

  if (event.type === "message_update") {
    const ev = event.assistantMessageEvent as Record<string, unknown> | undefined;
    if (!ev || typeof ev !== "object") return;
    if (ev.type === "thinking_delta") {
      switchSection("thinking");
      process.stdout.write(String(ev.delta ?? ""));
    } else if (ev.type === "text_delta") {
      switchSection("response");
      process.stdout.write(String(ev.delta ?? ""));
    } else if (ev.type === "tool_use") {
      const name = ev.toolName ?? ev.name ?? "?";
      switchSection("tool");
      process.stdout.write(`${dim("  \u2514 Tool:")} ${name}${reset}\n`);
    }
  } else if (event.type === "tool_start") {
    const name = event.toolName ?? event.name ?? "?";
    switchSection("tool");
    process.stdout.write(`${dim("  \u2514 Tool:")} ${name}${reset}\n`);
  } else if (event.type === "tool_end") {
    const name = event.toolName ?? event.name ?? "?";
    const result = event.result as string ?? event.output as string ?? "";
    const preview = String(result).slice(0, 300).replace(/\n/g, " ");
    process.stdout.write(`${dim("  \u2514 Done:")} ${name}${preview ? dim(" \u2014 ") + preview : ""}${reset}\n`);
  }
}

/**
 * Shared pi execution environment: which binary, which config home,
 * where isolated workdirs live, and the wall-clock budget per run.
 */
export interface PiEnvironment {
  /** Absolute path to the pi executable (injectable for tests). */
  piBin: string;
  /** Absolute path for PI_CODING_AGENT_DIR environment variable. */
  piHome: string;
  /** Directory under which the isolated working directory is created. */
  tempRoot: string;
  /** Wall-clock timeout in milliseconds; the process is killed if exceeded. */
  timeoutMs: number;
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
  /** Exit code of the pi process, or null if killed by timeout. */
  exitCode: number | null;
  /** True if the process was killed due to timeout. */
  timedOut: boolean;
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
 * - Kills the process if it exceeds timeoutMs.
 * - Renames the session JSONL file to session.jsonl.
 */
export async function runPi(options: PiRunOptions): Promise<PiRunResult> {
  const {
    prompt,
    question,
    provider,
    modelId,
    piBin,
    piHome,
    tempRoot,
    timeoutMs,
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

  // Build the pi command arguments
  const args: string[] = [
    "-p",
    "--mode",
    "json",
    "--no-extensions",
    "--no-skills",
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

  // Collect all output (buffer + stderr) into chunks for the log file
  const chunks: Buffer[] = [];

  // Pipe stderr directly to parent stderr and collect
  child.stderr.on("data", (d: Buffer) => {
    process.stderr.write(d);
    chunks.push(d);
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
    }
  });

  // Set up timeout to kill the process
  let timedOut = false;
  let exitCode: number | null = null;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    log(`timeout reached (${timeoutMs}ms), killing with SIGKILL`);
    child.kill("SIGKILL");
  }, timeoutMs);

  const startTime = Date.now();

  // Wait for the process to exit
  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => {
      exitCode = code;
      clearTimeout(timeoutId);
      resolve();
    });
    child.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  if (aiStarted) {
    process.stdout.write(`\n${dim("\u2501".repeat(50))}\n\n`);
  }
  if (timedOut) {
    log(`timed out after ${elapsed}s`);
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
    exitCode: timedOut ? null : exitCode,
    timedOut,
    durationMs,
    sessionFile,
    stdoutFile,
  };
}
