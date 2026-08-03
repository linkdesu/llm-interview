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
  stat,
} from "node:fs/promises";
import { join, isAbsolute, basename } from "node:path";
import { pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import type { RunJson } from "./run";
import type { MatrixResumeFile, ResumeRemainingCombo } from "./resume";

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
  // Test 8b: Model id typo aborts before any combo runs
  // -----------------------------------------------------------------------
  it("aborts before running when a model id is missing from pi's models.json", async () => {
    const { runMatrix } = await import("./run");

    // Declare the provider in pi's models.json but with different model ids
    await mkdir(piHome, { recursive: true });
    await writeFile(
      join(piHome, "models.json"),
      JSON.stringify({
        providers: {
          "llamacpp-local": {
            models: [{ id: "alpha-v2.gguf" }, { id: "beta-v2.gguf" }],
          },
        },
      }),
      "utf-8"
    );

    await expect(
      runMatrix({
        questionDir,
        configPath,
        sessionRoot,
        piBin: stubPiPath,
        piHome,
        tempRoot: runTempRoot,
        piVersion: "test-1.0",
        maxTurns: 100,
        runRules: "",
      })
    ).rejects.toThrow(/alpha\.gguf.*Available:.*alpha-v2\.gguf/s);

    // Nothing ran: no archives were produced
    expect(await listDir(sessionRoot)).toHaveLength(0);
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

// ---------------------------------------------------------------------------
// Matrix index log (run-log.ts): one pi-run-YYYYMMDD-HHmmss.log per matrix
// execution, with timestamped lines, self-contained combo START/END markers,
// and a SUMMARY. The END line must carry the archived session.jsonl path so
// failures can be located with `grep "END: ERROR"` even after an interrupt.
// ---------------------------------------------------------------------------

describe("runMatrix index log", () => {
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

  const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /;

  it("writes timestamped START/END markers and a SUMMARY for a healthy run", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-index-ok");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeTicketedFixtures(repoDir, 2);

    const stub = join(tempRoot, "stub-index-ok");
    await createScriptedStubPi(stub, { 1: CLEAN_SESSION, 2: CLEAN_SESSION });

    const indexLogPath = join(tempRoot, "pi-run-20990101-000000.log");
    await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      indexLogPath,
    });

    const content = await readFile(indexLogPath, "utf-8");

    // Every physical line carries an ISO timestamp prefix
    for (const line of content.trimEnd().split("\n")) {
      expect(line).toMatch(ISO_PREFIX);
    }

    // START marker names the combo and the (temporary) pi-run dir
    expect(content).toContain(
      "=== Combo 1/1 START: q-ticketed × model-alpha (pi-run-"
    );

    // END marker carries the archived transcript path — and it exists
    const endMatch = content.match(
      /=== Combo 1\/1 END: OK \([\d.]+s\) session: (.+) ===/
    );
    expect(endMatch).not.toBeNull();
    expect(endMatch![1]).toContain(sessionRoot);
    expect(endMatch![1].endsWith("session.jsonl")).toBe(true);
    expect(await readFile(endMatch![1], "utf-8")).toContain("done");

    // SUMMARY for a clean run
    expect(content).toContain("=== SUMMARY: 1 combos, 0 failed");
  });

  it("records a failed combo's session path in its END line and the SUMMARY", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-index-error");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeTicketedFixtures(repoDir, 1);

    // Single-invocation flow; the stub writes a session file, then exceeds
    // the turn limit and gets killed — an error combo WITH a transcript.
    const killerStub = join(tempRoot, "stub-index-killed");
    await writeFile(
      killerStub,
      `#!/usr/bin/env bash
SESSION_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session-dir) SESSION_DIR="$2"; shift 2 ;;
    *) shift ;;
  esac
done
SESSION_DIR="\${SESSION_DIR:-.}"
echo '${CLEAN_SESSION}' > "$SESSION_DIR/session.jsonl"
echo '<!DOCTYPE html><html></html>' > index.html
echo 'body {}' > style.css
echo 'console.log("hi");' > script.js
for i in 1 2 3 4 5; do echo '{"type":"turn_start"}'; done
sleep 30
`,
      "utf-8"
    );
    await chmod(killerStub, 0o755);

    const indexLogPath = join(tempRoot, "pi-run-20990101-000001.log");
    await runMatrix({
      questionDir,
      configPath,
      sessionRoot,
      piBin: killerStub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 2,
      runRules: "",
      indexLogPath,
    });

    const content = await readFile(indexLogPath, "utf-8");

    // END: ERROR still carries the archived transcript path
    const endMatch = content.match(
      /=== Combo 1\/1 END: ERROR \([\d.]+s\) session: (.+) ===/
    );
    expect(endMatch).not.toBeNull();
    expect(endMatch![1]).toContain(sessionRoot);
    expect(endMatch![1].endsWith("session.jsonl")).toBe(true);

    // SUMMARY lists the failure with its transcript path
    expect(content).toContain("=== SUMMARY: 1 combos, 1 failed");
    expect(content).toMatch(
      /ERROR q-ticketed × model-alpha → .+session\.jsonl/
    );
  });

  it("still writes the SUMMARY when the matrix aborts on a terminal API failure", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-index-abort");
    await mkdir(repoDir, { recursive: true });

    // Two models × one question: model-alpha dies from an API failure,
    // model-beta must never run — but the SUMMARY must still be written.
    const fixtures = await writeFixtures(
      repoDir,
      [
        { name: "model-alpha", provider: "llamacpp-local", modelId: "alpha.gguf", params: { temp: 0.7 } },
        { name: "model-beta", provider: "llamacpp-local", modelId: "beta.gguf", params: { temp: 0.7 } },
      ],
      [{ name: "q-hello", intent: "Build a hello world page." }]
    );
    const sessionRoot = join(repoDir, "session");

    const apiErrorSession =
      '{"type":"message","message":{"role":"assistant","content":[],"stopReason":"error"}}';
    const stub = join(tempRoot, "stub-index-api-error");
    await createScriptedStubPi(stub, { 1: apiErrorSession });

    const indexLogPath = join(tempRoot, "pi-run-20990101-000002.log");
    await runMatrix({
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      indexLogPath,
    });

    const content = await readFile(indexLogPath, "utf-8");

    // The failed combo's END line carries its transcript path
    expect(content).toMatch(
      /=== Combo 1\/2 END: ERROR \([\d.]+s\) session: .+session\.jsonl ===/
    );
    // SUMMARY exists despite the abort, and names the abort reason
    expect(content).toContain("=== SUMMARY: 1 combos, 1 failed — aborted:");
    // model-beta never started (it may still appear as "pending" in the
    // progress overview — that is expected)
    expect(content).not.toContain("START: q-hello × model-beta");
  });
});

// ---------------------------------------------------------------------------
// Question-level concurrency (--concurrency N): up to N questions of one
// model execute simultaneously, pulled in their original order; models
// stay strictly sequential.
// Asserted through stub-pi start/end markers (process-level overlap), never
// through scheduling internals.
// ---------------------------------------------------------------------------

/**
 * A stub pi that records `start`/`end` markers (model id + workdir) around
 * a fixed sleep, so tests can measure real process-level overlap. Fulfills
 * the same session/artifact contract as the other stubs.
 */
async function createMarkerStubPi(
  stubPath: string,
  markerLogPath: string,
  sleepSeconds: number
) {
  const script = `#!/usr/bin/env bash
# Stub pi that logs start/end markers for concurrency observation
MARKER_LOG="${markerLogPath}"
MODEL=""
SESSION_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session-dir) SESSION_DIR="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    *) shift ;;
  esac
done
SESSION_DIR="\${SESSION_DIR:-.}"
echo "start $MODEL $(pwd)" >> "$MARKER_LOG"
sleep ${sleepSeconds}
echo "end $MODEL $(pwd)" >> "$MARKER_LOG"
echo '${CLEAN_SESSION}' > "$SESSION_DIR/session.jsonl"
echo '<!DOCTYPE html><html></html>' > index.html
echo 'body {}' > style.css
echo 'console.log("hi");' > script.js
exit 0
`;
  await writeFile(stubPath, script, "utf-8");
  await chmod(stubPath, 0o755);
}

interface MarkerEvent {
  kind: "start" | "end";
  model: string;
  workdir: string;
}

async function readMarkerEvents(path: string): Promise<MarkerEvent[]> {
  const content = await readFile(path, "utf-8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [kind, model, workdir] = line.split(" ");
      return { kind: kind as "start" | "end", model, workdir };
    });
}

/**
 * Maximum simultaneously open invocations across the given marker events
 * (a sweep: +1 on start, -1 on end, tracking the peak).
 */
function maxOverlap(
  events: MarkerEvent[],
  match: (e: MarkerEvent) => boolean = () => true
): number {
  let open = 0;
  let max = 0;
  for (const e of events.filter(match)) {
    open += e.kind === "start" ? 1 : -1;
    if (open > max) max = open;
  }
  return max;
}

/**
 * A stub pi for API-failure drain tests: logs start/end markers like the
 * marker stub, dies immediately with a terminal API failure when the
 * prompt (the last argument) contains the fail token, and otherwise
 * sleeps — staying in flight — before completing cleanly.
 */
async function createDrainStubPi(
  stubPath: string,
  markerLogPath: string,
  failToken: string,
  siblingSleepSeconds: number
) {
  const apiErrorSession =
    '{"type":"message","message":{"role":"assistant","content":[],"stopReason":"error"}}';
  const script = `#!/usr/bin/env bash
# Stub pi: one combo fails terminally, siblings stay in flight then finish
MARKER_LOG="${markerLogPath}"
FAIL_TOKEN='${failToken}'
MODEL=""
SESSION_DIR=""
PROMPT="${'${@: -1}'}"
while [ $# -gt 0 ]; do
  case "$1" in
    --session-dir) SESSION_DIR="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    *) shift ;;
  esac
done
SESSION_DIR="\${SESSION_DIR:-.}"
echo "start $MODEL $(pwd)" >> "$MARKER_LOG"
case "$PROMPT" in
  *"$FAIL_TOKEN"*)
    SESSION='${apiErrorSession}'
    ;;
  *)
    sleep ${siblingSleepSeconds}
    SESSION='${CLEAN_SESSION}'
    ;;
esac
echo "$SESSION" > "$SESSION_DIR/session.jsonl"
echo "end $MODEL $(pwd)" >> "$MARKER_LOG"
echo '<!DOCTYPE html><html></html>' > index.html
echo 'body {}' > style.css
echo 'console.log("hi");' > script.js
exit 0
`;
  await writeFile(stubPath, script, "utf-8");
  await chmod(stubPath, 0o755);
}

