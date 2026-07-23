import {
  mkdir,
  writeFile,
  readdir,
  copyFile,
  rm,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { loadRegistry, type RegistryModel } from "./registry";
import { loadQuestions, type Question } from "./question";
import { buildPrompt } from "./prompt";
import { runPi, type PiEnvironment, type PiRunResult } from "./pi-runner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Options for running the full question × model matrix.
 */
export interface RunMatrixOptions extends PiEnvironment {
  /** Path to the question directory containing question subdirectories. */
  questionDir: string;
  /** Path to the models.registry.json file. */
  registryPath: string;
  /** Root directory where archived sessions are stored. */
  sessionRoot: string;
  /** Optional list of question names to include (match by name). */
  questionFilter?: string[];
  /** Optional list of model names to include (match by name). */
  modelFilter?: string[];
  /** Pi version string to record in run.json. */
  piVersion: string;
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
  /** Run status: "ok", "timeout", or "error". */
  status: "ok" | "timeout" | "error";
  /** Exit code from pi, or null if killed by timeout. */
  exitCode: number | null;
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
  /** Run status: "ok", "timeout", or "error". */
  status: "ok" | "timeout" | "error";
  /** Exit code from pi, or null if killed by timeout. */
  exitCode: number | null;
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
  ]);
  for (const f of actual) {
    if (!expected.has(f) && !allowedExtras.has(f)) {
      violations.push(`unexpected file: ${f}`);
    }
  }

  return violations;
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
function applyNameFilter<T extends { name: string }>(
  items: T[],
  filter: string[] | undefined,
  kind: string
): T[] {
  if (!filter || filter.length === 0) return items;
  const names = new Set(items.map((i) => i.name));
  const unknown = filter.filter((n) => !names.has(n));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown ${kind} filter name(s): ${unknown.join(", ")}. Available ${kind}s: ${[...names]
        .sort()
        .join(", ")}`
    );
  }
  return items.filter((i) => filter.includes(i.name));
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
    registryPath,
    sessionRoot,
    piBin,
    piHome,
    tempRoot,
    timeoutMs,
    questionFilter,
    modelFilter,
    piVersion,
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
  const models = await loadRegistry(registryPath);
  const questions = await loadQuestions(questionDir);

  const filteredModels = applyNameFilter(models, modelFilter, "model");
  const filteredQuestions = applyNameFilter(questions, questionFilter, "question");

  const outcomes: RunComboOutcome[] = [];

  // Model-major iteration: one model finishes all questions before the next
  for (const model of filteredModels) {
    for (const question of filteredQuestions) {
      const comboId = computeComboId(question.name, model.name, model.params);
      const startedAt = new Date().toISOString();

      let status: "ok" | "timeout" | "error" = "ok";
      let exitCode: number | null;
      let durationMs: number;

      try {
        // Build prompt for this question
        const prompt = buildPrompt(question);

        // Run pi in an isolated workdir
        const result: PiRunResult = await runPi({
          prompt,
          question,
          provider: model.provider,
          modelId: model.modelId,
          piBin,
          piHome,
          tempRoot,
          timeoutMs,
        });

        durationMs = result.durationMs;
        exitCode = result.exitCode;

        if (result.timedOut) {
          status = "timeout";
        } else if (result.exitCode !== 0) {
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

        // Validate artifact contract against files in workdir
        const workdirFiles = await readdir(result.workdir);
        const contractViolations = validateArtifactContract(workdirFiles);

        // A Session is transcript + artifact, inseparable — flag a missing transcript
        if (!result.sessionFile) {
          contractViolations.push("missing transcript: session.jsonl");
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
          contractViolations,
        };

        await writeFile(
          join(archiveDir, "run.json"),
          JSON.stringify(runJson, null, 2),
          "utf-8"
        );

        // Delete the isolated workdir after archiving
        await rm(result.workdir, { recursive: true, force: true });

        outcomes.push({
          question,
          model,
          comboId,
          startedAt,
          endedAt,
          durationMs,
          status,
          exitCode,
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
        });
      }
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
  let timeoutMs = 600000; // 10 minutes default

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--question":
        questionFilter = parseFilter(args[++i]);
        break;
      case "--model":
        modelFilter = parseFilter(args[++i]);
        break;
      case "--timeout-ms":
        timeoutMs = parseInt(args[++i] || "600000", 10);
        break;
    }
  }

  // Determine repo root (parent of runner/)
  const repoRoot = resolve(__dirname, "..", "..");
  const piBin = join(repoRoot, "runner", "node_modules", ".bin", "pi");

  // Run the matrix with defaults
  const outcomes = await runMatrix({
    questionDir: join(repoRoot, "question"),
    registryPath: join(repoRoot, "runner", "models.registry.json"),
    sessionRoot: join(repoRoot, "session"),
    piBin,
    piHome: join(repoRoot, ".pi-home"),
    tempRoot: join(tmpdir(), "llm-interview-runs"),
    timeoutMs,
    questionFilter,
    modelFilter,
    piVersion: await detectPiVersion(piBin),
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
