import { describe, expect, it } from "bun:test";
import { type Question, type Ticket } from "./question";
import {
  ARTIFACT_CONTRACT,
  buildPrompt,
  buildTicketPrompt,
  buildEvaluationPrompt,
} from "./prompt";

const baseQuestion: Question = {
  name: "test-question",
  dir: "/tmp/test",
  intent: "Build a landing page for a coffee shop.",
  hasSpec: false,
  hasTickets: false,
  tickets: [],
};

describe("buildPrompt", () => {
  it("returns trimmed intent text", () => {
    const question: Question = {
      ...baseQuestion,
      intent: "\n  Build a landing page for a coffee shop.  \n",
    };
    const prompt = buildPrompt(question);
    expect(prompt).toContain("Build a landing page for a coffee shop.");
  });

  it("includes spec.md instruction when hasSpec is true", () => {
    const question: Question = {
      ...baseQuestion,
      hasSpec: true,
    };
    const prompt = buildPrompt(question);
    expect(prompt).toContain("./spec.md");
    expect(prompt.toLowerCase()).toContain("read");
  });

  it("excludes spec.md instruction when hasSpec is false", () => {
    const prompt = buildPrompt(baseQuestion);
    expect(prompt).not.toContain("./spec.md");
  });

  it("includes tickets.md instruction when hasTickets is true", () => {
    const question: Question = {
      ...baseQuestion,
      hasTickets: true,
    };
    const prompt = buildPrompt(question);
    expect(prompt).toContain("./tickets.md");
    expect(prompt.toLowerCase()).toContain("read");
  });

  it("excludes tickets.md instruction when hasTickets is false", () => {
    const prompt = buildPrompt(baseQuestion);
    expect(prompt).not.toContain("./tickets.md");
  });

  it("includes artifact contract at the end, separated by a horizontal rule", () => {
    const prompt = buildPrompt(baseQuestion);
    expect(prompt).toContain("---");
    expect(prompt).toContain(ARTIFACT_CONTRACT);
    const lastPart = prompt.split("---").pop()!;
    expect(lastPart).toContain(ARTIFACT_CONTRACT);
  });

  it("orders sections correctly: intent → spec → tickets → rules → contract", () => {
    const question: Question = {
      ...baseQuestion,
      hasSpec: true,
      hasTickets: true,
    };
    const prompt = buildPrompt(question, "Global test rule.");
    const intentIndex = prompt.indexOf("Build a landing page");
    const specIndex = prompt.indexOf("./spec.md");
    const ticketsIndex = prompt.indexOf("./tickets.md");
    const rulesIndex = prompt.indexOf("Global test rule.");
    const contractIndex = prompt.indexOf(ARTIFACT_CONTRACT);

    expect(intentIndex).toBeLessThan(specIndex);
    expect(specIndex).toBeLessThan(ticketsIndex);
    expect(ticketsIndex).toBeLessThan(rulesIndex);
    expect(rulesIndex).toBeLessThan(contractIndex);
  });

  it("includes global rules when provided", () => {
    const prompt = buildPrompt(baseQuestion, "Use skill X for testing.");
    expect(prompt).toContain("Use skill X for testing.");
  });

  it("omits global rules when empty", () => {
    const prompt = buildPrompt(baseQuestion);
    const lastSection = prompt.split("---").pop()!;
    expect(lastSection).toContain(ARTIFACT_CONTRACT);
  });
});

describe("buildTicketPrompt", () => {
  const ticket: Ticket = { index: 2, title: "Start menu + score system" };

  it("scopes the work to exactly one ticket with index, total, and title", () => {
    const prompt = buildTicketPrompt(baseQuestion, ticket, 3);
    expect(prompt).toContain("./tickets.md");
    expect(prompt).toContain("ticket 2 of 3");
    expect(prompt).toContain("`Start menu + score system`");
    expect(prompt).toContain("ONLY");
  });

  it("points at tickets.md without inlining the ticket body", () => {
    const question: Question = {
      ...baseQuestion,
      hasTickets: true,
      tickets: [
        { index: 1, title: "Minimal playable snake" },
        ticket,
      ],
    };
    const prompt = buildTicketPrompt(question, ticket, 2);
    expect(prompt).toContain("read that file");
    expect(prompt).not.toContain("Minimal playable snake");
  });

  it("adds progress context for tickets after the first", () => {
    const prompt = buildTicketPrompt(baseQuestion, ticket, 3);
    expect(prompt).toContain("previous tickets");
    expect(prompt).toContain("do not start over");
  });

  it("omits progress context for the first ticket", () => {
    const prompt = buildTicketPrompt(baseQuestion, { index: 1, title: "First" }, 3);
    expect(prompt).not.toContain("previous tickets");
  });

  it("asks the model to mark the ticket done in tickets.md", () => {
    const prompt = buildTicketPrompt(baseQuestion, ticket, 3);
    expect(prompt).toContain("`[x]`");
  });

  it("keeps intent, rules, and the artifact contract", () => {
    const prompt = buildTicketPrompt(baseQuestion, ticket, 3, "Global test rule.");
    expect(prompt).toContain("Build a landing page for a coffee shop.");
    expect(prompt).toContain("Global test rule.");
    const lastPart = prompt.split("---").pop()!;
    expect(lastPart).toContain(ARTIFACT_CONTRACT);
  });
});

describe("buildEvaluationPrompt", () => {
  const ticket: Ticket = { index: 1, title: "Minimal playable snake" };

  it("identifies the ticket under evaluation", () => {
    const prompt = buildEvaluationPrompt(baseQuestion, ticket, 3);
    expect(prompt).toContain("ticket 1 of 3");
    expect(prompt).toContain("`Minimal playable snake`");
    expect(prompt).toContain("./tickets.md");
  });

  it("demands read-only inspection", () => {
    const prompt = buildEvaluationPrompt(baseQuestion, ticket, 3);
    expect(prompt).toContain("READ-ONLY");
    expect(prompt).toContain("do NOT create, modify, or delete any file");
  });

  it("requires the verdict marker", () => {
    const prompt = buildEvaluationPrompt(baseQuestion, ticket, 3);
    expect(prompt).toContain("<verdict>COMPLETE</verdict>");
    expect(prompt).toContain("<verdict>INCOMPLETE</verdict>");
  });

  it("warns against trusting self-reported marks", () => {
    const prompt = buildEvaluationPrompt(baseQuestion, ticket, 3);
    expect(prompt).toContain("do not trust");
  });

  it("points at spec.md when present", () => {
    const question: Question = { ...baseQuestion, hasSpec: true };
    const prompt = buildEvaluationPrompt(question, ticket, 3);
    expect(prompt).toContain("./spec.md");
  });

  it("anchors the evaluator to the current working directory", () => {
    const prompt = buildEvaluationPrompt(baseQuestion, ticket, 3);
    expect(prompt).toContain("THIS directory");
    expect(prompt).toContain("Do NOT look for files anywhere else");
  });
});
