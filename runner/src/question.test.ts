import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadQuestions, parseTickets, type Question } from "./question";

describe("loadQuestions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "question-test-"));
  });

  const cleanup = () => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };

  const createQuestion = (name: string, files: Record<string, string | undefined>) => {
    const dir = join(tempDir, name);
    mkdirSync(dir, { recursive: true });
    for (const [fileName, content] of Object.entries(files)) {
      if (content !== undefined) {
        writeFileSync(join(dir, fileName), content);
      }
    }
    return dir;
  };

  describe("throws when questionDir is missing", () => {
    it("throws a clear error for non-existent directory", () => {
      const missingPath = resolve("/this/path/does/not/exist");
      expect(() => loadQuestions(missingPath)).toThrow();
      cleanup();
    });
  });

  describe("returns empty array for valid but empty directory", () => {
    beforeEach(() => {
      mkdirSync(tempDir, { recursive: true });
    });

    it("returns [] when directory has no subdirectories", async () => {
      const result = await loadQuestions(tempDir);
      expect(result).toEqual([]);
      cleanup();
    });

    it("ignores plain files at the top level", async () => {
      writeFileSync(join(tempDir, "readme.txt"), "not a question");
      const result = await loadQuestions(tempDir);
      expect(result).toEqual([]);
      cleanup();
    });
  });

  describe("loads a valid question", () => {
    it("returns Question with correct name and dir", async () => {
      createQuestion("build-todo-app", {
        "intent.md": "# Build a todo app",
      });

      const result = await loadQuestions(tempDir);
      expect(result).toHaveLength(1);

      const q = result[0];
      expect(q.name).toBe("build-todo-app");
      expect(q.dir).toBe(resolve(tempDir, "build-todo-app"));
      expect(q.intent).toBe("# Build a todo app");
      cleanup();
    });

    it("sets hasSpec when spec.md exists", async () => {
      createQuestion("feature-x", {
        "intent.md": "Implement feature X",
        "spec.md": "Detailed spec here",
      });

      const result = await loadQuestions(tempDir);
      expect(result[0].hasSpec).toBe(true);
      expect(result[0].hasTickets).toBe(false);
      cleanup();
    });

    it("sets hasTickets when tickets.md exists", async () => {
      createQuestion("feature-y", {
        "intent.md": "Implement feature Y",
        "tickets.md": "- Ticket 1\n- Ticket 2",
      });

      const result = await loadQuestions(tempDir);
      expect(result[0].hasTickets).toBe(true);
      expect(result[0].hasSpec).toBe(false);
      cleanup();
    });

    it("sets both hasSpec and hasTickets when both files exist", async () => {
      createQuestion("full-question", {
        "intent.md": "Do everything",
        "spec.md": "Spec",
        "tickets.md": "Tickets",
      });

      const result = await loadQuestions(tempDir);
      expect(result[0].hasSpec).toBe(true);
      expect(result[0].hasTickets).toBe(true);
      cleanup();
    });

    it("preserves full intent.md content", async () => {
      const intent = `# Title

Some description with multiple paragraphs.

- Item 1
- Item 2
`;
      createQuestion("multiline", { "intent.md": intent });

      const result = await loadQuestions(tempDir);
      expect(result[0].intent).toBe(intent);
      cleanup();
    });
  });

  describe("filters out invalid directories", () => {
    it("skips directories without intent.md", async () => {
      createQuestion("no-intent", {
        "readme.md": "just a readme",
      });

      const result = await loadQuestions(tempDir);
      expect(result).toEqual([]);
      cleanup();
    });

    it("skips directories with empty intent.md", async () => {
      createQuestion("empty-intent", {
        "intent.md": "",
      });

      const result = await loadQuestions(tempDir);
      expect(result).toEqual([]);
      cleanup();
    });

    it("skips directories with whitespace-only intent.md", async () => {
      createQuestion("whitespace-intent", {
        "intent.md": "   \n\n  ",
      });

      const result = await loadQuestions(tempDir);
      expect(result).toEqual([]);
      cleanup();
    });
  });

  describe("sorting", () => {
    it("returns questions sorted by name ascending", async () => {
      createQuestion("zebra", { "intent.md": "Z" });
      createQuestion("alpha", { "intent.md": "A" });
      createQuestion("beta", { "intent.md": "B" });

      const result = await loadQuestions(tempDir);
      expect(result.map((q) => q.name)).toEqual(["alpha", "beta", "zebra"]);
      cleanup();
    });
  });

  describe("mixed valid and invalid entries", () => {
    it("loads only valid questions while skipping invalid ones", async () => {
      createQuestion("valid-one", { "intent.md": "Valid" });
      createQuestion("no-intent", { "readme.md": "No intent file" });
      createQuestion("empty-intent", { "intent.md": "" });
      createQuestion("valid-two", {
        "intent.md": "Also valid",
        "spec.md": "Spec",
      });
      writeFileSync(join(tempDir, "plain-file.txt"), "not a question");

      const result = await loadQuestions(tempDir);
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("valid-one");
      expect(result[0].hasSpec).toBe(false);
      expect(result[1].name).toBe("valid-two");
      expect(result[1].hasSpec).toBe(true);
      cleanup();
    });
  });

  describe("ticket parsing", () => {
    it("parses tickets.md into tickets in document order", async () => {
      createQuestion("with-tickets", {
        "intent.md": "Do things",
        "tickets.md": "# Tickets\n\n[ ]1. First ticket\n  - subtask a\n[ ]2. Second ticket: with description\n",
      });

      const result = await loadQuestions(tempDir);
      expect(result[0].tickets).toEqual([
        { index: 1, title: "First ticket" },
        { index: 2, title: "Second ticket: with description" },
      ]);
      cleanup();
    });

    it("returns an empty tickets array when tickets.md is absent", async () => {
      createQuestion("no-tickets", { "intent.md": "Do things" });

      const result = await loadQuestions(tempDir);
      expect(result[0].tickets).toEqual([]);
      cleanup();
    });

    it("returns an empty tickets array when nothing is parseable", async () => {
      createQuestion("unparseable-tickets", {
        "intent.md": "Do things",
        "tickets.md": "# Tickets\n\n## Old-style header\n- bullet\n",
      });

      const result = await loadQuestions(tempDir);
      expect(result[0].tickets).toEqual([]);
      cleanup();
    });
  });

  describe("type shape", () => {
    it("returns objects matching Question interface", async () => {
      createQuestion("typed-check", {
        "intent.md": "Check types",
        "spec.md": "Spec",
        "tickets.md": "Tickets",
      });

      const result = await loadQuestions(tempDir);
      const q = result[0] as Question;

      expect(typeof q.name).toBe("string");
      expect(typeof q.dir).toBe("string");
      expect(typeof q.intent).toBe("string");
      expect(typeof q.hasSpec).toBe("boolean");
      expect(typeof q.hasTickets).toBe("boolean");
      expect(Array.isArray(q.tickets)).toBe(true);
      expect(q.dir).not.toBe("");
      expect(q.dir.endsWith(q.name)).toBe(true);
      cleanup();
    });
  });

});

