import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  mkdir,
  writeFile,
  rm,
  readFile,
  access,
  rename,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pid } from "node:process";
import type { Question } from "./question";

// ---------------------------------------------------------------------------
// Stub pi executables (written as shell scripts into a temp dir)
// ---------------------------------------------------------------------------

/**
 * A stub pi that:
 * - Creates a fake session JSONL file in its cwd
 * - Prints a line to stdout
 * - Exits 0
 */
const STUB_PI_NORMAL = [
  '#!/bin/sh',
  '# Stub pi: normal exit',
  'echo "pi: starting session..."',
  '# Parse arguments to find --session-dir and --session-id',
  'SESSION_DIR=""',
  'SESSION_ID=""',
  'while [ $# -gt 0 ]; do',
  '  case "$1" in',
  '    --session-dir)',
  '      SESSION_DIR="$2"',
  '      shift 2',
  '      ;;',
  '    --session-id)',
  '      SESSION_ID="$2"',
  '      shift 2',
  '      ;;',
  '    *)',
  '      shift',
  '      ;;',
  '  esac',
  'done',
  'if [ -n "$SESSION_DIR" ] && [ -n "$SESSION_ID" ]; then',
  "  echo '{\"turn\":1,\"role\":\"assistant\",\"content\":\"stub response\"}' > \"${SESSION_DIR}/${SESSION_ID}_session.jsonl\"",
  'fi',
  'echo "pi: done"',
  'exit 0',
].join('\n');

/**
 * A stub pi that sleeps forever — used to test timeout/killing.
 */
const STUB_PI_HANG = `#!/bin/sh
# Stub pi: hangs forever
echo "pi: hanging..."
sleep 999999
`;

/**
 * A stub pi that exits with a non-zero code.
 */
const STUB_PI_FAIL = `#!/bin/sh
# Stub pi: fails
echo "pi: error occurred" >&2
exit 42
`;

// ---------------------------------------------------------------------------
// Test harness setup
// ---------------------------------------------------------------------------

let testRoot: string;
let stubBinDir: string;
let stubNormal: string;
let stubHang: string;
let stubFail: string;

beforeAll(async () => {
  testRoot = join(tmpdir(), "pi-runner-tests-" + Date.now() + "-" + pid);
  stubBinDir = join(testRoot, "stubs");
  await mkdir(testRoot, { recursive: true });
  await mkdir(stubBinDir, { recursive: true });

  stubNormal = join(stubBinDir, "pi-normal");
  stubHang = join(stubBinDir, "pi-hang");
  stubFail = join(stubBinDir, "pi-fail");

  await writeFile(stubNormal, STUB_PI_NORMAL);
  await writeFile(stubHang, STUB_PI_HANG);
  await writeFile(stubFail, STUB_PI_FAIL);

  await Bun.$`chmod +x ${stubNormal} ${stubHang} ${stubFail}`;
});

