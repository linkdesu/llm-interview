import type { Question, Ticket } from "./question";

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
 * (d) global run rules (if non-empty);
 * (e) horizontal rule + artifact contract, always last.
 */
export function buildPrompt(question: Question, globalRules = ""): string {
  const specSection = question.hasSpec
    ? "\n\nA detailed specification is available at ./spec.md. You MUST read that file with your read tool before starting."
    : "";
  const ticketsSection = question.hasTickets
    ? "\n\nA detailed ticket breakdown is available at ./tickets.md. You MUST read that file with your read tool before starting."
    : "";
  const rulesSection =
    globalRules.trim().length > 0 ? `\n\n${globalRules.trim()}` : "";

  return `${question.intent.trim()}${specSection}${ticketsSection}${rulesSection}

---
${ARTIFACT_CONTRACT}`;
}

/**
 * Build the prompt for one per-ticket invocation.
 *
 * Same skeleton as buildPrompt, but the tickets.md instruction narrows the
 * scope to exactly one ticket, adds progress context (previous invocations'
 * work is already in the working directory), and asks the model to mark the
 * ticket done. The ticket body is never inlined — locating and reading the
 * documents is part of what the Question tests.
 */
export function buildTicketPrompt(
  question: Question,
  ticket: Ticket,
  totalTickets: number,
  globalRules = ""
): string {
  const specSection = question.hasSpec
    ? "\n\nA detailed specification is available at ./spec.md. You MUST read that file with your read tool before starting."
    : "";
  const progressLine =
    ticket.index > 1
      ? "\nThe working directory already contains the work of the previous tickets. Read the existing files first and build on them — do not start over."
      : "";
  const rulesSection =
    globalRules.trim().length > 0 ? `\n\n${globalRules.trim()}` : "";

  return `${question.intent.trim()}${specSection}

A detailed ticket breakdown is available at ./tickets.md. You MUST read that file with your read tool before starting. Complete ONLY ticket ${ticket.index} of ${totalTickets}: \`${ticket.title}\` — do not work on any other ticket.${progressLine}
When you have completed the ticket, mark it in ./tickets.md by changing its \`[ ]\` to \`[x]\`.${rulesSection}

---
${ARTIFACT_CONTRACT}`;
}

/**
 * Build the prompt for an evaluation invocation: a read-only arbitration of
 * whether a dirty ticket invocation actually completed its ticket. The model
 * must end with a machine-parseable verdict marker; evaluation invocations
 * are never themselves evaluated (an unparseable verdict aborts the run).
 */
export function buildEvaluationPrompt(
  question: Question,
  ticket: Ticket,
  totalTickets: number
): string {
  const specSection = question.hasSpec
    ? "\n\nA detailed specification is available at ./spec.md in this directory. Read it with your read tool if you need it for context."
    : "";

  return `Your current working directory contains a web project built by another coding agent. You are evaluating that agent's work. Everything you need is in THIS directory — the one you are already in. Do NOT look for files anywhere else.

The agent's overall task was:
${question.intent.trim()}${specSection}

A ticket breakdown is available at ./tickets.md in this directory. You MUST read that file with your read tool first. The agent was asked to complete ONLY ticket ${ticket.index} of ${totalTickets}: \`${ticket.title}\`.
Then inspect the project files in this directory (index.html, style.css, script.js) and judge whether this ticket's requirements are actually met by the current code — do not trust the \`[x]\` marks in tickets.md, verify against the real code.
Work READ-ONLY: do NOT create, modify, or delete any file.

End your reply with exactly one verdict line:
<verdict>COMPLETE</verdict> or <verdict>INCOMPLETE</verdict>`;
}
