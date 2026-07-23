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

  // Copy question files into the workdir if they exist
  if (question.hasSpec) {
    await copyFile(
      join(question.dir, "spec.md"),
      join(workdir, "spec.md")
    );
  }
  if (question.hasTickets) {
    await copyFile(
      join(question.dir, "tickets.md"),
      join(workdir, "tickets.md")
    );
  }

  // Path for capturing stdout+stderr
  const stdoutFile = join(workdir, "pi-output.log");

  // Build the pi command arguments
  const args: string[] = [
    "-p",
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

  const child = spawn(piBin, args, {
    cwd: workdir,
    env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  // Collect stdout and stderr into the output log file
  const chunks: Buffer[] = [];
  child.stdout.on("data", (d: Buffer) => chunks.push(d));
  child.stderr.on("data", (d: Buffer) => chunks.push(d));

  // Set up timeout to kill the process
  let timedOut = false;
  let exitCode: number | null = null;
  const timeoutId = setTimeout(() => {
    timedOut = true;
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

  // Write collected output to the log file
  await writeFile(stdoutFile, Buffer.concat(chunks));

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
      }
      sessionFile = dstPath;
    }
  } catch {
    // If we can't read the directory, sessionFile stays null
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
