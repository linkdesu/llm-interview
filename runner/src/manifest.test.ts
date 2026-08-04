import {
  describe,
  it,
  expect,
  afterAll,
  beforeEach,
} from "bun:test";
import {
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { RunJson } from "./run";

// ---------------------------------------------------------------------------
// Helper: create a temp root for each test suite
// ---------------------------------------------------------------------------
function makeTempRoot(): string {
  return join(tmpdir(), `llm-interview-manifest-test-${randomUUID()}`);
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helper: write a fixture run.json
// ---------------------------------------------------------------------------
function fixtureRunJson(overrides: Partial<RunJson> = {}): RunJson {
  return {
    question: { name: "q-snake", hasSpec: true, hasTickets: false },
    model: {
      name: "model-alpha",
      provider: "llamacpp-local",
      modelId: "alpha.gguf",
    },
    params: { thinking: "on", temp: 0.6, top_k: 20, top_p: 0.95 },
    comboId: "aaaa1111bbbb",
    piVersion: "0.81.1",
    startedAt: "2026-07-23T15:27:34.983Z",
    endedAt: "2026-07-23T15:32:27.709Z",
    durationMs: 292713,
    status: "ok",
    exitCode: 0,
    maxTurnsExceeded: false,
    maxTurns: 100,
    contractViolations: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: write a fixture session directory
// ---------------------------------------------------------------------------
async function writeSession(
  sessionRoot: string,
  question: string,
  modelDir: string,
  datetimeDir: string,
  runJson: object | null,
  files: Record<string, string> = {}
) {
  const dir = join(sessionRoot, question, modelDir, datetimeDir);
  await mkdir(dir, { recursive: true });
  if (runJson !== null) {
    await writeFile(join(dir, "run.json"), JSON.stringify(runJson), "utf-8");
  }
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content, "utf-8");
  }
  return dir;
}

// ---------------------------------------------------------------------------
// Tests (seam two: fixture session trees)
// ---------------------------------------------------------------------------
describe("buildManifest", () => {
  let tempRoot: string;
  let sessionRoot: string;
  let outDir: string;

  beforeEach(async () => {
    tempRoot = makeTempRoot();
    sessionRoot = join(tempRoot, "session");
    outDir = join(tempRoot, "public");
    await mkdir(sessionRoot, { recursive: true });
    await mkdir(outDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // -----------------------------------------------------------------------
  // Test 1: Only the latest run per combo is published
  // -----------------------------------------------------------------------
  it("publishes only the latest run when a combo has multiple runs", async () => {
    const { buildManifest } = await import("./manifest");

    const comboId = "aaaa1111bbbb";
    const older = fixtureRunJson({
      comboId,
      startedAt: "2026-07-23T10:00:00.000Z",
      endedAt: "2026-07-23T10:05:00.000Z",
      durationMs: 300000,
    });
    const newer = fixtureRunJson({
      comboId,
      startedAt: "2026-07-23T15:27:34.983Z",
      endedAt: "2026-07-23T15:32:27.709Z",
      durationMs: 292713,
    });

    await writeSession(sessionRoot, "q-snake", "model-alpha", "20260723-180000", older, {
      "index.html": "older artifact",
      "session.jsonl": "older transcript",
    });
    await writeSession(sessionRoot, "q-snake", "model-alpha", "20260723-233227", newer, {
      "index.html": "newer artifact",
      "session.jsonl": "newer transcript",
    });

    const manifest = await buildManifest({ sessionRoot, outDir });

    expect(manifest.combos).toHaveLength(1);
    const combo = manifest.combos[0];
    // Manifest fields come from the latest run
    expect(combo.startedAt).toBe(newer.startedAt);
    expect(combo.durationMs).toBe(newer.durationMs);

    // Copied files come from the latest run
    const comboOut = join(outDir, "sessions", comboId);
    expect(await readFile(join(comboOut, "index.html"), "utf-8")).toBe("newer artifact");
    expect(await readFile(join(comboOut, "session.jsonl"), "utf-8")).toBe("newer transcript");
    expect(combo.files.artifact).toBe(`sessions/${comboId}/index.html`);
    expect(combo.files.transcript).toBe(`sessions/${comboId}/session.jsonl`);
  });

  // -----------------------------------------------------------------------
  // Test 2: Tiebreak by datetime directory name when timestamps are equal
  // -----------------------------------------------------------------------
  it("breaks startedAt ties by endedAt, then by datetime directory name", async () => {
    const { buildManifest } = await import("./manifest");

    const comboId = "aaaa1111bbbb";
    const sameStart = "2026-07-23T15:27:34.983Z";
    const a = fixtureRunJson({ comboId, startedAt: sameStart, endedAt: "2026-07-23T15:32:27.709Z" });
    const b = fixtureRunJson({ comboId, startedAt: sameStart, endedAt: "2026-07-23T15:40:00.000Z" });

    await writeSession(sessionRoot, "q-snake", "model-alpha", "20260723-233227", a, {
      "index.html": "run a",
    });
    await writeSession(sessionRoot, "q-snake", "model-alpha", "20260723-233300", b, {
      "index.html": "run b",
    });

    const manifest = await buildManifest({ sessionRoot, outDir });

    expect(manifest.combos).toHaveLength(1);
    expect(manifest.combos[0].endedAt).toBe("2026-07-23T15:40:00.000Z");
    expect(await readFile(join(outDir, "sessions", comboId, "index.html"), "utf-8")).toBe("run b");
  });

  // -----------------------------------------------------------------------
  // Test 3: Distinct combos are all published, sorted by question then model
  // -----------------------------------------------------------------------
  it("publishes every distinct combo sorted by question name then model name", async () => {
    const { buildManifest } = await import("./manifest");

    const combos = [
      { question: "q-zebra", model: "model-beta", comboId: "zzzz9999yyyy" },
      { question: "q-apple", model: "model-beta", comboId: "bbbb2222cccc" },
      { question: "q-apple", model: "model-alpha", comboId: "aaaa1111bbbb" },
    ];
    for (const c of combos) {
      await writeSession(
        sessionRoot,
        c.question,
        c.model,
        "20260723-233227",
        fixtureRunJson({
          comboId: c.comboId,
          question: { name: c.question, hasSpec: false, hasTickets: false },
          model: { name: c.model, provider: "llamacpp-local", modelId: `${c.model}.gguf` },
        }),
        { "index.html": `${c.question}/${c.model}` }
      );
    }

    const manifest = await buildManifest({ sessionRoot, outDir });

    expect(manifest.combos.map((c) => c.comboId)).toEqual([
      "aaaa1111bbbb", // q-apple × model-alpha
      "bbbb2222cccc", // q-apple × model-beta
      "zzzz9999yyyy", // q-zebra × model-beta
    ]);
  });

  // -----------------------------------------------------------------------
  // Test 4: Manifest field correctness against a known fixture run.json
  // -----------------------------------------------------------------------
  it("copies run.json fields verbatim into the manifest entry", async () => {
    const { buildManifest } = await import("./manifest");

    const runJson = fixtureRunJson({ comboId: "4144dda9648a" });
    await writeSession(sessionRoot, "q-snake", "model-alpha", "20260723-233227", runJson, {
      "index.html": "<!DOCTYPE html>",
      "style.css": "body {}",
      "script.js": "console.log('hi');",
      "session.jsonl": '{"role":"user"}',
    });

    const manifest = await buildManifest({ sessionRoot, outDir });

    expect(manifest.generatedAt).toBeDefined();
    expect(manifest.combos).toHaveLength(1);
    const combo = manifest.combos[0];

    expect(combo.comboId).toBe("4144dda9648a");
    expect(combo.question).toEqual(runJson.question);
    expect(combo.model).toEqual(runJson.model);
    expect(combo.params).toEqual(runJson.params);
    expect(combo.piVersion).toBe(runJson.piVersion);
    expect(combo.startedAt).toBe(runJson.startedAt);
    expect(combo.endedAt).toBe(runJson.endedAt);
    expect(combo.durationMs).toBe(runJson.durationMs);
    expect(combo.status).toBe(runJson.status);
    expect(combo.contractViolations).toEqual([]);
    expect(combo.maxTurnsExceeded).toBe(false);
    expect(combo.maxTurns).toBe(100);
    expect(combo.files).toEqual({
      artifact: "sessions/4144dda9648a/index.html",
      style: "sessions/4144dda9648a/style.css",
      script: "sessions/4144dda9648a/script.js",
      transcript: "sessions/4144dda9648a/session.jsonl",
      run: "sessions/4144dda9648a/run.json",
    });
  });

  // -----------------------------------------------------------------------
  // Test 5: Missing artifact files are omitted from the files map
  // -----------------------------------------------------------------------
  it("omits missing files from the files map but still publishes the combo", async () => {
    const { buildManifest } = await import("./manifest");

    const comboId = "aaaa1111bbbb";
    await writeSession(sessionRoot, "q-snake", "model-alpha", "20260723-233227", fixtureRunJson(), {
      "index.html": "<!DOCTYPE html>",
      // no style.css, no script.js, no session.jsonl (failed run)
    });

    const manifest = await buildManifest({ sessionRoot, outDir });

    expect(manifest.combos).toHaveLength(1);
    expect(manifest.combos[0].files).toEqual({
      artifact: `sessions/${comboId}/index.html`,
      run: `sessions/${comboId}/run.json`,
    });
    expect(await listDir(join(outDir, "sessions", comboId))).toEqual([
      "index.html",
      "run.json",
    ]);
  });

  // -----------------------------------------------------------------------
  // Test 6: run.json without newer fields still publishes (lenient parse)
  // -----------------------------------------------------------------------
  it("carries optional maxTurns fields only when present in run.json", async () => {
    const { buildManifest } = await import("./manifest");

    // Old-format run.json without maxTurns / maxTurnsExceeded / exitCode
    const legacy = fixtureRunJson({ comboId: "0ldf0rmat000" }) as unknown as Record<string, unknown>;
    delete legacy.maxTurns;
    delete legacy.maxTurnsExceeded;
    delete legacy.exitCode;
    await writeSession(sessionRoot, "q-snake", "model-alpha", "20260723-233227", legacy, {
      "index.html": "<!DOCTYPE html>",
    });

    const manifest = await buildManifest({ sessionRoot, outDir });

    expect(manifest.combos).toHaveLength(1);
    expect(manifest.combos[0]).not.toHaveProperty("maxTurns");
    expect(manifest.combos[0]).not.toHaveProperty("maxTurnsExceeded");
  });

  // -----------------------------------------------------------------------
  // Test 7: Directories without a parseable run.json are skipped
  // -----------------------------------------------------------------------
  it("skips directories without run.json and excludes them from the manifest", async () => {
    const { buildManifest } = await import("./manifest");

    await writeSession(sessionRoot, "q-snake", "model-alpha", "20260723-233227", fixtureRunJson(), {
      "index.html": "<!DOCTYPE html>",
    });
    // A leftover directory with no run.json (e.g. an aborted archive)
    await writeSession(sessionRoot, "q-snake", "model-beta", "20260723-233300", null, {
      "index.html": "orphan",
    });
    // A directory with an unparseable run.json
    const broken = await writeSession(sessionRoot, "q-apple", "model-alpha", "20260723-233300", null, {});
    await writeFile(join(broken, "run.json"), "{ not json", "utf-8");

    const manifest = await buildManifest({ sessionRoot, outDir });

    expect(manifest.combos).toHaveLength(1);
    expect(manifest.combos[0].comboId).toBe("aaaa1111bbbb");
    expect(await listDir(join(outDir, "sessions"))).toEqual(["aaaa1111bbbb"]);
  });

  // -----------------------------------------------------------------------
  // Test 8: Stale output combos are cleaned, other outDir files survive
  // -----------------------------------------------------------------------
  it("cleans stale combos from a previous build without wiping outDir", async () => {
    const { buildManifest } = await import("./manifest");

    // Leftover output from a previous build
    await mkdir(join(outDir, "sessions", "stale-combo-id"), { recursive: true });
    await writeFile(join(outDir, "sessions", "stale-combo-id", "index.html"), "stale", "utf-8");
    await writeFile(join(outDir, "index.html"), "dashboard shell", "utf-8");

    await writeSession(sessionRoot, "q-snake", "model-alpha", "20260723-233227", fixtureRunJson(), {
      "index.html": "fresh",
    });

    await buildManifest({ sessionRoot, outDir });

    expect(await listDir(join(outDir, "sessions"))).toEqual(["aaaa1111bbbb"]);
    expect(await readFile(join(outDir, "index.html"), "utf-8")).toBe("dashboard shell");
  });

  // -----------------------------------------------------------------------
  // Test 9: Loop-defect fields pass through (issue #21)
  // -----------------------------------------------------------------------
  it("carries loopDetected/loopConfidence/loopReason into the manifest", async () => {
    const { buildManifest } = await import("./manifest");

    await writeSession(sessionRoot, "q-snake", "model-alpha", "20260723-233227", fixtureRunJson({
      status: "error",
      exitCode: null,
      loopDetected: true,
      loopConfidence: 95,
      loopReason: "10 identical snapshot commands",
    }), {
      "index.html": "<!DOCTYPE html>",
    });

    const manifest = await buildManifest({ sessionRoot, outDir });

    expect(manifest.combos[0].loopDetected).toBe(true);
    expect(manifest.combos[0].loopConfidence).toBe(95);
    expect(manifest.combos[0].loopReason).toBe("10 identical snapshot commands");
  });

  it("omits loop-defect fields when run.json does not record them", async () => {
    const { buildManifest } = await import("./manifest");

    await writeSession(sessionRoot, "q-snake", "model-alpha", "20260723-233227", fixtureRunJson(), {
      "index.html": "<!DOCTYPE html>",
    });

    const manifest = await buildManifest({ sessionRoot, outDir });

    expect(manifest.combos[0]).not.toHaveProperty("loopDetected");
    expect(manifest.combos[0]).not.toHaveProperty("loopConfidence");
    expect(manifest.combos[0]).not.toHaveProperty("loopReason");
  });
});
