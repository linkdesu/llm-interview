import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { loadQuestions, type Question } from "./question";

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
      expect(q.dir).not.toBe("");
      expect(q.dir.endsWith(q.name)).toBe(true);
      cleanup();
    });
  });

});
