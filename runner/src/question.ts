import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * A coding agent question loaded from the question/ directory.
 * Each question is a subdirectory containing intent.md (required) and optionally spec.md / tickets.md.
 */
export interface Question {
  /** Unique name derived from the directory name. */
  name: string;
  /** Absolute path to the question directory. */
  dir: string;
  /** Full content of intent.md (the task description). */
  intent: string;
  /** Whether spec.md is present in the directory. */
  hasSpec: boolean;
  /** Whether tickets.md is present in the directory. */
  hasTickets: boolean;
}

/**
 * Load all valid questions from a directory.
 *
 * A valid question is a subdirectory containing a non-empty intent.md file.
 * Directories without intent.md, or with an empty/whitespace-only intent.md, are silently skipped.
 * Plain files at the top level are also ignored.
 *
 * @param questionDir - Path to the root directory containing question subdirectories.
 * @returns Array of Question objects, sorted by name ascending.
 * @throws Error if questionDir does not exist or is not a directory.
 */
export async function loadQuestions(questionDir: string): Promise<Question[]> {
  const resolvedDir = resolve(questionDir);

  // Verify the directory exists
  const dirStat = await stat(resolvedDir).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      throw new Error(`Question directory does not exist: ${resolvedDir}`);
    }
    throw err;
  });

  if (!dirStat.isDirectory()) {
    throw new Error(`Question path is not a directory: ${resolvedDir}`);
  }

  const entries = await readdir(resolvedDir, { withFileTypes: true });
  const questions: Question[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const questionPath = join(resolvedDir, entry.name);

    // Check for intent.md
    const intentPath = join(questionPath, "intent.md");
    let intentContent: string;
    try {
      intentContent = await readFile(intentPath, "utf-8");
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        // No intent.md — skip this directory
        continue;
      }
      throw err;
    }

    // Skip if intent.md is empty or whitespace-only
    if (intentContent.trim().length === 0) {
      continue;
    }

    // Check for optional spec.md and tickets.md
    const hasSpec = await fileExists(join(questionPath, "spec.md"));
    const hasTickets = await fileExists(join(questionPath, "tickets.md"));

    questions.push({
      name: entry.name,
      dir: questionPath,
      intent: intentContent,
      hasSpec,
      hasTickets,
    });
  }

  // Sort by name ascending
  questions.sort((a, b) => a.name.localeCompare(b.name));

  return questions;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}
