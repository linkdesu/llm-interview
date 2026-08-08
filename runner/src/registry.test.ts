import { describe, it, expect } from "bun:test";
import { writeFileSync, unlinkSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadRegistry } from "./registry";

function createTempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "registry-test-"));
  const path = join(dir, "config.toml");
  writeFileSync(path, content, "utf-8");
  return path;
}

function cleanup(path: string) {
  try { unlinkSync(path); } catch { /* ignore */ }
}

describe("loadRegistry", () => {
  it("loads a valid registry file", async () => {
    const fixture = `
[[models]]
name = "test-model"
provider = "llamacpp-local"
modelId = "test-model-id"
notes = "a test model"
[models.params]
temp = 0.7
`;
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
    const fixture = `
[[models]]
name = "same-name"
provider = "p1"
modelId = "m1"

[[models]]
name = "same-name"
provider = "p2"
modelId = "m2"
`;
    const path = createTempFile(fixture);
    try {
      await expect(loadRegistry(path)).rejects.toThrow('duplicate name "same-name"');
    } finally {
      cleanup(path);
    }
  });

  it("rejects an entry missing modelId", async () => {
    const fixture = `
[[models]]
name = "valid-name"
provider = "p1"
`;
    const path = createTempFile(fixture);
    try {
      await expect(loadRegistry(path)).rejects.toThrow('"modelId" must be a non-empty string');
    } finally {
      cleanup(path);
    }
  });

  it("defaults params to {} when omitted", async () => {
    const fixture = `
[[models]]
name = "no-params"
provider = "p1"
modelId = "m1"
`;
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
    const fixture = `
[[models]]
name = "bad name/slash"
provider = "p1"
modelId = "m1"
`;
    const path = createTempFile(fixture);
    try {
      await expect(loadRegistry(path)).rejects.toThrow('"name" must be path-safe');
    } finally {
      cleanup(path);
    }
  });

  it("parses a per-model max_turns override", async () => {
    const fixture = `
[[models]]
name = "slow-model"
provider = "p1"
modelId = "m1"
max_turns = 250
`;
    const path = createTempFile(fixture);
    try {
      const models = await loadRegistry(path);
      expect(models[0].maxTurns).toBe(250);
    } finally {
      cleanup(path);
    }
  });

  it("leaves maxTurns undefined when omitted", async () => {
    const fixture = `
[[models]]
name = "normal-model"
provider = "p1"
modelId = "m1"
`;
    const path = createTempFile(fixture);
    try {
      const models = await loadRegistry(path);
      expect(models[0].maxTurns).toBeUndefined();
    } finally {
      cleanup(path);
    }
  });

  it("rejects a non-positive max_turns override", async () => {
    const fixture = `
[[models]]
name = "bad-model"
provider = "p1"
modelId = "m1"
max_turns = 0
`;
    const path = createTempFile(fixture);
    try {
      await expect(loadRegistry(path)).rejects.toThrow('"max_turns" must be a positive integer');
    } finally {
      cleanup(path);
    }
  });
});

describe("loadConfig [loop_detector]", () => {
  const base = `
max_turns = 100
run_rules = ""

[[models]]
name = "test-model"
provider = "llamacpp-local"
modelId = "test-model-id"
[models.params]
temp = 0.7
`;

  it("is disabled when the section is absent", async () => {
    const path = createTempFile(base);
    try {
      const { loadConfig } = await import("./registry");
      const config = await loadConfig(path);
      expect(config.loopDetector).toBeUndefined();
    } finally {
      cleanup(path);
    }
  });

  it("applies the defaults (step 5, confidence threshold 80)", async () => {
    const path = createTempFile(`
[loop_detector]
provider = "ornith"
modelId = "ai-01/ornith-1.0-35b-5"
` + base);
    try {
      const { loadConfig } = await import("./registry");
      const config = await loadConfig(path);
      expect(config.loopDetector).toEqual({
        provider: "ornith",
        modelId: "ai-01/ornith-1.0-35b-5",
        step: 5,
        confidenceThreshold: 80,
      });
    } finally {
      cleanup(path);
    }
  });

  it("honours a custom step and confidence threshold", async () => {
    const path = createTempFile(`
[loop_detector]
provider = "ornith"
modelId = "ai-01/ornith-1.0-35b-5"
step = 15
confidence_threshold = 90
` + base);
    try {
      const { loadConfig } = await import("./registry");
      const config = await loadConfig(path);
      expect(config.loopDetector?.step).toBe(15);
      expect(config.loopDetector?.confidenceThreshold).toBe(90);
    } finally {
      cleanup(path);
    }
  });

  it("rejects a section without provider or modelId", async () => {
    const path = createTempFile(`
[loop_detector]
provider = "ornith"
` + base);
    try {
      const { loadConfig } = await import("./registry");
      await expect(loadConfig(path)).rejects.toThrow(/loop_detector.*modelId/);
    } finally {
      cleanup(path);
    }
  });

  it("rejects a non-positive step", async () => {
    const path = createTempFile(`
[loop_detector]
provider = "ornith"
modelId = "ai-01/ornith-1.0-35b-5"
step = 0
` + base);
    try {
      const { loadConfig } = await import("./registry");
      await expect(loadConfig(path)).rejects.toThrow(/loop_detector.*step/);
    } finally {
      cleanup(path);
    }
  });
});
