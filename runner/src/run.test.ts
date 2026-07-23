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
  models: Array<{ name: string; provider: string; modelId: string; params: Record<string, unknown> }>,
  questions: Array<{ name: string; intent: string; hasSpec?: boolean; hasTickets?: boolean }>
) {
  // Config (TOML)
  const configPath = join(root, "config.toml");
  const modelEntries = models.map((m) => {
    const paramsLines = Object.entries(m.params)
      .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
      .join("\n");
    return `[[models]]
name = ${JSON.stringify(m.name)}
provider = ${JSON.stringify(m.provider)}
modelId = ${JSON.stringify(m.modelId)}
[models.params]
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

# Create fake session.jsonl
echo '{"role":"user","content":"test"}' > session.jsonl

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
      timeoutMs: 30000,
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
      timeoutMs: 30000,
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
      timeoutMs: 30000,
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
      timeoutMs: 30000,
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
      timeoutMs: 30000,
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
      timeoutMs: 30000,
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
      timeoutMs: 30000,
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
      timeoutMs: 30000,
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
      timeoutMs: 30000,
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
        timeoutMs: 30000,
        questionFilter: ["nonexistent-question"],
        piVersion: "test-1.0",
      })
    ).rejects.toThrow();
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
        timeoutMs: 30000,
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
        timeoutMs: 30000,
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
      timeoutMs: 30000,
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
      timeoutMs: 30000,
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
});
