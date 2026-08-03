import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { runLog } from "./run-log";
import type { InvocationRecord } from "./run";

/**
 * Resume File schema v1 (`matrix-resume-<timestamp>.json`) — the stable,
 * self-contained contract for future tooling: the `resume` command restores
 * an interrupted Matrix from this file alone and refuses unknown versions.
 */
export interface MatrixResumeFile {
  /** Schema version, starts at 1; resume refuses unknown versions. */
  version: 1;
  /** Original CLI question filter, restored automatically on resume. */
  questionFilter?: string[];
  /** Original CLI model filter, restored automatically on resume. */
  modelFilter?: string[];
  /** Question-level Concurrency the Matrix was running with. */
  concurrency: number;
  /** Pi version string, as recorded in every run.json. */
  piVersion: string;
  /** Combos that still need work: never started, or partially executed. */
  remaining: ResumeRemainingCombo[];
}

/**
 * One Combo in the Resume File's `remaining` list. A Combo leaves the list
 * once archived — regardless of status (ok or error): archived means
 * completed, and failed Combos are never retried by resume.
 */
export interface ResumeRemainingCombo {
  questionName: string;
  modelName: string;
  comboId: string;
  /** Present when the Combo was interrupted mid-execution. */
  inFlight?: {
    /** Absolute path of the surviving run dir (workdir + session dir). */
    runDir: string;
    /** Completed invocations in execution order, same shape as run.json's records. */
    completedInvocations: InvocationRecord[];
  };
}

/**
 * Maintains the Resume File for one Matrix execution: created before the
 * first Combo runs, rewritten atomically (write-temp-then-rename in the
 * same directory) as Combos and invocations complete, and deleted when the
 * Matrix finishes normally. The file therefore survives Ctrl-C, crash,
 * kill -9, or power loss with content accurate as of the last completed
 * Combo — no signal handling needed.
 *
 * State mutations are synchronous and enqueue a serialized rewrite; the
 * snapshot is taken when the write executes, so rapid updates coalesce and
 * the file on disk always holds one complete, consistent generation.
 * Rewrite failures are logged and swallowed — persistence must never break
 * a running Matrix (the same rule the index log follows).
 */
export class ResumeTracker {
  /** Remaining Combos keyed by comboId, in matrix execution order. */
  private readonly remaining = new Map<string, ResumeRemainingCombo>();
  /** Serializes rewrites so concurrent Combos never overlap temp writes. */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly meta: {
      questionFilter?: string[];
      modelFilter?: string[];
      concurrency: number;
      piVersion: string;
    }
  ) {}

  /**
   * Create the Resume File with every planned Combo in `remaining`.
   * Awaited by the caller so the file exists before the first Combo runs.
   * A resumed Matrix seeds the entries it loaded from the file — including
   * their in-flight state — so the carried-over completed invocations stay
   * on record from the first rewrite.
   */
  async start(combos: ResumeRemainingCombo[]): Promise<void> {
    for (const combo of combos) {
      this.remaining.set(combo.comboId, { ...combo });
    }
    await this.writeAtomic();
  }

  /**
   * Record that a Combo started executing: its run dir survives an
   * interruption, so the file can point resume at it. The in-flight state
   * is flushed with the next rewrite — killed mid-Combo, the file shows
   * exactly what the Combo had completed.
   */
  comboStarted(comboId: string, runDir: string): void {
    const combo = this.remaining.get(comboId);
    if (!combo) return;
    // A resumed Combo adopting its recorded run dir keeps the carried-over
    // completed invocations; a fresh run dir (new Matrix, or a degraded
    // re-run after the recorded dir vanished) starts the record over — the
    // old invocations' transcripts live in a dir this run will not use.
    const completedInvocations =
      combo.inFlight?.runDir === runDir ? combo.inFlight.completedInvocations : [];
    combo.inFlight = { runDir, completedInvocations };
    this.enqueueRewrite();
  }

  /**
   * Append a completed invocation (run.json shape, execution order) to a
   * Combo's in-flight record. Flushed with the next rewrite rather than
   * only at Combo completion, so a kill mid-Combo never loses paid work.
   */
  invocationCompleted(comboId: string, record: InvocationRecord): void {
    const combo = this.remaining.get(comboId);
    if (!combo?.inFlight) return;
    combo.inFlight.completedInvocations.push(record);
    this.enqueueRewrite();
  }

  /**
   * Remove an archived Combo from `remaining` — regardless of its status
   * (ok or error): archived means completed. Awaited so the rewrite is
   * durable before the freed lane starts its next Combo, keeping the file
   * accurate as of every Combo completion.
   */
  async comboArchived(comboId: string): Promise<void> {
    this.remaining.delete(comboId);
    this.enqueueRewrite();
    await this.writeChain;
  }

  /**
   * Normal Matrix completion: the Resume File has served its purpose, so
   * delete it — a leftover file must never trigger a mistaken resume.
   * Pending rewrites settle first so none can rename over the deletion.
   */
  async finish(): Promise<void> {
    await this.writeChain;
    await rm(this.filePath, { force: true });
  }

  private enqueueRewrite(): void {
    this.writeChain = this.writeChain.then(() => this.writeAtomic());
  }

  /**
   * Serialize the current state and replace the file atomically: write a
   * temp sibling, then rename over the target — a concurrent reader never
   * observes a truncated file, and a crash mid-rewrite leaves either the
   * previous or the new complete file, never a partial one.
   */
  private async writeAtomic(): Promise<void> {
    const snapshot: MatrixResumeFile = {
      version: 1,
      questionFilter: this.meta.questionFilter,
      modelFilter: this.meta.modelFilter,
      concurrency: this.meta.concurrency,
      piVersion: this.meta.piVersion,
      remaining: [...this.remaining.values()],
    };
    try {
      const tempPath = `${this.filePath}.tmp`;
      await writeFile(
        tempPath,
        JSON.stringify(snapshot, null, 2) + "\n",
        "utf-8"
      );
      await rename(tempPath, this.filePath);
    } catch (err) {
      runLog(`[matrix] failed to rewrite Resume File ${this.filePath}: ${err}`);
    }
  }
}

