import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  copyFile,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import type { RunJson } from "./run";

const warn = (msg: string) => {
  if (process.env.NODE_ENV !== "test") console.error(`[manifest] ${msg}`);
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Older run.json files may predate newer RunJson fields — parse leniently
 * and carry those fields through only when present.
 */
type ArchivedRunJson = Omit<RunJson, "maxTurns" | "maxTurnsExceeded"> &
  Partial<Pick<RunJson, "maxTurns" | "maxTurnsExceeded">>;

/**
 * One Combo entry in the generated Manifest (see docs/spec.md).
 */
export interface ManifestCombo {
  /** Sha256-based combo ID (first 12 hex chars). */
  comboId: string;
  /** Question metadata. */
  question: RunJson["question"];
  /** Model metadata. */
  model: RunJson["model"];
  /** Sampling parameter snapshot used for the run. */
  params: RunJson["params"];
  /** Pi version string. */
  piVersion: string;
  /** ISO timestamp when the run started. */
  startedAt: string;
  /** ISO timestamp when the run ended. */
  endedAt: string;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Run status: "ok" or "error" ("timeout" may appear in older archives). */
  status: RunJson["status"];
  /** Artifact contract violation messages (empty if compliant). */
  contractViolations: string[];
  /** Present only when recorded in run.json. */
  maxTurnsExceeded?: boolean;
  /** Present only when recorded in run.json. */
  maxTurns?: number;
  /**
   * Files published for this combo, keyed by role; paths relative to outDir.
   * Only files that actually exist in the Session are listed.
   */
  files: Partial<
    Record<"artifact" | "style" | "script" | "transcript" | "run", string>
  >;
}

/**
 * The generated Manifest written to <outDir>/manifest.json.
 */
export interface Manifest {
  /** ISO timestamp when the manifest was generated. */
  generatedAt: string;
  /** Latest Run per Combo, sorted by question name then model name. */
  combos: ManifestCombo[];
}

/**
 * Options for buildManifest.
 */
export interface BuildManifestOptions {
  /** Root directory holding the full session history. */
  sessionRoot: string;
  /** Output directory for manifest.json and the flattened sessions/. */
  outDir: string;
}

/**
 * A run.json found in the session history plus its location.
 */
interface ArchivedRun {
  run: ArchivedRunJson;
  /** Absolute path of the session directory (…/<question>/<model>/<datetime>). */
  dir: string;
  /** Name of the datetime directory; final tiebreak for "latest". */
  datetimeDir: string;
}

/** Session file name → manifest files key. */
const PUBLISHED_FILES: ReadonlyArray<[string, keyof ManifestCombo["files"]]> = [
  ["index.html", "artifact"],
  ["style.css", "style"],
  ["script.js", "script"],
  ["session.jsonl", "transcript"],
  ["run.json", "run"],
];

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

/**
 * List immediate subdirectories of a directory ([] if it does not exist).
 */
async function listDirs(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw err;
  }
}

/**
 * Read every run.json under sessionRoot/<question>/<model>/<datetime>/.
 * Directories without a parseable run.json are skipped with a warning.
 */
async function collectRuns(sessionRoot: string): Promise<ArchivedRun[]> {
  const runs: ArchivedRun[] = [];
  for (const question of await listDirs(sessionRoot)) {
    for (const model of await listDirs(join(sessionRoot, question))) {
      for (const datetimeDir of await listDirs(join(sessionRoot, question, model))) {
        const dir = join(sessionRoot, question, model, datetimeDir);
        let run: ArchivedRunJson;
        try {
          run = JSON.parse(
            await readFile(join(dir, "run.json"), "utf-8")
          ) as ArchivedRunJson;
        } catch {
          warn(`skipping ${dir}: no parseable run.json`);
          continue;
        }
        runs.push({ run, dir, datetimeDir });
      }
    }
  }
  return runs;
}

/**
 * Keep the latest run per comboId: max startedAt, tiebreak by endedAt,
 * then by datetime directory name.
 */
function latestPerCombo(runs: ArchivedRun[]): ArchivedRun[] {
  const byCombo = new Map<string, ArchivedRun>();
  for (const candidate of runs) {
    const current = byCombo.get(candidate.run.comboId);
    if (!current || isLater(candidate, current)) {
      byCombo.set(candidate.run.comboId, candidate);
    }
  }
  return [...byCombo.values()];
}

function isLater(a: ArchivedRun, b: ArchivedRun): boolean {
  // ISO timestamps and YYYYMMDD-HHmmss directory names both sort lexicographically.
  if (a.run.startedAt !== b.run.startedAt) return a.run.startedAt > b.run.startedAt;
  if (a.run.endedAt !== b.run.endedAt) return a.run.endedAt > b.run.endedAt;
  return a.datetimeDir > b.datetimeDir;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Build the Manifest: scan the full session history, keep the latest Run
 * per Combo, copy its files into <outDir>/sessions/<comboId>/, and write
 * <outDir>/manifest.json. The generated sessions directory is cleaned first
 * so stale combos disappear; other files in outDir are left untouched.
 */
export async function buildManifest(
  options: BuildManifestOptions
): Promise<Manifest> {
  const { sessionRoot, outDir } = options;
  const winners = latestPerCombo(await collectRuns(sessionRoot));

  const sessionsOut = join(outDir, "sessions");
  await rm(sessionsOut, { recursive: true, force: true });
  await mkdir(sessionsOut, { recursive: true });

  const combos: ManifestCombo[] = [];
  for (const { run, dir } of winners) {
    const comboOut = join(sessionsOut, run.comboId);
    await mkdir(comboOut, { recursive: true });

    const files: ManifestCombo["files"] = {};
    for (const [fileName, key] of PUBLISHED_FILES) {
      try {
        await copyFile(join(dir, fileName), join(comboOut, fileName));
        files[key] = `sessions/${run.comboId}/${fileName}`;
      } catch (err) {
        // A missing file just means the key stays out of the files map
        // (e.g. artifact files lost on a failed run).
        if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
      }
    }

    const combo: ManifestCombo = {
      comboId: run.comboId,
      question: run.question,
      model: run.model,
      params: run.params,
      piVersion: run.piVersion,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      durationMs: run.durationMs,
      status: run.status,
      contractViolations: run.contractViolations ?? [],
      files,
    };
    if (run.maxTurnsExceeded !== undefined) combo.maxTurnsExceeded = run.maxTurnsExceeded;
    if (run.maxTurns !== undefined) combo.maxTurns = run.maxTurns;
    combos.push(combo);
  }

  combos.sort(
    (a, b) =>
      a.question.name.localeCompare(b.question.name) ||
      a.model.name.localeCompare(b.model.name)
  );

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    combos,
  };
  await writeFile(
    join(outDir, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
  return manifest;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);

  let sessionRoot: string | undefined;
  let outDir: string | undefined;
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--session-root":
        sessionRoot = args[++i];
        break;
      case "--out-dir":
        outDir = args[++i];
        break;
    }
  }

  // Determine repo root (parent of runner/)
  const repoRoot = resolve(__dirname, "..", "..");
  const resolvedSessionRoot = sessionRoot ?? join(repoRoot, "session");
  const resolvedOutDir = outDir ?? join(repoRoot, "dashboard", "public");

  const manifest = await buildManifest({
    sessionRoot: resolvedSessionRoot,
    outDir: resolvedOutDir,
  });
  console.log(
    `Published ${manifest.combos.length} combo(s) from ${resolvedSessionRoot} to ${resolvedOutDir}`
  );
}
