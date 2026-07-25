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

  // (d) Global run rules (if non-empty)
  if (globalRules.trim().length > 0) {
    lines.push("");
    lines.push(globalRules.trim());
  }

  // (e) Artifact contract, separated by horizontal rule
  lines.push("");
  lines.push("---");
  lines.push(ARTIFACT_CONTRACT);

  return lines.join("\n");
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
  const lines: string[] = [];

  // (a) Intent text, trimmed
  lines.push(question.intent.trim());

  // (b) Spec.md instruction (only if present)
  if (question.hasSpec) {
    lines.push("");
    lines.push("A detailed specification is available at ./spec.md. You MUST read that file with your read tool before starting.");
  }

  // (c) Tickets.md instruction, scoped to exactly this ticket
  lines.push("");
  lines.push(`A detailed ticket breakdown is available at ./tickets.md. You MUST read that file with your read tool before starting. Complete ONLY ticket ${ticket.index} of ${totalTickets}: \`${ticket.title}\` — do not work on any other ticket.`);
  if (ticket.index > 1) {
    lines.push("The working directory already contains the work of the previous tickets. Read the existing files first and build on them — do not start over.");
  }
  lines.push("When you have completed the ticket, mark it in ./tickets.md by changing its `[ ]` to `[x]`.");

  // (d) Global run rules (if non-empty)
  if (globalRules.trim().length > 0) {
    lines.push("");
    lines.push(globalRules.trim());
  }

  // (e) Artifact contract, separated by horizontal rule
  lines.push("");
  lines.push("---");
  lines.push(ARTIFACT_CONTRACT);

  return lines.join("\n");
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
  const lines: string[] = [];

  lines.push("Your current working directory contains a web project built by another coding agent. You are evaluating that agent's work. Everything you need is in THIS directory — the one you are already in. Do NOT look for files anywhere else.");
  lines.push("");
  lines.push(`The agent's overall task was:\n${question.intent.trim()}`);

  if (question.hasSpec) {
    lines.push("");
    lines.push("A detailed specification is available at ./spec.md in this directory. Read it with your read tool if you need it for context.");
  }

  lines.push("");
  lines.push(`A ticket breakdown is available at ./tickets.md in this directory. You MUST read that file with your read tool first. The agent was asked to complete ONLY ticket ${ticket.index} of ${totalTickets}: \`${ticket.title}\`.`);
  lines.push("Then inspect the project files in this directory (index.html, style.css, script.js) and judge whether this ticket's requirements are actually met by the current code — do not trust the `[x]` marks in tickets.md, verify against the real code.");
  lines.push("Work READ-ONLY: do NOT create, modify, or delete any file.");
  lines.push("");
  lines.push("End your reply with exactly one verdict line:");
  lines.push("<verdict>COMPLETE</verdict> or <verdict>INCOMPLETE</verdict>");

  return lines.join("\n");
}