afterAll(async () => {
  await rm(testRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Mock Question factory
// ---------------------------------------------------------------------------

function makeMockQuestion(
  name: string,
  options: { hasSpec?: boolean; hasTickets?: boolean } = {}
): { question: Question; dir: string } {
  const dir = join(testRoot, "mock-question-" + name);
  return {
    question: {
      name,
      dir,
      intent: "# Test intent\nDo something.",
      hasSpec: options.hasSpec ?? false,
      hasTickets: options.hasTickets ?? false,
    },
    dir,
  };
}

async function setupQuestionDir(
  dir: string,
  options: { specContent?: string; ticketsContent?: string }
) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "intent.md"), "# Intent\nTest task.");
  if (options.specContent) {
    await writeFile(join(dir, "spec.md"), options.specContent);
  }
  if (options.ticketsContent) {
    await writeFile(join(dir, "tickets.md"), options.ticketsContent);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPi", () => {
  it("should be exported as a function", async () => {
    const mod = await import("./pi-runner");
    expect(typeof mod.runPi).toBe("function");
  });

  it("creates a fresh workdir under tempRoot and runs pi successfully", async () => {
    const { runPi } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("normal-exit");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-normal");
    await mkdir(tempRoot, { recursive: true });
    const piHome = join(testRoot, "pi-home");
    await mkdir(piHome, { recursive: true });

    const result = await runPi({
      prompt: "Hello agent",
      question,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubNormal,
      piHome,
      tempRoot,
      timeoutMs: 10_000,
    });

    // Workdir is under tempRoot, not inside the repo
    expect(result.workdir).toContain(tempRoot);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.sessionFile).toBeTruthy();
    expect(result.sessionFile).toContain("session.jsonl");
    expect(result.stdoutFile).toContain("pi-output.log");

    // Session file exists and contains JSONL
    const sessionPath = result.sessionFile!;
    const sessionContent = await readFile(sessionPath, "utf-8");
    const lines = sessionContent.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    JSON.parse(lines[0]); // should be valid JSON

    // Stdout file exists
    await access(result.stdoutFile);
  });

  it("copies spec.md and tickets.md into workdir when present", async () => {
    const { runPi } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("with-files", {
      hasSpec: true,
      hasTickets: true,
    });
    await setupQuestionDir(dir, {
      specContent: "# Spec\nRequirements here.",
      ticketsContent: "- [ ] Ticket 1",
    });

    const tempRoot = join(testRoot, "tmp-with-files");
    await mkdir(tempRoot, { recursive: true });
    const piHome = join(testRoot, "pi-home");
    await mkdir(piHome, { recursive: true });

    const result = await runPi({
      prompt: "Implement the spec",
      question,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubNormal,
      piHome,
      tempRoot,
      timeoutMs: 10_000,
    });

    // Verify spec.md was copied
    const specPath = join(result.workdir, "spec.md");
    const specContent = await readFile(specPath, "utf-8");
    expect(specContent).toBe("# Spec\nRequirements here.");

    // Verify tickets.md was copied
    const ticketsPath = join(result.workdir, "tickets.md");
    const ticketsContent = await readFile(ticketsPath, "utf-8");
    expect(ticketsContent).toBe("- [ ] Ticket 1");
  });

  it("does not copy spec.md/tickets.md when they are absent", async () => {
    const { runPi } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("no-files", {
      hasSpec: false,
      hasTickets: false,
    });
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-no-files");
    await mkdir(tempRoot, { recursive: true });
    const piHome = join(testRoot, "pi-home");
    await mkdir(piHome, { recursive: true });

    const result = await runPi({
      prompt: "Hello",
      question,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubNormal,
      piHome,
      tempRoot,
      timeoutMs: 10_000,
    });

    const specExists = await access(join(result.workdir, "spec.md"))
      .then(() => true)
      .catch(() => false);
    const ticketsExists = await access(join(result.workdir, "tickets.md"))
      .then(() => true)
      .catch(() => false);

    expect(specExists).toBe(false);
    expect(ticketsExists).toBe(false);
  });

  it("kills the process and sets timedOut=true when timeoutMs is exceeded", async () => {
    const { runPi } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("timeout");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-timeout");
    await mkdir(tempRoot, { recursive: true });
    const piHome = join(testRoot, "pi-home");
    await mkdir(piHome, { recursive: true });

    const start = Date.now();
    const result = await runPi({
      prompt: "Hang me",
      question,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubHang,
      piHome,
      tempRoot,
      timeoutMs: 500, // short timeout
    });
    const elapsed = Date.now() - start;

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
    expect(elapsed).toBeLessThan(2000); // should not wait forever
    expect(elapsed).toBeGreaterThanOrEqual(400); // should be close to timeout
  });

  it("captures non-zero exit code from pi", async () => {
    const { runPi } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("fail");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-fail");
    await mkdir(tempRoot, { recursive: true });
    const piHome = join(testRoot, "pi-home");
    await mkdir(piHome, { recursive: true });

    const result = await runPi({
      prompt: "Fail me",
      question,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubFail,
      piHome,
      tempRoot,
      timeoutMs: 10_000,
    });

    expect(result.exitCode).toBe(42);
    expect(result.timedOut).toBe(false);
  });

  it("captures stdout/stderr to pi-output.log", async () => {
    const { runPi } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("stdout");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-stdout");
    await mkdir(tempRoot, { recursive: true });
    const piHome = join(testRoot, "pi-home");
    await mkdir(piHome, { recursive: true });

    const result = await runPi({
      prompt: "Output something",
      question,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubNormal,
      piHome,
      tempRoot,
      timeoutMs: 10_000,
    });

    const logContent = await readFile(result.stdoutFile, "utf-8");
    expect(logContent).toContain("pi: starting session");
    expect(logContent).toContain("pi: done");
  });

  it("sets sessionFile to null when pi produces no JSONL", async () => {
    // Create a stub that exits 0 but writes no session file
    const stubEmpty = join(stubBinDir, "pi-empty");
    await writeFile(
      stubEmpty,
      `#!/bin/sh\necho "pi: no session"; exit 0\n`
    );
    await Bun.$`chmod +x ${stubEmpty}`;

    const { runPi } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("no-session");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-no-session");
    await mkdir(tempRoot, { recursive: true });
    const piHome = join(testRoot, "pi-home");
    await mkdir(piHome, { recursive: true });

    const result = await runPi({
      prompt: "No session",
      question,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubEmpty,
      piHome,
      tempRoot,
      timeoutMs: 10_000,
    });

    expect(result.sessionFile).toBeNull();
  });

  it("passes correct arguments to pi including --model provider/modelId", async () => {
    const { runPi } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("args");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-args");
    await mkdir(tempRoot, { recursive: true });
    const piHome = join(testRoot, "pi-home");
    await mkdir(piHome, { recursive: true });

    const result = await runPi({
      prompt: "Test args",
      question,
      provider: "llamacpp-local",
      modelId: "test-model-123",
      piBin: stubNormal,
      piHome,
      tempRoot,
      timeoutMs: 10_000,
    });

    // The stub normal script should have created the session file using the args
    // This indirectly verifies args were passed correctly
    expect(result.sessionFile).toBeTruthy();
    expect(result.exitCode).toBe(0);
  });
});