describe("runMatrix concurrency", () => {
  let tempRoot: string;
  let piHome: string;
  let runTempRoot: string;
  let markerLogPath: string;
  let stubPath: string;

  beforeEach(async () => {
    tempRoot = makeTempRoot();
    await mkdir(tempRoot, { recursive: true });
    piHome = join(tempRoot, ".pi-home");
    runTempRoot = join(tempRoot, "runs");
    await mkdir(runTempRoot, { recursive: true });
    markerLogPath = join(tempRoot, "markers.log");
    stubPath = join(tempRoot, "stub-pi-marker");
    await createMarkerStubPi(stubPath, markerLogPath, 0.2);
  });

  afterAll(async () => {
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("rejects a non-integer or < 1 concurrency before any combo runs", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-invalid-concurrency");
    await mkdir(repoDir, { recursive: true });
    const { configPath, questionDir, sessionRoot } = await writeTicketedFixtures(repoDir, 1);

    for (const bad of [0, -2, 1.5]) {
      await expect(
        runMatrix({
          questionDir,
          configPath,
          sessionRoot,
          piBin: stubPath,
          piHome,
          tempRoot: runTempRoot,
          piVersion: "test-1.0",
          maxTurns: 100,
          runRules: "",
          concurrency: bad,
        })
      ).rejects.toThrow(/concurrency/);
    }

    // Nothing ran: no archives, no stub invocations.
    expect(await listDir(sessionRoot)).toHaveLength(0);
    expect(await listDir(tempRoot)).not.toContain("markers.log");
  });

  it("runs up to N questions of one model concurrently with isolated archives", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-ceiling");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeFixtures(
      repoDir,
      [
        {
          name: "model-alpha",
          provider: "llamacpp-local",
          modelId: "alpha.gguf",
          params: { temp: 0.7 },
        },
      ],
      [
        { name: "q-1", intent: "Build page one." },
        { name: "q-2", intent: "Build page two." },
        { name: "q-3", intent: "Build page three." },
        { name: "q-4", intent: "Build page four." },
      ]
    );
    const sessionRoot = join(repoDir, "session");

    const results = await runMatrix({
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot,
      piBin: stubPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      concurrency: 2,
    });

    expect(results).toHaveLength(4);

    // Process-level observation: the ceiling was reached, never exceeded.
    const events = await readMarkerEvents(markerLogPath);
    expect(events).toHaveLength(8);
    expect(maxOverlap(events)).toBe(2);

    // Every combo archived into its own destination with its own run.json.
    for (const q of ["q-1", "q-2", "q-3", "q-4"]) {
      const dirs = await listDir(join(sessionRoot, q, "model-alpha"));
      expect(dirs).toHaveLength(1);
      const runJson = JSON.parse(
        await readFile(join(sessionRoot, q, "model-alpha", dirs[0], "run.json"), "utf-8")
      ) as RunJson;
      expect(runJson.question.name).toBe(q);
      expect(runJson.status).toBe("ok");
    }
  });

  it("never runs invocations of two different models concurrently", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-model-serial");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeFixtures(
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
        { name: "q-1", intent: "Build page one." },
        { name: "q-2", intent: "Build page two." },
      ]
    );
    const sessionRoot = join(repoDir, "session");

    const results = await runMatrix({
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot,
      piBin: stubPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      concurrency: 2,
    });

    expect(results).toHaveLength(4);

    // At no point in time is an invocation of each model open at once.
    const events = await readMarkerEvents(markerLogPath);
    expect(events).toHaveLength(8);
    let openAlpha = 0;
    let openBeta = 0;
    let sawBeta = false;
    for (const e of events) {
      const delta = e.kind === "start" ? 1 : -1;
      if (e.model.endsWith("/alpha.gguf")) openAlpha += delta;
      else openBeta += delta;
      expect(openAlpha === 0 || openBeta === 0).toBe(true);
      if (openBeta > 0) sawBeta = true;
    }
    // Both models actually ran (guard against a vacuous pass).
    expect(sawBeta).toBe(true);
  });

  it("keeps per-ticket invocations of one combo strictly sequential under concurrency", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-ticket-isolation");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeFixtures(
      repoDir,
      [
        {
          name: "model-alpha",
          provider: "llamacpp-local",
          modelId: "alpha.gguf",
          params: { temp: 0.7 },
        },
      ],
      [
        { name: "q-one", intent: "Build project one.", hasTickets: true },
        { name: "q-two", intent: "Build project two.", hasTickets: true },
      ]
    );
    const sessionRoot = join(repoDir, "session");
    // Three tickets each → per-ticket flow (ADR 0007) in both combos.
    const tickets =
      "# Tickets\n\n[ ]1. Ticket number 1\n  - subtask\n[ ]2. Ticket number 2\n  - subtask\n[ ]3. Ticket number 3\n  - subtask\n";
    await writeFile(join(fixtures.questionDir, "q-one", "tickets.md"), tickets, "utf-8");
    await writeFile(join(fixtures.questionDir, "q-two", "tickets.md"), tickets, "utf-8");

    const results = await runMatrix({
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot,
      piBin: stubPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      concurrency: 2,
    });

    expect(results).toHaveLength(2);

    // 2 combos × 3 ticket invocations = 6 invocations, each pair marked.
    const events = await readMarkerEvents(markerLogPath);
    expect(events).toHaveLength(12);

    // The two combos (distinct workdirs) really did overlap …
    expect(maxOverlap(events)).toBe(2);
    // … but inside one combo (one workdir) invocations never overlap:
    // tickets keep building on each other's workdir state (ADR 0007).
    const workdirs = [...new Set(events.map((e) => e.workdir))];
    expect(workdirs).toHaveLength(2);
    for (const workdir of workdirs) {
      expect(maxOverlap(events, (e) => e.workdir === workdir)).toBe(1);
    }
  });

  it("is fully sequential by default (flag absent)", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-default-sequential");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeFixtures(
      repoDir,
      [
        {
          name: "model-alpha",
          provider: "llamacpp-local",
          modelId: "alpha.gguf",
          params: { temp: 0.7 },
        },
      ],
      [
        { name: "q-1", intent: "Build page one." },
        { name: "q-2", intent: "Build page two." },
        { name: "q-3", intent: "Build page three." },
      ]
    );
    const sessionRoot = join(repoDir, "session");

    const results = await runMatrix({
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot,
      piBin: stubPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(results).toHaveLength(3);
    const events = await readMarkerEvents(markerLogPath);
    expect(events).toHaveLength(6);
    expect(maxOverlap(events)).toBe(1);
  });

  it("accepts a concurrency larger than the question count", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-oversized");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeFixtures(
      repoDir,
      [
        {
          name: "model-alpha",
          provider: "llamacpp-local",
          modelId: "alpha.gguf",
          params: { temp: 0.7 },
        },
      ],
      [
        { name: "q-1", intent: "Build page one." },
        { name: "q-2", intent: "Build page two." },
      ]
    );
    const sessionRoot = join(repoDir, "session");

    const results = await runMatrix({
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot,
      piBin: stubPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      concurrency: 99,
    });

    expect(results).toHaveLength(2);
    const events = await readMarkerEvents(markerLogPath);
    expect(maxOverlap(events)).toBe(2);
  });

  it("keeps index log START/END markers, SUMMARY, and progress overviews greppable under interleaving", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-index-interleaved");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeFixtures(
      repoDir,
      [
        {
          name: "model-alpha",
          provider: "llamacpp-local",
          modelId: "alpha.gguf",
          params: { temp: 0.7 },
        },
      ],
      [
        { name: "q-1", intent: "Build page one." },
        { name: "q-2", intent: "Build page two." },
      ]
    );
    const sessionRoot = join(repoDir, "session");

    const indexLogPath = join(tempRoot, "pi-run-20990101-000003.log");
    const results = await runMatrix({
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot,
      piBin: stubPath,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      concurrency: 2,
      indexLogPath,
    });

    expect(results).toHaveLength(2);

    const content = await readFile(indexLogPath, "utf-8");
    const ISO_PREFIX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /;
    for (const line of content.trimEnd().split("\n")) {
      expect(line).toMatch(ISO_PREFIX);
    }

    // Every combo has exactly one START and one END marker, each naming
    // its combo — greppable despite interleaved concurrent output.
    for (const comboIndex of [1, 2]) {
      expect(
        content.match(new RegExp(`=== Combo ${comboIndex}/2 START: q-${comboIndex} × model-alpha`, "g"))
      ).toHaveLength(1);
    }
    const endMatches = [
      ...content.matchAll(
        /=== Combo (\d)\/2 END: OK \([\d.]+s\) session: (.+session\.jsonl) ===/g
      ),
    ];
    expect(endMatches).toHaveLength(2);
    for (const m of endMatches) {
      // The archived transcript named in the END marker exists.
      expect(await readFile(m[2], "utf-8")).toContain("done");
    }

    // SUMMARY reflects all completions; one progress overview was
    // rendered per combo completion (driven by completion, not iteration).
    expect(content).toContain("=== SUMMARY: 2 combos, 0 failed");
    expect(content.match(/\n[^\n]*Progress:\n/g)).toHaveLength(2);
  });

  it("drains the in-flight batch on a terminal API failure: siblings archive, later combos never start", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-api-drain");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeFixtures(
      repoDir,
      [
        {
          name: "model-alpha",
          provider: "llamacpp-local",
          modelId: "alpha.gguf",
          params: { temp: 0.7 },
        },
      ],
      [
        { name: "q-1-sibling", intent: "Build page one." },
        { name: "q-2-failing", intent: "Build the page that hits a terminal API failure." },
        { name: "q-3-later", intent: "Build page three." },
      ]
    );
    const sessionRoot = join(repoDir, "session");

    // q-2-failing dies immediately from a terminal API failure while its
    // sibling q-1-sibling is still in flight (sleeping).
    const stub = join(tempRoot, "stub-api-drain");
    await createDrainStubPi(stub, markerLogPath, "terminal API failure", 0.4);

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
      concurrency: 2,
    });

    // The batch drained, then the matrix aborted: q-3-later never ran.
    expect(results).toHaveLength(2);
    const byQuestion = Object.fromEntries(results.map((r) => [r.question.name, r]));
    expect(byQuestion["q-1-sibling"].status).toBe("ok");
    expect(byQuestion["q-2-failing"].status).toBe("error");

    // Process-level observation: two invocations were in flight together
    // when the failure hit, and no third invocation ever started.
    const events = await readMarkerEvents(markerLogPath);
    expect(events).toHaveLength(4);
    expect(maxOverlap(events)).toBe(2);

    // The sibling ran to completion and archived normally — already-paid
    // tokens are never thrown away by the abort.
    const siblingDirs = await listDir(join(sessionRoot, "q-1-sibling", "model-alpha"));
    expect(siblingDirs).toHaveLength(1);
    const siblingRunJson = JSON.parse(
      await readFile(join(sessionRoot, "q-1-sibling", "model-alpha", siblingDirs[0], "run.json"), "utf-8")
    ) as RunJson;
    expect(siblingRunJson.status).toBe("ok");
    expect(
      await readFile(join(sessionRoot, "q-1-sibling", "model-alpha", siblingDirs[0], "session.jsonl"), "utf-8")
    ).toContain("done");

    // The failed combo archived too, recording the terminal API failure.
    const failedDirs = await listDir(join(sessionRoot, "q-2-failing", "model-alpha"));
    expect(failedDirs).toHaveLength(1);
    const failedRunJson = JSON.parse(
      await readFile(join(sessionRoot, "q-2-failing", "model-alpha", failedDirs[0], "run.json"), "utf-8")
    ) as RunJson;
    expect(failedRunJson.status).toBe("error");
    expect(failedRunJson.apiError).toBeTruthy();

    // q-3-later was never dequeued after the observed failure: no archive.
    expect(await listDir(join(sessionRoot, "q-3-later", "model-alpha"))).toHaveLength(0);
  });

  it("names the abort reason in the SUMMARY exactly as the sequential path does", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-api-drain-summary");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeFixtures(
      repoDir,
      [
        {
          name: "model-alpha",
          provider: "llamacpp-local",
          modelId: "alpha.gguf",
          params: { temp: 0.7 },
        },
      ],
      [
        { name: "q-1-sibling", intent: "Build page one." },
        { name: "q-2-failing", intent: "Build the page that hits a terminal API failure." },
        { name: "q-3-later", intent: "Build page three." },
      ]
    );
    const sessionRoot = join(repoDir, "session");

    const stub = join(tempRoot, "stub-api-drain-summary");
    await createDrainStubPi(stub, markerLogPath, "terminal API failure", 0.4);

    const indexLogPath = join(tempRoot, "pi-run-20990101-000004.log");
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
      concurrency: 2,
      indexLogPath,
    });

    expect(results).toHaveLength(2);
    const content = await readFile(indexLogPath, "utf-8");

    // Both in-flight combos got their END markers with archived transcript
    // paths before the matrix returned.
    expect(content).toMatch(/=== Combo 1\/3 START: q-1-sibling × model-alpha/);
    expect(content).toMatch(/=== Combo 1\/3 END: OK \([\d.]+s\) session: .+session\.jsonl ===/);
    expect(content).toMatch(/=== Combo 2\/3 END: ERROR \([\d.]+s\) session: .+session\.jsonl ===/);

    // The SUMMARY names the abort reason with the exact string the
    // sequential path uses.
    expect(content).toContain(
      '=== SUMMARY: 2 combos, 1 failed — aborted: transcript ends with stopReason "error"'
    );

    // q-3-later never started.
    expect(content).not.toContain("START: q-3-later");
  });
});

