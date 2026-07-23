import type { Question } from "./question";

/**
 * Artifact contract appended to every prompt.
 * Defines the exact file structure and constraints the agent must follow.
 */
export const ARTIFACT_CONTRACT = `Artifact contract:
- ONLY the three files should be kept in the working directory at last: index.html, style.css, script.js.
- Other temporary files can be created and used during the process, but MUST be deleted afterward.
- All code must be readable; never minified or obfuscated.`;

/**
 * Build a prompt for a coding agent from a Question.
 *
 * Structure (in order):
 * (a) the intent text, trimmed;
 * (b) if hasSpec: instruction to read ./spec.md;
 * (c) if hasTickets: instruction to read ./tickets.md;
 * (d) horizontal rule + artifact contract, always last.
 */
export function buildPrompt(question: Question): string {
  const lines: string[] = [];

  // (a) Intent text, trimmed
  lines.push(question.intent.trim());

  // (b) Spec.md instruction (only if present)
  if (question.hasSpec) {
    lines.push("");
    lines.push("A detailed specification is available at ./spec.md. You MUST read that file with your read tool before starting.");
  }

  // (c) Tickets.md instruction (only if present)
  if (question.hasTickets) {
    lines.push("");
    lines.push("A detailed ticket breakdown is available at ./tickets.md. You MUST read that file with your read tool before starting.");
  }

  // (d) Artifact contract, separated by horizontal rule
  lines.push("");
  lines.push("---");
  lines.push(ARTIFACT_CONTRACT);

  return lines.join("\n");
}
