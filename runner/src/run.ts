import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  copyFile,
  rm,
  stat,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, sep, basename, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { setRunLogPath, runLog } from "./run-log";
import {
  ResumeTracker,
  loadResumeFile,
  type ResumeRemainingCombo,
} from "./resume";
import { loadConfig, type RegistryModel } from "./registry";
import { loadQuestions, type Question, type Ticket } from "./question";
import {
  buildPrompt,
  buildTicketPrompt,
  buildEvaluationPrompt,
} from "./prompt";
import {
  setupWorkdir,
  adoptWorkdir,
  runInvocation,
  sessionHasWriteToolErrors,
  parseVerdict,
  assertModelsAvailable,
  type PiEnvironment,
  type WorkdirSetup,
} from "./pi-runner";
import {
  LoopDetector,
  resolveSupervisor,
  LOOP_SAMPLE_LOG_NAME,
  type JudgeFn,
  type LoopDetectorConfig,
  type SupervisorEndpoint,
} from "./loop-detector";

// ---------------------------------------------------------------------------
// Compact console progress view
// ---------------------------------------------------------------------------
//
// The console is a scrolling line stream — one line per state transition,
// prefixed `[HH:MM:SS] [model] [question]` — designed to stay readable
// under Concurrency, when several Combos are in flight at once. Five line
// types: Combo start (▸), Ticket start (▸), turn end (·), Combo end
// (✔/✘), and warnings/errors (⚠ API retry, ✘ terminal failure /
// kill). Beyond those, only matrix-scope lines (`[matrix]`) and the final
// results table appear; the per-completion progress overview and the full
// pi agent stream were removed from the console (the stream stays
// available per invocation in the workdir's pi-output log and its
// archive). Elapsed times are always Combo-level, counted from Combo
// start.
//
// Dual-channel emission: the index log (runLog) keeps its long-standing
// lines byte-for-byte; only the console side of each call site uses the
// new format. All console output keeps the NODE_ENV=test suppression
// convention so the test suite never floods.

/**
 * Console column widths (brackets included), computed once after
 * filtering: the model and question columns pad to the widest name in the
 * filtered set, and matrix-scope lines use a `[matrix]` placeholder at
 * the model column width.
 */
const consoleColumns = { model: "[matrix]".length, question: 0 };