// ---------------------------------------------------------------------------
// Resume File lifecycle (schema v1): created before the first Combo runs,
// atomically rewritten (write-temp-then-rename) as Combos and invocations
// complete, deleted on normal Matrix completion. Kill-level interruption
// (kill -9) cannot be simulated in-process, so those tests drive runMatrix
// in a child process and SIGKILL it.
// ---------------------------------------------------------------------------

/**
 * A stub pi that announces each invocation with a `waiting-<key>` marker in
 * the gate dir and blocks until the matching `gate-<key>` file appears
 * (bounded, so orphaned stubs after a kill eventually exit). The key is
 * `<runDir basename>-<session id>` — unique per Combo per invocation.
 *
 * With `evalVerdict` set, evaluation invocations (session id ending in
 * `-eval`) emit a verdict session instead of the default clean one.
 */
async function createGatedStubPi(
  stubPath: string,
  gateDir: string,
  options: { evalVerdict?: "COMPLETE" | "INCOMPLETE" } = {}
) {
  const evalSession = options.evalVerdict
    ? VERDICT_SESSION(options.evalVerdict)
    : CLEAN_SESSION;
  const script = `#!/usr/bin/env bash
# Stub pi whose invocations proceed only when the test opens their gate
GATE_DIR="${gateDir}"
SESSION_DIR=""
SESSION_ID=""
while [ $# -gt 0 ]; do
  case "$1" in
    --session-dir) SESSION_DIR="$2"; shift 2 ;;
    --session-id) SESSION_ID="$2"; shift 2 ;;
    *) shift ;;
  esac
done
SESSION_DIR="\${SESSION_DIR:-.}"
KEY="$(basename "$(dirname "$SESSION_DIR")")-$SESSION_ID"
touch "$GATE_DIR/waiting-$KEY"
n=0
while [ ! -f "$GATE_DIR/gate-$KEY" ]; do
  n=$((n+1))
  if [ "$n" -gt 900 ]; then exit 1; fi
  sleep 0.05
done
case "$SESSION_ID" in
  *-eval) SESSION='${evalSession}' ;;
  *) SESSION='${CLEAN_SESSION}' ;;
esac
echo "$SESSION" > "$SESSION_DIR/session.jsonl"
echo '<!DOCTYPE html><html></html>' > index.html
echo 'body {}' > style.css
echo 'console.log("hi");' > script.js
exit 0
`;
  await writeFile(stubPath, script, "utf-8");
  await chmod(stubPath, 0o755);
}

/**
 * Write a repo fixture with one model and the given questions, each with a
 * tickets.md parsing into `ticketCount` tickets.
 */
async function writeTicketedMatrixFixtures(
  repoDir: string,
  questionNames: string[],
  ticketCount: number
): Promise<{ configPath: string; questionDir: string; sessionRoot: string }> {
  const configPath = join(repoDir, "config.toml");
  await writeFile(
    configPath,
    `max_turns = 100\nrun_rules = ""\n\n[[models]]\nname = "model-alpha"\nprovider = "llamacpp-local"\nmodelId = "alpha.gguf"\n[models.params]\ntemp = 0.7\n`,
    "utf-8"
  );
  const questionDir = join(repoDir, "questions");
  for (const name of questionNames) {
    const qDir = join(questionDir, name);
    await mkdir(qDir, { recursive: true });
    await writeFile(join(qDir, "intent.md"), `Build ${name}.`, "utf-8");
    const ticketLines = Array.from(
      { length: ticketCount },
      (_, i) => `[ ]${i + 1}. Ticket number ${i + 1}\n  - subtask`
    ).join("\n");
    await writeFile(join(qDir, "tickets.md"), `# Tickets\n\n${ticketLines}\n`, "utf-8");
  }
  return { configPath, questionDir, sessionRoot: join(repoDir, "session") };
}

/**
 * Poll an external condition (files written by stub pi processes, the
 * Resume File rewritten asynchronously) until it holds. A real poll
 * interval is required here: the condition is produced outside this
 * process's control flow, so there is no internal promise/event to await
 * and fake timers cannot observe the change. Bounded; fails on timeout.
 */
async function waitFor(
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 15000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await Bun.sleep(20);
  }
  throw new Error("waitFor: condition not met within timeout");
}

/** Parse the Resume File, or null when it does not exist / is momentarily absent. */
async function readResumeFile(path: string): Promise<MatrixResumeFile | null> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as MatrixResumeFile;
  } catch {
    return null;
  }
}

/** Open every waiting gate matching the filter (default: all of them). */
async function openWaitingGates(
  gateDir: string,
  filter: (marker: string) => boolean = () => true
): Promise<void> {
  for (const marker of await listDir(gateDir)) {
    if (marker.startsWith("waiting-") && filter(marker)) {
      await writeFile(
        join(gateDir, marker.replace("waiting-", "gate-")),
        "",
        "utf-8"
      );
    }
  }
}

/**
 * Write the tiny driver the kill tests spawn as a child process: it calls
 * runMatrix with fixture paths from argv. Kill-level interruption
 * (kill -9) cannot be simulated in-process — the same process being killed
 * must be the one maintaining the Resume File.
 */
async function writeResumeDriver(driverPath: string): Promise<void> {
  const runModuleUrl = pathToFileURL(join(import.meta.dir, "run.ts")).href;
  const source = `import { runMatrix } from ${JSON.stringify(runModuleUrl)};

const [
  questionDir,
  configPath,
  sessionRoot,
  tempRoot,
  piBin,
  piHome,
  resumeFilePath,
  concurrencyRaw,
] = process.argv.slice(2);

await runMatrix({
  questionDir,
  configPath,
  sessionRoot,
  tempRoot,
  piBin,
  piHome,
  resumeFilePath,
  concurrency: Number(concurrencyRaw),
  piVersion: "test-1.0",
  maxTurns: 100,
  runRules: "",
});
`;
  await writeFile(driverPath, source, "utf-8");
}

