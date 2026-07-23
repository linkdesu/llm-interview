import { describe, expect, it } from "bun:test";
import { type Question } from "./question";
import { ARTIFACT_CONTRACT, buildPrompt } from "./prompt";

const baseQuestion: Question = {
  name: "test-question",
  dir: "/tmp/test",
  intent: "Build a landing page for a coffee shop.",
  hasSpec: false,
  hasTickets: false,
};

describe("ARTIFACT_CONTRACT", () => {
  it("requires exactly three files: index.html, style.css, script.js", () => {
    expect(ARTIFACT_CONTRACT).toContain("index.html");
    expect(ARTIFACT_CONTRACT).toContain("style.css");
    expect(ARTIFACT_CONTRACT).toContain("script.js");
  });

  it("forbids creating other files", () => {
    expect(ARTIFACT_CONTRACT.toLowerCase()).toMatch(/no (other|additional) files/);
  });

  it("requires all CSS in style.css and all JS in script.js, not inlined", () => {
    expect(ARTIFACT_CONTRACT.toLowerCase()).toMatch(/not (inlined|inline)/);
    expect(ARTIFACT_CONTRACT.toLowerCase()).toMatch(/style\.css/);
    expect(ARTIFACT_CONTRACT.toLowerCase()).toMatch(/script\.js/);
  });

  it("forbids minified or obfuscated code", () => {
    expect(ARTIFACT_CONTRACT.toLowerCase()).toMatch(/minified|obfuscated/);
  });
});

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

  it("orders sections correctly: intent → spec → tickets → contract", () => {
    const question: Question = {
      ...baseQuestion,
      hasSpec: true,
      hasTickets: true,
    };
    const prompt = buildPrompt(question);
    const intentIndex = prompt.indexOf("Build a landing page");
    const specIndex = prompt.indexOf("./spec.md");
    const ticketsIndex = prompt.indexOf("./tickets.md");
    const contractIndex = prompt.indexOf(ARTIFACT_CONTRACT);

    expect(intentIndex).toBeLessThan(specIndex);
    expect(specIndex).toBeLessThan(ticketsIndex);
    expect(ticketsIndex).toBeLessThan(contractIndex);
  });
});
