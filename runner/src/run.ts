import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  copyFile,
  rm,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { loadConfig, loadRegistry, type RegistryModel } from "./registry";
import { loadQuestions, type Question } from "./question";
import { buildPrompt } from "./prompt";
import { runPi, type PiEnvironment, type PiRunResult } from "./pi-runner";

const log = (msg: string) => {
  if (process.env.NODE_ENV !== "test") console.error(`[matrix] ${msg}`);
};
const progress = (msg: string) => {
  if (process.env.NODE_ENV !== "test") console.log(msg);
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
   * Effective max turn limit for this run (model-level override if set,
   * otherwise the global config value).
   */
  maxTurns: number;
  /** Artifact contract violation messages (empty if compliant). */
  contractViolations: string[];
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
    "session.jsonl",
    "run.json",
    "pi-output.log",
    "spec.md",
    "tickets.md",
    ".skills",
  ]);
  for (const f of actual) {
    if (!expected.has(f) && !allowedExtras.has(f)) {
      violations.push(`unexpected file: ${f}`);
    }
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
 * Copy artifact files (.html, .css, .js) and session.jsonl from workdir to archive.
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
    // Copy session.jsonl and all artifact files
    if (f === "session.jsonl" || artifactExtensions.has(ext)) {
      await copyFile(join(workdir, f), join(archiveDir, f));
      copied.push(f);
    }
  }

  return copied;
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
      `Unknown ${kind} filter name(s): ${unknown.join(", ")}.`
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
  } = options;

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
  const models = await loadRegistry(configPath);
  const questions = await loadQuestions(questionDir);
  log(`loaded ${models.length} models, ${questions.length} questions`);

  const filteredModels = applyNameFilter(models, modelFilter, "model", (m) => m.modelId);
  const filteredQuestions = applyNameFilter(questions, questionFilter, "question", (q) => q.name);
  if (filteredModels.length !== models.length || filteredQuestions.length !== questions.length) {
    log(`filtered to ${filteredModels.length} models \u00d7 ${filteredQuestions.length} questions = ${filteredModels.length * filteredQuestions.length} combos`);
  }

  // Pre-compute the full combo list for progress tracking
  type ComboPlan = { model: typeof filteredModels[number]; question: typeof filteredQuestions[number]; comboId: string };
  const comboPlan: ComboPlan[] = [];
  for (const model of filteredModels) {
    for (const question of filteredQuestions) {
      comboPlan.push({ model, question, comboId: computeComboId(question.name, model.name, model.params) });
    }
  }
  const total = comboPlan.length;

  const outcomes: RunComboOutcome[] = [];
  const completed = new Set<string>();

  // Model-major iteration: one model finishes all questions before the next
  for (const model of filteredModels) {
    for (const question of filteredQuestions) {
      const comboId = computeComboId(question.name, model.name, model.params);
      const startedAt = new Date().toISOString();

      const comboIndex = comboPlan.findIndex((c) => c.comboId === comboId) + 1;
      const label = `${question.name} \u00d7 ${model.name}`;

      progress(`\n=== Combo ${comboIndex}/${total} ===`);
      progress(`Starting: ${label}`);

      let status: "ok" | "error" = "ok";
      let exitCode: number | null;
      let durationMs: number;
      let maxTurnsExceeded = false;
      // A model may override the global max turn limit when it needs
      // more attempts to finish a task.
      const effectiveMaxTurns = model.maxTurns ?? maxTurns;

      try {
        // Build prompt for this question
        const prompt = buildPrompt(question, runRules);
        log(`built prompt (${prompt.length} chars) for ${question.name}`);

        // Run pi in an isolated workdir
        const result: PiRunResult = await runPi({
          prompt,
          question,
          provider: model.provider,
          modelId: model.modelId,
          piBin,
          piHome,
          tempRoot,
          maxTurns: effectiveMaxTurns,
        });

        durationMs = result.durationMs;
        exitCode = result.exitCode;
        maxTurnsExceeded = result.maxTurnsExceeded;

        if (result.exitCode !== 0) {
          status = "error";
        }

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
        await copyArtifacts(result.workdir, archiveDir);
        log(`archived to: ${archiveDir}`);

        // Strip image data from session.jsonl to keep archive size manageable
        await stripSessionImageData(archiveDir);

        // Validate artifact contract against files in workdir
        const workdirFiles = await readdir(result.workdir);
        const contractViolations = validateArtifactContract(workdirFiles);

        // A Session is transcript + artifact, inseparable — flag a missing transcript
        if (!result.sessionFile) {
          contractViolations.push("missing transcript: session.jsonl");
        }
        if (contractViolations.length > 0) {
          log(`contract violations: ${contractViolations.join("; ")}`);
        }

        const endedAt = new Date().toISOString();

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
        };

        await writeFile(
          join(archiveDir, "run.json"),
          JSON.stringify(runJson, null, 2),
          "utf-8"
        );
        log(`wrote run.json to archive`);

        // Delete the isolated workdir after archiving
        await rm(result.workdir, { recursive: true, force: true });
        log(`deleted workdir`);

        outcomes.push({
          question,
          model,
          comboId,
          startedAt,
          endedAt,
          durationMs,
          status,
          exitCode,
          maxTurnsExceeded,
        });
      } catch (err: unknown) {
        // Record the failure but continue with the matrix
        durationMs = Date.now() - Date.parse(startedAt);
        const endedAt = new Date().toISOString();
        status = "error";
        exitCode = null;

        const message =
          err instanceof Error ? err.message : String(err);
        console.error(
          `[runMatrix] Combo ${question.name} × ${model.name} failed: ${message}`
        );

        outcomes.push({
          question,
          model,
          comboId,
          startedAt,
          endedAt,
          durationMs,
          status,
          exitCode,
          maxTurnsExceeded,
        });
      }

      completed.add(comboId);
      const durSec = ((Date.now() - Date.parse(startedAt)) / 1000).toFixed(1);
      const statusIcon = status === "ok" ? "\u2705" : "\u274c";
      progress(`=== Combo ${comboIndex}/${total} Done: ${statusIcon} ${status.toUpperCase()} (${durSec}s) ===`);

      // Print progress overview
      const lines = [`\nProgress:`];
      for (const plan of comboPlan) {
        if (completed.has(plan.comboId)) {
          const o = outcomes.find((r) => r.comboId === plan.comboId)!;
          const d = (o.durationMs / 1000).toFixed(1);
          const ic = o.status === "ok" ? "\u2705" : "\u274c";
          lines.push(`  ${ic} ${plan.question.name} \u00d7 ${plan.model.name}  ${o.status.toUpperCase()}  ${d}s`);
        } else {
          lines.push(`  \u23f3 ${plan.question.name} \u00d7 ${plan.model.name}  pending`);
        }
      }
      progress(lines.join("\n"));
    }
  }

  return outcomes;
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

if (import.meta.main) {
  const args = process.argv.slice(2);

  // Parse CLI arguments
  let questionFilter: string[] | undefined;
  let modelFilter: string[] | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--question":
        questionFilter = parseFilter(args[++i]);
        break;
      case "--model":
        modelFilter = parseFilter(args[++i]);
        break;
    }
  }

  // Determine repo root (parent of runner/)
  const repoRoot = resolve(__dirname, "..", "..");
  const piBin = join(repoRoot, "runner", "node_modules", ".bin", "pi");

  // Load runner config
  const configPath = join(repoRoot, "runner", "config.toml");
  const config = await loadConfig(configPath);

  // Run the matrix with defaults
  const outcomes = await runMatrix({
    questionDir: join(repoRoot, "question"),
    configPath,
    sessionRoot: join(repoRoot, "session"),
    piBin,
    piHome: join(repoRoot, ".pi-home"),
    tempRoot: join(tmpdir(), "llm-interview-runs"),
    questionFilter,
    modelFilter,
    maxTurns: config.maxTurns,
    runRules: config.runRules,
    piVersion: await detectPiVersion(piBin).then((v) => {
      log(`pi --version => ${v}`);
      return v;
    }),
  });

  // Print per-combo status table
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
