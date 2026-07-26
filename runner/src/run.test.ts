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
  chmod,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import type { RunJson } from "./run";

// ---------------------------------------------------------------------------
// Helper: create a temp root for each test suite
// ---------------------------------------------------------------------------
function makeTempRoot(): string {
  return join(tmpdir(), `llm-interview-test-${randomUUID()}`);
}

async function listDir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helper: write fixture registry and questions into a temp dir
// ---------------------------------------------------------------------------
async function writeFixtures(
  root: string,
  models: Array<{ name: string; provider: string; modelId: string; params: Record<string, unknown>; maxTurns?: number }>,
  questions: Array<{ name: string; intent: string; hasSpec?: boolean; hasTickets?: boolean }>
) {
  // Config (TOML)
  const configPath = join(root, "config.toml");
  const modelEntries = models.map((m) => {
    const paramsLines = Object.entries(m.params)
      .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
      .join("\n");
    const maxTurnsLine = m.maxTurns != null ? `max_turns = ${m.maxTurns}\n` : "";
    return `[[models]]
name = ${JSON.stringify(m.name)}
provider = ${JSON.stringify(m.provider)}
modelId = ${JSON.stringify(m.modelId)}
${maxTurnsLine}[models.params]
${paramsLines}`;
  }).join("\n\n");
  const configToml = `max_turns = 100\nrun_rules = ""\n\n${modelEntries}\n`;
  await writeFile(configPath, configToml, "utf-8");

  // Question dirs
  const questionDir = join(root, "questions");
  await mkdir(questionDir, { recursive: true });

  for (const q of questions) {
    const qDir = join(questionDir, q.name);
    await mkdir(qDir, { recursive: true });
    await writeFile(join(qDir, "intent.md"), q.intent, "utf-8");
    if (q.hasSpec) {
      await writeFile(join(qDir, "spec.md"), "# Spec\nDetails here.", "utf-8");
    }
    if (q.hasTickets) {
      await writeFile(join(qDir, "tickets.md"), "# Tickets\n- ticket1", "utf-8");
    }
  }

  return { configPath, questionDir };
}

// ---------------------------------------------------------------------------
// Helper: create a stub pi executable
// ---------------------------------------------------------------------------
async function createStubPi(
  stubPath: string,
  orderLogPath: string,
  misbehave: boolean = false
) {
  const extraLine = misbehave ? "echo 'extra' > extra.js" : "";
  const script = `#!/usr/bin/env bash
# Stub pi executable for tests
# Appends cwd to order log
ORDER_LOG="${orderLogPath}"
echo "$(pwd)" >> "$ORDER_LOG"

# Parse --session-dir (real pi writes its session JSONL there)
SESSION_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session-dir) SESSION_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
SESSION_DIR="\${SESSION_DIR:-.}"

# Create fake session.jsonl
echo '{"role":"user","content":"test"}' > "$SESSION_DIR/session.jsonl"

# Create expected artifacts
echo '<!DOCTYPE html><html></html>' > index.html
echo 'body {}' > style.css
echo 'console.log("hi");' > script.js

${extraLine}

exit 0
`;
  await writeFile(stubPath, script, "utf-8");
  await chmod(stubPath, 0o755);
}

// ---------------------------------------------------------------------------
// Import runMatrix after we've set up helpers
// ---------------------------------------------------------------------------
// We import lazily so tests can set up fixtures first