/** Find the remaining Combo a waiting-gate marker belongs to (by run dir). */
function comboForMarker(
  marker: string,
  resume: MatrixResumeFile
): MatrixResumeFile["remaining"][number] | undefined {
  const runKey = marker
    .slice("waiting-".length)
    .replace(/-t\d+(-eval)?$/, "");
  return resume.remaining.find((r) => r.inFlight?.runDir.endsWith(runKey));
}

/**
 * Drive the gated stub pi in the child process: as invocations announce
 * themselves, open their gates only when `mayOpen` allows, until the Resume
 * File satisfies `stop`. Returns the file content that satisfied it.
 */
async function pumpGatesUntil(opts: {
  gateDir: string;
  resumeFilePath: string;
  mayOpen: (marker: string, resume: MatrixResumeFile) => boolean;
  stop: (resume: MatrixResumeFile) => boolean;
}): Promise<MatrixResumeFile> {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const resume = await readResumeFile(opts.resumeFilePath);
    if (resume) {
      if (opts.stop(resume)) return resume;
      await openWaitingGates(opts.gateDir, (marker) =>
        opts.mayOpen(marker, resume)
      );
    }
    await Bun.sleep(30);
  }
  throw new Error("pumpGatesUntil: stop condition not met within timeout");
}

/**
 * Release killed-Matrix orphan stubs. A single-shot `openWaitingGates` can
 * miss an orphan whose `waiting-*` marker hasn't landed yet (its parent was
 * just kill -9'd), so pump until every observed marker is gated and no new
 * marker appears for a quiet streak, bounded by a deadline. Real-time
 * polling is unavoidable: the gate protocol runs in a spawned bash stub,
 * which fake timers cannot drive. The stub's own gate wait is bounded too.
 */
async function releaseOrphanedGates(gateDir: string): Promise<void> {
  const deadline = Date.now() + 5000;
  let quietPolls = 0;
  while (Date.now() < deadline && quietPolls < 10) {
    await openWaitingGates(gateDir);
    const files = await listDir(gateDir);
    const unreleased = files.some(
      (f) =>
        f.startsWith("waiting-") &&
        !files.includes(f.replace("waiting-", "gate-"))
    );
    quietPolls = unreleased ? 0 : quietPolls + 1;
    await Bun.sleep(30);
  }
}