/** Current local time as HH:MM:SS. */
function hhmmss(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Emit a matrix-scope console line: `[HH:MM:SS] [matrix] message`. */
function emitMatrix(msg: string): void {
  if (process.env.NODE_ENV === "test") return;
  console.log(`[${hhmmss()}] ${"[matrix]".padEnd(consoleColumns.model)} ${msg}`);
}

/** Emit a combo-scope console line: `[HH:MM:SS] [model] [question] message`. */
function emitCombo(model: string, question: string, msg: string): void {
  if (process.env.NODE_ENV === "test") return;
  console.log(
    `[${hhmmss()}] ${`[${model}]`.padEnd(consoleColumns.model)} ${`[${question}]`.padEnd(consoleColumns.question)} ${msg}`
  );
}

const log = (msg: string) => {
  runLog(`[matrix] ${msg}`);
  emitMatrix(msg);
};
/**
 * Dual-channel progress line: the runLog side keeps the legacy format
 * byte-for-byte; the console side of each call site is emitted separately
 * via emitMatrix/emitCombo — or dropped (the progress overview block).
 */
const progress = (msg: string) => {
  runLog(msg);
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for running the full question × model matrix.
 */
export interface RunMatrixOptions extends PiEnvironment {
  /** Path to the question directory containing question subdirectories. */
  questionDir: string;
  /** Path to the config.toml file. */
  configPath: string;
  /** Root directory where archived sessions are stored. */
  sessionRoot: string;
  /** Optional list of question names to include (match by name). */
  questionFilter?: string[];
  /** Optional list of model names to include (match by name). */
  modelFilter?: string[];
  /** Pi version string to record in run.json. */
  piVersion: string;
  /** Global run rules injected into every prompt. */
  runRules: string;
  /**
   * Optional path of the matrix index log (see run-log.ts). When set, every
   * [pi]/[matrix]/progress line plus combo START/END markers and a final
   * SUMMARY are appended to this file with ISO timestamps. When omitted, no
   * index log is written.
   */
  indexLogPath?: string;
  /**
   * Optional path of the Resume File (see resume.ts). When set, the file
   * is created before the first Combo runs, atomically rewritten after
   * every Combo completion (and as in-flight invocations complete), and
   * deleted when the Matrix finishes normally. The CLI names it
   * matrix-resume-<timestamp>.json with the same timestamp id as the
   * index log, deriving both from one matrix start time.
   */
  resumeFilePath?: string;
  /**
   * Question-level concurrency within one model (default 1 = fully
   * sequential). Models always run strictly one after another regardless
   * of this value. Must be a positive integer.
   */
  concurrency?: number;
  /**
   * Heartbeat interval in seconds (default 60): how often the console
   * prints a "(running)" line per in-flight Combo during long turns.
   * Comes from config.toml's optional `heartbeat_seconds` key.
   */
  heartbeatSeconds?: number;
  /**
   * Resume mode (internal — set by resumeMatrix, never by the CLI's fresh
   * run): execute exactly these remaining Combos instead of the full
   * filtered plan, adopting each Combo's recorded in-flight state where
   * present. Requires `resumeFilePath` to point at the same file the
   * entries were loaded from, so the resumed Matrix keeps updating it.
   */
  resumeRemaining?: ResumeRemainingCombo[];
  /**
   * Loop detection judging seam (issue #21): injected by tests to stub
   * the supervisor; production leaves it undefined and the detector calls
   * the supervisor over HTTP. Ignored when config.toml has no
   * [loop_detector] section.
   */
  loopJudge?: JudgeFn;
}

/**
 * Per-combo outcome returned by runMatrix.
 */
export interface RunComboOutcome {
  /** The question that was executed. */
  question: Question;
  /** The model that was used. */
  model: RegistryModel;
  /** The sha256-based combo ID (first 12 hex chars). */
  comboId: string;
  /** ISO timestamp when the run started. */
  startedAt: string;
  /** ISO timestamp when the run ended. */
  endedAt: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /**
   * Run status: "ok" or "error". A run killed for exceeding the max turn
   * limit is reported as "error" with maxTurnsExceeded set to true.
   */
  status: "ok" | "error";
  /** Exit code from pi, or null if killed (e.g. max turns exceeded). */
  exitCode: number | null;
  /**
   * True if the run was killed for exceeding the max turn limit —
   * usually a sign the agent looped or could not solve the task.
   */
  maxTurnsExceeded: boolean;
}

/**
 * Result returned by runCombo. Carries the outcome plus metadata the
 * matrix level needs (status, apiError, archived session path, SUMMARY
 * record fields) without the combo reading or writing any matrix-level
 * mutable accumulators.
 */
interface RunComboResult {
  outcome: RunComboOutcome;
  /** Terminal API failure string that should abort the matrix, or undefined. */
  apiError: string | undefined;
  /** Absolute path of the archived session.jsonl, or null. */
  archivedSessionJsonl: string | null;
  /** Exception message when the combo crashed without archiving. */
  failReason: string | undefined;
}

/**
 * Live state of an in-flight Combo, shared between the combo's invocation
 * loop (which updates it) and the matrix-level heartbeat timer (which
 * reads it to render "(running)" lines). Kept in the same closure that
 * already carries the invocation-loop context.
 */
interface InFlightCombo {
  /** Model name (console prefix). */
  model: string;
  /** Question name (console prefix). */
  question: string;
  /**
   * Current ticket label ("ticket 2/5"), or null for single-invocation
   * Questions (they omit the ticket segment).
   */
  ticket: string | null;
  /** Completed turns of the current invocation. */
  turn: number;
  /** Combo start (ms epoch) — heartbeat elapsed is always Combo-level. */
  startedAtMs: number;
}

/**
 * Per-invocation outcome recorded in run.json's invocations array.
 */
export interface InvocationRecord {
  /** 1-based ticket index (omitted for single-invocation runs). */
  ticket?: number;
  /** Ticket title from tickets.md (omitted for single-invocation runs). */
  ticketTitle?: string;
  /** True for evaluation invocations arbitrating a dirty ticket invocation. */
  evaluation?: boolean;
  /**
   * Parsed verdict for evaluation invocations. Null means the verdict was
   * missing or unparseable — treated as INCOMPLETE (conservative abort).
   */
  verdict?: "complete" | "incomplete" | null;
  /**
   * Dirty signals: non-zero exit, max-turns kill, or an isError tool result
   * in the transcript.
   */
  dirty: boolean;
  /** Invocation status: "ok" or "error" (exit code / max-turns / API failure). */
  status: "ok" | "error";
  /** Exit code from pi, or null if killed (e.g. max turns exceeded). */
  exitCode: number | null;
  /** True if this invocation was killed for exceeding the max turn limit. */
  maxTurnsExceeded: boolean;
  /**
   * True if this invocation was killed by the loop detector (issue #21).
   * Present only on the killed invocation.
   */
  loopDetected?: boolean;
  /**
   * Terminal API failure (e.g. connection loss after all retries), or
   * undefined. Always aborts the whole matrix — see RunJson.apiError.
   */
  apiError?: string;
  /** Duration of the invocation in milliseconds. */
  durationMs: number;
}

/**
 * Shape of the run.json file written for each archived session.
 */
export interface RunJson {
  /** Question metadata. */
  question: {
    name: string;
    hasSpec: boolean;
    hasTickets: boolean;
  };
  /** Model metadata. */
  model: {
    name: string;
    provider: string;
    modelId: string;
  };
  /** Sampling parameter snapshot used for this run. */
  params: Record<string, string | number | boolean>;
  /** Sha256-based combo ID (first 12 hex chars). */
  comboId: string;
  /** Pi version string. */
  piVersion: string;
  /** ISO timestamp when the run started. */
  startedAt: string;
  /** ISO timestamp when the run ended. */
  endedAt: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /**
   * Run status: "ok" or "error". A run killed for exceeding the max turn
   * limit is reported as "error" with maxTurnsExceeded set to true.
   */
  status: "ok" | "error";
  /** Exit code from pi, or null if killed (e.g. max turns exceeded). */
  exitCode: number | null;
  /**
   * True if the run was killed for exceeding the max turn limit —
   * usually a sign the agent looped or could not solve the task.
   */
  maxTurnsExceeded: boolean;
  /**
   * True if the run was killed by the loop detector: the supervisor
   * judged the agent stuck in a non-productive repetition loop
   * (issue #21). A loop defect is itself an observable model behavior.
   * Present only when the [loop_detector] section is configured.
   */
  loopDetected?: boolean;
  /** Confidence of the killing judgment (present when loopDetected). */
  loopConfidence?: number;
  /** Reason of the killing judgment (present when loopDetected). */
  loopReason?: string;
  /**
   * Effective max turn limit for this run (model-level override if set,
   * otherwise the global config value).
   */
  maxTurns: number;
  /** Artifact contract violation messages (empty if compliant). */
  contractViolations: string[];
  /**
   * Per-invocation records for per-ticket runs (absent for the
   * single-invocation flow). Includes evaluation invocations.
   */
  invocations?: InvocationRecord[];
  /**
   * Terminal API failure that aborted the whole matrix (e.g. network
   * outage). Infrastructure failures are not model failures: every
   * subsequent invocation would fail the same way, so the runner stops
   * immediately and waits for manual recovery instead of burning combos.
   */
  apiError?: string;
}

/**
 * Format a timestamp as YYYYMMDD-HHmmss using local time.
 */
function formatTimestamp(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return (
    date.getFullYear().toString() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    "-" +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

/**
 * Compute comboId: first 12 hex chars of sha256([questionName, modelName, params]).
 */
function computeComboId(
  questionName: string,
  modelName: string,
  params: Record<string, string | number | boolean>
): string {
  const input = JSON.stringify([questionName, modelName, params]);
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

/**
 * Check the artifact contract: exactly index.html, style.css, script.js.
 * Returns an array of violation messages (empty if compliant).
 */
function validateArtifactContract(files: string[]): string[] {
  const violations: string[] = [];
  const expected = new Set(["index.html", "style.css", "script.js"]);
  const actual = new Set(files);

  // Check for missing expected files
  for (const f of expected) {
    if (!actual.has(f)) {
      violations.push(`missing expected artifact: ${f}`);
    }
  }

  // Check for unexpected files (ignore run infrastructure and copied inputs)
  const allowedExtras = new Set([
    "run.json",
    "spec.md",
    "tickets.md",
    ".skills",
  ]);
  for (const f of actual) {
    if (expected.has(f) || allowedExtras.has(f)) continue;
    // Session transcripts (session.jsonl, t1.jsonl, ...) and pi output logs
    // are run infrastructure, not artifact content.
    if (f.endsWith(".jsonl")) continue;
    if (/^pi-output.*\.log$/.test(f)) continue;
    violations.push(`unexpected file: ${f}`);
  }

  return violations;
}

/**
 * Strip base64 image data from session.jsonl to reduce archive size.
 * Replaces `{"type":"image","data":"base64..."}` with `{"type":"image","data":"[stripped]"}`.
 */
async function stripSessionImageData(archiveDir: string): Promise<void> {
  const sessionPath = join(archiveDir, "session.jsonl");
  let content: string;
  try {
    content = await readFile(sessionPath, "utf-8");
  } catch (err) {
    // A missing transcript is fine (flagged elsewhere as a contract
    // violation); anything else is a real failure and must be visible.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return;
    log(`failed to read session.jsonl for stripping: ${err}`);
    return;
  }

  const cleaned = content.split("\n").filter(Boolean).map((line) => {
    try {
      const obj = JSON.parse(line);
      const msg = obj.message as Record<string, unknown> | undefined;
      if (msg?.content && Array.isArray(msg.content)) {
        msg.content = msg.content.map((item: Record<string, unknown>) => {
          if (item.type === "image") item.data = "[stripped]";
          return item;
        });
      }
      return JSON.stringify(obj);
    } catch {
      return line;
    }
  }).join("\n");

  if (cleaned !== content) {
    const before = content.length;
    await writeFile(sessionPath, cleaned, "utf-8");
    const after = (await readFile(sessionPath, "utf-8")).length;
    log(`stripped image data from session.jsonl (${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB)`);
  } else {
    log(`no image data to strip in session.jsonl`);
  }
}

/**
 * Copy artifact files (.html, .css, .js) from workdir to archive.
 * The transcript is archived separately by concatenating the invocations'
 * session files (see concatenateSessions).
 */
async function copyArtifacts(
  workdir: string,
  archiveDir: string
): Promise<string[]> {
  const files = await readdir(workdir);
  const artifactExtensions = new Set([".html", ".css", ".js"]);
  const copied: string[] = [];

  for (const f of files) {
    const ext = f.slice(f.lastIndexOf("."));
    if (artifactExtensions.has(ext)) {
      await copyFile(join(workdir, f), join(archiveDir, f));
      copied.push(f);
    }
  }

  return copied;
}

/**
 * Concatenate the invocations' session JSONL files (in execution order,
 * evaluation invocations included) into the archived session.jsonl.
 */
async function concatenateSessions(
  sessionFiles: string[],
  archiveDir: string
): Promise<void> {
  if (sessionFiles.length === 0) return;
  const parts: string[] = [];
  for (const f of sessionFiles) {
    parts.push((await readFile(f, "utf-8")).replace(/\n+$/, ""));
  }
  await writeFile(join(archiveDir, "session.jsonl"), parts.join("\n") + "\n", "utf-8");
  log(`concatenated ${sessionFiles.length} session file(s) into session.jsonl`);
}

/**
 * Total line count of session segments as they will appear in the
 * concatenated session.jsonl (trailing newlines stripped, see
 * concatenateSessions) — the loop detector's line-reference offset.
 */
async function countSessionLines(sessionFiles: string[]): Promise<number> {
  let total = 0;
  for (const f of sessionFiles) {
    try {
      const content = (await readFile(f, "utf-8")).replace(/\n+$/, "");
      total += content.length === 0 ? 0 : content.split("\n").length;
    } catch {
      // A missing segment contributes no lines.
    }
  }
  return total;
}

/**
 * Filter items by name. Throws with a list of available names on unknown filters.
 */
function applyNameFilter<T>(
  items: T[],
  filter: string[] | undefined,
  kind: string,
  keyFn: (item: T) => string
): T[] {
  if (!filter || filter.length === 0) return items;
  const keys = new Set(items.map(keyFn));
  const unknown = filter.filter((n) => !keys.has(n));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown ${kind} filter name(s): ${unknown.join(", ")}. Available: ${[...keys].join(", ")}`
    );
  }
  return items.filter((i) => filter.includes(keyFn(i)));
}

/**
 * Run the full question × model matrix in model-major order.
 *
 * For each model (outer loop), runs all questions (inner loop).
 * Each run is isolated, archived, and recorded in run.json.
 * Failures in one combo do not stop the matrix.
 *
 * @returns Array of per-combo outcomes.
 */
export async function runMatrix(options: RunMatrixOptions): Promise<RunComboOutcome[]> {
  const {
    questionDir,
    configPath,
    sessionRoot,
    piBin,
    piHome,
    tempRoot,
    questionFilter,
    modelFilter,
    piVersion,
    runRules,
    maxTurns,
    indexLogPath,
    resumeFilePath,
    concurrency = 1,
    heartbeatSeconds = 60,
    resumeRemaining,
  } = options;

  // Fail fast on an invalid concurrency: a typo discovered hours into the
  // matrix is far worse than a startup error (validated here rather than
  // only in the CLI so the engine contract holds for every caller).
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(
      `Invalid concurrency: ${concurrency} (expected a positive integer)`
    );
  }

  // Enable the matrix index log before anything can fail, so even startup
  // errors (isolation guard, unknown model ids) leave a trace.
  setRunLogPath(indexLogPath ?? null);

  // Isolation guard: the temp area for run workdirs must live outside the
  // repo (approximated by sessionRoot's parent) so the model can never read
  // project files or other Sessions' artifacts.
  const repoRoot = resolve(sessionRoot, "..");
  const resolvedTempRoot = resolve(tempRoot);
  if (resolvedTempRoot === repoRoot || resolvedTempRoot.startsWith(repoRoot + sep)) {
    throw new Error(
      `tempRoot must be outside the repository (got ${resolvedTempRoot}, repo is ${repoRoot})`
    );
  }

  // Load registry and questions
  const config = await loadConfig(configPath);
  const models = config.models;
  const questions = await loadQuestions(questionDir);

  const filteredModels = applyNameFilter(models, modelFilter, "model", (m) => m.modelId);
  const filteredQuestions = applyNameFilter(questions, questionFilter, "question", (q) => q.name);

  // Console column widths: computed once, now that the filtered set (and
  // thus the exec plan's names) is known — pad to the widest names.
  consoleColumns.model = Math.max(
    "[matrix]".length,
    ...filteredModels.map((m) => m.name.length + 2)
  );
  consoleColumns.question = Math.max(
    0,
    ...filteredQuestions.map((q) => q.name.length + 2)
  );

  log(`loaded ${models.length} models, ${questions.length} questions`);
  if (filteredModels.length !== models.length || filteredQuestions.length !== questions.length) {
    log(`filtered to ${filteredModels.length} models × ${filteredQuestions.length} questions = ${filteredModels.length * filteredQuestions.length} combos`);
  }

  // Fail fast on model id typos: pi runs unknown ids as "custom models"
  // instead of erroring, which would silently burn the whole matrix.
  await assertModelsAvailable(piHome, filteredModels);

  // Loop detection (issue #21): the [loop_detector] section enables the
  // supervisor. Resolve its endpoint at config-validation time — a
  // provider missing from models.json refuses to start the Matrix, same
  // spirit as assertModelsAvailable. Absent section = feature disabled.
  let loop:
    | {
        config: LoopDetectorConfig;
        supervisor: SupervisorEndpoint;
        judge?: JudgeFn;
      }
    | undefined;
  if (config.loopDetector) {
    const supervisor = await resolveSupervisor(piHome, config.loopDetector);
    loop = { config: config.loopDetector, supervisor, judge: options.loopJudge };
    log(
      `loop detection enabled: supervisor ${config.loopDetector.provider}/${config.loopDetector.modelId} ` +
        `(step ${config.loopDetector.step}, threshold ${config.loopDetector.confidenceThreshold})`
    );
  }

  // Pre-compute the full combo list for progress tracking
  type ComboPlan = {
    model: typeof filteredModels[number];
    question: typeof filteredQuestions[number];
    comboId: string;
    /** In-flight state carried over from the Resume File (resume mode). */
    adoptedRun?: {
      runDir: string;
      completedInvocations: InvocationRecord[];
    };
  };
  const comboPlan: ComboPlan[] = [];
  for (const model of filteredModels) {
    for (const question of filteredQuestions) {
      comboPlan.push({ model, question, comboId: computeComboId(question.name, model.name, model.params) });
    }
  }

  // Resume mode: the file's `remaining` list — not the filtered plan —
  // decides what executes. Archived Combos are absent from it by
  // construction and are never retried: archived means completed, status
  // ok or error alike. Entries are matched to plan Combos by question ×
  // model identity; the recorded comboId is informational (registry
  // params may have changed since the interruption) and the freshly
  // computed id replaces it in the file from the first rewrite.
  let execPlan = comboPlan;
  if (resumeRemaining) {
    if (!resumeFilePath) {
      throw new Error(
        "resumeRemaining requires resumeFilePath (the same file the entries were loaded from)"
      );
    }
    const byIdentity = new Map(
      comboPlan.map((c) => [`${c.question.name} × ${c.model.name}`, c])
    );
    execPlan = resumeRemaining.map((r) => {
      const plan = byIdentity.get(`${r.questionName} × ${r.modelName}`);
      if (!plan) {
        throw new Error(
          `Resume File Combo ${r.questionName} × ${r.modelName} is not part of the filtered Matrix — did the registry or questions change since the interruption?`
        );
      }
      return {
        ...plan,
        adoptedRun: r.inFlight
          ? {
              runDir: r.inFlight.runDir,
              completedInvocations: r.inFlight.completedInvocations,
            }
          : undefined,
      };
    });
  }
  const total = execPlan.length;

  // Resume File: created before the first Combo runs so interruption
  // protection exists from the start. Rewritten after every Combo
  // completion below; deleted only on normal Matrix completion — an
  // interrupted or aborted Matrix keeps it, listing the Combos that
  // still need work.
  const resume = resumeFilePath
    ? new ResumeTracker(resumeFilePath, {
        questionFilter,
        modelFilter,
        concurrency,
        piVersion,
      })
    : null;
  await resume?.start(
    execPlan.map((c) => ({
      questionName: c.question.name,
      modelName: c.model.name,
      comboId: c.comboId,
      // Resume mode seeds the carried-over in-flight state, so the file on
      // disk keeps pointing at the adopted run dir and its completed
      // invocations from the first rewrite.
      inFlight: c.adoptedRun
        ? {
            runDir: c.adoptedRun.runDir,
            completedInvocations: c.adoptedRun.completedInvocations,
          }
        : undefined,
    }))
  );

  const outcomes: RunComboOutcome[] = [];
  const completed = new Set<string>();
  // Per-combo end records for the index log's SUMMARY section. Each combo's
  // END line is self-contained, so the SUMMARY is a convenience that exists
  // only when the matrix returns normally (including an API-failure abort).
  const comboEndRecords: Array<{
    label: string;
    status: "ok" | "error";
    sessionJsonl: string | null;
  }> = [];
  const writeIndexSummary = (aborted?: string): void => {
    const failed = comboEndRecords.filter((r) => r.status !== "ok");
    runLog(
      `=== SUMMARY: ${comboEndRecords.length} combos, ${failed.length} failed` +
      (aborted ? ` — aborted: ${aborted}` : "")
    );
    for (const r of failed) {
      runLog(`  ${r.status.toUpperCase()} ${r.label} → ${r.sessionJsonl ?? "none"}`);
    }
  };

  // Heartbeat: one matrix-level timer (shared by all Combos) emits one
  // "(running)" line per in-flight Combo every heartbeatSeconds, so a long
  // turn never looks dead. Unref'd so it never keeps the process alive;
  // cleared on every exit path below (normal finish and the API-failure
  // abort alike) via try/finally.
  const inFlight = new Map<string, InFlightCombo>();
  const heartbeat = setInterval(() => {
    for (const combo of inFlight.values()) {
      const elapsed = Math.round((Date.now() - combo.startedAtMs) / 1000);
      const ticketSeg = combo.ticket ? `${combo.ticket} · ` : "";
      emitCombo(
        combo.model,
        combo.question,
        `· ${ticketSeg}turn ${combo.turn} (running) · ${elapsed}s`
      );
    }
  }, heartbeatSeconds * 1000);
  heartbeat.unref();

  try {
  // Model-major iteration: one model finishes all questions before the next
  for (const model of filteredModels) {
    // Concurrency: up to `concurrency` questions of THIS model execute
    // simultaneously, pulled from the queue head in their original order.
    // All completion handling (outcomes, END markers, progress overview)
    // is driven by combo completion, not by loop iteration.
    const queue = execPlan.filter((c) => c.model === model);
    // Set when any concurrent combo observes a terminal API failure: no
    // new combos are dequeued; in-flight combos finish and archive, then
    // the matrix aborts after the batch settles.
    let apiError: string | undefined;

    const runOne = async (plan: ComboPlan): Promise<void> => {
      const { question, comboId } = plan;
      const startedAt = new Date().toISOString();

      const comboIndex = execPlan.findIndex((c) => c.comboId === comboId) + 1;
      const label = `${question.name} × ${model.name}`;

      progress(`\n=== Combo ${comboIndex}/${total} ===`);
      progress(`Starting: ${label}`);
      // Console combo start: ticket count only for per-ticket Questions.
      const ticketCount =
        question.tickets.length >= 2 ? ` · ${question.tickets.length} tickets` : "";
      emitCombo(model.name, question.name, `▸ combo ${comboIndex}/${total} start${ticketCount}`);

      // In-flight state for the heartbeat: the combo's invocation loop
      // (inside runCombo) keeps it current; the entry leaves the map when
      // the combo settles, whether it archived, failed, or crashed.
      const heartbeatState: InFlightCombo = {
        model: model.name,
        question: question.name,
        ticket: null,
        turn: 0,
        startedAtMs: Date.now(),
      };
      inFlight.set(comboId, heartbeatState);

      // Delegate the per-combo execution to the extracted function.
      // It receives only explicit parameters and returns a structured result.
      let result: RunComboResult;
      try {
        result = await runCombo({
          question,
          model,
          comboId,
          comboIndex,
          total,
          label,
          startedAt,
          effectiveMaxTurns: model.maxTurns ?? maxTurns,
          sessionRoot,
          tempRoot,
          piBin,
          piHome,
          piVersion,
          runRules,
          adoptedRun: plan.adoptedRun,
          heartbeatState,
          loop,
          onRunDirReady: resume
            ? (runDir) => resume.comboStarted(comboId, runDir)
            : undefined,
          onInvocationComplete: resume
            ? (record) => resume.invocationCompleted(comboId, record)
            : undefined,
        });
      } finally {
        inFlight.delete(comboId);
      }

      const { outcome, apiError: comboApiError, archivedSessionJsonl, failReason } = result;

      outcomes.push(outcome);

      completed.add(comboId);
      const durSec = ((Date.now() - Date.parse(startedAt)) / 1000).toFixed(1);
      // Self-contained END marker for the index log: status, duration, and
      // the archived transcript path — greppable even when the matrix is
      // interrupted before the SUMMARY can be written.
      runLog(
        `=== Combo ${comboIndex}/${total} END: ${outcome.status.toUpperCase()} (${durSec}s) session: ` +
        (archivedSessionJsonl ?? `none${failReason ? ` (${failReason})` : ""}`) +
        ` ===`
      );
      comboEndRecords.push({ label, status: outcome.status, sessionJsonl: archivedSessionJsonl });

      // A Combo leaves the Resume File's remaining list once archived —
      // regardless of status ok/error. A Combo that crashed before
      // archiving (failReason) keeps its entry: the work still needs doing.
      if (!failReason) await resume?.comboArchived(comboId);

      const statusIcon = outcome.status === "ok" ? "✅" : "❌";
      progress(`=== Combo ${comboIndex}/${total} Done: ${statusIcon} ${outcome.status.toUpperCase()} (${durSec}s) ===`);
      // Console combo end: outcome + Combo-level elapsed (+ archived).
      const elapsedSec = Math.round((Date.now() - Date.parse(startedAt)) / 1000);
      emitCombo(
        model.name,
        question.name,
        outcome.status === "ok"
          ? `✔ ok · ${elapsedSec}s · archived`
          : `✘ error · ${elapsedSec}s${archivedSessionJsonl ? " · archived" : ""}`
      );

      // Progress overview: the console side is deleted outright (the
      // compact view replaced it); the index log keeps it unchanged.
      const lines = [`\nProgress:`];
      for (const plan of execPlan) {
        if (completed.has(plan.comboId)) {
          const o = outcomes.find((r) => r.comboId === plan.comboId)!;
          const d = (o.durationMs / 1000).toFixed(1);
          const ic = o.status === "ok" ? "✅" : "❌";
          lines.push(`  ${ic} ${plan.question.name} × ${plan.model.name}  ${o.status.toUpperCase()}  ${d}s`);
        } else {
          lines.push(`  ⏳ ${plan.question.name} × ${plan.model.name}  pending`);
        }
      }
      progress(lines.join("\n"));

      // A terminal API failure is infrastructure, not model behavior: stop
      // dequeuing; the matrix aborts once the in-flight batch settles.
      if (comboApiError) apiError = comboApiError;
    };

    const lanes = Array.from(
      { length: Math.min(concurrency, queue.length) },
      async () => {
        while (!apiError) {
          const plan = queue.shift();
          if (!plan) return;
          await runOne(plan);
        }
      }
    );
    await Promise.all(lanes);

    // A terminal API failure is infrastructure, not model behavior: stop
    // the whole matrix and wait for manual recovery instead of burning
    // the remaining combos on guaranteed failures.
    if (apiError) {
      progress(
        `\n⚠ Matrix aborted: terminal API failure (${apiError}).\n` +
        `Restore connectivity, then re-run the remaining combos.`
      );
      emitMatrix(
        `⚠ Matrix aborted: terminal API failure (${apiError}). ` +
        `Restore connectivity, then re-run the remaining combos.`
      );
      writeIndexSummary(apiError);
      return outcomes;
    }
  }
  } finally {
    clearInterval(heartbeat);
  }

  writeIndexSummary();
  // Normal completion: delete the Resume File so a leftover never
  // triggers a mistaken resume. (The API-failure abort above returns
  // early and deliberately keeps it.)
  await resume?.finish();
  return outcomes;
}

/**
 * Options for resuming an interrupted Matrix: the same execution
 * environment as a fresh run, minus the settings the Resume File restores
 * itself (filters, concurrency, its own path).
 */
export interface ResumeMatrixOptions extends PiEnvironment {
  /** Path to the question directory containing question subdirectories. */
  questionDir: string;
  /** Path to the config.toml file. */
  configPath: string;
  /** Root directory where archived sessions are stored. */
  sessionRoot: string;
  /**
   * Pi version re-detected for the new run's run.json records. The
   * recorded version is not checked — resume never blocks on a version
   * mismatch, it simply documents the version actually used now.
   */
  piVersion: string;
  /** Global run rules injected into every prompt. */
  runRules: string;
  /** Optional path of the matrix index log (see run-log.ts). */
  indexLogPath?: string;
}

/**
 * Operator overrides for a resumed Matrix. Question/model filters come
 * from the Resume File and are never re-narrowed.
 */
export interface ResumeMatrixOverrides {
  /**
   * Override the recorded Question-level Concurrency — the resume may
   * happen on different hardware or a busier machine.
   */
  concurrency?: number;
}

/**
 * Resume an interrupted Matrix from its Resume File (`resume` command).
 *
 * Loads and validates the file, restores the recorded filters and
 * concurrency (overridable), and delegates to the same engine as a fresh
 * run seeded with the file's remaining Combos and their in-flight state.
 * The engine re-validates registry and questions against the recorded
 * filters — unknown names fail fast exactly like a fresh run, before any
 * Combo runs. The same file (same path, same id) keeps being updated
 * during the resumed Matrix and is deleted on normal completion, so a
 * second interruption is equally recoverable.
 */
export async function resumeMatrix(
  resumeFilePath: string,
  options: ResumeMatrixOptions,
  overrides: ResumeMatrixOverrides = {}
): Promise<RunComboOutcome[]> {
  const file = await loadResumeFile(resumeFilePath);
  const concurrency = overrides.concurrency ?? file.concurrency;
  return runMatrix({
    ...options,
    questionFilter: file.questionFilter,
    modelFilter: file.modelFilter,
    concurrency,
    resumeFilePath,
    resumeRemaining: file.remaining,
  });
}

// ---------------------------------------------------------------------------
// Per-combo execution
// ---------------------------------------------------------------------------

/**
 * Parameters for a single combo execution. All values are read-only;
 * runCombo does not read or write any matrix-level mutable state.
 */
interface RunComboParams {
  question: Question;
  model: RegistryModel;
  comboId: string;
  comboIndex: number;
  total: number;
  label: string;
  startedAt: string;
  effectiveMaxTurns: number;
  sessionRoot: string;
  tempRoot: string;
  piBin: string;
  piHome: string;
  piVersion: string;
  runRules: string;
  /**
   * Optional callback fired once the combo's run dir exists — the dir
   * survives an interruption, so the Resume File can point at it.
   */
  onRunDirReady?: (runDir: string) => void;
  /**
   * Optional callback fired after each invocation completes, in execution
   * order, with the same record that goes into run.json's invocations.
   */
  onInvocationComplete?: (record: InvocationRecord) => void;
  /**
   * Optional live state shared with the matrix-level heartbeat timer: the
   * invocation loop below keeps the current ticket and turn up to date so
   * the heartbeat can render "(running)" lines while a long turn runs.
   */
  heartbeatState?: InFlightCombo;
  /**
   * Resume state for an interrupted Combo: adopt the recorded run dir and
   * carry the completed invocations into the new archive instead of
   * re-running them. Ignored for single-invocation Combos (they always
   * re-run whole) and when the recorded run dir is gone or unusable (the
   * Combo degrades to a full re-run on a fresh workdir).
   */
  adoptedRun?: {
    runDir: string;
    completedInvocations: InvocationRecord[];
  };
  /**
   * Loop detection settings (issue #21): present when config.toml has a
   * [loop_detector] section. The combo creates its detector from these.
   */
  loop?: {
    config: LoopDetectorConfig;
    supervisor: SupervisorEndpoint;
    judge?: JudgeFn;
  };
}

/**
 * Execute a single question × model combo in isolation.
 *
 * Handles workdir setup, invocation plan, per-ticket loop with
 * dirty/evaluation arbitration, archiving, run.json writing, and
 * workdir cleanup. Returns a structured result with the outcome and
 * metadata the matrix level needs.
 *
 * Does not read or write matrix-level mutable state (outcomes, completed,
 * comboEndRecords, apiError flags).
 */
async function runCombo(params: RunComboParams): Promise<RunComboResult> {
  const {
    question,
    model,
    comboId,
    comboIndex,
    total,
    label,
    startedAt,
    effectiveMaxTurns,
    sessionRoot,
    tempRoot,
    piBin,
    piHome,
    piVersion,
    runRules,
    onRunDirReady,
    onInvocationComplete,
    heartbeatState,
    adoptedRun,
    loop,
  } = params;

  // Combo-scoped console emission in the compact progress format. Elapsed
  // is always Combo-level, counted from combo start.
  const emit = (msg: string) => emitCombo(model.name, question.name, msg);
  const comboElapsed = () => Math.round((Date.now() - Date.parse(startedAt)) / 1000);

  /** Progress callbacks wiring an invocation into the compact console view. */
  const invocationCallbacks = (ticketSeg: string) => ({
    onTurn: (turn: number) => {
      if (heartbeatState) heartbeatState.turn = turn;
      emit(`· ${ticketSeg}turn ${turn} · ${comboElapsed()}s`);
    },
    onApiRetry: (retry: { attempt: number; maxAttempts: number; errorMessage: string }) =>
      emit(`⚠ API error ${retry.errorMessage} · retrying ${retry.attempt}/${retry.maxAttempts}`),
  });

  let status: "ok" | "error" = "ok";
  let exitCode: number | null = null;
  let durationMs: number;
  let endedAt: string;
  let maxTurnsExceeded = false;
  // Loop-defect marking (issue #21): set when the supervisor's kill
  // verdict aborted this Combo.
  let loopDetected = false;
  let loopConfidence: number | undefined;
  let loopReason: string | undefined;
  // Exception message when the combo crashed without archiving.
  let failReason: string | undefined;
  // Terminal API failure that aborts the whole matrix (recorded in
  // run.json); undefined while the combo is healthy.
  let apiError: string | undefined;
  // Absolute path of the archived session.jsonl for this combo (null
  // when the run produced no transcript or crashed before archiving).
  let archivedSessionJsonl: string | null = null;

  try {
    // Per-ticket flow (ADR 0007): one pi invocation per ticket when
    // tickets.md parses into >= 2 tickets; otherwise the classic
    // single-invocation flow with an unchanged prompt.
    const perTicket = question.tickets.length >= 2;

    // Resume: an interrupted Combo's recorded run dir is ADOPTED when it
    // survives and every completed invocation's transcript is still in
    // place — completed tickets are not re-run and their records and
    // session files flow into the new archive. Single-invocation Combos
    // have no useful in-flight state and always re-run whole; a missing
    // or unusable run dir degrades the Combo to a full re-run.
    let setup: WorkdirSetup | null = null;
    let seededRecords: InvocationRecord[] = [];
    let seededSessionFiles: string[] = [];
    if (adoptedRun && perTicket) {
      const candidate = await adoptWorkdir(adoptedRun.runDir);
      let seeds: string[] | null = null;
      if (candidate) {
        seeds = [];
        for (const record of adoptedRun.completedInvocations) {
          const sessionId = record.evaluation
            ? `t${record.ticket}-eval`
            : `t${record.ticket}`;
          const file = join(candidate.sessionDir, `${sessionId}.jsonl`);
          try {
            await stat(file);
            seeds.push(file);
          } catch {
            // A recorded invocation without its transcript cannot flow
            // into the archive — the run dir is unusable as a whole.
            seeds = null;
            break;
          }
        }
      }
      if (candidate && seeds) {
        setup = candidate;
        seededRecords = adoptedRun.completedInvocations;
        seededSessionFiles = seeds;
        // Every other transcript in the session dir is stale — above all
        // the interrupted invocation's half-written file: delete them so
        // they can neither leak into the archived transcript nor shadow a
        // fresh invocation's output (runInvocation picks up only files
        // that did not exist before the invocation).
        for (const f of await readdir(candidate.sessionDir)) {
          if (f.endsWith(".jsonl") && !seeds.includes(join(candidate.sessionDir, f))) {
            await rm(join(candidate.sessionDir, f), { force: true });
          }
        }
        log(
          `resuming Combo ${label}: adopted run dir ${basename(candidate.runDir)}, ` +
            `${seededRecords.length} completed invocation(s) carried over`
        );
      } else {
        log(
          `resuming Combo ${label}: recorded run dir is gone or unusable — falling back to a full re-run`
        );
      }
    }
    if (!setup) {
      setup = await setupWorkdir(question, tempRoot);
    }

    // Combo-scoped loop detector (issue #21): judges windows of the work
    // invocations' tool calls in the background; its sample log lives in
    // the session dir and is archived next to session.jsonl.
    const detector = loop
      ? new LoopDetector({
          config: loop.config,
          supervisor: loop.supervisor,
          combo: { model: model.name, question: question.name },
          sampleLogPath: join(setup.sessionDir, LOOP_SAMPLE_LOG_NAME),
          judge: loop.judge,
        })
      : null;
    runLog(
      `=== Combo ${comboIndex}/${total} START: ${label} (${basename(setup.runDir)}) ===`
    );
    onRunDirReady?.(setup.runDir);

    type Planned = { sessionId: string; prompt: string; ticket?: Ticket };
    const plan: Planned[] = perTicket
      ? question.tickets.map((t) => ({
          sessionId: `t${t.index}`,
          prompt: buildTicketPrompt(question, t, question.tickets.length, runRules),
          ticket: t,
        }))
      : [{ sessionId: "session", prompt: buildPrompt(question, runRules) }];
    log(`planned ${plan.length} invocation(s) for ${question.name}${perTicket ? " (per-ticket)" : ""}`);

    // Completed invocations carried over from the interrupted run seed
    // both the new run.json's invocation list and the archived transcript
    // concatenation; the Combo-level accumulators follow the last record.
    const invocations: InvocationRecord[] = [...seededRecords];
    const sessionFiles: string[] = [...seededSessionFiles];
    if (seededRecords.length > 0) {
      exitCode = seededRecords[seededRecords.length - 1].exitCode;
      maxTurnsExceeded = seededRecords.some((r) => r.maxTurnsExceeded);
    }

    /**
     * Arbitrate a dirty ticket invocation with an evaluation invocation
     * (ADR 0007). Pushes the evaluation's record and transcript and
     * returns false when the Combo must stop (terminal API failure or a
     * verdict other than COMPLETE).
     */
    const arbitrateDirtyTicket = async (step: Planned): Promise<boolean> => {
      const ticket = step.ticket!;
      const ticketSeg = `ticket ${ticket.index}/${plan.length} · `;
      progress(`  → ${step.sessionId}-eval: evaluating ticket ${ticket.index}`);
      if (heartbeatState) heartbeatState.turn = 0;
      emit(`· ${ticketSeg}evaluating (dirty invocation)`);
      const evalRes = await runInvocation({
        prompt: buildEvaluationPrompt(question, ticket, plan.length),
        workdir: setup!.workdir,
        sessionDir: setup!.sessionDir,
        sessionId: `${step.sessionId}-eval`,
        extraArgs: setup!.extraArgs,
        provider: model.provider,
        modelId: model.modelId,
        piBin,
        piHome,
        maxTurns: effectiveMaxTurns,
        ...invocationCallbacks(ticketSeg),
      });

      if (evalRes.sessionFile) sessionFiles.push(evalRes.sessionFile);
      if (evalRes.maxTurnsExceeded) {
        maxTurnsExceeded = true;
        emit(`✘ ${ticketSeg}evaluation killed: max turns (${effectiveMaxTurns}) exceeded`);
      }

      const evalToolErrors = evalRes.sessionFile
        ? await sessionHasWriteToolErrors(evalRes.sessionFile)
        : false;
      const evalDirty =
        evalRes.exitCode !== 0 || evalRes.maxTurnsExceeded || evalToolErrors;
      // A crashed or killed evaluation, or a missing/unparseable
      // verdict, is treated as INCOMPLETE (conservative abort).
      // Failed tool results inside the evaluation do NOT invalidate
      // an explicit verdict — the verdict marker is the evaluator's
      // deliberate final answer (a benign isError must not discard it).
      const verdict =
        evalRes.exitCode !== 0 || evalRes.maxTurnsExceeded || !evalRes.sessionFile
          ? null
          : await parseVerdict(evalRes.sessionFile);

      const evalRecord: InvocationRecord = {
        ticket: ticket.index,
        ticketTitle: ticket.title,
        evaluation: true,
        verdict,
        dirty: evalDirty,
        status: evalRes.exitCode === 0 && !evalRes.maxTurnsExceeded && !evalRes.apiError ? "ok" : "error",
        exitCode: evalRes.exitCode,
        maxTurnsExceeded: evalRes.maxTurnsExceeded,
        apiError: evalRes.apiError ?? undefined,
        durationMs: evalRes.durationMs,
      };
      invocations.push(evalRecord);
      onInvocationComplete?.(evalRecord);

      // Same infrastructure-failure rule as ticket invocations: an
      // evaluation that died from an API failure says nothing about
      // ticket completeness — abort the matrix, not just the run.
      if (evalRes.apiError) {
        progress(`  ✗ ${step.sessionId}-eval: terminal API failure (${evalRes.apiError})`);
        emit(`✘ ${ticketSeg}terminal API failure (${evalRes.apiError})`);
        status = "error";
        apiError = evalRes.apiError;
        return false;
      }

      if (verdict !== "complete") {
        // Distinguish an explicit INCOMPLETE from a missing/unparseable
        // verdict marker — the log must not misattribute the cause.
        const reason = verdict === null
          ? "no verdict marker found in evaluation (treated as INCOMPLETE)"
          : "judged INCOMPLETE by evaluation";
        progress(`  ✗ ticket ${ticket.index}: ${reason} — aborting run`);
        emit(`✘ ${ticketSeg}${reason} — aborting run`);
        status = "error";
        return false;
      }
      progress(`  ✓ ticket ${ticket.index} judged complete despite dirty signals`);
      emit(`✔ ${ticketSeg}judged complete despite dirty signals`);
      return true;
    };

    for (const step of plan) {
      // Resume: invocations completed before the interruption are carried,
      // never re-run. A ticket whose dirty main invocation completed but
      // whose arbitration never finished still needs its evaluation.
      if (seededRecords.length > 0 && step.ticket) {
        const mainRecord = seededRecords.find(
          (r) => r.ticket === step.ticket!.index && !r.evaluation
        );
        if (mainRecord) {
          const evalRecord = seededRecords.find(
            (r) => r.ticket === step.ticket!.index && r.evaluation
          );
          if (!mainRecord.dirty || evalRecord) {
            progress(
              `  ↷ ${step.sessionId}: ticket ${step.ticket.index} completed before the interruption — skipping`
            );
            emit(`· ticket ${step.ticket.index}/${plan.length} · skipped (completed before the interruption)`);
            continue;
          }
          if (!(await arbitrateDirtyTicket(step))) break;
          continue;
        }
        progress(
          `  → ${step.sessionId}: re-running the interrupted ticket from scratch in a fresh session`
        );
      }

      const stepLabel = step.ticket
        ? `ticket ${step.ticket.index}/${plan.length}: ${step.ticket.title}`
        : "single invocation";
      progress(`  → ${step.sessionId}: ${stepLabel}`);

      // Ticket start (console): single-invocation Questions omit the
      // ticket segment — they get turn lines only.
      const ticketSeg = step.ticket
        ? `ticket ${step.ticket.index}/${plan.length} · `
        : "";
      if (heartbeatState) {
        heartbeatState.ticket = step.ticket
          ? `ticket ${step.ticket.index}/${plan.length}`
          : null;
        heartbeatState.turn = 0;
      }
      if (step.ticket) {
        const rerunNote = seededRecords.length > 0 ? " (re-running after the interruption)" : "";
        emit(`▸ ticket ${step.ticket.index}/${plan.length} · ${step.ticket.title}${rerunNote}`);
      }
      const res = await runInvocation({
        prompt: step.prompt,
        workdir: setup.workdir,
        sessionDir: setup.sessionDir,
        sessionId: step.sessionId,
        extraArgs: setup.extraArgs,
        provider: model.provider,
        modelId: model.modelId,
        piBin,
        piHome,
        maxTurns: effectiveMaxTurns,
        ...invocationCallbacks(ticketSeg),
        // Loop detection monitors WORK invocations only — evaluation
        // invocations (arbitrateDirtyTicket) never get a monitor.
        ...(detector
          ? {
              loop: {
                detector,
                invocationIndex: sessionFiles.length + 1,
                ticket: step.ticket?.index,
                sessionLineOffset: await countSessionLines(sessionFiles),
              },
            }
          : {}),
      });

      if (res.sessionFile) sessionFiles.push(res.sessionFile);
      exitCode = res.exitCode;
      if (res.maxTurnsExceeded) {
        maxTurnsExceeded = true;
        emit(`✘ ${ticketSeg}killed: max turns (${effectiveMaxTurns}) exceeded`);
      }
      if (res.loopDetected) {
        loopDetected = true;
        loopConfidence = res.loopConfidence;
        loopReason = res.loopReason;
      }

      const toolErrors = res.sessionFile
        ? await sessionHasWriteToolErrors(res.sessionFile)
        : false;
      // Dirty signals: non-zero exit, max-turns kill, or a failed
      // write-side tool result (read-only tool failures are benign).
      const dirty = res.exitCode !== 0 || res.maxTurnsExceeded || toolErrors;

      const record: InvocationRecord = {
        ticket: step.ticket?.index,
        ticketTitle: step.ticket?.title,
        dirty,
        status: res.exitCode === 0 && !res.maxTurnsExceeded && !res.apiError ? "ok" : "error",
        exitCode: res.exitCode,
        maxTurnsExceeded: res.maxTurnsExceeded,
        loopDetected: res.loopDetected || undefined,
        apiError: res.apiError ?? undefined,
        durationMs: res.durationMs,
      };
      invocations.push(record);
      onInvocationComplete?.(record);

      // Loop kill (issue #21): the Combo is a loop defect — skip
      // evaluation and all remaining tickets and archive it as "error",
      // but let the Matrix continue with the next Combo.
      if (res.loopDetected) {
        progress(`  ✗ ${step.sessionId}: loop detected (confidence ${res.loopConfidence}) — aborting the Combo`);
        emit(`✘ ${ticketSeg}loop detected (confidence ${res.loopConfidence}) — combo killed`);
        status = "error";
        break;
      }

      // Infrastructure failure (network outage etc.): every subsequent
      // invocation would fail the same way, so skip evaluation, fail the
      // combo, and abort the whole matrix for manual recovery.
      if (res.apiError) {
        progress(`  ✗ ${step.sessionId}: terminal API failure (${res.apiError})`);
        emit(`✘ ${ticketSeg}terminal API failure (${res.apiError})`);
        status = "error";
        apiError = res.apiError;
        break;
      }

      if (!perTicket) {
        if (res.exitCode !== 0) status = "error";
        continue;
      }

      if (dirty && step.ticket) {
        // Arbitrate: an evaluation invocation decides whether the ticket
        // was actually completed despite the dirty signals.
        if (!(await arbitrateDirtyTicket(step))) break;
      }
    }

    durationMs = Date.now() - Date.parse(startedAt);

    // Determine archive directory: sessionRoot/<question>/<model>/<timestamp>/
    const timestamp = formatTimestamp(new Date());
    const archiveDir = join(
      sessionRoot,
      question.name,
      model.name,
      timestamp
    );
    await mkdir(archiveDir, { recursive: true });

    // Copy artifacts from workdir to archive
    await copyArtifacts(setup.workdir, archiveDir);
    log(`archived to: ${archiveDir}`);

    // Concatenate the invocations' transcripts into session.jsonl
    await concatenateSessions(sessionFiles, archiveDir);
    if (sessionFiles.length > 0) {
      archivedSessionJsonl = join(archiveDir, "session.jsonl");
    }

    // Loop detection: settle in-flight judgments now that every
    // invocation has ended (judging never blocked them), then archive
    // loop-detect.jsonl next to session.jsonl.
    if (detector) {
      await detector.close();
      try {
        await copyFile(
          join(setup.sessionDir, LOOP_SAMPLE_LOG_NAME),
          join(archiveDir, LOOP_SAMPLE_LOG_NAME)
        );
      } catch (err) {
        // No judgments at all → no sample log → nothing to archive.
        if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
      }
    }

    // Strip image data from session.jsonl to keep archive size manageable
    await stripSessionImageData(archiveDir);

    // Validate artifact contract against files in workdir
    const workdirFiles = await readdir(setup.workdir);
    const contractViolations = validateArtifactContract(workdirFiles);

    // A Session is transcript + artifact, inseparable — flag a missing transcript
    if (sessionFiles.length === 0) {
      contractViolations.push("missing transcript: session.jsonl");
    }
    if (contractViolations.length > 0) {
      log(`contract violations: ${contractViolations.join("; ")}`);
    }

    endedAt = new Date().toISOString();

    // Write run.json
    const runJson: RunJson = {
      question: {
        name: question.name,
        hasSpec: question.hasSpec,
        hasTickets: question.hasTickets,
      },
      model: {
        name: model.name,
        provider: model.provider,
        modelId: model.modelId,
      },
      params: model.params,
      comboId,
      piVersion,
      startedAt,
      endedAt,
      durationMs,
      status,
      exitCode,
      maxTurnsExceeded,
      maxTurns: effectiveMaxTurns,
      contractViolations,
      invocations: perTicket ? invocations : undefined,
      apiError,
    };

    // Loop-defect marking (issue #21): recorded only when the feature is
    // configured — a disabled detector leaves run.json untouched.
    if (detector) {
      runJson.loopDetected = loopDetected;
      if (loopDetected) {
        runJson.loopConfidence = loopConfidence;
        runJson.loopReason = loopReason;
      }
    }

    await writeFile(
      join(archiveDir, "run.json"),
      JSON.stringify(runJson, null, 2),
      "utf-8"
    );
    log(`wrote run.json to archive`);

    // Delete the isolated run directory (workdir + session dir) after archiving
    await rm(setup.runDir, { recursive: true, force: true });
    log(`deleted run dir`);
  } catch (err: unknown) {
    // Record the failure but continue with the matrix
    durationMs = Date.now() - Date.parse(startedAt);
    endedAt = new Date().toISOString();
    status = "error";
    exitCode = null;

    const message =
      err instanceof Error ? err.message : String(err);
    failReason = message;
    runLog(`[runMatrix] Combo ${question.name} × ${model.name} failed: ${message}`);
    emit(`✘ error: ${message}`);
  }

  const outcome: RunComboOutcome = {
    question,
    model,
    comboId,
    startedAt,
    endedAt,
    durationMs,
    status,
    exitCode,
    maxTurnsExceeded,
  };

  return { outcome, apiError, archivedSessionJsonl, failReason };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

/**
 * Parse comma-separated filter values from argv.
 */
function parseFilter(arg: string | undefined): string[] | undefined {
  if (!arg || arg.trim().length === 0) return undefined;
  return arg
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const execFileAsync = promisify(execFile);

/**
 * Detect the pi version by running `pi --version`. Falls back to "unknown".
 */
async function detectPiVersion(piBin: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(piBin, ["--version"]);
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

/**
 * Print the per-combo status table and exit non-zero on any failure.
 */
function printOutcomes(outcomes: RunComboOutcome[]): void {
  console.log("\n=== Run Matrix Results ===\n");
  console.log(
    ["Question", "Model", "Status", "Exit", "Duration", "ComboId"].join("\t")
  );
  console.log("-".repeat(80));

  for (const o of outcomes) {
    const durSec = (o.durationMs / 1000).toFixed(1);
    console.log(
      [o.question.name, o.model.name, o.status, o.exitCode ?? "N/A", `${durSec}s`, o.comboId].join(
        "\t"
      )
    );
  }

  console.log(`\nTotal: ${outcomes.length} combo(s)`);
  const failures = outcomes.filter((o) => o.status !== "ok").length;
  if (failures > 0) {
    console.log(`Failures: ${failures}`);
    process.exit(1);
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes("--help")) {
    console.log(`usage: bun run main [--question <names>] [--model <ids>] [--concurrency N]
       bun run main resume <resume-file> [--concurrency N]

Run the Matrix: every Question against every Model, one Combo at a time.

Commands:
  (default)                Run the Matrix, optionally filtered.
  resume <resume-file>     Resume an interrupted Matrix from its Resume File
                           (matrix-resume-<timestamp>.json). The recorded
                           question/model filters are restored automatically,
                           so --question/--model are not accepted here.

Options:
  --question <names>       Comma-separated Question names to run (default: all).
  --model <ids>            Comma-separated Model ids to run (default: all).
  --concurrency N          Question-level concurrency within one Model;
                           must be a positive integer (default: 1). On resume,
                           overrides the value recorded in the Resume File.
  --help                   Show this help text and exit.`);
    process.exit(0);
  }

  // One positional subcommand, `resume <path>`: recovery is a deliberate
  // act that can never happen by accident. Everything else stays
  // flag-based.
  const isResume = args[0] === "resume";
  const flagArgs = isResume ? args.slice(1) : args;
  let resumePath: string | undefined;
  if (isResume) {
    resumePath =
      flagArgs[0] && !flagArgs[0].startsWith("--") ? flagArgs.shift() : undefined;
    if (!resumePath) {
      console.error(
        "usage: bun run main resume <resume-file> [--concurrency N]"
      );
      process.exit(1);
    }
  }

  // Parse CLI arguments
  let questionFilter: string[] | undefined;
  let modelFilter: string[] | undefined;
  let concurrency: number | undefined;

  for (let i = 0; i < flagArgs.length; i++) {
    switch (flagArgs[i]) {
      case "--question":
        questionFilter = parseFilter(flagArgs[++i]);
        break;
      case "--model":
        modelFilter = parseFilter(flagArgs[++i]);
        break;
      case "--concurrency": {
        // Question-level concurrency within one model; default 1. Invalid
        // values abort at startup — a typo must not surface hours in.
        const raw = flagArgs[++i];
        const parsed = raw === undefined ? NaN : Number(raw);
        if (!Number.isInteger(parsed) || parsed < 1) {
          console.error(
            `error: --concurrency must be a positive integer (got "${raw}")`
          );
          process.exit(1);
        }
        concurrency = parsed;
        break;
      }
    }
  }

  // The Resume File restores the recorded filters automatically; letting
  // the operator re-narrow them would silently change the original intent.
  if (isResume && (questionFilter || modelFilter)) {
    console.error(
      "error: resume restores the recorded filters from the Resume File; --question/--model are not accepted"
    );
    process.exit(1);
  }

  // Determine repo root (parent of runner/)
  const repoRoot = resolve(__dirname, "..", "..");
  const piBin = join(repoRoot, "runner", "node_modules", ".bin", "pi");

  // Load runner config
  const configPath = join(repoRoot, "runner", "config.toml");
  const config = await loadConfig(configPath);

  const sharedOptions = {
    questionDir: join(repoRoot, "question"),
    configPath,
    sessionRoot: join(repoRoot, "session"),
    piBin,
    piHome: join(repoRoot, ".pi-home"),
    tempRoot: join(tmpdir(), "llm-interview-runs"),
    maxTurns: config.maxTurns,
    heartbeatSeconds: config.heartbeatSeconds,
    runRules: config.runRules,
  };

  let outcomes: RunComboOutcome[];
  if (isResume) {
    const resolvedResumePath = resolve(resumePath!);
    // Pair the resumed run's index log with the Resume File it continues:
    // same timestamp id, same directory (pi-run-<ts>.log pairs with
    // matrix-resume-<ts>.json), so log and resume state stay together
    // across the interruption. A file named otherwise gets a fresh
    // timestamped log in the cwd.
    const nameMatch = basename(resolvedResumePath).match(
      /^matrix-resume-(.+)\.json$/
    );
    const indexLogPath = nameMatch
      ? join(dirname(resolvedResumePath), `pi-run-${nameMatch[1]}.log`)
      : join(process.cwd(), `pi-run-${formatTimestamp(new Date())}.log`);
    setRunLogPath(indexLogPath);
    log(`writing index log: ${indexLogPath}`);
    log(`resuming from Resume File: ${resolvedResumePath}`);

    try {
      outcomes = await resumeMatrix(
        resolvedResumePath,
        {
          ...sharedOptions,
          indexLogPath,
          // The pi version is re-detected for the new run's run.json
          // records — resume never blocks on a version mismatch.
          piVersion: await detectPiVersion(piBin).then((v) => {
            log(`pi --version => ${v}`);
            return v;
          }),
        },
        { concurrency }
      );
    } catch (err) {
      // A missing/invalid Resume File or a startup failure (unknown model
      // id, isolation guard, ...) aborts before any combo runs — report
      // cleanly and leave a trace in the index log.
      const message = err instanceof Error ? err.message : String(err);
      runLog(`=== MATRIX FAILED: ${message} ===`);
      console.error(`error: ${message}`);
      process.exit(1);
    }
  } else {
    // One timestamp id per matrix execution, shared by the index log and
    // the Resume File so log and resume state pair up naturally. Both live
    // in the current working directory (see run-log.ts and resume.ts).
    const matrixTimestamp = formatTimestamp(new Date());
    const indexLogPath = join(
      process.cwd(),
      `pi-run-${matrixTimestamp}.log`
    );
    const resumeFilePath = join(
      process.cwd(),
      `matrix-resume-${matrixTimestamp}.json`
    );
    setRunLogPath(indexLogPath);
    log(`writing index log: ${indexLogPath}`);
    log(`writing Resume File: ${resumeFilePath}`);

    // Run the matrix with defaults
    try {
      outcomes = await runMatrix({
        ...sharedOptions,
        questionFilter,
        modelFilter,
        concurrency,
        indexLogPath,
        resumeFilePath,
        piVersion: await detectPiVersion(piBin).then((v) => {
          log(`pi --version => ${v}`);
          return v;
        }),
      });
    } catch (err) {
      // Startup failures (unknown model id, isolation guard, ...) abort before
      // any combo runs — leave a trace in the index log.
      const message = err instanceof Error ? err.message : String(err);
      runLog(`=== MATRIX FAILED: ${message} ===`);
      throw err;
    }
  }

  printOutcomes(outcomes);
}