describe("runMatrix", () => {
  let tempRoot: string;
  let orderLogPath: string;
  let stubPiPath: string;
  let misbehaveStubPath: string;
  let configPath: string;
  let questionDir: string;
  let sessionRoot: string;
  let piHome: string;
  let runTempRoot: string;

  beforeEach(async () => {
    tempRoot = makeTempRoot();
    await mkdir(tempRoot, { recursive: true });
    // Mirror the production layout: a "repo" dir holds questions/registry/session,
    // while run workdirs live OUTSIDE it (the isolation guard requires this).
    const repoDir = join(tempRoot, "repo");
    await mkdir(repoDir, { recursive: true });
    orderLogPath = join(tempRoot, "order.log");
    stubPiPath = join(tempRoot, "stub-pi");
    misbehaveStubPath = join(tempRoot, "stub-pi-misbehave");
    sessionRoot = join(repoDir, "session");
    piHome = join(tempRoot, ".pi-home");
    runTempRoot = join(tempRoot, "runs");
    await mkdir(runTempRoot, { recursive: true });

    // Create stubs
    await createStubPi(stubPiPath, orderLogPath, false);
    await createStubPi(misbehaveStubPath, orderLogPath, true);

    // Write fixtures: 2 models x 2 questions
    const { configPath: rp, questionDir: qd } = await writeFixtures(
      repoDir,
      [
        {
          name: "model-alpha",
          provider: "llamacpp-local",
          modelId: "alpha.gguf",
          params: { temp: 0.7 },
        },
        {
          name: "model-beta",
          provider: "llamacpp-local",
          modelId: "beta.gguf",
          params: { temp: 0.3 },
        },
      ],
      [
        { name: "q-hello", intent: "Build a hello world page." },
        {
          name: "q-counter",
          intent: "Build a counter widget.",
          hasSpec: true,
        },
      ]
    );

    configPath = rp;
    questionDir = qd;
  });

  afterAll(async () => {
    // Cleanup temp dirs (best effort)
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // -----------------------------------------------------------------------
  // Test 1: Model-major execution order
  // -----------------------------------------------------------------------
  it("executes in model-major order (one model finishes all questions before the next)", async () => {
    const { runMatrix } = await import("./run");

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stubPiPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(results).toHaveLength(4); // 2 models x 2 questions

    // Read the order log: each line is the cwd of a run
    const orderLog = await readFile(orderLogPath, "utf-8");
    const dirs = orderLog.trim().split("\n").filter(Boolean);
    expect(dirs).toHaveLength(4);

    // The dirs are random names, but we can verify model-major by checking
    // the archived session paths: model-alpha should have both questions before model-beta
    const sessionAlphaQHello = join(sessionRoot, "q-hello", "model-alpha");
    const sessionAlphaQCounter = join(sessionRoot, "q-counter", "model-alpha");
    const sessionBetaQHello = join(sessionRoot, "q-hello", "model-beta");
    const sessionBetaQCounter = join(sessionRoot, "q-counter", "model-beta");

    // All four session dirs should exist (each with exactly 1 timestamp sub-dir)
    expect(await listDir(sessionAlphaQHello)).toHaveLength(1);
    expect(await listDir(sessionAlphaQCounter)).toHaveLength(1);
    expect(await listDir(sessionBetaQHello)).toHaveLength(1);
    expect(await listDir(sessionBetaQCounter)).toHaveLength(1);

    // Verify model-major: model-alpha's runs completed before model-beta started.
    // We check timestamps in run.json: all model-alpha endedAt < first model-beta startedAt
    const alphaRuns = results.filter((r) => r.model.name === "model-alpha");
    const betaRuns = results.filter((r) => r.model.name === "model-beta");

    const maxAlphaEnd = Math.max(...alphaRuns.map((r) => Date.parse(r.endedAt)));
    const minBetaStart = Math.min(...betaRuns.map((r) => Date.parse(r.startedAt)));

    expect(maxAlphaEnd).toBeLessThanOrEqual(minBetaStart);
  });

  // -----------------------------------------------------------------------
  // Test 2: Archive structure
  // -----------------------------------------------------------------------
  it("archives each run into sessionRoot/<question>/<model>/<YYYYMMDD-HHmmss>/", async () => {
    const { runMatrix } = await import("./run");

    await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stubPiPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    // Check one archive path
    const alphaHelloDirs = await listDir(join(sessionRoot, "q-hello", "model-alpha"));
    expect(alphaHelloDirs).toHaveLength(1);

    const timestampDir = alphaHelloDirs[0];
    // Timestamp format: YYYYMMDD-HHmmss
    expect(timestampDir).toMatch(/^\d{8}-\d{6}$/);

    const archivePath = join(sessionRoot, "q-hello", "model-alpha", timestampDir);
    const files = await listDir(archivePath);

    // Should contain: session.jsonl, index.html, style.css, script.js, run.json
    expect(files).toContain("session.jsonl");
    expect(files).toContain("index.html");
    expect(files).toContain("style.css");
    expect(files).toContain("script.js");
    expect(files).toContain("run.json");
  });

  // -----------------------------------------------------------------------
  // Test 3: run.json fields
  // -----------------------------------------------------------------------
  it("writes correct run.json fields", async () => {
    const { runMatrix } = await import("./run");

    await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stubPiPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    const archivePath = join(
      sessionRoot,
      "q-hello",
      "model-alpha",
      (await listDir(join(sessionRoot, "q-hello", "model-alpha")))[0]
    );
    const runJsonRaw = await readFile(join(archivePath, "run.json"), "utf-8");
    const runJson = JSON.parse(runJsonRaw) as RunJson;

    expect(runJson.question.name).toBe("q-hello");
    expect(runJson.model.name).toBe("model-alpha");
    expect(runJson.model.provider).toBe("llamacpp-local");
    expect(runJson.model.modelId).toBe("alpha.gguf");
    expect(runJson.params).toEqual({ temp: 0.7 });
    expect(runJson.piVersion).toBe("test-1.0");
    expect(runJson.startedAt).toBeDefined();
    expect(runJson.endedAt).toBeDefined();
    expect(runJson.durationMs).toBeGreaterThan(0);
    expect(runJson.status).toBe("ok");
    expect(runJson.exitCode).toBe(0);
    expect(runJson.maxTurnsExceeded).toBe(false);
    expect(runJson.maxTurns).toBe(100);
    expect(runJson.contractViolations).toEqual([]);
    expect(runJson.comboId).toBeDefined();
    expect(runJson.comboId.length).toBe(12);
  });

  // -----------------------------------------------------------------------
  // Test 3b: spec.md / tickets.md in workdir are inputs, not contract violations
  // -----------------------------------------------------------------------
  it("does not flag copied spec.md as a contract violation", async () => {
    const { runMatrix } = await import("./run");

    await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stubPiPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    // q-counter has hasSpec: true — its workdir contains a copied spec.md
    const archivePath = join(
      sessionRoot,
      "q-counter",
      "model-alpha",
      (await listDir(join(sessionRoot, "q-counter", "model-alpha")))[0]
    );
    const runJson = JSON.parse(await readFile(join(archivePath, "run.json"), "utf-8")) as RunJson;

    expect(runJson.contractViolations).toEqual([]);
  });

  // -----------------------------------------------------------------------
  // Test 4: comboId stability
  // -----------------------------------------------------------------------
  it("produces stable comboId for same question+model+params", async () => {
    const { runMatrix } = await import("./run");

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stubPiPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    // Find two runs with the same model but different questions
    const alphaRuns = results.filter((r) => r.model.name === "model-alpha");
    expect(alphaRuns).toHaveLength(2);

    // comboId should differ by question name
    const comboIdsByQuestion = new Map<string, string>();
    for (const r of alphaRuns) {
      comboIdsByQuestion.set(r.question.name, r.comboId);
    }

    expect(comboIdsByQuestion.get("q-hello")).toBeDefined();
    expect(comboIdsByQuestion.get("q-counter")).toBeDefined();
    expect(comboIdsByQuestion.get("q-hello")).not.toBe(
      comboIdsByQuestion.get("q-counter")
    );

    // Verify determinism: runMatrix again with same inputs should get same comboIds
    // (second archive root still lives inside the repo, next to sessionRoot)
    const sessionRoot2 = join(sessionRoot, "..", "session-2");
    const results2 = await runMatrix({
      questionDir,
      configPath,
      sessionRoot: sessionRoot2,
      piBin: stubPiPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    const alphaRuns2 = results2.filter((r) => r.model.name === "model-alpha");
    const comboIdsByQuestion2 = new Map<string, string>();
    for (const r of alphaRuns2) {
      comboIdsByQuestion2.set(r.question.name, r.comboId);
    }

    expect(comboIdsByQuestion.get("q-hello")).toBe(
      comboIdsByQuestion2.get("q-hello")
    );
    expect(comboIdsByQuestion.get("q-counter")).toBe(
      comboIdsByQuestion2.get("q-counter")
    );
  });

  // -----------------------------------------------------------------------
  // Test 5: Contract violation recorded
  // -----------------------------------------------------------------------
  it("records contract violation when extra files are created", async () => {
    const { runMatrix } = await import("./run");

    // Use misbehaving stub that creates extra.js
    await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: misbehaveStubPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    // Check run.json for contract violations
    const archivePath = join(
      sessionRoot,
      "q-hello",
      "model-alpha",
      (await listDir(join(sessionRoot, "q-hello", "model-alpha")))[0]
    );
    const runJsonRaw = await readFile(join(archivePath, "run.json"), "utf-8");
    const runJson = JSON.parse(runJsonRaw) as RunJson;

    expect(runJson.contractViolations).toBeDefined();
    expect(runJson.contractViolations.length).toBeGreaterThan(0);
    // Should mention extra.js
    expect(runJson.contractViolations.some((v: string) => v.includes("extra.js"))).toBe(true);

    // Violation should NOT block archiving — files still exist
    const files = await listDir(archivePath);
    expect(files).toContain("extra.js");
    expect(files).toContain("run.json");
  });

  // -----------------------------------------------------------------------
  // Test 6: Workdir deleted after archiving
  // -----------------------------------------------------------------------
  it("deletes the isolated workdir after archiving", async () => {
    const { runMatrix } = await import("./run");

    await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stubPiPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    const finalRunDirs = await listDir(runTempRoot);

    // All pi-run-* directories should be cleaned up
    const leftoverRunDirs = finalRunDirs.filter((d) => d.startsWith("pi-run-"));
    expect(leftoverRunDirs).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Test 7: Filters narrow the matrix
  // -----------------------------------------------------------------------
  it("narrows the matrix with --question and --model filters", async () => {
    const { runMatrix } = await import("./run");

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stubPiPath,
      piHome,
      tempRoot: runTempRoot,
      questionFilter: ["q-counter"],
      modelFilter: ["beta.gguf"],
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    // Should only run 1 combo: q-counter x model-beta
    expect(results).toHaveLength(1);
    expect(results[0].question.name).toBe("q-counter");
    expect(results[0].model.name).toBe("model-beta");
  });

  // -----------------------------------------------------------------------
  // Test 8: Unknown filter name errors
  // -----------------------------------------------------------------------
  it("throws error for unknown question filter name", async () => {
    const { runMatrix } = await import("./run");

    await expect(
      runMatrix({
        questionDir,
        configPath,
        sessionRoot,
        piBin: stubPiPath,
        piHome,
        tempRoot: runTempRoot,
        questionFilter: ["nonexistent-question"],
        piVersion: "test-1.0",
      })
    ).rejects.toThrow(/nonexistent-question.*Available:.*q-hello/s);
  });

  it("throws error for unknown model filter name", async () => {
    const { runMatrix } = await import("./run");

    await expect(
      runMatrix({
        questionDir,
        configPath,
        sessionRoot,
        piBin: stubPiPath,
        piHome,
        tempRoot: runTempRoot,
        modelFilter: ["nonexistent-model"],
        piVersion: "test-1.0",
      })
    ).rejects.toThrow();
  });

  // -----------------------------------------------------------------------
  // Test 9: Isolation guard — run workdirs must live outside the repo
  // -----------------------------------------------------------------------
  it("rejects a tempRoot inside the repository", async () => {
    const { runMatrix } = await import("./run");

    await expect(
      runMatrix({
        questionDir,
        configPath,
        sessionRoot,
        piBin: stubPiPath,
        piHome,
        // sessionRoot's parent is the repo; this puts workdirs inside it
        tempRoot: join(sessionRoot, "..", "runs-inside-repo"),
        piVersion: "test-1.0",
      })
    ).rejects.toThrow(/outside the repository/);
  });

  // -----------------------------------------------------------------------
  // Test 10: Missing-artifact contract violations are flagged
  // -----------------------------------------------------------------------
  it("flags missing artifact files in run.json", async () => {
    const { runMatrix } = await import("./run");

    // Stub that produces only index.html (no style.css / script.js)
    const lazyStub = join(tempRoot, "stub-pi-lazy");
    await writeFile(
      lazyStub,
      `#!/usr/bin/env bash
echo '{"role":"user","content":"test"}' > session.jsonl
echo '<!DOCTYPE html><html></html>' > index.html
exit 0
`,
      "utf-8"
    );
    await chmod(lazyStub, 0o755);

    await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: lazyStub,
      piHome,
      tempRoot: runTempRoot,
      questionFilter: ["q-hello"],
      modelFilter: ["alpha.gguf"],
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    const archivePath = join(
      sessionRoot,
      "q-hello",
      "model-alpha",
      (await listDir(join(sessionRoot, "q-hello", "model-alpha")))[0]
    );
    const runJson = JSON.parse(await readFile(join(archivePath, "run.json"), "utf-8")) as RunJson;

    expect(
      runJson.contractViolations.some((v: string) => v.includes("missing expected artifact: style.css"))
    ).toBe(true);
    expect(
      runJson.contractViolations.some((v: string) => v.includes("missing expected artifact: script.js"))
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Test 11: Missing transcript is flagged (Session = transcript + artifact)
  // -----------------------------------------------------------------------
  it("flags a missing transcript in run.json", async () => {
    const { runMatrix } = await import("./run");

    // Stub that produces artifacts but NO session jsonl
    const muteStub = join(tempRoot, "stub-pi-mute");
    await writeFile(
      muteStub,
      `#!/usr/bin/env bash
echo '<!DOCTYPE html><html></html>' > index.html
echo 'body {}' > style.css
echo 'console.log("hi");' > script.js
exit 0
`,
      "utf-8"
    );
    await chmod(muteStub, 0o755);

    await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: muteStub,
      piHome,
      tempRoot: runTempRoot,
      questionFilter: ["q-hello"],
      modelFilter: ["alpha.gguf"],
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    const archivePath = join(
      sessionRoot,
      "q-hello",
      "model-alpha",
      (await listDir(join(sessionRoot, "q-hello", "model-alpha")))[0]
    );
    const runJson = JSON.parse(await readFile(join(archivePath, "run.json"), "utf-8")) as RunJson;

    expect(
      runJson.contractViolations.some((v: string) => v.includes("missing transcript"))
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Test 12: Base64 image data is stripped from the archived session.jsonl
  // -----------------------------------------------------------------------
  it("strips base64 image data from the archived session.jsonl", async () => {
    const { runMatrix } = await import("./run");

    // Stub that writes a session.jsonl containing an image content item
    // into --session-dir (like real pi)
    const imageStub = join(tempRoot, "stub-pi-image");
    await writeFile(
      imageStub,
      `#!/usr/bin/env bash
SESSION_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session-dir) SESSION_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
SESSION_DIR="\${SESSION_DIR:-.}"
cat > "$SESSION_DIR/session.jsonl" <<'JSONL'
{"type":"message","message":{"role":"user","content":[{"type":"text","text":"look at this"},{"type":"image","data":"iVBORw0KGgoAAAANSUhEUg","mimeType":"image/png"}]}}
JSONL
echo '<!DOCTYPE html><html></html>' > index.html
echo 'body {}' > style.css
echo 'console.log("hi");' > script.js
exit 0
`,
      "utf-8"
    );
    await chmod(imageStub, 0o755);

    await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: imageStub,
      piHome,
      tempRoot: runTempRoot,
      questionFilter: ["q-hello"],
      modelFilter: ["alpha.gguf"],
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    const archivePath = join(
      sessionRoot,
      "q-hello",
      "model-alpha",
      (await listDir(join(sessionRoot, "q-hello", "model-alpha")))[0]
    );
    const sessionRaw = await readFile(join(archivePath, "session.jsonl"), "utf-8");

    expect(sessionRaw).not.toContain("iVBORw0KGgoAAAANSUhEUg");
    expect(sessionRaw).toContain('"data":"[stripped]"');
    // Non-image content must survive untouched
    expect(sessionRaw).toContain("look at this");
  });

  // -----------------------------------------------------------------------
  // Test 13: Exceeding the max turn limit is recorded in run.json
  // -----------------------------------------------------------------------
  it("records maxTurnsExceeded in run.json when the turn limit is hit", async () => {
    const { runMatrix } = await import("./run");

    // Stub that emits more turn_start events than the limit, then idles
    // until the runner kills it.
    const loopingStub = join(tempRoot, "stub-pi-looping");
    await writeFile(
      loopingStub,
      `#!/usr/bin/env bash
for i in 1 2 3 4 5; do echo '{"type":"turn_start"}'; done
sleep 30
`,
      "utf-8"
    );
    await chmod(loopingStub, 0o755);

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: loopingStub,
      piHome,
      tempRoot: runTempRoot,
      questionFilter: ["q-hello"],
      modelFilter: ["alpha.gguf"],
      piVersion: "test-1.0",
      maxTurns: 2,
      runRules: "",
    });

    expect(results).toHaveLength(1);
    expect(results[0].maxTurnsExceeded).toBe(true);
    expect(results[0].status).not.toBe("ok");

    const archivePath = join(
      sessionRoot,
      "q-hello",
      "model-alpha",
      (await listDir(join(sessionRoot, "q-hello", "model-alpha")))[0]
    );
    const runJson = JSON.parse(await readFile(join(archivePath, "run.json"), "utf-8")) as RunJson;
    expect(runJson.maxTurnsExceeded).toBe(true);
    expect(runJson.maxTurns).toBe(2);
  });

  // -----------------------------------------------------------------------
  // Test 14: A model-level max_turns override wins over the global limit
  // -----------------------------------------------------------------------
  it("lets a model-level max_turns override win over the global limit", async () => {
    const { runMatrix } = await import("./run");

    // Separate repo fixture: one model with max_turns = 2, global stays 100
    const repoDir2 = join(tempRoot, "repo-override");
    await mkdir(repoDir2, { recursive: true });
    const sessionRoot2 = join(repoDir2, "session");
    const { configPath: configPath2, questionDir: questionDir2 } = await writeFixtures(
      repoDir2,
      [
        {
          name: "model-limited",
          provider: "llamacpp-local",
          modelId: "limited.gguf",
          params: { temp: 0.7 },
          maxTurns: 2,
        },
      ],
      [{ name: "q-hello", intent: "Build a hello world page." }]
    );

    // Same looping stub: emits 5 turn_start events, then idles
    const loopingStub = join(tempRoot, "stub-pi-looping-2");
    await writeFile(
      loopingStub,
      `#!/usr/bin/env bash
for i in 1 2 3 4 5; do echo '{"type":"turn_start"}'; done
sleep 30
`,
      "utf-8"
    );
    await chmod(loopingStub, 0o755);

    const results = await runMatrix({
      questionDir: questionDir2,
      configPath: configPath2,
      sessionRoot: sessionRoot2,
      piBin: loopingStub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100, // global limit — the model's max_turns = 2 must win
      runRules: "",
    });

    expect(results).toHaveLength(1);
    expect(results[0].maxTurnsExceeded).toBe(true);

    const archivePath = join(
      sessionRoot2,
      "q-hello",
      "model-limited",
      (await listDir(join(sessionRoot2, "q-hello", "model-limited")))[0]
    );
    const runJson = JSON.parse(await readFile(join(archivePath, "run.json"), "utf-8")) as RunJson;
    expect(runJson.maxTurnsExceeded).toBe(true);
    expect(runJson.maxTurns).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Per-ticket flow (ADR 0007): one pi invocation per ticket, dirty
// invocations arbitrated by an evaluation invocation.
// ---------------------------------------------------------------------------

/**
 * Write a repo fixture with one model and one question whose tickets.md
 * parses into the given number of tickets.
 */
async function writeTicketedFixtures(
  repoDir: string,
  ticketCount: number
): Promise<{ configPath: string; questionDir: string; sessionRoot: string }> {
  const configPath = join(repoDir, "config.toml");
  await writeFile(
    configPath,
    `max_turns = 100\nrun_rules = ""\n\n[[models]]\nname = "model-alpha"\nprovider = "llamacpp-local"\nmodelId = "alpha.gguf"\n[models.params]\ntemp = 0.7\n`,
    "utf-8"
  );

  const questionDir = join(repoDir, "questions");
  const qDir = join(questionDir, "q-ticketed");
  await mkdir(qDir, { recursive: true });
  await writeFile(join(qDir, "intent.md"), "Build a multi-ticket project.", "utf-8");
  const ticketLines = Array.from(
    { length: ticketCount },
    (_, i) => `[ ]${i + 1}. Ticket number ${i + 1}\n  - subtask`
  ).join("\n");
  await writeFile(join(qDir, "tickets.md"), `# Tickets\n\n${ticketLines}\n`, "utf-8");

  return { configPath, questionDir, sessionRoot: join(repoDir, "session") };
}

/**
 * A stub pi that distinguishes invocations via a counter file in cwd and
 * emits a session.jsonl per invocation into --session-dir (like real pi)
 * according to the given script map (1-based invocation number →
 * session.jsonl content). Always writes the three artifact files and
 * exits 0. Cleans up its counter on the last call.
 *
 * When cleanWorkdir is set, each invocation first deletes any *.jsonl and
 * pi-output-*.log in its cwd — simulating an agent that "cleans up" the
 * working directory to satisfy the artifact contract.
 */
async function createScriptedStubPi(
  stubPath: string,
  sessionByCall: Record<number, string>,
  options: { cleanWorkdir?: boolean } = {}
) {
  const lastCall = Math.max(...Object.keys(sessionByCall).map(Number));
  const cases = Object.entries(sessionByCall)
    .map(([n, content]) => `  ${n}) SESSION='${content}' ;;`)
    .join("\n");
  const cleanup = options.cleanWorkdir
    ? 'rm -f ./*.jsonl ./pi-output-*.log 2>/dev/null || true'
    : "";
  const script = `#!/usr/bin/env bash
COUNT=$(cat .stub-count 2>/dev/null || echo 0)
COUNT=$((COUNT+1))
echo "$COUNT" > .stub-count
SESSION_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session-dir) SESSION_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
SESSION_DIR="\${SESSION_DIR:-.}"
${cleanup}
SESSION='{}'
case "$COUNT" in
${cases}
esac
echo "$SESSION" > "$SESSION_DIR/session.jsonl"
echo '<!DOCTYPE html><html></html>' > index.html
echo 'body {}' > style.css
echo 'console.log("hi");' > script.js
if [ "$COUNT" -ge ${lastCall} ]; then rm -f .stub-count; fi
exit 0
`;
  await writeFile(stubPath, script, "utf-8");
  await chmod(stubPath, 0o755);
}

const CLEAN_SESSION =
  '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"done"}]}}';
const DIRTY_SESSION =
  '{"type":"message","message":{"role":"assistant","content":[{"type":"toolResult","isError":true}]}}';
const VERDICT_SESSION = (v: string) =>
  `{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"Judged. <verdict>${v}</verdict>"}]}}`;

describe("runMatrix per-ticket flow", () => {
  let tempRoot: string;
  let piHome: string;
  let runTempRoot: string;

  beforeEach(async () => {
    tempRoot = makeTempRoot();
    await mkdir(tempRoot, { recursive: true });
    piHome = join(tempRoot, ".pi-home");
    runTempRoot = join(tempRoot, "runs");
    await mkdir(runTempRoot, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  async function readArchivedRunJson(sessionRoot: string): Promise<RunJson> {
    const dirs = await listDir(join(sessionRoot, "q-ticketed", "model-alpha"));
    expect(dirs).toHaveLength(1);
    const archivePath = join(sessionRoot, "q-ticketed", "model-alpha", dirs[0]);
    return JSON.parse(await readFile(join(archivePath, "run.json"), "utf-8")) as RunJson;
  }

  async function readArchivedSession(sessionRoot: string): Promise<string> {
    const dirs = await listDir(join(sessionRoot, "q-ticketed", "model-alpha"));
    const archivePath = join(sessionRoot, "q-ticketed", "model-alpha", dirs[0]);
    return readFile(join(archivePath, "session.jsonl"), "utf-8");
  }

  it("runs one invocation per ticket and records them in run.json", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-clean");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeTicketedFixtures(repoDir, 2);

    const stub = join(tempRoot, "stub-clean");
    await createScriptedStubPi(stub, { 1: CLEAN_SESSION, 2: CLEAN_SESSION });

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe("ok");

    const runJson = await readArchivedRunJson(sessionRoot);
    expect(runJson.status).toBe("ok");
    expect(runJson.invocations).toBeDefined();
    expect(runJson.invocations!).toHaveLength(2);
    expect(runJson.invocations![0]).toMatchObject({
      ticket: 1,
      ticketTitle: "Ticket number 1",
      dirty: false,
      status: "ok",
    });
    expect(runJson.invocations![1]).toMatchObject({
      ticket: 2,
      ticketTitle: "Ticket number 2",
      dirty: false,
      status: "ok",
    });

    // Both invocations' transcripts are concatenated into one session.jsonl
    const session = await readArchivedSession(sessionRoot);
    const lines = session.trim().split("\n");
    expect(lines).toHaveLength(2);
  });

  it("arbitrates a dirty invocation with an evaluation and continues on COMPLETE", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-eval-complete");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeTicketedFixtures(repoDir, 2);

    // Call 1: ticket 1 with a failed tool result (dirty) → evaluation.
    // Call 2: evaluation verdict COMPLETE → continue. Call 3: ticket 2 clean.
    const stub = join(tempRoot, "stub-eval-complete");
    await createScriptedStubPi(stub, {
      1: DIRTY_SESSION,
      2: VERDICT_SESSION("COMPLETE"),
      3: CLEAN_SESSION,
    });

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(results[0].status).toBe("ok");

    const runJson = await readArchivedRunJson(sessionRoot);
    expect(runJson.status).toBe("ok");
    expect(runJson.invocations!).toHaveLength(3);
    expect(runJson.invocations![0]).toMatchObject({ ticket: 1, dirty: true });
    expect(runJson.invocations![1]).toMatchObject({
      ticket: 1,
      evaluation: true,
      verdict: "complete",
    });
    expect(runJson.invocations![2]).toMatchObject({ ticket: 2, dirty: false });

    // The evaluation transcript is part of the archived session.jsonl
    const session = await readArchivedSession(sessionRoot);
    expect(session).toContain("<verdict>COMPLETE</verdict>");
  });

  it("aborts the run when the evaluation verdict is INCOMPLETE", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-eval-incomplete");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeTicketedFixtures(repoDir, 3);

    // Call 1: ticket 1 dirty → evaluation. Call 2: verdict INCOMPLETE → abort.
    const stub = join(tempRoot, "stub-eval-incomplete");
    await createScriptedStubPi(stub, {
      1: DIRTY_SESSION,
      2: VERDICT_SESSION("INCOMPLETE"),
    });

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(results[0].status).toBe("error");

    const runJson = await readArchivedRunJson(sessionRoot);
    expect(runJson.status).toBe("error");
    // Ticket 1 + its evaluation; tickets 2 and 3 never ran
    expect(runJson.invocations!).toHaveLength(2);
    expect(runJson.invocations![1]).toMatchObject({
      ticket: 1,
      evaluation: true,
      verdict: "incomplete",
    });

    const session = await readArchivedSession(sessionRoot);
    expect(session.trim().split("\n")).toHaveLength(2);
  });

  it("aborts the run when the evaluation verdict is missing", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-eval-missing");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeTicketedFixtures(repoDir, 2);

    // Call 1: dirty → evaluation. Call 2: no verdict marker → conservative abort.
    const stub = join(tempRoot, "stub-eval-missing");
    await createScriptedStubPi(stub, { 1: DIRTY_SESSION, 2: CLEAN_SESSION });

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(results[0].status).toBe("error");

    const runJson = await readArchivedRunJson(sessionRoot);
    expect(runJson.invocations!).toHaveLength(2);
    expect(runJson.invocations![1]).toMatchObject({
      evaluation: true,
      verdict: null,
    });
  });

  it("trusts a COMPLETE verdict even when the evaluation had failed tool calls", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-eval-dirty");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeTicketedFixtures(repoDir, 2);

    // Call 1: ticket 1 dirty → evaluation.
    // Call 2: evaluation transcript contains a benign isError tool result
    //         AND an explicit COMPLETE verdict — the verdict must win.
    // Call 3: ticket 2 clean.
    const dirtyEvalSession =
      '{"type":"message","message":{"role":"toolResult","toolName":"write","content":[{"type":"text","text":"disk full"}],"isError":true}}' +
      "\n" +
      VERDICT_SESSION("COMPLETE");
    const stub = join(tempRoot, "stub-eval-dirty");
    await createScriptedStubPi(stub, {
      1: DIRTY_SESSION,
      2: dirtyEvalSession,
      3: CLEAN_SESSION,
    });

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(results[0].status).toBe("ok");

    const runJson = await readArchivedRunJson(sessionRoot);
    expect(runJson.invocations!).toHaveLength(3);
    expect(runJson.invocations![1]).toMatchObject({
      ticket: 1,
      evaluation: true,
      verdict: "complete",
      dirty: true,
    });
    expect(runJson.invocations![2]).toMatchObject({ ticket: 2 });
  });

  it("does not trigger an evaluation for failed read-only tool calls", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-readonly-dirty");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeTicketedFixtures(repoDir, 2);

    // Call 1: ticket 1 with failed read/grep probes only — NOT dirty, no
    // evaluation. Call 2: ticket 2 clean.
    const readOnlyDirtySession =
      '{"type":"message","message":{"role":"toolResult","toolName":"read","content":[{"type":"text","text":"ENOENT"}],"isError":true}}' +
      "\n" +
      '{"type":"message","message":{"role":"toolResult","toolName":"grep","content":[{"type":"text","text":"no match"}],"isError":true}}';
    const stub = join(tempRoot, "stub-readonly-dirty");
    await createScriptedStubPi(stub, {
      1: readOnlyDirtySession,
      2: CLEAN_SESSION,
    });

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(results[0].status).toBe("ok");

    const runJson = await readArchivedRunJson(sessionRoot);
    expect(runJson.invocations!).toHaveLength(2);
    expect(runJson.invocations![0]).toMatchObject({ ticket: 1, dirty: false });
    expect(runJson.invocations![1]).toMatchObject({ ticket: 2, dirty: false });
  });

  it("keeps the single-invocation flow when tickets.md has fewer than 2 tickets", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-single-ticket");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeTicketedFixtures(repoDir, 1);

    const stub = join(tempRoot, "stub-single");
    await createScriptedStubPi(stub, { 1: CLEAN_SESSION });

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(results[0].status).toBe("ok");

    const runJson = await readArchivedRunJson(sessionRoot);
    // Single-invocation flow: no invocations array, no evaluation
    expect(runJson.invocations).toBeUndefined();
  });

  it("survives the agent deleting transcript-like files from its workdir", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-agent-cleanup");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeTicketedFixtures(repoDir, 2);

    // Real-run behavior (Qwopus, 2026-07-25): the agent "cleans up" *.jsonl
    // and pi-output-*.log from its cwd so the directory matches the
    // three-file artifact contract — deleting the runner's transcripts.
    // Transcripts must live outside the agent's workdir so archiving
    // still succeeds.
    const stub = join(tempRoot, "stub-agent-cleanup");
    await createScriptedStubPi(
      stub,
      { 1: CLEAN_SESSION, 2: CLEAN_SESSION },
      { cleanWorkdir: true }
    );

    const results = await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(results[0].status).toBe("ok");

    // Both invocations' transcripts survived and were archived
    const session = await readArchivedSession(sessionRoot);
    expect(session.trim().split("\n")).toHaveLength(2);
  });
});

describe("runMatrix API failure handling", () => {
  let tempRoot: string;
  let piHome: string;
  let runTempRoot: string;

  beforeEach(async () => {
    tempRoot = makeTempRoot();
    await mkdir(tempRoot, { recursive: true });
    piHome = join(tempRoot, ".pi-home");
    runTempRoot = join(tempRoot, "runs");
    await mkdir(runTempRoot, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const API_ERROR_SESSION =
    '{"type":"message","message":{"role":"assistant","content":[],"stopReason":"error"}}';

  it("aborts the whole matrix on a terminal API failure (no evaluation, no later combos)", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-api-abort");
    await mkdir(repoDir, { recursive: true });

    // Two models × one ticketed question: model-alpha runs first and dies
    // from an API failure; model-beta must never run.
    const fixtures = await writeFixtures(
      repoDir,
      [
        { name: "model-alpha", provider: "llamacpp-local", modelId: "alpha.gguf", params: { temp: 0.7 } },
        { name: "model-beta", provider: "llamacpp-local", modelId: "beta.gguf", params: { temp: 0.7 } },
      ],
      [{ name: "q-ticketed", intent: "Build a multi-ticket project.", hasTickets: true }]
    );
    const sessionRoot = join(repoDir, "session");
    const qDir = join(repoDir, "questions", "q-ticketed");
    await writeFile(
      join(qDir, "tickets.md"),
      "# Tickets\n\n[ ]1. Ticket number 1\n  - subtask\n[ ]2. Ticket number 2\n  - subtask\n",
      "utf-8"
    );

    // First (and only) invocation: transcript ends with stopReason "error",
    // the signature of a terminal API failure.
    const stub = join(tempRoot, "stub-api-error");
    await createScriptedStubPi(stub, { 1: API_ERROR_SESSION });

    const results = await runMatrix({
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    // The matrix stopped after the failed combo: model-beta never ran.
    expect(results).toHaveLength(1);
    expect(results[0].model.name).toBe("model-alpha");
    expect(results[0].status).toBe("error");

    // run.json records the API failure; no evaluation was attempted.
    const dirs = await listDir(join(sessionRoot, "q-ticketed", "model-alpha"));
    expect(dirs).toHaveLength(1);
    const runJson = JSON.parse(
      await readFile(join(sessionRoot, "q-ticketed", "model-alpha", dirs[0], "run.json"), "utf-8")
    ) as RunJson;
    expect(runJson.status).toBe("error");
    expect(runJson.apiError).toBeTruthy();
    expect(runJson.invocations!).toHaveLength(1);
    expect(runJson.invocations![0]).toMatchObject({
      ticket: 1,
      status: "error",
    });
    expect(runJson.invocations![0].apiError).toBeTruthy();

    // model-beta has no archive at all.
    const betaDirs = await listDir(join(sessionRoot, "q-ticketed", "model-beta"));
    expect(betaDirs).toHaveLength(0);
  });

  it("does not abort the matrix when a retry eventually succeeds", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-api-recovered");
    await mkdir(repoDir, { recursive: true });

    const fixtures = await writeFixtures(
      repoDir,
      [
        { name: "model-alpha", provider: "llamacpp-local", modelId: "alpha.gguf", params: { temp: 0.7 } },
        { name: "model-beta", provider: "llamacpp-local", modelId: "beta.gguf", params: { temp: 0.7 } },
      ],
      [{ name: "q-ticketed", intent: "Build a multi-ticket project.", hasTickets: true }]
    );
    const sessionRoot = join(repoDir, "session");
    const qDir = join(repoDir, "questions", "q-ticketed");
    await writeFile(
      join(qDir, "tickets.md"),
      "# Tickets\n\n[ ]1. Ticket number 1\n  - subtask\n[ ]2. Ticket number 2\n  - subtask\n",
      "utf-8"
    );

    // An earlier retry attempt errored, but the last assistant message is
    // clean — the invocation recovered and the matrix must continue.
    const recoveredSession =
      '{"type":"message","message":{"role":"assistant","content":[],"stopReason":"error"}}' +
      "\n" +
      CLEAN_SESSION;
    const stub = join(tempRoot, "stub-api-recovered");
    await createScriptedStubPi(stub, {
      1: recoveredSession,
      2: CLEAN_SESSION,
      3: recoveredSession,
      4: CLEAN_SESSION,
    });

    const results = await runMatrix({
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(results).toHaveLength(2);
    expect(results[0].status).toBe("ok");
    expect(results[1].status).toBe("ok");
  });
});