describe("runMatrix Resume File", () => {
  let tempRoot: string;
  let piHome: string;
  let runTempRoot: string;
  let gateDir: string;

  beforeEach(async () => {
    tempRoot = makeTempRoot();
    await mkdir(tempRoot, { recursive: true });
    piHome = join(tempRoot, ".pi-home");
    runTempRoot = join(tempRoot, "runs");
    await mkdir(runTempRoot, { recursive: true });
    gateDir = join(tempRoot, "gates");
    await mkdir(gateDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("exists before the first Combo runs and reflects exactly the Combos still needing work after every completion", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-lifecycle");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1", "q-2"], 2);
    const stub = join(tempRoot, "stub-pi-gated");
    await createGatedStubPi(stub, gateDir);
    const resumeFilePath = join(tempRoot, "matrix-resume-20990101-000000.json");

    const runPromise = runMatrix({
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot: fixtures.sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      resumeFilePath,
    });

    // The file exists from the very start of the Matrix...
    await waitFor(async () => (await readResumeFile(resumeFilePath)) !== null);
    // ...and once the first Combo is in flight (its first invocation is
    // gated), it still lists every planned Combo — interruption protection
    // exists from the first Combo.
    await waitFor(async () =>
      (await listDir(gateDir)).some((f) => f.startsWith("waiting-"))
    );
    const initial = (await readResumeFile(resumeFilePath))!;
    expect(initial.version).toBe(1);
    expect(initial.remaining.map((r) => r.questionName)).toEqual(["q-1", "q-2"]);

    // Let the first Combo finish: the rewrite drops exactly that Combo.
    await waitFor(async () => {
      await openWaitingGates(gateDir);
      return (await readResumeFile(resumeFilePath))?.remaining.length === 1;
    });
    const afterFirst = (await readResumeFile(resumeFilePath))!;
    expect(afterFirst.remaining.map((r) => r.questionName)).toEqual(["q-2"]);

    // Let the second Combo finish; a normally finished Matrix deletes the file.
    await waitFor(async () => {
      await openWaitingGates(gateDir);
      return (await readResumeFile(resumeFilePath)) === null;
    });
    const results = await runPromise;
    expect(results).toHaveLength(2);
  }, 30000);

  it("deletes the Resume File when the Matrix finishes normally, leaving no temp files behind", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-normal-finish");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1", "q-2"], 2);
    const stub = join(tempRoot, "stub-pi-fast");
    await createMarkerStubPi(stub, join(tempRoot, "markers.log"), 0.1);
    const resumeFilePath = join(tempRoot, "matrix-resume-20990101-000001.json");

    const runPromise = runMatrix({
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot: fixtures.sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      resumeFilePath,
    });

    // Guard against a vacuous deletion assertion: the file must have
    // existed while the Matrix was running.
    await waitFor(async () => (await readResumeFile(resumeFilePath)) !== null);

    const results = await runPromise;
    expect(results).toHaveLength(2);

    // Neither the Resume File nor a leftover temp sibling survives a normal finish.
    expect(
      (await listDir(tempRoot)).filter((f) => f.startsWith("matrix-resume-"))
    ).toEqual([]);
  }, 30000);

  it("records the original filters, concurrency, and pi version, and an aborted Matrix keeps the file listing the Combos that never ran", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-abort-keeps-file");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeFixtures(
      repoDir,
      [
        {
          name: "model-alpha",
          provider: "llamacpp-local",
          modelId: "alpha.gguf",
          params: { temp: 0.7 },
        },
      ],
      [
        { name: "q-1-sibling", intent: "Build page one." },
        { name: "q-2-failing", intent: "Build the page that hits a terminal API failure." },
        { name: "q-3-later", intent: "Build page three." },
      ]
    );
    const sessionRoot = join(repoDir, "session");

    // q-2-failing dies immediately from a terminal API failure while its
    // sibling q-1-sibling is still in flight (sleeping): the batch drains,
    // then the Matrix aborts without starting q-3-later.
    const markerLogPath = join(tempRoot, "markers.log");
    const stub = join(tempRoot, "stub-api-drain-resume");
    await createDrainStubPi(stub, markerLogPath, "terminal API failure", 0.4);
    const resumeFilePath = join(tempRoot, "matrix-resume-20990101-000002.json");

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
      concurrency: 2,
      questionFilter: ["q-1-sibling", "q-2-failing", "q-3-later"],
      modelFilter: ["alpha.gguf"],
      resumeFilePath,
    });

    // The Matrix aborted after draining the in-flight batch.
    expect(results).toHaveLength(2);

    // The file survives the abort, self-contained: original filters,
    // concurrency, and pi version — everything resume needs to restore the
    // original intent without re-specifying flags.
    const resume = (await readResumeFile(resumeFilePath))!;
    expect(resume).not.toBeNull();
    expect(resume.version).toBe(1);
    expect(resume.concurrency).toBe(2);
    expect(resume.piVersion).toBe("test-1.0");
    expect(resume.questionFilter).toEqual(["q-1-sibling", "q-2-failing", "q-3-later"]);
    expect(resume.modelFilter).toEqual(["alpha.gguf"]);

    // Both drained Combos left `remaining` once archived — q-2-failing
    // included, despite its error status: archived means completed. Only
    // the Combo that never ran is left, with no in-flight state.
    expect(resume.remaining.map((r) => r.questionName)).toEqual(["q-3-later"]);
    expect(resume.remaining[0].modelName).toBe("model-alpha");
    expect(resume.remaining[0].comboId).toMatch(/^[0-9a-f]{12}$/);
    expect(resume.remaining[0].inFlight).toBeUndefined();
  }, 30000);

  it("leaves the interrupted Combo's surviving runDir and completed invocations in the file when the Matrix is killed mid-Combo", async () => {
    const repoDir = join(tempRoot, "repo-killed-mid-combo");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1", "q-2"], 3);
    const stub = join(tempRoot, "stub-pi-gated-kill");
    await createGatedStubPi(stub, gateDir);
    const driverPath = join(tempRoot, "resume-driver.ts");
    await writeResumeDriver(driverPath);
    const resumeFilePath = join(tempRoot, "matrix-resume-20990101-000003.json");

    // runMatrix in a CHILD process: kill -9 semantics are only honest when
    // the killed process is the one maintaining the Resume File.
    const proc = Bun.spawn(
      [
        "bun",
        driverPath,
        fixtures.questionDir,
        fixtures.configPath,
        fixtures.sessionRoot,
        runTempRoot,
        stub,
        piHome,
        resumeFilePath,
        "1",
      ],
      { env: { ...process.env, NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe" }
    );

    // q-1 runs to completion (its gates open as they appear); for q-2 only
    // the first ticket may complete — the Matrix is then killed with q-2's
    // second ticket in flight. Gates open only once the Resume File
    // positively tracks the Combo, so no gate opens ahead of a rewrite.
    await pumpGatesUntil({
      gateDir,
      resumeFilePath,
      mayOpen: (marker, resume) => {
        const combo = comboForMarker(marker, resume);
        if (!combo) return false;
        if (combo.questionName === "q-2") return marker.endsWith("-t1");
        return true;
      },
      stop: (resume) => {
        const q2 = resume.remaining.find((r) => r.questionName === "q-2");
        return q2?.inFlight?.completedInvocations.length === 1;
      },
    });

    // kill -9: no cleanup, no final write — the file must already be accurate.
    proc.kill(9);
    await proc.exited;

    const killed = (await readResumeFile(resumeFilePath))!;
    expect(killed).not.toBeNull();
    expect(killed.version).toBe(1);

    // q-1 archived before the kill and left `remaining`; q-2 is the only
    // Combo still needing work, recorded as interrupted mid-execution.
    expect(killed.remaining.map((r) => r.questionName)).toEqual(["q-2"]);
    const interrupted = killed.remaining[0];
    expect(interrupted.inFlight).toBeDefined();
    const { runDir, completedInvocations } = interrupted.inFlight!;
    expect(isAbsolute(runDir)).toBe(true);
    // The surviving run dir really survives (the killed process ran no cleanup).
    expect((await listDir(runDir)).length).toBeGreaterThan(0);
    // The completed ticket invocation is recorded in run.json shape so a
    // future resume can skip it instead of re-paying for it.
    expect(completedInvocations).toHaveLength(1);
    expect(completedInvocations[0].ticket).toBe(1);
    expect(completedInvocations[0].ticketTitle).toBe("Ticket number 1");
    expect(completedInvocations[0].status).toBe("ok");
    expect(completedInvocations[0].dirty).toBe(false);

    // Release any orphaned stub pi so the temp dir can be cleaned up.
    await releaseOrphanedGates(gateDir);
  }, 60000);

  it("records up to N in-flight entries when a concurrent Matrix is killed mid-batch", async () => {
    const repoDir = join(tempRoot, "repo-killed-mid-batch");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(
      repoDir,
      ["q-1", "q-2", "q-3"],
      2
    );
    const stub = join(tempRoot, "stub-pi-gated-kill-batch");
    await createGatedStubPi(stub, gateDir);
    const driverPath = join(tempRoot, "resume-driver-batch.ts");
    await writeResumeDriver(driverPath);
    const resumeFilePath = join(tempRoot, "matrix-resume-20990101-000004.json");

    const proc = Bun.spawn(
      [
        "bun",
        driverPath,
        fixtures.questionDir,
        fixtures.configPath,
        fixtures.sessionRoot,
        runTempRoot,
        stub,
        piHome,
        resumeFilePath,
        "2",
      ],
      { env: { ...process.env, NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe" }
    );

    // Two lanes run q-1 and q-2 concurrently; each may complete only its
    // first ticket. The kill lands with both second tickets in flight.
    await pumpGatesUntil({
      gateDir,
      resumeFilePath,
      mayOpen: (marker, resume) =>
        comboForMarker(marker, resume) !== undefined && marker.endsWith("-t1"),
      stop: (resume) =>
        resume.remaining.filter(
          (r) => r.inFlight && r.inFlight.completedInvocations.length === 1
        ).length === 2,
    });

    proc.kill(9);
    await proc.exited;

    const killed = (await readResumeFile(resumeFilePath))!;
    expect(killed).not.toBeNull();
    expect(killed.concurrency).toBe(2);

    // All three Combos still need work; exactly N (= concurrency) of them
    // carry in-flight state — the batch that was executing at the kill.
    expect(killed.remaining.map((r) => r.questionName)).toEqual([
      "q-1",
      "q-2",
      "q-3",
    ]);
    const inFlight = killed.remaining.filter((r) => r.inFlight);
    expect(inFlight).toHaveLength(2);
    for (const combo of inFlight) {
      expect(isAbsolute(combo.inFlight!.runDir)).toBe(true);
      expect((await listDir(combo.inFlight!.runDir)).length).toBeGreaterThan(0);
      expect(combo.inFlight!.completedInvocations).toHaveLength(1);
      expect(combo.inFlight!.completedInvocations[0].ticket).toBe(1);
      expect(combo.inFlight!.completedInvocations[0].status).toBe("ok");
    }
    // q-3 never started: no in-flight state.
    expect(
      killed.remaining.find((r) => r.questionName === "q-3")!.inFlight
    ).toBeUndefined();

    // Release any orphaned stub pi so the temp dir can be cleaned up.
    await releaseOrphanedGates(gateDir);
  }, 60000);

  it("never serves a truncated or unparseable file while rewrites land continuously under concurrency", async () => {
    const { runMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-atomic-rewrites");
    await mkdir(repoDir, { recursive: true });
    // 4 Combos × 2 tickets at concurrency 3: combo starts, per-invocation
    // flushes, and combo completions rewrite the file continuously.
    const fixtures = await writeTicketedMatrixFixtures(
      repoDir,
      ["q-1", "q-2", "q-3", "q-4"],
      2
    );
    const stub = join(tempRoot, "stub-pi-atomic");
    await createMarkerStubPi(stub, join(tempRoot, "markers.log"), 0.05);
    const resumeFilePath = join(tempRoot, "matrix-resume-20990101-000005.json");

    // Concurrent reader for the whole run: every read must observe either
    // no file (before creation / after deletion) or complete, parseable
    // JSON — atomic rename makes a torn write unobservable.
    let running = true;
    let observed = 0;
    const unparseable: string[] = [];
    const reader = (async () => {
      while (running) {
        try {
          JSON.parse(await readFile(resumeFilePath, "utf-8"));
          observed++;
        } catch (err) {
          // ENOENT is legitimate (not yet created / already deleted);
          // anything else means a reader saw a truncated file.
          if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
            unparseable.push(String(err));
          }
        }
      }
    })();

    const results = await runMatrix({
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot: fixtures.sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
      concurrency: 3,
      resumeFilePath,
    });
    running = false;
    await reader;

    expect(results).toHaveLength(4);
    // The reader genuinely observed the file mid-run (no vacuous pass).
    expect(observed).toBeGreaterThan(0);
    expect(unparseable).toEqual([]);
    // Normal finish: neither the file nor a temp sibling remains.
    expect(
      (await listDir(tempRoot)).filter((f) => f.startsWith("matrix-resume-"))
    ).toEqual([]);
  }, 30000);
});

// ---------------------------------------------------------------------------
// resumeMatrix: invocation-level recovery from a Resume File (#19).
// In-flight fixtures are produced two ways: hand-crafted Resume Files plus
// surviving run dirs, and authentic leftovers of a Matrix killed mid-Combo
// in a child process (the same kill harness as the Resume File suite).
// ---------------------------------------------------------------------------

/**
 * A stub pi that appends one line per invocation to a count log:
 * `<question>-<sessionId> <runDir basename>` (the question name is
 * extracted from the prompt, which always opens with the intent). Lets
 * resume tests assert exactly which invocations executed for which Combo —
 * and, more importantly, which did NOT.
 */
async function createCountingStubPi(stubPath: string, countLogPath: string) {
  const script = `#!/usr/bin/env bash
# Stub pi that records every invocation for resume assertions
COUNT_LOG="${countLogPath}"
SESSION_DIR=""
SESSION_ID=""
PROMPT="${'${@: -1}'}"
while [ $# -gt 0 ]; do
  case "$1" in
    --session-dir) SESSION_DIR="$2"; shift 2 ;;
    --session-id) SESSION_ID="$2"; shift 2 ;;
    *) shift ;;
  esac
done
SESSION_DIR="\${SESSION_DIR:-.}"
Q=$(printf '%s' "$PROMPT" | grep -oE 'q-[0-9]+' | head -n 1)
echo "\${Q:-unknown}-\${SESSION_ID:-session} $(basename "$(dirname "$SESSION_DIR")")" >> "$COUNT_LOG"
echo '${CLEAN_SESSION}' > "$SESSION_DIR/session.jsonl"
echo '<!DOCTYPE html><html></html>' > index.html
echo 'body {}' > style.css
echo 'console.log("hi");' > script.js
exit 0
`;
  await writeFile(stubPath, script, "utf-8");
  await chmod(stubPath, 0o755);
}

/** Read the counting stub's log into `<question>-<sessionId>` / runKey pairs. */
async function readCountLog(
  path: string
): Promise<Array<{ invocation: string; runKey: string }>> {
  const content = await readFile(path, "utf-8");
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [invocation, runKey] = line.split(" ");
      return { invocation, runKey };
    });
}

/** Write a well-formed Resume File fixture (schema v1 defaults overridable). */
async function writeResumeFileFixture(
  path: string,
  file: Partial<MatrixResumeFile> & Pick<MatrixResumeFile, "remaining">
): Promise<void> {
  const full: MatrixResumeFile = {
    version: 1,
    concurrency: 1,
    piVersion: "test-1.0",
    ...file,
  };
  await writeFile(path, JSON.stringify(full, null, 2) + "\n", "utf-8");
}

/** comboId exactly as the engine computes it for the single-model fixtures. */
function fixtureComboId(questionName: string): string {
  return createHash("sha256")
    .update(JSON.stringify([questionName, "model-alpha", { temp: 0.7 }]))
    .digest("hex")
    .slice(0, 12);
}

/** A remaining-Combo entry for the single-model fixtures. */
function remainingCombo(
  questionName: string,
  inFlight?: ResumeRemainingCombo["inFlight"]
): ResumeRemainingCombo {
  return {
    questionName,
    modelName: "model-alpha",
    comboId: fixtureComboId(questionName),
    inFlight,
  };
}

/**
 * A surviving run dir as a killed Combo would leave it behind: the workdir
 * holds the artifact files produced so far, the session dir one transcript
 * per completed invocation (plus optionally a half-written one).
 */