/**
 * Load and validate a Resume File for the `resume` command. Resume is a
 * deliberate act: a missing, unparseable, or malformed file — or one from
 * an unknown schema version — must fail with a clear error before anything
 * runs, never start a half-valid Matrix.
 */
export async function loadResumeFile(
  filePath: string
): Promise<MatrixResumeFile> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    throw new Error(
      `Cannot load Resume File ${filePath}: ${(err as Error).message}`,
      { cause: err }
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Cannot load Resume File ${filePath}: not valid JSON`, {
      cause: err,
    });
  }
  const fail = (reason: string): never => {
    throw new Error(`Cannot load Resume File ${filePath}: ${reason}`);
  };
  if (typeof parsed !== "object" || parsed === null) fail("not an object");
  const file = parsed as MatrixResumeFile;
  if (file.version !== 1) {
    fail(
      `unsupported Resume File version ${JSON.stringify(
        (parsed as { version?: unknown }).version
      )} (expected 1)`
    );
  }
  if (!Number.isInteger(file.concurrency) || file.concurrency < 1) {
    fail(`invalid concurrency ${JSON.stringify(file.concurrency)}`);
  }
  if (typeof file.piVersion !== "string") fail("missing piVersion");
  for (const [key, filter] of [
    ["questionFilter", file.questionFilter],
    ["modelFilter", file.modelFilter],
  ] as const) {
    if (
      filter !== undefined &&
      (!Array.isArray(filter) || filter.some((n) => typeof n !== "string"))
    ) {
      fail(`malformed ${key} (expected an array of strings)`);
    }
  }
  if (!Array.isArray(file.remaining)) fail("missing remaining Combo list");
  for (const combo of file.remaining) {
    if (
      typeof combo?.questionName !== "string" ||
      typeof combo?.modelName !== "string" ||
      typeof combo?.comboId !== "string"
    ) {
      fail("malformed remaining Combo entry");
    }
    if (
      combo.inFlight !== undefined &&
      (typeof combo.inFlight.runDir !== "string" ||
        !Array.isArray(combo.inFlight.completedInvocations))
    ) {
      fail(`malformed in-flight state for Combo ${combo.comboId}`);
    }
  }
  return file;
}
