import { appendFileSync } from "node:fs";

/**
 * Matrix index log: one file per matrix execution (pi-run-YYYYMMDD-HHmmss.log
 * in the process cwd), capturing every [pi] / [matrix] / progress line with
 * an ISO timestamp, plus structured combo START/END markers and a final
 * SUMMARY. The goal: after a long run — interrupted or not — opening this
 * single file shows how many combos failed and where each failure's archived
 * session.jsonl lives (`grep "END: ERROR"`).
 *
 * The console output is unchanged; this is a parallel copy. Writes are
 * synchronous appends so lines survive a process kill, and failures are
 * swallowed — logging must never break a run.
 */

let logPath: string | null = null;

/**
 * Set the index log file for the current matrix execution (null disables
 * file logging). Called by runMatrix at startup.
 */
export function setRunLogPath(path: string | null): void {
  logPath = path;
}

/**
 * Append a message to the index log. Every physical line gets an ISO
 * timestamp prefix (some log messages span multiple lines, e.g. truncated
 * spawn args). No-op when no log path is set.
 */
export function runLog(message: string): void {
  if (!logPath) return;
  const ts = new Date().toISOString();
  const text =
    message
      .split("\n")
      .map((line) => `${ts} ${line}`)
      .join("\n") + "\n";
  try {
    appendFileSync(logPath, text, "utf-8");
  } catch {
    // Never let logging break the run.
  }
}