async function craftSurvivingRunDir(
  runDir: string,
  sessionFiles: Record<string, string>
): Promise<void> {
  await mkdir(join(runDir, "work"), { recursive: true });
  await mkdir(join(runDir, "sessions"), { recursive: true });
  await writeFile(
    join(runDir, "work", "index.html"),
    "<!DOCTYPE html><html></html>",
    "utf-8"
  );
  await writeFile(join(runDir, "work", "style.css"), "body {}", "utf-8");
  await writeFile(
    join(runDir, "work", "script.js"),
    'console.log("hi");',
    "utf-8"
  );
  for (const [name, content] of Object.entries(sessionFiles)) {
    await writeFile(join(runDir, "sessions", name), content + "\n", "utf-8");
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write the tiny driver the resume kill tests spawn as a child process: it
 * calls resumeMatrix with fixture paths from argv. The resumed Matrix must
 * be killable the same way as the original one — in its own process.
 */
async function writeResumeCommandDriver(driverPath: string): Promise<void> {
  const runModuleUrl = pathToFileURL(join(import.meta.dir, "run.ts")).href;
  const source = `import { resumeMatrix } from ${JSON.stringify(runModuleUrl)};

const [
  resumeFilePath,
  questionDir,
  configPath,
  sessionRoot,
  tempRoot,
  piBin,
  piHome,
] = process.argv.slice(2);

await resumeMatrix(resumeFilePath, {
  questionDir,
  configPath,
  sessionRoot,
  tempRoot,
  piBin,
  piHome,
  piVersion: "test-1.0",
  maxTurns: 100,
  runRules: "",
});
`;
  await writeFile(driverPath, source, "utf-8");
}

/**
 * Spawn a child driver (fresh Matrix or resume command), pump gates until
 * the Resume File satisfies `stop`, then kill -9 the child — the authentic
 * interruption the Resume File exists for. Returns the leftover file.
 */
async function killChildMatrix(
  argv: string[],
  gateDir: string,
  resumeFilePath: string,
  mayOpen: (marker: string, resume: MatrixResumeFile) => boolean,
  stop: (resume: MatrixResumeFile) => boolean
): Promise<MatrixResumeFile> {
  const proc = Bun.spawn(["bun", ...argv], {
    env: { ...process.env, NODE_ENV: "test" },
    stdout: "pipe",
    stderr: "pipe",
  });
  await pumpGatesUntil({ gateDir, resumeFilePath, mayOpen, stop });
  proc.kill(9);
  await proc.exited;
  const killed = await readResumeFile(resumeFilePath);
  if (!killed) throw new Error("Resume File missing after kill");
  return killed;
}

describe("resumeMatrix", () => {
  let tempRoot: string;
  let piHome: string;
  let runTempRoot: string;
  let gateDir: string;

  beforeEach(async () => {
    tempRoot = makeTempRoot();
    await mkdir(tempRoot, { recursive: true });
    piHome = join(tempRoot, ".pi-home");
    runTempRoot = join(tempRoot, "runs");
    await mkdir(runTempRoot, { recursive: true });
    gateDir = join(tempRoot, "gates");
    await mkdir(gateDir, { recursive: true });
  });

  afterAll(async () => {
    try {
      await rm(tempRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  /** Pump every waiting gate until the in-process resumed Matrix settles. */
  async function resumeWithGatesPumped(
    resumeFilePath: string,
    fixtures: { configPath: string; questionDir: string; sessionRoot: string },
    stub: string
  ) {
    const { resumeMatrix } = await import("./run");
    let done = false;
    const pump = (async () => {
      while (!done) {
        await openWaitingGates(gateDir);
        await Bun.sleep(30);
      }
    })();
    try {
      return await resumeMatrix(resumeFilePath, {
        questionDir: fixtures.questionDir,
        configPath: fixtures.configPath,
        sessionRoot: fixtures.sessionRoot,
        piBin: stub,
        piHome,
        tempRoot: runTempRoot,
        piVersion: "test-1.0",
        maxTurns: 100,
        runRules: "",
      });
    } finally {
      done = true;
      await pump;
    }
  }

  /** Release killed phases' orphaned stubs and wait for their last write. */
  async function releaseOrphanedStubs(sessionDir: string): Promise<void> {
    // The orphan is a grandchild whose parent was just kill -9'd: its
    // `waiting-*` marker may not exist yet, so pump gates inside the wait —
    // a single-shot release would never open a late marker's gate.
    await waitFor(async () => {
      await openWaitingGates(gateDir);
      // The orphan writes its (half-written) session file after its gate
      // opens — wait for it so the surviving run dir is in its final state.
      return (await listDir(sessionDir)).some((f) => f === "session.jsonl");
    });
  }

  async function clearGates(): Promise<void> {
    for (const f of await listDir(gateDir)) {
      await rm(join(gateDir, f), { force: true });
    }
  }

  it("executes exactly the Resume File's remaining Combos, restoring the recorded filters", async () => {
    const { resumeMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-exact-remaining");
    await mkdir(repoDir, { recursive: true });
    // q-4 exists but was never part of the original Matrix (not in the
    // recorded filter); q-1 was archived before the interruption.
    const fixtures = await writeTicketedMatrixFixtures(
      repoDir,
      ["q-1", "q-2", "q-3", "q-4"],
      2
    );
    const countLog = join(tempRoot, "count-exact.log");
    const stub = join(tempRoot, "stub-count-exact");
    await createCountingStubPi(stub, countLog);
    const resumeFilePath = join(tempRoot, "matrix-resume-exact.json");
    await writeResumeFileFixture(resumeFilePath, {
      questionFilter: ["q-1", "q-2", "q-3"],
      modelFilter: ["alpha.gguf"],
      concurrency: 1,
      piVersion: "test-1.0-original",
      remaining: [remainingCombo("q-2"), remainingCombo("q-3")],
    });

    const outcomes = await resumeMatrix(resumeFilePath, {
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot: fixtures.sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      // pi version is re-detected for the new run's run.json records.
      piVersion: "test-2.0-resumed",
      maxTurns: 100,
      runRules: "",
    });

    // Exactly the remaining Combos ran — no more (not q-1, archived; not
    // q-4, never in the recorded filter), no fewer.
    expect(outcomes).toHaveLength(2);
    expect(outcomes.map((o) => o.question.name)).toEqual(["q-2", "q-3"]);
    expect(outcomes.every((o) => o.status === "ok")).toBe(true);
    const invocations = (await readCountLog(countLog)).map((e) => e.invocation);
    expect(invocations).toEqual(["q-2-t1", "q-2-t2", "q-3-t1", "q-3-t2"]);

    // The new run's run.json records the re-detected pi version, not the
    // one recorded at the original Matrix's start.
    const dirs = await listDir(join(fixtures.sessionRoot, "q-2", "model-alpha"));
    expect(dirs).toHaveLength(1);
    const runJson = JSON.parse(
      await readFile(
        join(fixtures.sessionRoot, "q-2", "model-alpha", dirs[0], "run.json"),
        "utf-8"
      )
    ) as RunJson;
    expect(runJson.piVersion).toBe("test-2.0-resumed");

    // Normal completion deletes the Resume File.
    expect(await readResumeFile(resumeFilePath)).toBeNull();
  }, 30000);

  it("restores the recorded concurrency when no override is given", async () => {
    const { resumeMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-recorded-concurrency");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1", "q-2"], 2);
    const markerLog = join(tempRoot, "markers-recorded.log");
    const stub = join(tempRoot, "stub-marker-recorded");
    await createMarkerStubPi(stub, markerLog, 0.3);
    const resumeFilePath = join(tempRoot, "matrix-resume-recorded.json");
    await writeResumeFileFixture(resumeFilePath, {
      concurrency: 2,
      remaining: [remainingCombo("q-1"), remainingCombo("q-2")],
    });

    const outcomes = await resumeMatrix(resumeFilePath, {
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot: fixtures.sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(outcomes).toHaveLength(2);
    // The recorded concurrency 2 is in effect: the two Combos' invocations
    // overlap at process level.
    expect(maxOverlap(await readMarkerEvents(markerLog))).toBe(2);
  }, 30000);

  it("--concurrency overrides the recorded value on resume", async () => {
    const { resumeMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-override-concurrency");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1", "q-2"], 2);
    const markerLog = join(tempRoot, "markers-override.log");
    const stub = join(tempRoot, "stub-marker-override");
    await createMarkerStubPi(stub, markerLog, 0.3);
    const resumeFilePath = join(tempRoot, "matrix-resume-override.json");
    await writeResumeFileFixture(resumeFilePath, {
      concurrency: 2,
      remaining: [remainingCombo("q-1"), remainingCombo("q-2")],
    });

    const outcomes = await resumeMatrix(
      resumeFilePath,
      {
        questionDir: fixtures.questionDir,
        configPath: fixtures.configPath,
        sessionRoot: fixtures.sessionRoot,
        piBin: stub,
        piHome,
        tempRoot: runTempRoot,
        piVersion: "test-1.0",
        maxTurns: 100,
        runRules: "",
      },
      { concurrency: 1 }
    );

    expect(outcomes).toHaveLength(2);
    // The override wins: fully sequential despite the recorded 2.
    expect(maxOverlap(await readMarkerEvents(markerLog))).toBe(1);
  }, 30000);

  it("resumes an interrupted Combo at invocation granularity: completed tickets keep their adopted workdir and are not re-run, the interrupted ticket re-runs fresh, and the archive holds only complete invocations", async () => {
    const repoDir = join(tempRoot, "repo-invocation-recovery");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1"], 3);
    const stub = join(tempRoot, "stub-gated-recovery");
    await createGatedStubPi(stub, gateDir);
    const driverPath = join(tempRoot, "driver-recovery.ts");
    await writeResumeDriver(driverPath);
    const resumeFilePath = join(tempRoot, "matrix-resume-recovery.json");

    // Phase 1: a real Matrix in a child process, killed mid-Combo after
    // ticket 1 completed — the authentic in-flight fixture.
    const killed = await killChildMatrix(
      [
        driverPath,
        fixtures.questionDir,
        fixtures.configPath,
        fixtures.sessionRoot,
        runTempRoot,
        stub,
        piHome,
        resumeFilePath,
        "1",
      ],
      gateDir,
      resumeFilePath,
      (marker, resume) =>
        comboForMarker(marker, resume) !== undefined && marker.endsWith("-t1"),
      (resume) =>
        resume.remaining[0]?.inFlight?.completedInvocations.length === 1
    );
    const interrupted = killed.remaining[0];
    expect(interrupted.questionName).toBe("q-1");
    const runDir = interrupted.inFlight!.runDir;
    const runKey = basename(runDir);
    const carriedRecord = interrupted.inFlight!.completedInvocations[0];
    expect(carriedRecord.ticket).toBe(1);

    // The interrupted ticket 2's orphaned stub leaves its half-written
    // transcript behind in the surviving run dir (post-kill write).
    const sessionDir = join(runDir, "sessions");
    await releaseOrphanedStubs(sessionDir);
    const HALF_WRITTEN =
      '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"HALF-WRITTEN-INTERRUPTED-T2"}]}}';
    await writeFile(join(sessionDir, "session.jsonl"), HALF_WRITTEN + "\n", "utf-8");
    await clearGates();

    // Phase 2: resume from the leftover file.
    const outcomes = await resumeWithGatesPumped(resumeFilePath, fixtures, stub);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("ok");

    // Ticket 1 was NOT re-executed; the interrupted ticket 2 and ticket 3
    // ran — all inside the ADOPTED run dir (same basename as recorded).
    const phase2Markers = (await listDir(gateDir)).filter((f) =>
      f.startsWith("waiting-")
    );
    expect(phase2Markers.sort()).toEqual([
      `waiting-${runKey}-t2`,
      `waiting-${runKey}-t3`,
    ]);

    // The archived run.json carries ticket 1's original record verbatim
    // (same duration as recorded at the kill) plus the two fresh ones.
    const dirs = await listDir(join(fixtures.sessionRoot, "q-1", "model-alpha"));
    expect(dirs).toHaveLength(1);
    const archiveDir = join(fixtures.sessionRoot, "q-1", "model-alpha", dirs[0]);
    const runJson = JSON.parse(
      await readFile(join(archiveDir, "run.json"), "utf-8")
    ) as RunJson;
    expect(runJson.status).toBe("ok");
    expect(runJson.invocations!).toHaveLength(3);
    expect(runJson.invocations![0]).toMatchObject({
      ticket: 1,
      ticketTitle: "Ticket number 1",
      status: "ok",
      dirty: false,
      durationMs: carriedRecord.durationMs,
    });
    expect(runJson.invocations![1]).toMatchObject({ ticket: 2, status: "ok" });
    expect(runJson.invocations![2]).toMatchObject({ ticket: 3, status: "ok" });

    // The archived transcript contains exactly the three complete
    // invocations — the interrupted ticket's half-written session file is
    // excluded.
    const session = await readFile(join(archiveDir, "session.jsonl"), "utf-8");
    const lines = session.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l === CLEAN_SESSION)).toBe(true);
    expect(session).not.toContain("HALF-WRITTEN");

    // The adopted run dir is deleted after archiving, and the Resume File
    // is gone after normal completion.
    expect(await fileExists(runDir)).toBe(false);
    expect(await readResumeFile(resumeFilePath)).toBeNull();
  }, 90000);

  it("degrades to a full Combo re-run when the recorded run dir is missing", async () => {
    const { resumeMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-missing-rundir");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1"], 3);
    const countLog = join(tempRoot, "count-missing.log");
    const stub = join(tempRoot, "stub-count-missing");
    await createCountingStubPi(stub, countLog);
    const resumeFilePath = join(tempRoot, "matrix-resume-missing.json");
    await writeResumeFileFixture(resumeFilePath, {
      remaining: [
        remainingCombo("q-1", {
          // Temp cleanup / reboot wiped it: the path does not exist.
          runDir: join(runTempRoot, "pi-run-vanished"),
          completedInvocations: [
            {
              ticket: 1,
              ticketTitle: "Ticket number 1",
              dirty: false,
              status: "ok",
              exitCode: 0,
              maxTurnsExceeded: false,
              durationMs: 1234,
            },
          ],
        }),
      ],
    });

    const outcomes = await resumeMatrix(resumeFilePath, {
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot: fixtures.sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("ok");

    // Full re-run in a FRESH run dir: even the recorded ticket 1 ran again.
    const entries = await readCountLog(countLog);
    expect(entries.map((e) => e.invocation)).toEqual(["q-1-t1", "q-1-t2", "q-1-t3"]);
    expect(entries[0].runKey).not.toBe("pi-run-vanished");

    // ...and the archive is a correct, complete Session.
    const dirs = await listDir(join(fixtures.sessionRoot, "q-1", "model-alpha"));
    expect(dirs).toHaveLength(1);
    const archiveDir = join(fixtures.sessionRoot, "q-1", "model-alpha", dirs[0]);
    const runJson = JSON.parse(
      await readFile(join(archiveDir, "run.json"), "utf-8")
    ) as RunJson;
    expect(runJson.status).toBe("ok");
    expect(runJson.invocations!).toHaveLength(3);
    const session = await readFile(join(archiveDir, "session.jsonl"), "utf-8");
    expect(session.trim().split("\n")).toHaveLength(3);
  }, 30000);

  it("always re-runs single-invocation Combos whole, even with surviving in-flight state", async () => {
    const { resumeMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-single-invocation");
    await mkdir(repoDir, { recursive: true });
    // One ticket only: the Combo runs the classic single-invocation flow.
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1"], 1);
    const countLog = join(tempRoot, "count-single.log");
    const stub = join(tempRoot, "stub-count-single");
    await createCountingStubPi(stub, countLog);

    // A genuinely surviving run dir — adoption is possible in principle,
    // but single-invocation Combos have no useful in-flight state.
    const survivingRunDir = join(runTempRoot, "pi-run-surviving-single");
    await craftSurvivingRunDir(survivingRunDir, {
      "session.jsonl":
        '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"OLD-SINGLE-CONTENT"}]}}',
    });
    const resumeFilePath = join(tempRoot, "matrix-resume-single.json");
    await writeResumeFileFixture(resumeFilePath, {
      remaining: [
        remainingCombo("q-1", {
          runDir: survivingRunDir,
          completedInvocations: [
            {
              dirty: false,
              status: "ok",
              exitCode: 0,
              maxTurnsExceeded: false,
              durationMs: 999,
            },
          ],
        }),
      ],
    });

    const outcomes = await resumeMatrix(resumeFilePath, {
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot: fixtures.sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("ok");

    // Re-run whole: one fresh invocation in a FRESH run dir — the
    // surviving dir was NOT adopted and stays untouched.
    const entries = await readCountLog(countLog);
    expect(entries).toHaveLength(1);
    expect(entries[0].invocation).toBe("q-1-session");
    expect(entries[0].runKey).not.toBe(basename(survivingRunDir));
    expect(await fileExists(survivingRunDir)).toBe(true);

    const dirs = await listDir(join(fixtures.sessionRoot, "q-1", "model-alpha"));
    expect(dirs).toHaveLength(1);
    const session = await readFile(
      join(fixtures.sessionRoot, "q-1", "model-alpha", dirs[0], "session.jsonl"),
      "utf-8"
    );
    expect(session).toContain(CLEAN_SESSION);
    expect(session).not.toContain("OLD-SINGLE-CONTENT");
  }, 30000);

  it("never retries archived Combos, including ones that ended in error", async () => {
    const { resumeMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-archived-not-retried");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1", "q-2", "q-3"], 2);

    // q-1 and q-2 were archived before the interruption — q-2 with an
    // error status. Archived means completed, so the Resume File's
    // remaining list holds only q-3 by construction.
    for (const [question, status] of [["q-1", "ok"], ["q-2", "error"]] as const) {
      const archiveDir = join(
        fixtures.sessionRoot,
        question,
        "model-alpha",
        "20260730-120000"
      );
      await mkdir(archiveDir, { recursive: true });
      await writeFile(
        join(archiveDir, "run.json"),
        JSON.stringify({ status }),
        "utf-8"
      );
    }

    const countLog = join(tempRoot, "count-archived.log");
    const stub = join(tempRoot, "stub-count-archived");
    await createCountingStubPi(stub, countLog);
    const resumeFilePath = join(tempRoot, "matrix-resume-archived.json");
    await writeResumeFileFixture(resumeFilePath, {
      questionFilter: ["q-1", "q-2", "q-3"],
      remaining: [remainingCombo("q-3")],
    });

    const outcomes = await resumeMatrix(resumeFilePath, {
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot: fixtures.sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].question.name).toBe("q-3");
    // Only q-3 executed; the archived Combos — error included — were not
    // retried. Failures stay evaluation data and are retried deliberately
    // through the filter workflow, never as a side effect of recovery.
    const invocations = (await readCountLog(countLog)).map((e) => e.invocation);
    expect(invocations).toEqual(["q-3-t1", "q-3-t2"]);
  }, 30000);

  it("re-runs only the missing evaluation when a dirty ticket invocation completed but its arbitration did not", async () => {
    const repoDir = join(tempRoot, "repo-eval-resume");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1"], 2);

    // Killed after ticket 2's dirty main invocation completed but before
    // its evaluation invocation finished: completedInvocations holds both
    // main records, the eval record is missing.
    const survivingRunDir = join(runTempRoot, "pi-run-surviving-eval");
    await craftSurvivingRunDir(survivingRunDir, {
      "t1.jsonl": CLEAN_SESSION,
      "t2.jsonl": DIRTY_SESSION,
      // The interrupted evaluation's half-written transcript.
      "session.jsonl":
        '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"HALF-WRITTEN-EVAL"}]}}',
    });
    const resumeFilePath = join(tempRoot, "matrix-resume-eval.json");
    await writeResumeFileFixture(resumeFilePath, {
      remaining: [
        remainingCombo("q-1", {
          runDir: survivingRunDir,
          completedInvocations: [
            {
              ticket: 1,
              ticketTitle: "Ticket number 1",
              dirty: false,
              status: "ok",
              exitCode: 0,
              maxTurnsExceeded: false,
              durationMs: 111,
            },
            {
              ticket: 2,
              ticketTitle: "Ticket number 2",
              dirty: true,
              status: "ok",
              exitCode: 0,
              maxTurnsExceeded: false,
              durationMs: 222,
            },
          ],
        }),
      ],
    });

    const stub = join(tempRoot, "stub-gated-eval");
    await createGatedStubPi(stub, gateDir, { evalVerdict: "COMPLETE" });
    const outcomes = await resumeWithGatesPumped(resumeFilePath, fixtures, stub);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("ok");

    // Neither main invocation re-ran; only the missing evaluation did.
    const markers = (await listDir(gateDir)).filter((f) => f.startsWith("waiting-"));
    expect(markers).toEqual([`waiting-${basename(survivingRunDir)}-t2-eval`]);

    // The archive carries both main records verbatim plus the fresh
    // evaluation; the half-written eval transcript is excluded.
    const dirs = await listDir(join(fixtures.sessionRoot, "q-1", "model-alpha"));
    expect(dirs).toHaveLength(1);
    const archiveDir = join(fixtures.sessionRoot, "q-1", "model-alpha", dirs[0]);
    const runJson = JSON.parse(
      await readFile(join(archiveDir, "run.json"), "utf-8")
    ) as RunJson;
    expect(runJson.status).toBe("ok");
    expect(runJson.invocations!).toHaveLength(3);
    expect(runJson.invocations![0]).toMatchObject({ ticket: 1, dirty: false, durationMs: 111 });
    expect(runJson.invocations![1]).toMatchObject({ ticket: 2, dirty: true, durationMs: 222 });
    expect(runJson.invocations![2]).toMatchObject({
      ticket: 2,
      evaluation: true,
      verdict: "complete",
    });
    const session = await readFile(join(archiveDir, "session.jsonl"), "utf-8");
    const lines = session.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(CLEAN_SESSION);
    expect(lines[1]).toBe(DIRTY_SESSION);
    expect(lines[2]).toContain("<verdict>COMPLETE</verdict>");
    expect(session).not.toContain("HALF-WRITTEN-EVAL");
  }, 30000);

  it("keeps updating the same Resume File during the resumed Matrix — a second interruption is equally recoverable", async () => {
    const repoDir = join(tempRoot, "repo-second-interruption");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1"], 3);
    const stub = join(tempRoot, "stub-gated-twice");
    await createGatedStubPi(stub, gateDir);
    const driverPath = join(tempRoot, "driver-twice.ts");
    await writeResumeDriver(driverPath);
    const resumeDriverPath = join(tempRoot, "driver-resume-twice.ts");
    await writeResumeCommandDriver(resumeDriverPath);
    const resumeFilePath = join(tempRoot, "matrix-resume-twice.json");

    // Phase 1: kill the original Matrix after ticket 1 completed.
    const firstKill = await killChildMatrix(
      [
        driverPath,
        fixtures.questionDir,
        fixtures.configPath,
        fixtures.sessionRoot,
        runTempRoot,
        stub,
        piHome,
        resumeFilePath,
        "1",
      ],
      gateDir,
      resumeFilePath,
      (marker, resume) =>
        comboForMarker(marker, resume) !== undefined && marker.endsWith("-t1"),
      (resume) =>
        resume.remaining[0]?.inFlight?.completedInvocations.length === 1
    );
    const runDir = firstKill.remaining[0].inFlight!.runDir;
    const runKey = basename(runDir);
    const t1Record = firstKill.remaining[0].inFlight!.completedInvocations[0];
    const sessionDir = join(runDir, "sessions");
    await releaseOrphanedStubs(sessionDir);
    await clearGates();

    // Phase 2: the resumed Matrix in a CHILD process, killed after ticket
    // 2 completed — the same Resume File keeps being updated.
    const secondKill = await killChildMatrix(
      [
        resumeDriverPath,
        resumeFilePath,
        fixtures.questionDir,
        fixtures.configPath,
        fixtures.sessionRoot,
        runTempRoot,
        stub,
        piHome,
      ],
      gateDir,
      resumeFilePath,
      (marker, resume) =>
        comboForMarker(marker, resume) !== undefined && marker.endsWith("-t2"),
      (resume) =>
        resume.remaining[0]?.inFlight?.completedInvocations.length === 2
    );

    // Same file, same id, same adopted run dir; the carried ticket-1 record
    // is untouched and ticket 2's record appended by the resumed Matrix.
    const inFlight = secondKill.remaining[0].inFlight!;
    expect(inFlight.runDir).toBe(runDir);
    expect(inFlight.completedInvocations).toHaveLength(2);
    expect(inFlight.completedInvocations[0]).toEqual(t1Record);
    expect(inFlight.completedInvocations[1].ticket).toBe(2);
    const t2Record = inFlight.completedInvocations[1];
    // Ticket 1 was not re-executed during the first resume either.
    const phase2Markers = (await listDir(gateDir)).filter((f) =>
      f.startsWith("waiting-")
    );
    expect(phase2Markers.some((f) => f.endsWith("-t1"))).toBe(false);

    await releaseOrphanedStubs(sessionDir);
    await clearGates();

    // Phase 3: resume again — equally recoverable — and finish.
    const outcomes = await resumeWithGatesPumped(resumeFilePath, fixtures, stub);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("ok");

    // Only ticket 3 executed in the final phase.
    const phase3Markers = (await listDir(gateDir)).filter((f) =>
      f.startsWith("waiting-")
    );
    expect(phase3Markers).toEqual([`waiting-${runKey}-t3`]);

    // One archive with exactly the three complete invocations; tickets 1
    // and 2 carry their original records from the two interrupted phases.
    const dirs = await listDir(join(fixtures.sessionRoot, "q-1", "model-alpha"));
    expect(dirs).toHaveLength(1);
    const archiveDir = join(fixtures.sessionRoot, "q-1", "model-alpha", dirs[0]);
    const runJson = JSON.parse(
      await readFile(join(archiveDir, "run.json"), "utf-8")
    ) as RunJson;
    expect(runJson.status).toBe("ok");
    expect(runJson.invocations!).toHaveLength(3);
    expect(runJson.invocations![0]).toMatchObject({
      ticket: 1,
      durationMs: t1Record.durationMs,
    });
    expect(runJson.invocations![1]).toMatchObject({
      ticket: 2,
      durationMs: t2Record.durationMs,
    });
    expect(runJson.invocations![2]).toMatchObject({ ticket: 3, status: "ok" });
    const session = await readFile(join(archiveDir, "session.jsonl"), "utf-8");
    const lines = session.trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l === CLEAN_SESSION)).toBe(true);

    // Normal completion finally deletes the Resume File.
    expect(await readResumeFile(resumeFilePath)).toBeNull();
  }, 120000);

  it("fails fast on unknown names in the recorded filters before any Combo runs", async () => {
    const { resumeMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-unknown-filters");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1"], 2);
    const countLog = join(tempRoot, "count-unknown.log");
    const stub = join(tempRoot, "stub-count-unknown");
    await createCountingStubPi(stub, countLog);
    const options = {
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot: fixtures.sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    };

    const badQuestion = join(tempRoot, "matrix-resume-bad-question.json");
    await writeResumeFileFixture(badQuestion, {
      questionFilter: ["q-ghost"],
      remaining: [],
    });
    await expect(resumeMatrix(badQuestion, options)).rejects.toThrow(
      /Unknown question filter name/
    );

    const badModel = join(tempRoot, "matrix-resume-bad-model.json");
    await writeResumeFileFixture(badModel, {
      modelFilter: ["ghost.gguf"],
      remaining: [],
    });
    await expect(resumeMatrix(badModel, options)).rejects.toThrow(
      /Unknown model filter name/
    );

    // Fail fast means exactly that: not a single invocation ran, nothing
    // was archived.
    expect(await fileExists(countLog)).toBe(false);
    expect(await listDir(fixtures.sessionRoot)).toEqual([]);
  }, 30000);

  it("rejects a missing, unparseable, or unsupported-version Resume File without running anything", async () => {
    const { resumeMatrix } = await import("./run");
    const repoDir = join(tempRoot, "repo-invalid-file");
    await mkdir(repoDir, { recursive: true });
    const fixtures = await writeTicketedMatrixFixtures(repoDir, ["q-1"], 2);
    const countLog = join(tempRoot, "count-invalid.log");
    const stub = join(tempRoot, "stub-count-invalid");
    await createCountingStubPi(stub, countLog);
    const options = {
      questionDir: fixtures.questionDir,
      configPath: fixtures.configPath,
      sessionRoot: fixtures.sessionRoot,
      piBin: stub,
      piHome,
      tempRoot: runTempRoot,
      piVersion: "test-1.0",
      maxTurns: 100,
      runRules: "",
    };

    await expect(
      resumeMatrix(join(tempRoot, "does-not-exist.json"), options)
    ).rejects.toThrow(/Cannot load Resume File/);

    const malformed = join(tempRoot, "matrix-resume-malformed.json");
    await writeFile(malformed, "{ not json", "utf-8");
    await expect(resumeMatrix(malformed, options)).rejects.toThrow(
      /Cannot load Resume File/
    );

    const futureVersion = join(tempRoot, "matrix-resume-v2.json");
    await writeFile(
      futureVersion,
      JSON.stringify({ version: 2, concurrency: 1, piVersion: "x", remaining: [] }),
      "utf-8"
    );
    await expect(resumeMatrix(futureVersion, options)).rejects.toThrow(
      /unsupported Resume File version/
    );

    // A non-array filter must be rejected as malformed, not crash later
    // inside the engine's filter application.
    const badFilter = join(tempRoot, "matrix-resume-bad-filter.json");
    await writeFile(
      badFilter,
      JSON.stringify({
        version: 1,
        questionFilter: "q-1",
        concurrency: 1,
        piVersion: "x",
        remaining: [],
      }),
      "utf-8"
    );
    await expect(resumeMatrix(badFilter, options)).rejects.toThrow(
      /malformed questionFilter/
    );

    expect(await fileExists(countLog)).toBe(false);
    expect(await listDir(fixtures.sessionRoot)).toEqual([]);
  }, 30000);
});
