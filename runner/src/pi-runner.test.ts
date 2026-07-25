import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  mkdir,
  writeFile,
  rm,
  readFile,
  access,
} from "node:fs/promises";
import { join } from "node:path";
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
let stubFail: string;

beforeAll(async () => {
  testRoot = join(tmpdir(), "pi-runner-tests-" + Date.now() + "-" + pid);
  stubBinDir = join(testRoot, "stubs");
  await mkdir(testRoot, { recursive: true });
  await mkdir(stubBinDir, { recursive: true });

  stubNormal = join(stubBinDir, "pi-normal");
  stubFail = join(stubBinDir, "pi-fail");

  await writeFile(stubNormal, STUB_PI_NORMAL);
  await writeFile(stubFail, STUB_PI_FAIL);

  await Bun.$`chmod +x ${stubNormal} ${stubFail}`;
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
      tickets: [],
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

async function makePiHome(): Promise<string> {
  const piHome = join(testRoot, "pi-home");
  await mkdir(piHome, { recursive: true });
  return piHome;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("setupWorkdir", () => {
  it("is exported as a function", async () => {
    const mod = await import("./pi-runner");
    expect(typeof mod.setupWorkdir).toBe("function");
    expect(typeof mod.runInvocation).toBe("function");
  });

  it("creates a fresh workdir under tempRoot", async () => {
    const { setupWorkdir } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("setup-normal");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-setup");
    await mkdir(tempRoot, { recursive: true });

    const setup = await setupWorkdir(question, tempRoot);
    expect(setup.workdir).toContain(tempRoot);
    await access(setup.workdir);
  });

  it("copies spec.md and tickets.md into workdir when present", async () => {
    const { setupWorkdir } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("setup-with-files", {
      hasSpec: true,
      hasTickets: true,
    });
    await setupQuestionDir(dir, {
      specContent: "# Spec\nRequirements here.",
      ticketsContent: "[ ]1. Ticket one\n[ ]2. Ticket two",
    });

    const tempRoot = join(testRoot, "tmp-setup-files");
    await mkdir(tempRoot, { recursive: true });

    const setup = await setupWorkdir(question, tempRoot);

    const specContent = await readFile(join(setup.workdir, "spec.md"), "utf-8");
    expect(specContent).toBe("# Spec\nRequirements here.");

    const ticketsContent = await readFile(join(setup.workdir, "tickets.md"), "utf-8");
    expect(ticketsContent).toBe("[ ]1. Ticket one\n[ ]2. Ticket two");
  });

  it("does not copy spec.md/tickets.md when they are absent", async () => {
    const { setupWorkdir } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("setup-no-files");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-setup-nofiles");
    await mkdir(tempRoot, { recursive: true });

    const setup = await setupWorkdir(question, tempRoot);

    const specExists = await access(join(setup.workdir, "spec.md"))
      .then(() => true)
      .catch(() => false);
    const ticketsExists = await access(join(setup.workdir, "tickets.md"))
      .then(() => true)
      .catch(() => false);

    expect(specExists).toBe(false);
    expect(ticketsExists).toBe(false);
  });
});

describe("runInvocation", () => {
  it("runs pi successfully and normalizes the session file to <sessionId>.jsonl", async () => {
    const { setupWorkdir, runInvocation } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("inv-normal");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-inv-normal");
    await mkdir(tempRoot, { recursive: true });
    const setup = await setupWorkdir(question, tempRoot);

    const result = await runInvocation({
      prompt: "Hello agent",
      workdir: setup.workdir,
      sessionId: "t1",
      extraArgs: setup.extraArgs,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubNormal,
      piHome: await makePiHome(),
      maxTurns: 100,
    });

    expect(result.exitCode).toBe(0);
    expect(result.maxTurnsExceeded).toBe(false);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.sessionFile).toBeTruthy();
    expect(result.sessionFile).toContain("t1.jsonl");
    expect(result.stdoutFile).toContain("pi-output-t1.log");

    // Session file exists and contains valid JSONL
    const sessionContent = await readFile(result.sessionFile!, "utf-8");
    const lines = sessionContent.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    JSON.parse(lines[0]); // should be valid JSON

    // Stdout log exists
    await access(result.stdoutFile);
  });

  it("keeps multiple invocations' session files side by side in one workdir", async () => {
    const { setupWorkdir, runInvocation } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("inv-multi");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-inv-multi");
    await mkdir(tempRoot, { recursive: true });
    const setup = await setupWorkdir(question, tempRoot);
    const piHome = await makePiHome();

    const first = await runInvocation({
      prompt: "Ticket one",
      workdir: setup.workdir,
      sessionId: "t1",
      extraArgs: setup.extraArgs,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubNormal,
      piHome,
      maxTurns: 100,
    });
    const second = await runInvocation({
      prompt: "Ticket two",
      workdir: setup.workdir,
      sessionId: "t2",
      extraArgs: setup.extraArgs,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubNormal,
      piHome,
      maxTurns: 100,
    });

    expect(first.sessionFile).toContain("t1.jsonl");
    expect(second.sessionFile).toContain("t2.jsonl");
    // Both transcripts survive side by side
    await access(first.sessionFile!);
    await access(second.sessionFile!);
  });

  it("captures non-zero exit code from pi", async () => {
    const { setupWorkdir, runInvocation } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("inv-fail");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-inv-fail");
    await mkdir(tempRoot, { recursive: true });
    const setup = await setupWorkdir(question, tempRoot);

    const result = await runInvocation({
      prompt: "Fail me",
      workdir: setup.workdir,
      sessionId: "t1",
      extraArgs: setup.extraArgs,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubFail,
      piHome: await makePiHome(),
      maxTurns: 100,
    });

    expect(result.exitCode).toBe(42);
  });

  it("captures stdout/stderr to pi-output-<sessionId>.log", async () => {
    const { setupWorkdir, runInvocation } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("inv-stdout");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-inv-stdout");
    await mkdir(tempRoot, { recursive: true });
    const setup = await setupWorkdir(question, tempRoot);

    const result = await runInvocation({
      prompt: "Output something",
      workdir: setup.workdir,
      sessionId: "t1",
      extraArgs: setup.extraArgs,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubNormal,
      piHome: await makePiHome(),
      maxTurns: 100,
    });

    const logContent = await readFile(result.stdoutFile, "utf-8");
    expect(logContent).toContain("pi: starting session");
    expect(logContent).toContain("pi: done");
  });

  it("sets sessionFile to null when pi produces no JSONL", async () => {
    const stubEmpty = join(stubBinDir, "pi-empty");
    await writeFile(
      stubEmpty,
      `#!/bin/sh\necho "pi: no session"; exit 0\n`
    );
    await Bun.$`chmod +x ${stubEmpty}`;

    const { setupWorkdir, runInvocation } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("inv-no-session");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-inv-no-session");
    await mkdir(tempRoot, { recursive: true });
    const setup = await setupWorkdir(question, tempRoot);

    const result = await runInvocation({
      prompt: "No session",
      workdir: setup.workdir,
      sessionId: "t1",
      extraArgs: setup.extraArgs,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubEmpty,
      piHome: await makePiHome(),
      maxTurns: 100,
    });

    expect(result.sessionFile).toBeNull();
  });
});

describe("sessionHasWriteToolErrors", () => {
  const toolResultLine = (toolName: string | null, isError: boolean) =>
    JSON.stringify({
      type: "message",
      message: {
        role: "toolResult",
        toolName,
        content: [{ type: "text", text: "boom" }],
        isError,
      },
    });

  it("detects a failed write tool (pi's native toolResult format)", async () => {
    const { sessionHasWriteToolErrors } = await import("./pi-runner");
    const f = join(testRoot, "dirty-write.jsonl");
    await writeFile(f, toolResultLine("write", true) + "\n");
    expect(await sessionHasWriteToolErrors(f)).toBe(true);
  });

  it("detects a failed edit tool", async () => {
    const { sessionHasWriteToolErrors } = await import("./pi-runner");
    const f = join(testRoot, "dirty-edit.jsonl");
    await writeFile(f, toolResultLine("edit", true) + "\n");
    expect(await sessionHasWriteToolErrors(f)).toBe(true);
  });

  it("detects a failed bash command (bash can mutate files)", async () => {
    const { sessionHasWriteToolErrors } = await import("./pi-runner");
    const f = join(testRoot, "dirty-bash.jsonl");
    await writeFile(f, toolResultLine("bash", true) + "\n");
    expect(await sessionHasWriteToolErrors(f)).toBe(true);
  });

  it("treats an unknown tool's failure as write-side (conservative)", async () => {
    const { sessionHasWriteToolErrors } = await import("./pi-runner");
    const f = join(testRoot, "dirty-unknown.jsonl");
    await writeFile(f, toolResultLine("some_extension_tool", true) + "\n");
    expect(await sessionHasWriteToolErrors(f)).toBe(true);
  });

  it("ignores failed read-only tools (read, grep)", async () => {
    const { sessionHasWriteToolErrors } = await import("./pi-runner");
    const f = join(testRoot, "dirty-readonly.jsonl");
    await writeFile(
      f,
      toolResultLine("read", true) + "\n" + toolResultLine("grep", true) + "\n"
    );
    expect(await sessionHasWriteToolErrors(f)).toBe(false);
  });

  it("detects failures in the content-item toolResult format", async () => {
    const { sessionHasWriteToolErrors } = await import("./pi-runner");
    const f = join(testRoot, "dirty-content-item.jsonl");
    await writeFile(
      f,
      '{"type":"message","message":{"role":"assistant","content":[{"type":"toolResult","isError":true}]}}\n'
    );
    expect(await sessionHasWriteToolErrors(f)).toBe(true);
  });

  it("returns false for a clean transcript", async () => {
    const { sessionHasWriteToolErrors } = await import("./pi-runner");
    const f = join(testRoot, "clean.jsonl");
    await writeFile(
      f,
      toolResultLine("write", false) + "\n" + toolResultLine("read", false) + "\n"
    );
    expect(await sessionHasWriteToolErrors(f)).toBe(false);
  });

  it("returns false for a missing file", async () => {
    const { sessionHasWriteToolErrors } = await import("./pi-runner");
    expect(await sessionHasWriteToolErrors(join(testRoot, "nope.jsonl"))).toBe(false);
  });
});

describe("parseVerdict", () => {
  const verdictLine = (verdict: string) =>
    JSON.stringify({
      type: "message",
      message: {
        role: "assistant",
        content: [{ type: "text", text: `Judgment done.\n<verdict>${verdict}</verdict>` }],
      },
    });

  it("parses COMPLETE from the last assistant message", async () => {
    const { parseVerdict } = await import("./pi-runner");
    const f = join(testRoot, "verdict-complete.jsonl");
    await writeFile(f, verdictLine("COMPLETE") + "\n");
    expect(await parseVerdict(f)).toBe("complete");
  });

  it("parses INCOMPLETE case-insensitively", async () => {
    const { parseVerdict } = await import("./pi-runner");
    const f = join(testRoot, "verdict-incomplete.jsonl");
    await writeFile(f, verdictLine("Incomplete") + "\n");
    expect(await parseVerdict(f)).toBe("incomplete");
  });

  it("prefers the last marker when several assistant messages carry one", async () => {
    const { parseVerdict } = await import("./pi-runner");
    const f = join(testRoot, "verdict-multi.jsonl");
    await writeFile(f, verdictLine("INCOMPLETE") + "\n" + verdictLine("COMPLETE") + "\n");
    expect(await parseVerdict(f)).toBe("complete");
  });

  it("returns null when no verdict marker exists", async () => {
    const { parseVerdict } = await import("./pi-runner");
    const f = join(testRoot, "verdict-none.jsonl");
    await writeFile(
      f,
      '{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"no verdict here"}]}}\n'
    );
    expect(await parseVerdict(f)).toBeNull();
  });
});

describe("sessionEndedWithApiError", () => {
  const assistantLine = (stopReason: string) =>
    JSON.stringify({
      type: "message",
      message: { role: "assistant", content: [], stopReason },
    });

  it("returns true when the last assistant message has stopReason error", async () => {
    const { sessionEndedWithApiError } = await import("./pi-runner");
    const f = join(testRoot, "api-error-last.jsonl");
    await writeFile(f, assistantLine("stop") + "\n" + assistantLine("error") + "\n");
    expect(await sessionEndedWithApiError(f)).toBe(true);
  });

  it("returns false when an earlier attempt errored but the last message is fine", async () => {
    const { sessionEndedWithApiError } = await import("./pi-runner");
    const f = join(testRoot, "api-error-recovered.jsonl");
    await writeFile(f, assistantLine("error") + "\n" + assistantLine("stop") + "\n");
    expect(await sessionEndedWithApiError(f)).toBe(false);
  });

  it("returns false for a missing file", async () => {
    const { sessionEndedWithApiError } = await import("./pi-runner");
    expect(await sessionEndedWithApiError(join(testRoot, "nope.jsonl"))).toBe(false);
  });
});

describe("runInvocation API failure detection", () => {
  /**
   * Stub pi emitting a terminal auto-retry failure on stdout (what a real
   * network outage looks like), writing a session file, and exiting 0 —
   * exactly how pi behaves when the API is unreachable.
   */
  const STUB_PI_RETRY_FAIL = [
    "#!/bin/sh",
    'echo "{\\"type\\":\\"auto_retry_start\\",\\"attempt\\":1,\\"maxAttempts\\":3,\\"delayMs\\":2000,\\"errorMessage\\":\\"Connection error.\\"}"',
    'echo "{\\"type\\":\\"auto_retry_end\\",\\"success\\":false,\\"attempt\\":3,\\"finalError\\":\\"Connection error.\\"}"',
    'SESSION_DIR=""',
    'SESSION_ID=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    --session-dir) SESSION_DIR="$2"; shift 2 ;;',
    '    --session-id) SESSION_ID="$2"; shift 2 ;;',
    '    *) shift ;;',
    "  esac",
    "done",
    'if [ -n "$SESSION_DIR" ] && [ -n "$SESSION_ID" ]; then',
    "  echo '{\"type\":\"message\",\"message\":{\"role\":\"assistant\",\"content\":[],\"stopReason\":\"error\"}}' > \"${SESSION_DIR}/${SESSION_ID}_session.jsonl\"",
    "fi",
    "exit 0",
  ].join("\n");

  it("captures a terminal auto-retry failure as apiError despite exit code 0", async () => {
    const stubRetryFail = join(stubBinDir, "pi-retry-fail");
    await writeFile(stubRetryFail, STUB_PI_RETRY_FAIL);
    await Bun.$`chmod +x ${stubRetryFail}`;

    const { setupWorkdir, runInvocation } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("inv-retry-fail");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-inv-retry-fail");
    await mkdir(tempRoot, { recursive: true });
    const setup = await setupWorkdir(question, tempRoot);

    const result = await runInvocation({
      prompt: "Hello agent",
      workdir: setup.workdir,
      sessionId: "t1",
      extraArgs: setup.extraArgs,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubRetryFail,
      piHome: await makePiHome(),
      maxTurns: 100,
    });

    expect(result.exitCode).toBe(0);
    expect(result.apiError).toBe("Connection error.");
  });

  it("flags apiError via the transcript backstop when no retry events appear", async () => {
    // Stub pi: no auto-retry events (e.g. auto-retry disabled), but the
    // transcript's last assistant message has stopReason "error".
    const stubSilentFail = join(stubBinDir, "pi-silent-fail");
    await writeFile(
      stubSilentFail,
      [
        "#!/bin/sh",
        'SESSION_DIR=""',
        'SESSION_ID=""',
        'while [ $# -gt 0 ]; do',
        '  case "$1" in',
        '    --session-dir) SESSION_DIR="$2"; shift 2 ;;',
        '    --session-id) SESSION_ID="$2"; shift 2 ;;',
        '    *) shift ;;',
        "  esac",
        "done",
        'if [ -n "$SESSION_DIR" ] && [ -n "$SESSION_ID" ]; then',
        "  echo '{\"type\":\"message\",\"message\":{\"role\":\"assistant\",\"content\":[],\"stopReason\":\"error\"}}' > \"${SESSION_DIR}/${SESSION_ID}_session.jsonl\"",
        "fi",
        "exit 0",
      ].join("\n")
    );
    await Bun.$`chmod +x ${stubSilentFail}`;

    const { setupWorkdir, runInvocation } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("inv-silent-fail");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-inv-silent-fail");
    await mkdir(tempRoot, { recursive: true });
    const setup = await setupWorkdir(question, tempRoot);

    const result = await runInvocation({
      prompt: "Hello agent",
      workdir: setup.workdir,
      sessionId: "t1",
      extraArgs: setup.extraArgs,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubSilentFail,
      piHome: await makePiHome(),
      maxTurns: 100,
    });

    expect(result.exitCode).toBe(0);
    expect(result.apiError).toBeTruthy();
  });

  it("reports no apiError for a healthy invocation", async () => {
    const { setupWorkdir, runInvocation } = await import("./pi-runner");
    const { question, dir } = makeMockQuestion("inv-healthy");
    await setupQuestionDir(dir, {});

    const tempRoot = join(testRoot, "tmp-inv-healthy");
    await mkdir(tempRoot, { recursive: true });
    const setup = await setupWorkdir(question, tempRoot);

    const result = await runInvocation({
      prompt: "Hello agent",
      workdir: setup.workdir,
      sessionId: "t1",
      extraArgs: setup.extraArgs,
      provider: "llamacpp-local",
      modelId: "my-model",
      piBin: stubNormal,
      piHome: await makePiHome(),
      maxTurns: 100,
    });

    expect(result.apiError).toBeNull();
  });
});
