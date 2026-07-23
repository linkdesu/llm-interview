import { describe, it, expect } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRegistry } from "./registry";

function createTempFile(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "registry-test-"));
  const path = join(dir, "models.registry.json");
  writeFileSync(path, JSON.stringify(content), "utf-8");
  return path;
}

function cleanup(path: string) {
  try {
    unlinkSync(path);
  } catch {
    // ignore cleanup errors
  }
}

describe("loadRegistry", () => {
  it("loads a valid registry file", async () => {
    const fixture = {
      models: [
        {
          name: "test-model",
          provider: "llamacpp-local",
          modelId: "test-model-id",
          params: { temp: 0.7 },
          notes: "a test model",
        },
      ],
    };
    const path = createTempFile(fixture);
    try {
      const models = await loadRegistry(path);
      expect(models.length).toBe(1);
      expect(models[0].name).toBe("test-model");
      expect(models[0].provider).toBe("llamacpp-local");
      expect(models[0].modelId).toBe("test-model-id");
      expect(models[0].params).toEqual({ temp: 0.7 });
      expect(models[0].notes).toBe("a test model");
    } finally {
      cleanup(path);
    }
  });

  it("rejects duplicate names", async () => {
    const fixture = {
      models: [
        { name: "same-name", provider: "p1", modelId: "m1" },
        { name: "same-name", provider: "p2", modelId: "m2" },
      ],
    };
    const path = createTempFile(fixture);
    try {
      await expect(loadRegistry(path)).rejects.toThrow('duplicate name "same-name"');
    } finally {
      cleanup(path);
    }
  });

  it("rejects an entry missing modelId", async () => {
    const fixture = {
      models: [
        { name: "valid-name", provider: "p1" },
      ],
    };
    const path = createTempFile(fixture);
    try {
      await expect(loadRegistry(path)).rejects.toThrow('"modelId" must be a non-empty string');
    } finally {
      cleanup(path);
    }
  });

  it("defaults params to {} when omitted", async () => {
    const fixture = {
      models: [
        { name: "no-params", provider: "p1", modelId: "m1" },
      ],
    };
    const path = createTempFile(fixture);
    try {
      const models = await loadRegistry(path);
      expect(models.length).toBe(1);
      expect(models[0].params).toEqual({});
    } finally {
      cleanup(path);
    }
  });

  it("rejects a path-unsafe name", async () => {
    const fixture = {
      models: [
        { name: "bad name/slash", provider: "p1", modelId: "m1" },
      ],
    };
    const path = createTempFile(fixture);
    try {
      await expect(loadRegistry(path)).rejects.toThrow('"name" must be path-safe');
    } finally {
      cleanup(path);
    }
  });
});