describe("parseTickets", () => {
  it("parses checkbox-prefixed ordered list items", () => {
    const tickets = parseTickets(
      "# Snake — Tickets\n\n[ ]1. Minimal playable snake\n  - subtask\n[ ]2. Start menu\n[x]3. Done already\n"
    );
    expect(tickets).toEqual([
      { index: 1, title: "Minimal playable snake" },
      { index: 2, title: "Start menu" },
      { index: 3, title: "Done already" },
    ]);
  });

  it("parses bare ordered list items without checkboxes", () => {
    const tickets = parseTickets("1. First\n2. Second\n");
    expect(tickets).toEqual([
      { index: 1, title: "First" },
      { index: 2, title: "Second" },
    ]);
  });

  it("ignores nested list items, headers, and prose", () => {
    const tickets = parseTickets(
      "# Tickets\nSome preamble.\n\n[ ]1. Real ticket\n  - 2. not a ticket (nested)\n## 3. not a ticket (header)\n\n[ ]2. Another real one\n"
    );
    expect(tickets).toEqual([
      { index: 1, title: "Real ticket" },
      { index: 2, title: "Another real one" },
    ]);
  });

  it("renumbers by document order, ignoring literal numbers", () => {
    const tickets = parseTickets("[ ]5. Fifth\n[ ]9. Ninth\n");
    expect(tickets).toEqual([
      { index: 1, title: "Fifth" },
      { index: 2, title: "Ninth" },
    ]);
  });

  it("returns an empty array for content without ordered items", () => {
    expect(parseTickets("# Only headers\n- bullets\n")).toEqual([]);
    expect(parseTickets("")).toEqual([]);
  });
});
