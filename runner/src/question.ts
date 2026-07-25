import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

/**
 * A single ticket parsed from tickets.md: a top-level ordered-list item.
 */
export interface Ticket {
  /** 1-based position in document order (independent of the literal number). */
  index: number;
  /** The ordered-list item's text (without the number/checkbox marker). */
  title: string;
}

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
  /**
   * Tickets parsed from tickets.md in document order (empty when absent or
   * nothing parseable). Parsing is deliberately lenient — following the
   * format convention is part of what the Question tests.
   */
  tickets: Ticket[];
}

/**
 * Parse tickets.md content into tickets: top-level ordered-list items,
 * with an optional `[ ]` / `[x]` checkbox prefix. Nested (indented) lines
 * and non-list content are ignored. Indices are assigned in document order.
 */
export function parseTickets(content: string): Ticket[] {
  const tickets: Ticket[] = [];
  for (const line of content.split("\n")) {
    const m = line.match(/^ {0,3}(?:\[[ xX]\])?\s*\d+\.\s+(.+?)\s*$/);
    if (m) {
      tickets.push({ index: tickets.length + 1, title: m[1] });
    }
  }
  return tickets;
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

    // Parse tickets.md into tickets when present (lenient; empty when
    // nothing parseable — the runner falls back to the single-invocation flow)
    let tickets: Ticket[] = [];
    if (hasTickets) {
      const ticketsContent = await readFile(join(questionPath, "tickets.md"), "utf-8");
      tickets = parseTickets(ticketsContent);
    }

    questions.push({
      name: entry.name,
      dir: questionPath,
      intent: intentContent,
      hasSpec,
      hasTickets,
      tickets,
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
